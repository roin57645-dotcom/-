# 对话动力学复盘助手 — 项目总结文档

> 生成日期：2026-05-18

---

## 一、项目概述

**对话动力学复盘助手** 是一款面向个人用户的聊天截图分析工具。用户上传微信等平台的聊天截图，系统通过多模态大模型对截图进行视觉理解与语义分析，输出结构化的对话动力学报告（潜台词、情绪、期待反馈），并提供全局应对策略和幽默灵感回复。

### 核心价值

- **对话复盘**：将模糊的"感觉对方话里有话"转化为结构化的潜台词分析
- **长期记忆**：跨次分析积累人物画像，越用越懂对方
- **灵感激发**：提供发散性幽默素材，而非死板的"万能话术"

---

## 二、技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React + Tailwind)           │
│                    http://localhost:3000                  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Profile   │  │ AnalysisBox  │  │   StrategyBar     │  │
│  │ Selector  │  │ (卡片组件)    │  │   (全局策略)       │  │
│  │ + Humor   │  │              │  │                   │  │
│  └──────────┘  └──────────────┘  └───────────────────┘  │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP / SSE
┌────────────────────────▼────────────────────────────────┐
│                    Backend (FastAPI)                      │
│                    http://localhost:8000                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Upload/Analyze│  │ Profile CRUD │  │ Humor Gen    │   │
│  │ (SSE stream)  │  │ (JSON file)  │  │ (sync call)  │   │
│  └──────┬───────┘  └──────────────┘  └──────┬───────┘   │
│         │                                    │           │
│  ┌──────▼────────────────────────────────────▼───────┐   │
│  │              api_client.py (AI 调用层)              │   │
│  │  stream_analyze / sync_merge_call / sync_humor_call│   │
│  └──────────────────────┬────────────────────────────┘   │
└─────────────────────────┼────────────────────────────────┘
                          │ OpenAI-compatible API
              ┌───────────▼───────────┐
              │  mimo-v2-omni (视觉)   │
              │  mimo-v2.5-pro (文本)  │
              │  token-plan-cn.xiaomi  │
              └───────────────────────┘
```

### 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | React | 18.3 |
| 样式方案 | Tailwind CSS | 3.4 |
| 构建工具 | Create React App (react-scripts) | 5.0.1 |
| 后端框架 | FastAPI | — |
| ASGI 服务器 | Uvicorn | — |
| AI SDK | OpenAI Python SDK (AsyncOpenAI / OpenAI) | — |
| 数据存储 | JSON 文件（`storage/profiles/`） | — |

### 大模型配置

| 用途 | 模型 ID | 调用方式 |
|------|---------|---------|
| 截图视觉分析 | `mimo-v2-omni` | AsyncOpenAI 流式 |
| 档案合并精炼 | `mimo-v2-omni` | OpenAI 同步 |
| 幽默灵感生成 | `mimo-v2.5-pro` | OpenAI 同步 |

> 重要发现：`mimo-v2-omni` 是视觉模型，纯文本任务会返回空结果。文本生成必须使用 `mimo-v2.5-pro`。

---

## 三、文件结构与职责

```
dialogue-analysis/
├── start.bat                          # 一键启动脚本（同时启动前后端）
├── PROJECT_SUMMARY.md                 # 本文档
│
├── backend/
│   ├── main.py                        # FastAPI 服务端入口
│   │   ├── /api/upload                # 图片上传（base64 内存缓存）
│   │   ├── /api/analyze/{image_id}    # SSE 流式分析
│   │   ├── /api/profiles              # 列出所有人物档案
│   │   ├── /api/profiles/create       # 创建新人物
│   │   └── /api/generate_humor        # 幽默灵感生成
│   │
│   ├── api_client.py                  # AI 调用层（所有 prompt 和解析逻辑）
│   │   ├── _PROTOCOL                  # 视觉分析系统提示词（含引用框剔除规则）
│   │   ├── stream_analyze()           # 异步流式截图分析
│   │   ├── build_merge_messages()     # 构建档案合并请求
│   │   ├── sync_merge_call()          # 同步档案合并调用
│   │   ├── build_humor_messages()     # 构建幽默灵感请求
│   │   ├── _parse_humor_text()        # 解析模型输出为字符串数组
│   │   └── sync_humor_call()          # 同步幽默灵感调用
│   │
│   ├── requirements.txt               # Python 依赖
│   └── storage/profiles/              # 人物档案持久化目录
│       ├── me.json                    # 用户自我画像
│       ├── 2.0.json                   # 对话对象档案
│       └── 111.json                   # 对话对象档案
│
└── frontend/
    ├── package.json                   # Node 依赖
    ├── tailwind.config.js             # Tailwind 配置
    ├── postcss.config.js              # PostCSS 配置
    ├── public/index.html              # HTML 入口
    └── src/
        ├── index.jsx                  # React 入口
        ├── index.css                  # 全局样式（Tailwind 导入）
        ├── App.jsx                    # 主组件（布局 + 状态管理）
        └── components/
            ├── AnalysisBox.jsx        # 对话分析卡片（折叠/展开）
            └── StrategyBar.jsx        # 全局策略建议栏
