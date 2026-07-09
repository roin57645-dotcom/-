# PROJECT_ARCHITECTURE.md — 对话动力学复盘助手

> 本文档供 AI 会话快速加载项目上下文。最后更新：2026-06-10

---

## 一、项目简介

上传聊天截图，AI 读懂对方潜台词、分析情绪、给出应对策略和幽默回复，并随使用次数积累越来越精准的人物画像。

核心能力：截图分析 → 策略建议 → 灵感回复 → 话题发散 → 长期记忆画像

---

## 二、技术栈概览

| 层级 | 技术 | 版本 | 备注 |
|------|------|------|------|
| 前端框架 | React | 18.3.1 | CRA 脚手架，未 eject |
| UI 样式 | Tailwind CSS | 3.4.0 | 原子化类名，无组件库 |
| 状态管理 | React useState | 内置 | 无 Redux/Zustand，全部状态集中在 App.jsx |
| HTTP 通信 | 原生 fetch | 内置 | 无 axios，SSE 用原生 EventSource |
| 构建工具 | react-scripts (Webpack) | 5.0.1 | 未自定义配置 |
| 画布引擎 | 原生 Canvas API + Vanilla JS | — | AssociationCanvas.js，非 React |
| 后端框架 | FastAPI + Uvicorn | — | 异步 Python |
| AI SDK | OpenAI Python SDK | — | 对接 MiMo + DeepSeek |
| 数据存储 | JSON 文件 | — | 无数据库 |

**项目特征**：极度轻量——零第三方 UI 库、零状态管理库、零路由库（单页面）、零 HTTP 封装库。

---

## 三、目录结构

```
dialogue-analysis/
├── .gitignore
├── start.bat                       # 一键启动（开两个 cmd 窗口：后端 8000 + 前端 3000）
├── PROJECT_ARCHITECTURE.md         # 本文档
│
├── backend/                        # Python 后端
│   ├── main.py                     # FastAPI 入口 + 全部 API 路由 + 记忆维护
│   ├── api_client.py               # AI 调用层：提示词工程 + 3 个模型接口 + 知识库加载
│   ├── requirements.txt            # fastapi, uvicorn, openai, python-multipart
│   ├── knowledge/                  # AI 参考语料（markdown 知识库，启动时加载）
│   │   ├── 对话心理学.md
│   │   └── 话术技巧.md
│   └── storage/                    # 持久化数据
│       ├── profiles/               # 人物画像 JSON
│       │   ├── me.json             # 全局自我画像（无 history_sessions）
│       │   └── {name}.json         # 具体对象画像（含双向 history_sessions）
│       └── global_ledger.json      # 全局对话流水账（append-only）
│
└── frontend/                       # React 前端
    ├── package.json
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── public/index.html
    └── src/
        ├── index.jsx               # React 入口（createRoot）
        ├── index.css               # 全局样式 + Tailwind 指令
        ├── App.jsx                 # 核心组件（全部状态 + 逻辑 + 布局，~611 行）
        ├── components/
        │   ├── AnalysisBox.jsx     # 单条分析结果卡片（折叠/展开双态）
        │   └── StrategyBar.jsx     # 全局策略建议展示栏
        └── canvas/
            ├── AssociationCanvas.js # 灵感发散画布引擎（Vanilla JS class）
            └── canvas.css           # 玻璃拟态主题样式（含明暗主题 CSS 变量）
```

---

## 四、后端 API 路由

| 方法 | 路径 | 功能 | 请求体/参数 |
|------|------|------|------------|
| POST | `/api/upload` | 上传截图 | FormData: file |
| GET | `/api/analyze/{image_id}` | SSE 流式分析 | Query: name |
| GET | `/api/profiles` | 列出所有人物画像 | — |
| POST | `/api/profiles/create` | 创建新人物 | Query: name |
| POST | `/api/generate_humor` | 生成幽默回复 | JSON: { name, blocks } |
| POST | `/api/associate` | DeepSeek 词联想 | JSON: { word } |
| GET | `/api/global_ledger` | 获取全局对话账本 | — |

### API 地址

- 后端：`http://localhost:8000`
- 前端：`http://localhost:3000`
- 跨域：后端 CORSMiddleware `allow_origins=["*"]`，全放开
- 鉴权：无。API Key 全部硬编码在后端 `api_client.py`

### 数据流

