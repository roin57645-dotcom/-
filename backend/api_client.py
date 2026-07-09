import os
import re
from pathlib import Path
from openai import OpenAI, AsyncOpenAI

API_BASE_URL = os.getenv("API_BASE_URL", "https://token-plan-cn.xiaomimimo.com/v1")
API_KEY = os.getenv("API_KEY", "")
MODEL_NAME = os.getenv("MODEL_NAME", "mimo-v2.5")

_KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"


def _load_knowledge() -> str:
    """Load all .md files from the knowledge directory, concatenated."""
    if not _KNOWLEDGE_DIR.exists():
        return ""
    parts = []
    for f in sorted(_KNOWLEDGE_DIR.iterdir()):
        if f.suffix == ".md":
            text = f.read_text(encoding="utf-8").strip()
            if text:
                parts.append(text)
    return "\n\n---\n\n".join(parts)


_KNOWLEDGE_CACHE = _load_knowledge()


_PROTOCOL = """## 身份判断规则
- 截图中靠右对齐的消息气泡 = "自己"（SIDE: right）
- 截图中靠左对齐的消息气泡 = "对方"（SIDE: left）

## 穷举扫描规则（最高优先级）
- 你必须从截图的**最顶部**开始，逐行向下扫描，直到**最底部**，确保不遗漏任何一条消息。
- 截图可能很长，包含 10 条甚至 20 条以上消息。你必须全部输出，不允许跳过中间或底部的任何气泡。
- 如果截图被截断（顶部或底部不完整），对截断部分标注"[截图未完整显示]"，但仍需分析可见的每一条。
- 完成所有 BLOCK 输出后，自查一遍：你输出的语义块数量是否与截图中可见的气泡数量一致？如果不一致，补充遗漏的块。

## 非文字内容识别规则
- 截图中可能出现图片、表情包、动图、语音消息、视频缩略图、链接卡片、小程序卡片等非纯文字内容。
- 对于这类内容，QUOTE 字段不能留空，必须用方括号描述该内容，例如：
  - QUOTE: [一张猫咪大笑的表情包]
  - QUOTE: [对方发送了一张海边风景照]
  - QUOTE: [一条5秒的语音消息]
  - QUOTE: [一个外卖小程序卡片]
- 在 SUBTEXT 分析中，结合该非文字内容的视觉含义进行潜台词解读（如：发表情包可能是为了化解尴尬、拉近距离、或回避正面回答）。

## 微信引用框视觉无情剔除规则（最高优先级）
- **视觉去重特征**：在截图中，某些消息气泡下方会挂着一个**字号较小、浅灰色矩形框包裹**的"引用历史文本"。
- **QUOTE 字段彻底清洗（反向约束）**：在输出该语义块的 QUOTE 时，**必须直接无视并无情剔除**灰色框内的所有历史文字，**仅逐字抄录发送者在气泡上方输入的全新文本**！绝对不允许让引用历史独立成块，也绝对不允许在 QUOTE 中出现重复文字。
- **上下文应激关联（正向约束）**：虽然在文本上扣掉了它，但你必须明白发送者是在精准回应被引用的那句话。请在分析 SUBTEXT（潜台词）时，将这个引用线索作为最高优先级的心理应激参考。

## 语义块聚合规则
- 如果同一个人连续发了多条消息（中间没被对方截断），将它们合并为一个语义块
- 单条消息独立成一个语义块
- 每个语义块只输出一个 BLOCK

## 输出协议（严格遵守）
每个语义块用以下格式输出，字段顺序固定，每个字段独占一行：

[BLOCK_START]
SIDE: left或right
QUOTE: 该语义块的对话原话（逐字抄录截图中的文字，多条消息用换行分隔；非文字内容用方括号描述，如[一张表情包]）
SUBTEXT: 潜台词分析（真实意图）
EXPECT: 期待反馈（想要怎样的回答）
EMOTION: 当前情绪状态（一个词，如：焦虑、愤怒、开心、冷漠、犹豫、期待、试探、讨好）
[BLOCK_END]

## 策略建议
所有 BLOCK 输出完毕后，输出一行分隔符：
[STRATEGY_START]
然后用自然语言给出详尽的整体应对策略建议，包括但不限于：
1. 对话的动态特征与双方心理态势的深层解读（展开分析，不要一句话带过）
2. 潜在的风险点、容易踩的雷区以及对方可能的隐藏诉求
3. 具体的应对策略（至少给出 3-5 条可操作的方向），每条策略后附上示例话术（如”xxxxx”），确保用户可以直接参考使用
4. 如果对话中存在多个可切入的破局点，请逐一展开分析，帮助用户从不同角度发散思维
输出篇幅不限，越详细越好，宁可多写不要遗漏。
[STRATEGY_END]

## 注意事项
- 每个 BLOCK 必须包含全部5个字段，缺一不可
- QUOTE 必须逐字抄录截图中的原始对话文字，不要翻译、改写或省略
- SUBTEXT 和 EXPECT 各写1-2句话，不要太长
- EMOTION 用一个词或短短语
- 严格按协议格式输出，不要添加任何额外的解释文字"""


