"""
Qwen3.7-Plus 视觉 + 对话分析能力测试
用法: python test_qwen.py
需先设置环境变量 DASHSCOPE_API_KEY=你的密钥
"""
import os
import sys
import io
import base64
from pathlib import Path

# Fix Windows GBK encoding
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from openai import OpenAI

API_BASE = "https://ws-svkkiga9n84qyoj5.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
MODEL = "qwen3.7-plus"
API_KEY = os.getenv("DASHSCOPE_API_KEY", "")

if not API_KEY:
    sys.stdout.write("[FAIL] 请先设置 API 密钥: set DASHSCOPE_API_KEY=你的密钥\n")
    sys.exit(1)

client = OpenAI(api_key=API_KEY, base_url=API_BASE)


# -- Test 1: Text dialogue analysis --
sys.stdout.write("=" * 50 + "\n")
sys.stdout.write("测试 1: 对话分析能力\n")
sys.stdout.write("=" * 50 + "\n")

resp = client.chat.completions.create(
    model=MODEL,
    messages=[
        {"role": "system", "content": "你是一个对话分析专家。"},
        {"role": "user", "content": """分析这段对话的潜台词和情绪走向：

对方：最近好累啊
自己：怎么了，工作上的事？
对方：嗯，项目赶进度，天天加班
自己：注意身体啊，别太拼了
对方：知道啦，你也是

请从潜台词、情绪状态、期待反馈三个维度分析对方的每句话。"""},
    ],
    max_tokens=512,
)

sys.stdout.write(resp.choices[0].message.content + "\n")
sys.stdout.write("[PASS] 测试 1 完成\n\n")


# -- Test 2: Vision ability with base64 local image --
sys.stdout.write("=" * 50 + "\n")
sys.stdout.write("测试 2: 视觉识别能力\n")
sys.stdout.write("=" * 50 + "\n")

import base64

# Use a local chat screenshot if available, otherwise create a minimal test image
test_img = Path(__file__).parent.parent / "test_chat_screenshot.png"
if test_img.exists():
    with open(test_img, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()
    img_type = "image/png"
    sys.stdout.write(f"使用本地截图: {test_img}\n")
else:
    # Fallback: 1x1 blue pixel png
    img_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    img_type = "image/png"
    sys.stdout.write("未找到本地截图，使用占位图。请放一张微信截图到项目根目录命名为 test_chat_screenshot.png\n")

data_url = f"data:{img_type};base64,{img_b64}"

resp2 = client.chat.completions.create(
    model=MODEL,
    messages=[
        {"role": "user", "content": [
            {"type": "text", "text": "描述这张图片的内容。如果是聊天截图，列出每个气泡的发送者和消息内容。"},
            {"type": "image_url", "image_url": {"url": data_url}},
        ]},
    ],
    max_tokens=512,
)

sys.stdout.write(resp2.choices[0].message.content + "\n")
sys.stdout.write("[PASS] 测试 2 完成\n\n")
sys.stdout.write("所有测试完成!\n")
