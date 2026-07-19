import argparse
import asyncio
import base64
import json
import os
import re
import socket
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

from fastapi import BackgroundTasks, FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from api_client import stream_analyze, build_merge_messages, sync_merge_call, sync_humor_call, sync_associate_call

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Static file hosting deferred to end of file (after all API routes)
import sys

IMAGE_STORE: dict[str, dict] = {}
CLEANUP_DELAY = 900  # 15 minutes

STORAGE_ROOT = Path(__file__).parent / "storage"
PROFILES_DIR = STORAGE_ROOT / "profiles"
LEDGER_PATH = STORAGE_ROOT / "global_ledger.json"


# ---------------------------------------------------------------------------
# Profile I/O helpers
# ---------------------------------------------------------------------------

def _ensure_profiles_dir():
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)


def _profile_path(name: str) -> Path:
    return PROFILES_DIR / f"{name}.json"


def load_profile(name: str) -> dict:
    """Load a profile JSON, or return the default init structure.
    me.json is a lean global self-portrait (no history_sessions).
    Specific person JSONs carry dual-direction history_sessions."""
    _ensure_profiles_dir()
    path = _profile_path(name)
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    # Default structure
    data = {
        "name": name,
        "current_count": 0,
        "max_word_limit": 200,
        "persona_profile": "暂无历史记忆。这是与该对象的第一次对话分析。",
    }
    if name != "me":
        data["history_sessions"] = []
    return data