def get_system_prompt(persona_profile: str, self_profile: str, history_sessions: list = None) -> str:
    memory_block = (
        f"## 已知历史记忆与人设背景\n"
        f"### 对方画像\n"
        f"以下是关于对话对象的长期记忆档案，在分析本次截图时请结合此背景进行更深层的洞察：\n"
        f"---\n{persona_profile}\n---\n\n"
        f"### 自我画像\n"
        f"以下是用户自身的说话习惯与性格特征档案，分析时请注意用户自身的行为模式：\n"
        f"---\n{self_profile}\n---\n\n"
    )

    # 近期真实对话时序线索
    history_block = ""
    if history_sessions:
        lines = []
        for s in history_sessions:
            sid = s.get("session_id", "?")
            ts = s.get("timestamp", "未知时间")
            for b in s.get("blocks", []):
                side = "对方" if b.get("side") == "left" else "自己"
                emotion = b.get("emotion", "")
                quote = b.get("quote", "")
                lines.append(f"[会话 #{sid}] [{ts}] {side}({emotion}): {quote}")
        if lines:
            history_block = (
                f"## 近期真实对话时序线索\n"
                f"以下是该对象最近几次未被蒸馏的真实对话记录，按时间顺序排列：\n"
                f"---\n" + "\n".join(lines) + f"\n---\n\n"
                f"你必须通读上述未被蒸馏的近期真实对话时序脉络。在生成最后的 [STRATEGY_START] 核心破局点时，"
                f"严禁碎片化分析，必须结合近期的时间线消长给出极具时序连续性的精准暧昧策略。\n\n"
            )

    knowledge_block = ""
    if _KNOWLEDGE_CACHE:
        knowledge_block = f"## 参考知识库\n以下是对话心理学与话术技巧的参考资料，分析时请结合这些知识给出更具人性化的洞察：\n---\n{_KNOWLEDGE_CACHE}\n---\n\n"

    return f"你是一个对话动力学分析专家。用户会给你一张聊天截图，请严格按以下规则分析。\n\n{knowledge_block}{memory_block}{history_block}{_PROTOCOL}"


