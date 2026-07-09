# 对话动力学复盘助手

> 把截图交给我，把思路还给你。

一款基于 AI 视觉模型的聊天截图分析工具。上传微信/QQ 聊天截图，自动解读每句话的潜台词、情绪状态和真实期待，输出可操作的应对策略，并长期积累对话对象的性格画像。

---

## 功能概览

| 功能 | 说明 |
|------|------|
| **逐句深度分析** | 识别截图中每条消息的发送方（左=对方，右=自己），分析潜台词、情绪、期待反馈 |
| **整体策略建议** | 基于对话态势给出 3-5 条可操作策略，每条附带示例话术 |
| **长期人物画像** | 为每位对话对象建立行为档案，随着分析次数增加，洞察越来越精准 |
| **幽默回复生成** | 一键生成轻量幽默的回复灵感（暧昧期推拉大师风） |
| **话题延伸画布** | 输入关键词 → 自动发散联想 → 可视化节点图，帮你在聊天中找新话题 |
| **全局对话账本** | 所有分析过的对话永久保存，支持按人物检索 |

---

## 快速开始

### 环境要求

- Python 3.10+
- Node.js 18+
- 阿里云百炼 API Key（获取 visual 模型访问权限）

### 1. 克隆仓库

```bash
git clone <your-repo-url>
cd dialogue-analysis
```

### 2. 配置环境变量

```bash
# 复制模板文件
cp .env.example .env

# 编辑 .env，填入你的 API 密钥
```

`.env` 内容：

```env
# 视觉分析模型（阿里云百炼 / 通义千问）
API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
API_KEY=你的阿里云API密钥
MODEL_NAME=qwen3.7-plus

# 联想模型（DeepSeek）
ASSOCIATE_BASE_URL=https://api.deepseek.com
ASSOCIATE_API_KEY=你的DeepSeek密钥
ASSOCIATE_MODEL=deepseek-v4-flash
```

> 也支持任何 OpenAI 兼容接口，修改 `API_BASE_URL`、`API_KEY`、`MODEL_NAME` 即可。

### 3. 安装依赖

```bash
# 后端
cd backend
pip install -r requirements.txt

# 前端
cd ../frontend
npm install
```

### 4. 启动

**Windows（一键启动）：**

```bash
start.bat
```

**手动启动：**

```bash
# 终端 1：后端
cd backend
python main.py --port 8000

# 终端 2：前端
cd frontend
npm start
```

浏览器打开 `http://localhost:3000`。

---

## 使用流程

1. **选择/创建人物** — 左侧下拉菜单，为每个对话对象建立独立档案
2. **上传截图** — 点击上传或拖拽微信聊天截图到页面
3. **开始分析** — 点击按钮，右侧实时流式显示分析结果
4. **查看策略** — 底部策略栏给出可操作的应对话术
5. **积累画像** — 每分析 5 次，系统自动蒸馏更新人物档案

---

## 项目结构

```
dialogue-analysis/
├── backend/                 # FastAPI 后端
│   ├── main.py              # API 路由、记忆系统、启动入口
│   ├── api_client.py        # AI 模型调用、Prompt 模板
│   ├── knowledge/           # 可复用的对话分析知识库 (.md)
│   │   ├── 对话心理学.md
│   │   ├── 话术技巧.md
│   │   └── 场景话术模板.md
│   └── storage/             # 运行时数据（gitignored）
│       ├── profiles/        # 人物画像 JSON
│       └── global_ledger.json  # 全局对话账本
├── frontend/                # React 前端
│   └── src/
│       ├── App.jsx          # 主组件
│       ├── components/      # AnalysisBox, StrategyBar
│       └── canvas/          # 话题延伸画布
├── desktop-app/             # Electron 桌面端（开发中）
├── .env.example             # 环境变量模板（可提交）
├── .env                     # 实际密钥（gitignored）
└── start.bat                # Windows 一键启动
```

---

## 自定义知识库

在 `backend/knowledge/` 下放置任意 `.md` 文件，系统会在每次分析时自动加载并注入到 AI prompt 中。

文件名自由（按字母排序拼接），内容会被完整传入 system prompt 的"参考知识库"段落。

示例：
```markdown
# 我的高价值回复模板

## 场景：对方情绪低落
- 先共情："听起来真的挺难受的"
- 再引导："你最想改变的是哪部分？"
```

---

## API 接口概览

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/profiles` | 列出所有人物的画像 |
| `POST` | `/api/profiles/create` | 创建新人物 |
| `POST` | `/api/upload` | 上传聊天截图 |
| `GET` | `/api/analyze/{id}?name=...` | SSE 流式分析 |
| `POST` | `/api/generate_humor` | 生成幽默回复 |
| `POST` | `/api/associate` | 词语发散联想 |
| `GET` | `/api/global_ledger` | 查看全局对话账本 |

---

## 记忆系统

- **人物画像** — 每 5 次分析自动蒸馏合并，保留行为模式、剔除一次性事件
- **对话时序** — 最近 30 次 session 的原始对话传入模型，全部数据永久保存
- **全局账本** — `global_ledger.json`，纯追加、不删减、永久可追溯

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18, Tailwind CSS 3, Vanilla JS Canvas |
| 后端 | FastAPI, Uvicorn, OpenAI SDK |
| AI | Qwen3.7-Plus（视觉分析）, DeepSeek（联想） |
| 桌面 | Electron + PyInstaller（开发中） |

---

## 安全

- 所有 API 密钥通过 `.env` 文件管理，`.gitignore` 已排除
- 提交前请确认 `.env` 不在暂存区
- 如需清理 git 历史中的旧密钥，建议去平台重置