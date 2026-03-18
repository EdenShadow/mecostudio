# Meco Studio 🚀

## ⚡ 一行安装 / 升级

```bash
curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash
```

同一条命令既可首次安装，也可后续升级（重跑即更新）。

## 🌟 项目亮点

- 🧠 **多智能体编排引擎**：角色化智能体协作、主持人机制、动态麦序与话题切换
- 🎙️ **实时互动系统**：流式思考 + 流式回复 + 实时音频推流一体化
- 🔌 **双技能生态**：兼容 OpenClaw skills 与 config skills，扩展能力极强
- 🗂️ **知识库优先架构**：热门话题抓取、分类沉淀、历史上下文复用
- 🔒 **本地优先控制**：关键数据与运行状态尽量保持在本地可控边界
- ⚙️ **安装与升级幂等**：一条命令重复执行即可升级，不破坏已有目录

> **OpenClaw 多智能体控制中枢**  
> 更快的推理、更稳的音频推流、更可控的本地化协作工作流。  
> 从单体聊天到多人圆桌，从技能调用到知识库沉淀，一套系统打通。 ⚡

![Meco Studio Hero](assets/readme/hero-1.png)

![Meco Studio Roundtable](assets/readme/hero-2.png)

## 🖼️ 产品界面预览

| 控制台 | 多智能体协作 |
|---|---|
| ![Feature 1](assets/readme/feature-1.png) | ![Feature 2](assets/readme/feature-2.png) |

| 圆桌舞台 | 话题与推流 |
|---|---|
| ![Feature 3](assets/readme/feature-3.png) | ![Feature 4](assets/readme/feature-4.png) |

## 📌 安装后自动完成

- 安装/升级 OpenClaw（未安装自动安装）
- 安装 Kimi CLI（`curl -L code.kimi.com/install.sh | bash`）
- 安装 Whisper（`openai-whisper`，用于 hot-topics 音频分析）
- 拉取或更新 Meco Studio 到 `~/meco-studio`
- 安装 npm 依赖并同步初始化 agents/skills（幂等）
- 初始化 `~/Documents/知识库/热门话题` 分类目录（仅补齐，不覆盖）
- 清空默认测试房间数据（`data/rooms.json` -> `[]`）
- 启动服务（默认 `http://127.0.0.1:3456`）

## 🔑 API Key 配置（首页左上角头像下拉）

打开 `http://127.0.0.1:3456`，点击左上角头像进入 **API Keys**。

OpenClaw 的 `HTTP URL / WS URL / Gateway Token` 现在会由 Meco Studio 自动从本机 OpenClaw 配置发现，不需要手填。

推荐配置：

- `Kimi Coding API Key`
- `TikHub API Key`
- `MeowLoad API Key`（哼哼猫 / media-downloader）
- `MiniMax API Key`（TTS 必需）

点击“确定并自动安装/激活”后会自动执行：

- 检测/安装 Kimi CLI
- 写入 `~/.kimi/config.json` / `~/.kimi/config.toml`
- 安装 hot-topics 技能及依赖（含 `openai-whisper`）
- 自动确定 `Kimi CLI Command` 与 `Hot Topics KB Path`
- 初始化热门话题知识库目录（仅补齐缺失）

## 🧪 常用环境变量（可选）

```bash
MECO_INSTALL_DIR="$HOME/meco-studio" \
MECO_BRANCH="main" \
MECO_START_AFTER_INSTALL=1 \
MECO_RESET_RUNTIME_STATE=1 \
MECO_UPGRADE_OPENCLAW=0 \
MECO_OPENCLAW_MODEL="kimi-coding/kimi-k2.5" \
MECO_OPENCLAW_MODEL_API_KEY="sk-xxxxx" \
MECO_KIMI_CODING_API_KEY="sk-xxxxx" \
MECO_MINIMAX_API_KEY="xxxx" \
MECO_TIKHUB_API_KEY="xxxx" \
MECO_MEOWLOAD_API_KEY="xxxx" \
MECO_OPENAI_API_KEY="" \
HOT_TOPICS_ROOT="$HOME/Documents/知识库/热门话题" \
curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash
```

说明：

- `MECO_OPENCLAW_MODEL`：安装时写入 OpenClaw 默认模型
- `MECO_OPENCLAW_MODEL_API_KEY`：安装时写入 OpenClaw 对应 provider 的 key
- `MECO_KIMI_CODING_API_KEY`：用于 Kimi CLI 激活，并可作为 OpenClaw kimi provider 的 key 兜底
- `MECO_MINIMAX_API_KEY` / `MECO_TIKHUB_API_KEY` / `MECO_MEOWLOAD_API_KEY`：开箱即用所需关键能力
- `MECO_OPENAI_API_KEY`：可选，Whisper API 模式可用

## 🤖 AI 可读协议（Machine Readable Spec）

```yaml
product: "Meco Studio"
repo: "https://github.com/EdenShadow/mecostudio"
install_command: "curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash"
upgrade_command: "curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash"
default_install_dir: "~/meco-studio"
default_openclaw_root: "~/.openclaw"
default_hot_topics_root: "~/Documents/知识库/热门话题"
service_url: "http://127.0.0.1:3456"
required_api_keys:
  - "Kimi Coding API Key"
  - "TikHub API Key"
  - "MeowLoad API Key"
  - "MiniMax API Key"
optional_api_keys:
  - "OpenAI API Key"
post_install_actions:
  - "openclaw install/upgrade if needed"
  - "auto discover openclaw http/ws/token from local config"
  - "write openclaw default model and provider api key"
  - "kimi cli install if missing"
  - "whisper install for hot-topics audio analysis"
  - "sync bootstrap agents/skills (idempotent)"
  - "ensure hot-topics category folders under ~/Documents/知识库/热门话题"
  - "reset default test rooms to empty"
```

## 📦 维护者打包

```bash
bash scripts/build-bootstrap-package.sh
```

可选定向打包：

```bash
MECO_BOOTSTRAP_AGENTS="main,gates,hawking,jobs,kobe,munger" \
MECO_BOOTSTRAP_OPENCLAW_SKILLS="hot-topics,kimi-search,twitter-scraper,tikhub-api,x-grok" \
MECO_BOOTSTRAP_CONFIG_SKILLS="hot-topics" \
bash scripts/build-bootstrap-package.sh
```

初始化包输出目录：`bootstrap/openclaw/`