MERGE_PROMPT_TEMPLATE = """你是一个长期人格档案的精炼编辑器。

## 输入
你会收到两部分内容：
- **A. 历史档案摘要**：该人物过去积累的人设画像与说话习惯总结。
- **B. 本次新对话数据**：最新一次截图分析中提取的对话原话、潜台词、情绪标签。

## 核心任务
将 B 合并进 A，生成一份更新后的、精炼的人物档案。

## 铁律——重要性过滤器
- **保留**：反复出现的情绪模式（如"每次被质疑就转移话题"）、稳定的利益诉求（如"始终关注价格"）、高频句式习惯（如"爱用反问句施压"）、核心性格特质（如"回避冲突型人格"）。
- **无情剔除**：一次性偶发事件（吃了什么、去了哪里、某次加班）、仅出现一次且无模式意义的碎屑事实、不具备跨次分析价值的具体场景细节。
- **输出约束**：总字数不得超过 {max_word_limit} 字。用第三人称概述，不要引用完整原话。语言风格为客观、精炼、无废话的画像式描述。

## 输出
直接输出更新后的人物档案文本（纯文本，不要加任何标记或前缀）。

---

## A. 历史档案摘要
{persona_profile}

## B. 本次新对话数据
{new_data}
"""


def build_merge_messages(persona_profile: str, blocks: list, max_word_limit: int) -> list:
    new_data_lines = []
    for b in blocks:
        side_label = "对方" if b.get("side") == "left" else "自己"
        new_data_lines.append(
            f"[{side_label}] 原话: {b.get('quote', '')}\n"
            f"  潜台词: {b.get('subtext', '')}\n"
            f"  情绪: {b.get('emotion', '')}"
        )
    new_data = "\n\n".join(new_data_lines)

    user_content = MERGE_PROMPT_TEMPLATE.format(
        max_word_limit=max_word_limit,
        persona_profile=persona_profile,
        new_data=new_data,
    )
    return [
        {"role": "system", "content": "你是一个长期人格档案的精炼编辑器。"},
        {"role": "user", "content": user_content},
    ]


async def stream_analyze(image_data_url: str, persona_profile: str, self_profile: str, history_sessions: list = None):
    client = AsyncOpenAI(api_key=API_KEY, base_url=API_BASE_URL)
    stream = await client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": get_system_prompt(persona_profile, self_profile, history_sessions)},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "请分析这张聊天截图中的对话动力学，严格按照系统提示中的协议格式输出："},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            },
        ],
        stream=True,
        max_tokens=16384,
    )
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content


def sync_merge_call(messages: list) -> str:
    client = OpenAI(api_key=API_KEY, base_url=API_BASE_URL)
    resp = client.chat.completions.create(
        model=MODEL_NAME,
        messages=messages,
        stream=False,
        max_tokens=2048,
    )
    return resp.choices[0].message.content.strip()


HUMOR_TEXT_MODEL = "mimo-v2.5-pro"

_HUMOR_SYSTEM_PROMPT = """你是一个情商极高、充满松弛感、带着轻微痞气与无限偏爱的暧昧期推拉大师。你的每一句话都像一句没经过精心准备的随口接话，日常、口语化、毫不费力。

## 核心任务
结合给定的【长期行为画像】和【当前对话时序文本】，精准锚定最后 1-2 轮对话的特定情境（着陆区），输出 3 种完全不同维度的暧昧期策略回复。

## 反向硬指标（违反即失败）
- 严禁陈年老梗（蓝瘦香菇、神马、给力、鸭梨山大等）
- 严禁客服腔、爹味、说教味、油腻的土味情话
- 严禁高高在上的官方安慰或心灵鸡汤
- 每条回复严格控制在 15-25 字之间，超出即废

## 正向生成指标

1. 【情境专属撑腰流】
百分百看懂并接住对方当下的狼狈、脆弱或倒霉处境（如生病、加班、天气糟糕）。
把调侃的靶子对准"命运、无常、天气或欺负对方的客观存在"，绝不对准对方本人。
核心效果：建立"只有我们两个人"的私人秘密同盟，提供看似荒诞不羁、实则极度护短的特殊特权和心理依恋。

2. 【越界安全试探流】
精准捕捉对方在文字、语气中流露出的一丝丝依赖或傲娇。
以"开玩笑"的形式合理化那些普通朋友眼里的越界行为。
用最轻描淡写的语气，说出最具有占有欲、指向特殊专属身份或暗示下一次见面的越界暗示。
核心效果：哪怕试探失败，也留有随时可以退回安全区的玩笑台阶——对方如果不接，这也只是一句玩笑话。

3. 【反客为主拉扯流】
抓住对方话里的细微漏洞，反手把聚光灯打在对方身上，进行不冒犯的推拉并制造下一次互动契机。

## 输出格式（严格遵守，违反即失败）
直接输出以下格式，不要有任何多余文字、不要 markdown 包裹、不要解释：

[ROUTE_1]
情境专属撑腰流
话术内容（15-25字）
[ROUTE_2]
越界安全试探流
话术内容（15-25字）
[ROUTE_3]
反客为主拉扯流
话术内容（15-25字）"""


