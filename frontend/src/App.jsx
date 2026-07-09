import React, { useState, useRef, useEffect, useCallback } from "react";
import AnalysisBox from "./components/AnalysisBox";
import StrategyBar from "./components/StrategyBar";
import AssociationCanvas from "./canvas/AssociationCanvas";
import "./canvas/canvas.css";

const API = "http://localhost:8000";
const IMAGE_WIDTH = 420;
const COL_WIDTH = 300;
const GAP = 40;

export default function App() {
  const [image, setImage] = useState(null);
  const [imageId, setImageId] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [strategy, setStrategy] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [humorReplies, setHumorReplies] = useState([]);
  const [humorLoading, setHumorLoading] = useState(false);

  // ===== Drag & Drop state =====
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  // Drawer canvas state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerWord, setDrawerWord] = useState("");
  const canvasMountRef = useRef(null);
  const engineRef = useRef(null);

  useEffect(() => {
    if (!drawerOpen || !canvasMountRef.current) return;
    engineRef.current = new AssociationCanvas(canvasMountRef.current, API);
    const onClose = () => setDrawerOpen(false);
    canvasMountRef.current.addEventListener("canvas-close", onClose);
    return () => {
      canvasMountRef.current?.removeEventListener("canvas-close", onClose);
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [drawerOpen]);

  // ===== Global dragover/drop prevention =====
  // Prevent browser from opening images in new tab on drop outside dropzone
  useEffect(() => {
    const prevent = (e) => e.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  async function handleDrawerSearch() {
    const word = drawerWord.trim();
    if (!word) return;
    const eng = engineRef.current;
    if (!eng) return;
    eng._doSearch(word);
  }

  function handleDrawerClear() {
    engineRef.current?._clearGraph();
  }

  // Profile selector state
  const [profiles, setProfiles] = useState([]);
  const [selectedName, setSelectedName] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const newInputRef = useRef();
  const dropdownRef = useRef();
  const fileRef = useRef();

  const refreshProfiles = useCallback(() => {
    fetch(`${API}/api/profiles`)
      .then((r) => r.json())
      .then((data) => setProfiles(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshProfiles();
  }, [refreshProfiles]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImage(URL.createObjectURL(file));
    setBlocks([]);
    setStrategy("");
    setError("");
    setExpandedId(null);

    const form = new FormData();
    form.append("file", file);
    fetch(`${API}/api/upload`, { method: "POST", body: form })
      .then((r) => r.json())
      .then((d) => setImageId(d.image_id))
      .catch(() => setError("上传失败，请检查后端是否运行"));
  }

  // ===== Unified file processor for both file input and drag-drop =====
  function processFile(file) {
    setImage(URL.createObjectURL(file));
    setBlocks([]);
    setStrategy("");
    setError("");
    setExpandedId(null);

    const form = new FormData();
    form.append("file", file);
    fetch(`${API}/api/upload`, { method: "POST", body: form })
      .then((r) => r.json())
      .then((d) => setImageId(d.image_id))
      .catch(() => setError("上传失败，请检查后端是否运行"));
  }

  // ===== Dropzone event handlers (counter-based to avoid flicker) =====
  function handleDragEnter(e) {
    e.preventDefault();
    dragCounter.current += 1;
    if (dragCounter.current === 1) setIsDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setIsDragging(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);

    // 1. Physical file from system file manager or QQ saved image
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      processFile(file);
      return;
    }

    // 2. QQ in-memory screenshot / virtual clipboard stream fallback
    const html = e.dataTransfer.getData("text/html");
    if (html) {
      const match = html.match(/src="([^"]+)"/);
      if (match) {
        const imgUrl = match[1];
        fetch(imgUrl)
          .then((res) => res.blob())
          .then((blob) => {
            const virtualFile = new File([blob], "qq-screenshot.png", { type: blob.type || "image/png" });
            processFile(virtualFile);
          })
          .catch(() => setError("QQ 截图提取失败，请先保存到本地再上传"));
        return;
      }
    }

    setError("未识别到图片，请拖入聊天截图");
  }

  function startAnalyze() {
    if (!imageId || loading || !selectedName) return;
    setLoading(true);
    setBlocks([]);
    setStrategy("");
    setError("");
    setExpandedId(null);
    setHumorReplies([]);

    const nameParam = encodeURIComponent(selectedName);
    const es = new EventSource(`${API}/api/analyze/${imageId}?name=${nameParam}`);
    es.onmessage = (e) => {
      if (e.data === "[DONE]") {
        es.close();
        setLoading(false);
        return;
      }
      try {
        const d = JSON.parse(e.data);
        if (d.type === "error") {
          setError(d.message);
          es.close();
          setLoading(false);
        } else if (d.type === "strategy") {
          setStrategy(d.content);
        } else if (d.type === "profile_update") {
          setProfiles((prev) =>
            prev.map((p) =>
              p.name === selectedName ? { ...p, persona_profile: d.content } : p
            )
          );
        } else {
          setBlocks((prev) => [...prev, d]);
        }
      } catch {}
    };
    es.onerror = () => {
      es.close();
      setLoading(false);
      if (!blocks.length && !strategy) setError("连接中断，请重试");
    };
  }

  function handleCreate(name) {
    const trimmed = name.trim();
    if (!trimmed) {
      setIsCreating(false);
      return;
    }
    fetch(`${API}/api/profiles/create?name=${encodeURIComponent(trimmed)}`, { method: "POST" })
      .then((r) => {
        if (!r.ok) return r.json().then((d) => { throw new Error(d.detail); });
        return r.json();
      })
      .then((data) => {
        setProfiles((prev) => [...prev, { name: data.name, persona_profile: data.persona_profile }]);
        setSelectedName(data.name);
        setIsCreating(false);
        setDropdownOpen(false);
      })
      .catch((err) => setError(err.message || "创建失败"));
  }

  function handleCreateKeyDown(e) {
    if (e.key === "Enter") {
      handleCreate(e.target.value);
    } else if (e.key === "Escape") {
      setIsCreating(false);
    }
  }

  function selectProfile(name) {
    setSelectedName(name);
    setDropdownOpen(false);
    setHumorReplies([]);
  }

  function generateHumor() {
    if (!selectedName || !blocks.length || humorLoading) return;
    setHumorLoading(true);
    setHumorReplies([]);
    fetch(`${API}/api/generate_humor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: selectedName, blocks }),
    })
      .then((r) => {
        if (!r.ok) return r.json().then((d) => { throw new Error(d.detail); });
        return r.json();
      })
      .then((data) => { console.log("[humor] raw response:", JSON.stringify(data, null, 2)); setHumorReplies(data); })
      .catch((err) => { console.error("[humor] error:", err); setError(err.message || "生成失败"); })
      .finally(() => setHumorLoading(false));
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  const toggleExpand = (id) => setExpandedId((prev) => (prev === id ? null : id));

  const leftBlocks = blocks.filter((b) => b.side === "left");
  const rightBlocks = blocks.filter((b) => b.side === "right");
  const activeProfile = profiles.find((p) => p.name === selectedName);

  return (
    <>
    <div className={`min-h-screen bg-gray-50 flex p-6 gap-8 overflow-x-auto transition-all duration-300 ${drawerOpen ? "brightness-50" : ""}`}>

      {/* ===== Left Sidebar: config + profile card ===== */}
      <aside className="w-[280px] shrink-0 flex flex-col gap-4">

        {/* Profile Selector */}
        <div ref={dropdownRef}>
          {isCreating ? (
            <input
              ref={newInputRef}
              autoFocus
              type="text"
              placeholder="输入新人物姓名..."
              className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg shadow-sm
                placeholder-gray-400 text-gray-700
                focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-400 transition"
              onKeyDown={handleCreateKeyDown}
              onBlur={() => setIsCreating(false)}
            />
          ) : (
            <div className="relative">
              <button
                onClick={() => setDropdownOpen((v) => !v)}
                className="w-full px-3 py-2 text-sm text-left bg-white border border-gray-200
                  rounded-lg shadow-sm hover:shadow-md transition flex items-center justify-between"
              >
                <span className={selectedName ? "text-gray-800" : "text-gray-400"}>
                  {selectedName || "请选择分析对象..."}
                </span>
                <svg className="w-4 h-4 text-gray-400 shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {dropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-full bg-white border border-gray-200
                  rounded-lg shadow-lg overflow-hidden z-50">
                  {profiles.length > 0 && (
                    <div className="max-h-48 overflow-y-auto">
                      {profiles.map((p) => (
                        <div
                          key={p.name}
                          onClick={() => selectProfile(p.name)}
                          className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 transition
                            ${p.name === selectedName ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700"}`}
                        >
                          {p.name}
                        </div>
                      ))}
                    </div>
                  )}
                  <div
                    className="px-3 py-2 text-sm text-blue-600 cursor-pointer hover:bg-blue-50
                      border-t border-gray-100 font-medium transition"
                    onClick={() => {
                      setDropdownOpen(false);
                      setIsCreating(true);
                    }}
                  >
                    ➕ 添加新人物
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ProfileCard — long-term persona panel */}
        {activeProfile && (
          <div className="bg-white/80 backdrop-blur-sm border border-gray-200 rounded-xl shadow-sm p-3">
            <div className="text-xs font-semibold text-gray-500 mb-2 tracking-wide">
              👤 长期行为画像
            </div>
            <div className="text-xs text-gray-700 leading-relaxed max-h-[200px] overflow-y-auto
              scrollbar-thin pr-1">
              {activeProfile.persona_profile}
            </div>
          </div>
        )}

        {/* Humor Generator — only visible after analysis */}
        {selectedName && blocks.length > 0 && (
          <div className="flex flex-col gap-3">
            <button
              onClick={generateHumor}
              disabled={humorLoading}
              className="w-full px-3 py-2.5 text-sm font-medium text-amber-700 bg-amber-50
                border border-amber-200 rounded-lg shadow-sm hover:bg-amber-100
                transition disabled:opacity-50 disabled:cursor-not-allowed
                flex items-center justify-center gap-1.5"
            >
              {humorLoading ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  灵感生成中...
                </>
              ) : (
                <>✨ 幽默回复生成</>
              )}
            </button>

            {humorReplies.length > 0 && (
              <div className="bg-amber-50/50 border border-amber-200 rounded-xl shadow-sm p-3">
                <div className="text-xs font-semibold text-amber-600 mb-2 tracking-wide">
                  💡 灵感回复补给站
                </div>
                <div className="max-h-[160px] overflow-y-auto scrollbar-thin pr-1 space-y-2.5">
                  {humorReplies.map((item, i) => (
                    <div key={i} className="group">
                      <span className="inline-block text-[10px] font-bold text-amber-700 bg-amber-100
                        px-1.5 py-0.5 rounded-full mb-1">
                        {item.route}
                      </span>
                      <div className="flex items-start gap-1.5">
                        <p className="text-xs text-gray-700 leading-relaxed flex-1">
                          {item.reply}
                        </p>
                        <button
                          onClick={() => copyToClipboard(item.reply)}
                          className="shrink-0 text-[10px] text-gray-400 hover:text-amber-600
                            transition opacity-0 group-hover:opacity-100"
                          title="复制"
                        >
                          📋
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* ===== Right Main Canvas (Dropzone) ===== */}
      <main
        className="flex-1 flex flex-col items-center min-w-0 relative"
        onDragEnter={handleDragEnter}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Title */}
        <h1 className="text-2xl font-bold text-gray-800 mb-6">
          对话动力学复盘助手
        </h1>

        {/* Controls */}
        <div className="flex justify-center gap-4 mb-6">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
          <button
            onClick={() => fileRef.current.click()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            上传截图
          </button>
          <button
            onClick={startAnalyze}
            disabled={!imageId || loading || !selectedName}
            className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition
              disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? "分析中..." : "开始分析"}
          </button>
        </div>

        {error && (
          <div className="max-w-xl mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 text-center">
            {error}
          </div>
        )}

        {/* Three-column analysis canvas */}
        {image && (
          <div className="flex items-start justify-center" style={{ gap: GAP }}>
            {/* Left analysis column */}
            <div className="flex flex-col gap-3" style={{ width: COL_WIDTH }}>
              {leftBlocks.map((b) => (
                <AnalysisBox
                  key={b.id}
                  data={b}
                  side="left"
                  isExpanded={b.id === expandedId}
                  onToggle={toggleExpand}
                />
              ))}
            </div>

            {/* Center image */}
            <div
              className="border-2 border-gray-200 rounded-lg overflow-hidden shadow-lg shrink-0"
              style={{ width: IMAGE_WIDTH }}
            >
              <img
                src={image}
                alt="聊天截图"
                className="block w-full h-auto max-h-[80vh] object-contain"
              />
            </div>

            {/* Right analysis column */}
            <div className="flex flex-col gap-3" style={{ width: COL_WIDTH }}>
              {rightBlocks.map((b) => (
                <AnalysisBox
                  key={b.id}
                  data={b}
                  side="right"
                  isExpanded={b.id === expandedId}
                  onToggle={toggleExpand}
                />
              ))}
            </div>
          </div>
        )}

        {/* Strategy bar */}
        <StrategyBar content={strategy} />

        {/* Loading indicator */}
        {loading && !blocks.length && (
          <div className="text-center mt-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              AI 正在分析中，请稍候...
            </div>
          </div>
        )}

        {/* ===== Dropzone overlay ===== */}
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center
            bg-blue-500/10 backdrop-blur-sm border-4 border-dashed border-blue-500
            rounded-xl animate-pulse pointer-events-none">
            <div className="text-center">
              <div className="text-4xl mb-3">✨</div>
              <p className="text-lg font-semibold text-blue-600">
                识别到截图流，请在此处松手分析
              </p>
            </div>
          </div>
        )}
      </main>
    </div>

    {/* ===== Floating Button: Topic Extension ===== */}
    <button
      onClick={() => setDrawerOpen(true)}
      className="fixed top-4 right-14 z-40 w-10 h-10 flex items-center justify-center
        rounded-xl border border-gray-200 bg-white/80 backdrop-blur-md shadow-md
        hover:bg-amber-50 hover:border-amber-300 hover:shadow-lg transition-all duration-200
        text-gray-600 hover:text-amber-600"
      title="话题延伸"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
    </button>

    {/* ===== Drawer: Topic Extension Canvas ===== */}
    {drawerOpen && (
      <div className="fixed inset-0 z-[900] flex">
        {/* Overlay */}
        <div
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={() => setDrawerOpen(false)}
        />
        {/* Panel */}
        <div className="absolute top-0 right-0 w-2/3 h-full flex flex-col
          bg-white/80 backdrop-blur-xl border-l border-white/20 shadow-2xl
          animate-[slideIn_0.3s_ease-out]">
          {/* Toolbar */}
          <div className="relative z-[600] flex items-center gap-2 px-4 py-3
            border-b border-gray-200/50 bg-white/60 backdrop-blur-md shrink-0">
            <button
              onClick={() => setDrawerOpen(false)}
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200
                bg-white/60 hover:bg-gray-100 transition text-gray-600 text-sm font-medium shrink-0"
              title="返回"
            >
              ←
            </button>
            <button
              onClick={handleDrawerClear}
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200
                bg-white/60 hover:bg-red-50 hover:border-red-200 transition text-gray-500 hover:text-red-500
                text-sm shrink-0"
              title="清空画布"
            >
              ✕
            </button>
            <div className="flex-1 flex items-center h-9 rounded-lg border border-gray-200
              bg-white/70 px-3 gap-2">
              <input
                type="text"
                value={drawerWord}
                onChange={(e) => setDrawerWord(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleDrawerSearch(); }}
                placeholder="输入一个词，按 Enter 发散联想..."
                className="flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder-gray-400
                  min-w-0"
              />
              <button
                onClick={handleDrawerSearch}
                className="w-7 h-7 flex items-center justify-center rounded-md bg-amber-400 hover:bg-amber-500
                  text-gray-900 text-sm font-bold transition shrink-0"
                title="发散"
              >
                →
              </button>
            </div>
          </div>
          {/* Canvas mount point */}
          <div ref={canvasMountRef} className="flex-1 relative overflow-hidden" />
        </div>
      </div>
    )}
    </>
  );
}