```

---

## 四、核心数据流

### 4.1 截图分析流

```
用户上传截图
    │
    ▼
POST /api/upload  →  base64 存入 IMAGE_STORE（内存字典）
    │                返回 image_id
    ▼
GET /api/analyze/{image_id}?name=xxx  →  SSE 流式响应
    │
    ├─ 读取目标人物档案 + 自我画像(me.json)
    ├─ 注入系统提示词（含微信引用框剔除规则 + 人设背景）
    ├─ 调用 mimo-v2-omni 流式视觉分析
    ├─ 实时解析 [BLOCK_START]...[BLOCK_END] → 推送 block 事件
    ├─ 解析 [STRATEGY_START]...[STRATEGY_END] → 推送 strategy 事件
    ├─ 推送 profile_update 事件（前端即时刷新画像面板）
    └─ 后台任务 post_analysis_memory()
        ├─ left_blocks → 更新目标人物档案
        └─ right_blocks → 更新 me.json（自我画像）
```

### 4.2 长期记忆机制

```
每次分析 → current_count++
    │
    ├── current_count % 5 != 0 → 仅保存 count
    │
    └── current_count % 5 == 0 → 触发档案合并
        ├─ 构建 MERGE_PROMPT（历史摘要 + 本次数据）
        ├─ 调用 mimo-v2-omni 生成新摘要
        ├─ max_word_limit += 50（从 200 起步，每合并一次扩容）
        └─ 保存更新后的 persona_profile
```

**重要性过滤铁律**：
- 保留：反复出现的情绪模式、稳定利益诉求、高频句式习惯、核心性格特质
- 剔除：一次性偶发事件、碎屑事实、无跨次分析价值的场景细节

### 4.3 幽默灵感生成流

```
用户点击"幽默回复生成"
    │
    ▼
POST /api/generate_humor  { name, blocks }
    │
    ├─ 为 blocks 数组最后 30% 标记 is_landing_zone: true
    ├─ 构建 prompt：完整对话上下文 + [着陆区] 标记
    │   → 要求围绕着陆区的关键词/意象生成 3 个 15-25 字幽默选项
    │   → 输出格式：["选项一","选项二","选项三"]
    ├─ 调用 mimo-v2.5-pro（纯文本模型）
    └─ 解析 JSON 数组 → 返回字符串列表
```

---

## 五、前端架构

### 5.1 全局布局（App.jsx）

```
┌──────────────────────────────────────────────────────┐
│  min-h-screen bg-gray-50 flex p-6 gap-8              │
│                                                      │
│  ┌──────────────┐  ┌──────────────────────────────┐  │
│  │  aside        │  │  main (flex-1)               │  │
│  │  w-[280px]    │  │                              │  │
│  │              │  │  ┌─────────────────────────┐  │  │
│  │  人物选择器    │  │  │  三栏分析画布             │  │  │
│  │  ┌──────────┐│  │  │  ┌─────┐ ┌─────┐ ┌─────┐│  │  │
│  │  │ Profile   ││  │  │  │ 对方 │ │ 截图 │ │ 自己 ││  │  │
│  │  │ Card      ││  │  │  │ 分析 │ │     │ │ 分析 ││  │  │
│  │  └──────────┘│  │  │  └─────┘ └─────┘ └─────┘│  │  │
│  │  ┌──────────┐│  │  └─────────────────────────┘  │  │
│  │  │ 灵感参考   ││  │                              │  │
│  │  │ ①②③     ││  │  ┌─────────────────────────┐  │  │
│  │  └──────────┘│  │  │  StrategyBar (全局策略)    │  │  │
│  └──────────────┘  │  └─────────────────────────┘  │  │
│                    └──────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### 5.2 组件职责

| 组件 | 文件 | 职责 |
|------|------|------|
| App | App.jsx | 全局状态、API 调用、布局编排 |
| AnalysisBox | components/AnalysisBox.jsx | 单条对话分析卡片（折叠态 44px / 展开态 max-h 320px） |
| StrategyBar | components/StrategyBar.jsx | 全局策略建议展示 |

### 5.3 SSE 事件处理

App.jsx 通过 `EventSource` 监听 `/api/analyze/{image_id}`，处理三种事件类型：