```
上传截图 → POST /api/upload → 返回 image_id（内存存储，15 分钟清理）
    ↓
开始分析 → GET /api/analyze/{image_id}?name=xxx (SSE)
    ↓
流式返回 → BLOCK 事件 → 前端实时渲染 AnalysisBox
         → STRATEGY 事件 → 前端渲染 StrategyBar
         → PROFILE_UPDATE 事件 → 前端刷新侧边栏画像
         → [DONE] → 后端触发 post_analysis_memory（记忆维护 + 账本写入）
```

---

## 五、AI 模型配置

| 用途 | 模型 | 端点 | 调用方式 |
|------|------|------|---------|
| 截图分析（视觉） | mimo-v2-omni | token-plan-cn.xiaomimimo.com/v1 | AsyncOpenAI 流式 |
| 幽默回复（文本） | mimo-v2.5-pro | 同上 | OpenAI 同步 |
| 词联想（文本） | deepseek-v4-flash | api.deepseek.com | OpenAI 兼容同步 |

所有 API Key 硬编码在 `api_client.py` 顶部，通过环境变量可覆盖。

---

## 六、核心开发规范

### 6.1 如何新增后端 API

1. 在 `main.py` 中定义路由函数（参考现有写法）
2. 如需调用 AI，在 `api_client.py` 中新增调用函数
3. 在 `main.py` 顶部 import 新函数
4. 无需重启——uvicorn 默认不支持热重载，需手动重启

```python
# main.py 中的标准模式
@app.post("/api/xxx")
async def xxx(req: SomeModel):
    try:
        result = some_ai_call(req.param)
        return result
    except Exception as e:
        raise HTTPException(500, f"错误: {str(e)}")
```

### 6.2 如何新增前端页面/面板

本项目是单页面应用，无路由。新增视图通过**条件渲染**实现：

```jsx
// 1. 在 App.jsx 中新增状态
const [panelOpen, setPanelOpen] = useState(false);

// 2. 在 JSX 中条件渲染
{panelOpen && <YourComponent onClose={() => setPanelOpen(false)} />}

// 3. 新增按钮触发
<button onClick={() => setPanelOpen(true)}>打开面板</button>
```

组件文件放在 `frontend/src/components/` 目录下。

### 6.3 如何新增前端 API 调用

直接使用原生 fetch，无需引入额外库：

```jsx
// GET 请求
fetch(`${API}/api/xxx`)
  .then((r) => r.json())
  .then((data) => setState(data))
  .catch(() => setError("请求失败"));

// POST 请求（JSON）
fetch(`${API}/api/xxx`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ key: value }),
})
  .then((r) => r.json())
  .then((data) => { /* 处理 */ });

// SSE 流式请求
const es = new EventSource(`${API}/api/analyze/${id}?name=${name}`);
es.onmessage = (e) => {
  if (e.data === "[DONE]") { es.close(); return; }
  const d = JSON.parse(e.data);
  // 处理事件
};
```

`API` 常量定义在 App.jsx 顶部：`const API = "http://localhost:8000";`

### 6.4 如何新增分析卡片类型

在 `AnalysisBox.jsx` 中：
1. 在 `EMOTION_ICONS` 中新增情绪映射
2. 在 `Section` 组件的渲染逻辑中新增字段展示

### 6.5 如何新增灵感发散画布的节点交互

在 `AssociationCanvas.js` 中：
- 注意这是 **Vanilla JS class**，不是 React 组件
- 用 `this.xxx` 管理实例状态，不用 useState
- 用原生 DOM API 操作节点，不用 JSX
- 事件监听直接绑定在 DOM 元素上（因 backdrop-filter 合成层问题，不要用事件委托）

### 6.6 如何扩展知识库

在 `backend/knowledge/` 目录下新增 `.md` 文件即可。文件名按字母/拼音排序拼接。**需要重启后端**才能生效（`_KNOWLEDGE_CACHE` 启动时一次性加载）。

### 6.7 如何新增人物画像字段

1. 修改 `main.py` 中 `load_profile` 的默认数据结构
2. 修改 `post_analysis_memory` 中的存储逻辑
3. 修改 `api_client.py` 中 `get_system_prompt` 的画像注入格式

---

## 七、记忆系统架构

### 7.1 双向会话存储

```
具体对象 JSON（如 美绪.json）
├── name, current_count, max_word_limit, persona_profile
└── history_sessions[]  ← 双向对话 blocks（对方+自己，最近 10 条）
    └── { session_id, timestamp, blocks[] }

me.json（全局自我画像）
├── name, current_count, max_word_limit, persona_profile
└── 无 history_sessions（精简结构）
```

### 7.2 记忆维护流程（post_analysis_memory）

