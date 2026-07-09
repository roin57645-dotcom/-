import React from "react";

const EMOTION_ICONS = {
  "焦虑": "😰", "愤怒": "🔥", "开心": "😊", "冷漠": "😐",
  "犹豫": "🤔", "期待": "🌟", "试探": "🔍", "讨好": "🥺",
};

const SIDE_STYLES = {
  left: {
    collapsed: "bg-gray-50 border-gray-200",
    expanded: "bg-white border-gray-200",
    badge: "bg-gray-200 text-gray-600",
    quoteBg: "bg-gray-100",
  },
  right: {
    collapsed: "bg-blue-50/60 border-blue-200",
    expanded: "bg-white border-blue-200",
    badge: "bg-blue-100 text-blue-600",
    quoteBg: "bg-blue-50",
  },
};

function CollapsedTag({ data, side, onClick }) {
  const s = SIDE_STYLES[side];
  const icon = EMOTION_ICONS[data.emotion] || "💬";
  const truncated = data.quote?.length > 10 ? data.quote.slice(0, 10) + "..." : data.quote;

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 px-3 rounded-lg border cursor-pointer
        hover:shadow-md transition-all duration-200 select-none ${s.collapsed}`}
      style={{ height: 44 }}
    >
      <span className="text-xs font-mono text-gray-400 shrink-0">#{data.id}</span>
      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${s.badge}`}>
        {side === "left" ? "对方" : "自己"}
      </span>
      <span className="text-sm shrink-0">{icon}</span>
      <span className="text-xs text-gray-500 truncate">{truncated}</span>
    </div>
  );
}

function ExpandedCard({ data, side, onCollapse }) {
  const s = SIDE_STYLES[side];
  const icon = EMOTION_ICONS[data.emotion] || "💬";

  return (
    <div className={`rounded-xl border shadow-lg overflow-hidden ${s.expanded}`}>
      {/* Header — click to collapse */}
      <div
        className={`flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-gray-50
          select-none border-b border-gray-100`}
        onClick={onCollapse}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-gray-400">#{data.id}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${s.badge}`}>
            {side === "left" ? "对方" : "自己"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{icon}</span>
          <span className="text-xs font-medium text-gray-600">{data.emotion}</span>
        </div>
      </div>

      {/* Body — scrollable */}
      <div className="px-4 py-3 space-y-3 overflow-y-auto max-h-[320px]">
        {/* Original quote */}
        <div className={`rounded-lg px-3 py-2.5 ${s.quoteBg}`}>
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
            对话原话
          </span>
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
            {data.quote}
          </p>
        </div>

        {/* Subtext */}
        <Section label="潜台词分析" text={data.subtext} />

        {/* Expect */}
        <Section label="期待反馈" text={data.expect} />

        {/* Emotion */}
        <div className="flex items-center gap-1.5 pt-1">
          <span className="text-base">{icon}</span>
          <span className="text-sm font-medium text-gray-600">{data.emotion}</span>
        </div>
      </div>
    </div>
  );
}

function Section({ label, text }) {
  return (
    <div>
      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
      <p className="text-xs text-gray-700 leading-relaxed mt-0.5">{text}</p>
    </div>
  );
}

export default function AnalysisBox({ data, side, isExpanded, onToggle }) {
  if (isExpanded) {
    return <ExpandedCard data={data} side={side} onCollapse={() => onToggle(data.id)} />;
  }
  return <CollapsedTag data={data} side={side} onClick={() => onToggle(data.id)} />;
}