def build_humor_messages(persona_profile: str, blocks: list) -> list:
    dialogue_lines = []
    for b in blocks[-6:]:
        side_label = "对方" if b.get("side") == "left" else "自己"
        dialogue_lines.append(f"{side_label}: {b.get('quote', '')}")
    dialogue = "\n".join(dialogue_lines)

    system_content = _HUMOR_SYSTEM_PROMPT
    if _KNOWLEDGE_CACHE:
        system_content += f"\n\n## 参考知识库\n以下是话术技巧参考资料，生成回复时请借鉴其中的接话框架和情绪共鸣方式：\n---\n{_KNOWLEDGE_CACHE}\n---"

    user_content = (
        f"## 长期行为画像\n{persona_profile}\n\n"
        f"## 当前对话（最后几轮）\n{dialogue}\n\n"
        f"请针对最后 1-2 轮对话，生成 3 种风格的幽默回复。"
    )
    return [
        {"role": "system", "content": system_content},
        {"role": "user", "content": user_content},
    ]


def _parse_humor_text(raw: str) -> list:
    routes = ["情境专属撑腰流", "越界安全试探流", "反客为主拉扯流"]

    # Try [ROUTE_N] format first
    route_blocks = re.split(r"\[ROUTE_\d+\]", raw)
    if len(route_blocks) >= 2:
        result = []
        for i, block in enumerate(route_blocks[1:]):
            if i >= 3:
                break
            lines = [l.strip() for l in block.strip().split("\n") if l.strip()]
            reply = lines[-1] if len(lines) > 1 else (lines[0] if lines else "")
            reply = reply.strip().strip('"').strip('"').strip('"')
            if reply and len(reply) > 2:
                result.append({"route": routes[i], "reply": reply})
        if result:
            # Fill missing routes with fallback
            while len(result) < 3:
                result.append({"route": routes[len(result)], "reply": "（该风格未生成，请重试）"})
            print(f"[humor] parsed via [ROUTE_N] format: {len(result)} routes")
            return result
        print(f"[humor] [ROUTE_N] format matched but all replies empty")

    # Fallback: extract quoted strings (support both smart and ASCII quotes)
    all_quotes = re.findall(r'[“”"‘’\']([^"“”‘’\']{8,})[“”"‘’\']', raw)
    if len(all_quotes) >= 3:
        print(f"[humor] parsed via quoted-string fallback: {len(all_quotes)} quotes found")
        return [{"route": routes[i], "reply": q.strip()} for i, q in enumerate(all_quotes[:3])]
    print(f"[humor] quoted-string fallback: only {len(all_quotes)} quotes found (need 3)")

    # Last resort: numbered lines
    replies = []
    parts = re.split(r'\d[.、]', raw)
    for part in parts[1:]:
        lines = part.strip().split("\n")
        for line in lines:
            line = line.strip().strip("*").strip()
            if any(tag in line for tag in ["自嘲", "网速", "拉扯", "效果", "小解析"]):
                continue
            if len(line) > 6:
                replies.append(line.strip('"').strip('"').strip('"'))
                break

    print(f"[humor] numbered-line fallback: extracted {len(replies)} replies: {replies}")
    result = []
    for i, route in enumerate(routes):
        text = replies[i] if i < len(replies) else "（生成失败，请重试）"
        result.append({"route": route, "reply": text})
    if any(r["reply"] == "（生成失败，请重试）" for r in result):
        print(f"[humor] FINAL FALLBACK triggered — model output did not match any parser")
    return result