1. 将本次 blocks 包装为 session，追加到 history_sessions
2. 与上一次 session 做行级去重（quote 匹配）
3. 滑动窗口保留最近 10 条 session
4. 每 5 次分析触发 split-merge：
   - left blocks → 对象画像蒸馏（sync_merge_call）
   - right blocks → me.json 自我画像蒸馏
5. 同时无条件写入 global_ledger.json（append-only，永不清除）

### 7.3 数据流图

```
截图分析完成
    ├── collected_blocks → post_analysis_memory
    │   ├── → 对象 JSON 的 history_sessions（滑动窗口 10 条）
    │   ├── → 每 5 次：left blocks → 对象 persona_profile（蒸馏合并）
    │   ├── → 每 5 次：right blocks → me.json persona_profile（蒸馏合并）
    │   └── → global_ledger.json（append-only 流水账）
    └── 流式结果 → 前端实时渲染
```

---

## 八、样式规范

### 8.1 双轨样式方案

| 场景 | 方案 | 说明 |
|------|------|------|
| 主布局 + 业务组件 | Tailwind CSS 原子类 | 直接写在 JSX className 中 |
| 灵感发散画布 | 独立 CSS 文件 | `canvas/canvas.css`，BEM-like 命名，CSS 自定义属性 |

### 8.2 配色约定

| 用途 | 色系 | Tailwind 类 |
|------|------|------------|
| 主操作按钮 | 蓝色 | `bg-blue-600 text-white` |
| 分析中/加载 | 蓝色 | `bg-blue-50 text-blue-600` |
| 幽默回复/灵感 | 琥珀色 | `bg-amber-50 text-amber-700 border-amber-200` |
| 对方分析卡片 | 灰色 | `bg-gray-50 border-gray-200` |
| 自己分析卡片 | 蓝色 | `bg-blue-50 border-blue-200` |
| 错误提示 | 红色 | `bg-red-50 border-red-200 text-red-700` |
| 策略建议 | 琥珀渐变 | `bg-gradient-to-r from-amber-50 to-orange-50` |
| 画布强调 | 黄色 | `#FFD600`（CSS 变量 --cm-accent） |

### 8.3 组件风格

- 圆角：`rounded-lg`（按钮/输入框）、`rounded-xl`（卡片/面板）
- 阴影：`shadow-sm`（默认）、`shadow-lg`（悬浮/弹出）
- 毛玻璃：`backdrop-blur-sm` / `backdrop-blur-xl`（画布和抽屉）
- 过渡：`transition`（全局默认）

---

## 九、已知风险与注意事项

| 风险 | 说明 | 规避方式 |
|------|------|---------|
| 文件编码 | 后端 .py 文件被编辑器存为 GBK 会报 SyntaxError | 确认编辑器使用 UTF-8 |
| Smart Quote | 编辑操作可能引入 Unicode 智能引号 `""` | 提示词字符串中只用 ASCII 引号 |
| 图片内存存储 | IMAGE_STORE 是 Python 字典，重启丢失 | 生产环境需改用持久化存储 |
| 知识库缓存 | _KNOWLEDGE_CACHE 启动时加载，运行时不变 | 新增 .md 后需重启后端 |
| 全局账本并发 | global_ledger.json 用 read-modify-write | 单进程安全，多 worker 需加锁 |
| 画布事件穿透 | backdrop-filter 创建合成层，事件委托失效 | 画布按钮使用直接事件监听器 |
| 无错误边界 | 无 React Error Boundary | 子组件异常会导致白屏 |
| 无前端路由 | 单页面，无 React Router | 如需多页面需引入路由库 |
| App.jsx 臃肿 | 全部状态+逻辑+布局集中在一个文件 | 功能继续增长时应拆分 |

---

## 十、启动方式

```bash
# 方式一：双击 start.bat（自动开两个 cmd 窗口）

# 方式二：手动分别启动
# 终端 1 — 后端
cd backend
pip install -r requirements.txt
python main.py    # → http://localhost:8000

# 终端 2 — 前端
cd frontend
npm install
npm start         # → http://localhost:3000
```

---

## 十一、Git 版本历史

```
535d7d9 feat: 添加全局对话归纳大账本 (global_ledger.json)
581aac5 refactor: 重构上下文记忆系统为双向会话存储架构
c229cd8 refactor: 重构幽默 prompt 为暧昧期推拉大师 + 策略段扩展输出
5f3dd84 feat: 添加拖拽截图落鱼区（Dropzone UI）
2c880d2 Initial commit: 对话动力学复盘助手
```

当前分支：`master`