| 事件类型 | 处理逻辑 |
|----------|----------|
| block（无 type 字段） | 追加到 blocks 数组 → 渲染 AnalysisBox |
| `{ type: "strategy" }` | 设置 strategy 状态 → 渲染 StrategyBar |
| `{ type: "profile_update" }` | 即时更新 profiles 数组中对应人物的 persona_profile |
| `{ type: "error" }` | 显示错误提示，关闭连接 |
| `[DONE]` | 关闭 EventSource，停止 loading |

---

## 六、提示词工程

### 6.1 视觉分析提示词结构

```
系统提示词 = 角色定义 + 已知历史记忆（对方画像 + 自我画像） + 分析协议

分析协议包含：
├── 身份判断规则（左=对方，右=自己）
├── 微信引用框视觉无情剔除规则（最高优先级）
│   ├── QUOTE 清洗：剔除灰色引用框文字
│   └── SUBTEXT 关联：引用线索作为心理应激参考
├── 语义块聚合规则（连续消息合并）
├── 输出协议（BLOCK_START/BLOCK_END 格式）
├── 策略建议（STRATEGY_START/STRATEGY_END）
└── 注意事项
```

### 6.2 幽默灵感提示词

```
角色：思维跳跃、不设限的聊天灵感提供商
输入：完整对话上下文 + [着陆区] 标记
约束：
├── 3 个完全不同角度的回复选项
├── 每个 15-25 字，越短越有松弛感
├── 切入点锁定着陆区的关键词/意象/逻辑盲点
├── 严禁爹味、严禁大长篇、严禁陈年老梗
└── 输出纯 JSON 数组
```

### 6.3 档案合并提示词

```
角色：长期人格档案精炼编辑器
输入：A. 历史档案摘要 + B. 本次新对话数据
约束：
├── 重要性过滤器（保留模式、剔除偶发）
├── 字数限制（动态 max_word_limit）
├── 第三人称概述，不引用完整原话
└── 输出纯文本，无标记前缀
```

---

## 七、运行与部署

### 启动方式

```bash
# 方式一：一键启动（双窗口）
start.bat

# 方式二：分别启动
# 终端 1 — 后端
cd backend && python main.py

# 终端 2 — 前端
cd frontend && npm start
```

### 端口

| 服务 | 端口 | 地址 |
|------|------|------|
| 后端 (FastAPI) | 8000 | http://localhost:8000 |
| 前端 (React Dev) | 3000 | http://localhost:3000 |

### 依赖安装

```bash
# 后端
cd backend && pip install -r requirements.txt

# 前端
cd frontend && npm install
```

---

## 八、已知限制与改进方向

### 当前限制

1. **图片存储在内存**：`IMAGE_STORE` 是进程级字典，重启丢失，15 分钟后自动清理
2. **档案存储为 JSON 文件**：无数据库，不适合多用户并发场景
3. **无鉴权机制**：API 完全开放，任何人可访问
4. **模型返回格式不稳定**：`mimo-v2.5-pro` 对复杂 prompt 容易返回空或格式偏差，需要 fallback 解析

### 可改进方向

1. **持久化图片存储**：接入对象存储（OSS/S3）或本地文件系统
2. **数据库迁移**：将 profiles 从 JSON 文件迁移至 SQLite/PostgreSQL
3. **模型容错**：增加重试机制和模型降级策略
4. **多轮对话支持**：支持上传多张截图进行跨次分析
5. **导出功能**：支持将分析报告导出为 PDF/图片

---

## 九、开发历程关键节点

| 阶段 | 内容 | 解决的核心问题 |
|------|------|--------------|
| V1 | 基础 Flex 布局 + 折叠卡片 | MVP 可用 |
| V2 | 长期记忆层 + 档案合并 | 跨次分析能力 |
| V3 | 自我画像 (me.json) | 双向行为追踪 |
| V4 | 人物选择器 + ProfileCard | 多人物管理 |
| V5 | 两栏 Flex 重构 | 布局溢出修复 |
| V6 | 幽默灵感生成器 | 聊天素材激发 |
| V7 | 引用框剔除 + 去套路化 | 视觉污染 + 模板感 |

### 踩过的坑

- `mimo-v2-omni` 纯文本返回空 → 必须用 `mimo-v2.5-pro`
- 弯引号 `""` vs 直引号 `""` → 正则需同时支持两种
- Windows 批处理中文编码 → start.bat 改用纯英文
- Python 进程端口占用 → 启动前需 `taskkill` 旧进程
- 幽默模型返回格式不稳定 → JSON 解析 + 引号提取 + 行过滤三级 fallback