def sync_humor_call(persona_profile: str, blocks: list) -> list:
    client = OpenAI(api_key=API_KEY, base_url=API_BASE_URL)
    messages = build_humor_messages(persona_profile, blocks)
    resp = client.chat.completions.create(
        model=HUMOR_TEXT_MODEL,
        messages=messages,
        stream=False,
        max_tokens=2048,
    )
    raw = resp.choices[0].message.content or ""
    print(f"[humor] === RAW MODEL OUTPUT ===\n{raw}\n[humor] === END RAW ===")
    return _parse_humor_text(raw)


# ---------------------------------------------------------------------------
# Association (DeepSeek) — topic extension
# ---------------------------------------------------------------------------

ASSOCIATE_MODEL = os.getenv("ASSOCIATE_MODEL", "deepseek-v4-flash")
ASSOCIATE_BASE_URL = os.getenv("ASSOCIATE_BASE_URL", "https://api.deepseek.com")
ASSOCIATE_API_KEY = os.getenv("ASSOCIATE_API_KEY", "")

_ASSOCIATE_SYSTEM_PROMPT = """你是一个创意联想专家。用户会给你一个词，你需要围绕它进行发散联想。

## 铁律（违反即失败）
- 严格只返回一个 JSON 数组，不要返回任何解释、前缀、后缀、markdown 标记或多余文字。
- 数组内恰好 8 个对象，每个对象包含 "zh"（中文词）和 "en"（英文词）两个字段。
- 联想词应跨越不同维度（情感、感官、文化、自然、科技、抽象概念等），避免同义重复。
- 如果你返回了 JSON 以外的任何内容，本次任务视为失败。

## 正确示例
输入：月亮
输出：[{"zh":"潮汐","en":"Tide"},{"zh":"孤独","en":"Solitude"},{"zh":"桂花","en":"Osmanthus"},{"zh":"阿波罗","en":"Apollo"},{"zh":"反光","en":"Reflection"},{"zh":"狼人","en":"Werewolf"},{"zh":"阴晴圆缺","en":"Wax and Wane"},{"zh":"引力","en":"Gravity"}]

## 错误示例（绝对禁止）
- 用 ```json ``` 包裹
- 在数组前后添加"好的，这是..."等废话
- 返回少于或多于 8 个词
- 只返回中文不返回英文"""


def sync_associate_call(word: str) -> list:
    client = OpenAI(api_key=ASSOCIATE_API_KEY, base_url=ASSOCIATE_BASE_URL)
    resp = client.chat.completions.create(
        model=ASSOCIATE_MODEL,
        messages=[
            {"role": "system", "content": _ASSOCIATE_SYSTEM_PROMPT},
            {"role": "user", "content": word},
        ],
        temperature=0.7,
        max_tokens=1024,
        stream=False,
    )
    raw = resp.choices[0].message.content or ""
    print(f"[associate] === RAW MODEL OUTPUT ===\n{raw}\n[associate] === END RAW ===")

    # Markdown shell cleaning: extract [...] substring
    m = re.search(r"\[.*\]", raw, re.DOTALL)
    if m:
        raw = m.group(0)

    try:
        import json
        arr = json.loads(raw)
        if isinstance(arr, list):
            result = [{"zh": str(item.get("zh", "")), "en": str(item.get("en", ""))} for item in arr[:8]]
            print(f"[associate] parsed {len(result)} words OK")
            return result
    except (json.JSONDecodeError, ValueError, AttributeError) as e:
        print(f"[associate] JSON parse failed: {e}")
        print(f"[associate] cleaned raw: {raw[:200]}")

    return []