def save_profile(name: str, data: dict):
    _ensure_profiles_dir()
    path = _profile_path(name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Global ledger I/O helpers (append-only, no dedup, no sliding window)
# ---------------------------------------------------------------------------

def _load_ledger() -> list:
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    if LEDGER_PATH.exists():
        with open(LEDGER_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    # Initialize empty ledger
    with open(LEDGER_PATH, "w", encoding="utf-8") as f:
        json.dump([], f)
    return []


def _save_ledger(ledger: list):
    with open(LEDGER_PATH, "w", encoding="utf-8") as f:
        json.dump(ledger, f, ensure_ascii=False)


def _append_to_ledger(name: str, blocks: list):
    """Append all blocks as flat ledger entries. Pure append-only, no dedup."""
    try:
        ledger = _load_ledger()
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        for b in blocks:
            ledger.append({
                "timestamp": now,
                "target_name": name,
                "role": "对方" if b.get("side") == "left" else "自己",
                "quote": b.get("quote", ""),
                "emotion": b.get("emotion", ""),
                "expect": b.get("expect", ""),
            })
        _save_ledger(ledger)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Protocol parsers
# ---------------------------------------------------------------------------

def _parse_blocks(buffer: str):
    block_re = re.compile(r"\[BLOCK_START\](.*?)\[BLOCK_END\]", re.DOTALL)
    for m in block_re.finditer(buffer):
        body = m.group(1)
        block = {}
        for field, pattern in [
            ("side", r"SIDE\s*:\s*(left|right)"),
            ("quote", r"QUOTE\s*:\s*(.+?)(?=\n(?:SUBTEXT|EXPECT|EMOTION)\s*:)"),
            ("subtext", r"SUBTEXT\s*:\s*(.+?)(?=\n(?:EXPECT|EMOTION)\s*:)"),
            ("expect", r"EXPECT\s*:\s*(.+?)(?=\nEMOTION\s*:)"),
            ("emotion", r"EMOTION\s*:\s*(.+?)$"),
        ]:
            fm = re.search(pattern, body, re.DOTALL | re.IGNORECASE | re.MULTILINE)
            if fm:
                block[field] = fm.group(1).strip()
        if all(k in block for k in ("side", "quote", "subtext", "expect", "emotion")):
            yield block


def _parse_strategy(text: str) -> str:
    m = re.search(r"\[STRATEGY_START\](.*?)\[STRATEGY_END\]", text, re.DOTALL)
    if m:
        return m.group(1).strip()
    fallback = re.sub(r"\[(?:BLOCK_START|BLOCK_END|STRATEGY_START|STRATEGY_END)\]", "", text)
    fallback = fallback.strip()
    return fallback if fallback else ""


# ---------------------------------------------------------------------------
# Background memory maintenance
# ---------------------------------------------------------------------------

def post_analysis_memory(name: str, blocks: list):
    """Runs after SSE stream is fully sent.
    Dual-direction blocks are stored in the specific person's history_sessions.
    Every 5th analysis: left blocks merge into target profile, right blocks
    merge into the global me.json self-portrait."""
    try:
        # 0. Append to global ledger (long-term memory)
        _append_to_ledger(name, blocks)

        profile = load_profile(name)
        profile["current_count"] += 1
        history = profile.get("history_sessions", [])

        # 1. Session packaging (dual-direction, all blocks together)
        next_id = (history[-1]["session_id"] + 1) if history else 1
        session = {
            "session_id": next_id,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "blocks": blocks,
        }

        # 2. Line-level semantic dedup against the last session
        if history and blocks:
            last_quotes = {b.get("quote", "") for b in history[-1].get("blocks", [])}
            session["blocks"] = [b for b in blocks if b.get("quote", "") not in last_quotes]

        # Reject if dedup left nothing
        if session["blocks"]:
            history.append(session)

        # 3. No sliding window — keep all sessions permanently
        profile["history_sessions"] = history

        # 4. Split-merge on every 5th analysis
        if profile["current_count"] % 5 == 0 and history:
            recent = history[-5:]

            # 4a. Left blocks → target person's persona_profile
            left_flat = [b for s in recent for b in s.get("blocks", []) if b.get("side") == "left"]
            if left_flat:
                try:
                    messages = build_merge_messages(
                        profile["persona_profile"], left_flat, profile["max_word_limit"],
                    )
                    profile["persona_profile"] = sync_merge_call(messages)
                    profile["max_word_limit"] += 50
                except Exception:
                    pass

            # 4b. Right blocks → global me.json persona_profile
            right_flat = [b for s in recent for b in s.get("blocks", []) if b.get("side") == "right"]
            if right_flat:
                try:
                    me_profile = load_profile("me")
                    messages = build_merge_messages(
                        me_profile["persona_profile"], right_flat, me_profile.get("max_word_limit", 200),
                    )
                    me_profile["persona_profile"] = sync_merge_call(messages)
                    me_profile["max_word_limit"] = me_profile.get("max_word_limit", 200) + 50
                    save_profile("me", me_profile)
                except Exception:
                    pass

        save_profile(name, profile)

    except Exception:
        pass  # never let background task crash the process


# ---------------------------------------------------------------------------
# Profile management endpoints
# ---------------------------------------------------------------------------

@app.get("/api/profiles")
async def list_profiles():
    _ensure_profiles_dir()
    result = []
    for f in sorted(PROFILES_DIR.iterdir()):
        if f.suffix == ".json" and f.stem != "me":
            data = json.loads(f.read_text(encoding="utf-8"))
            result.append({"name": data.get("name", f.stem), "persona_profile": data.get("persona_profile", "")})
    return result


@app.post("/api/profiles/create")
async def create_profile(name: str = Query(...)):
    name = name.strip()
    if not name or "/" in name or "\\" in name:
        raise HTTPException(400, "姓名不合法")
    if name == "me":
        raise HTTPException(400, "me 为系统保留名称")
    _ensure_profiles_dir()
    if _profile_path(name).exists():
        raise HTTPException(400, "该人物已存在")
    data = {
        "name": name,
        "current_count": 0,
        "max_word_limit": 200,
        "persona_profile": "暂无历史记忆。这是与该对象的第一次对话分析。",
        "history_sessions": [],
    }
    save_profile(name, data)
    return {"name": name, "persona_profile": data["persona_profile"]}


# ---------------------------------------------------------------------------
# Humor generator endpoint
# ---------------------------------------------------------------------------

class HumorRequest(BaseModel):
    name: str
    blocks: list


@app.post("/api/generate_humor")
async def generate_humor(req: HumorRequest):
    profile = load_profile(req.name)
    try:
        result = sync_humor_call(profile["persona_profile"], req.blocks)
        return result
    except Exception as e:
        raise HTTPException(500, f"幽默回复生成失败: {str(e)}")


# ---------------------------------------------------------------------------
# Upload & Analyze endpoints
# ---------------------------------------------------------------------------

@app.post("/api/upload")
async def upload_image(file: UploadFile = File(...)):
    raw = await file.read()
    mime = file.content_type or "image/png"
    image_id = uuid.uuid4().hex[:12]
    IMAGE_STORE[image_id] = {
        "data": f"data:{mime};base64,{base64.b64encode(raw).decode()}",
        "ts": time.time(),
    }
    return {"image_id": image_id}


@app.get("/api/analyze/{image_id}")
async def analyze(
    image_id: str,
    background_tasks: BackgroundTasks,
    name: str = Query("default_user"),
    user_notes: str = Query("", description="用户的辅助判断与背景补充"),
):
    entry = IMAGE_STORE.get(image_id)
    if not entry:
        raise HTTPException(404, "图片不存在，请先上传")

    profile = load_profile(name)
    self_profile = load_profile("me")

    analysis_time = datetime.now().strftime("%Y年%m月%d日 %H:%M")

    async def event_generator():
        buffer = ""
        emitted_ids = set()
        block_counter = 0
        collected_blocks = []

        try:
            async for chunk in stream_analyze(entry["data"], profile["persona_profile"], self_profile["persona_profile"], profile.get("history_sessions", [])[-30:], analysis_time, user_notes):
                buffer += chunk

                for block in _parse_blocks(buffer):
                    key = (block["side"], block["quote"][:30])
                    if key not in emitted_ids:
                        emitted_ids.add(key)
                        block_counter += 1
                        block["id"] = block_counter
                        collected_blocks.append(block)
                        yield f"data: {json.dumps(block, ensure_ascii=False)}\n\n"

                buffer = re.sub(r"\[BLOCK_START\].*?\[BLOCK_END\]", "", buffer, flags=re.DOTALL)

            strategy = _parse_strategy(buffer)
            if strategy:
                yield f"data: {json.dumps({'type': 'strategy', 'content': strategy}, ensure_ascii=False)}\n\n"

            # Emit current persona_profile so the frontend panel refreshes instantly
            yield f"data: {json.dumps({'type': 'profile_update', 'content': profile['persona_profile']}, ensure_ascii=False)}\n\n"

        except asyncio.TimeoutError:
            yield f"data: {json.dumps({'type': 'error', 'message': '分析超时（60秒），请重试'}, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': f'分析出错: {str(e)}'}, ensure_ascii=False)}\n\n"
        finally:
            yield "data: [DONE]\n\n"
            asyncio.get_event_loop().call_later(CLEANUP_DELAY, lambda: IMAGE_STORE.pop(image_id, None))
            background_tasks.add_task(post_analysis_memory, name, collected_blocks)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Association endpoint (DeepSeek topic extension)
# ---------------------------------------------------------------------------

class AssociateRequest(BaseModel):
    word: str


@app.post("/api/associate")
async def associate(req: AssociateRequest):
    word = req.word.strip()
    if not word:
        raise HTTPException(400, "词不能为空")
    try:
        result = sync_associate_call(word)
        if not result:
            raise HTTPException(502, "联想生成失败，请检查 API Key 配置")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"联想接口出错: {str(e)}")


# Static file hosting for packaged Electron builds only
# Must be after all API routes so /api/* requests are not intercepted
if getattr(sys, 'frozen', False):
    _BUILD_DIR = Path(sys._MEIPASS) / "frontend" / "build"
    if _BUILD_DIR.exists():
        app.mount("/", StaticFiles(directory=str(_BUILD_DIR), html=True), name="static")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--storage-path", default=None, help="自定义数据存储根目录")
    parser.add_argument("--port", type=int, default=0, help="指定端口号（0=动态分配）")
    args = parser.parse_args()

    if args.storage_path:
        root = Path(args.storage_path)
        STORAGE_ROOT = root
        PROFILES_DIR = root / "profiles"
        LEDGER_PATH = root / "global_ledger.json"

    _ensure_profiles_dir()

    if args.port:
        port = args.port
    else:
        # 动态绑定空闲端口（避免与其他软件端口冲突）
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("", 0))
        port = sock.getsockname()[1]
        sock.close()

    # Electron 父进程通过此暗号截获端口号
    print(f"[SYS_PORT]:{port}", flush=True)
    sys.stdout.flush()

    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=port)
