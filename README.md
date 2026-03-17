# Meco Studio 🚀

Meco Studio 是一个面向 **OpenClaw / OpenClew** 的智能体控制台与协作系统，强调三件事：**快**、**稳**、**可控**。  
它支持多智能体编排、圆桌讨论、实时音频推流、技能体系、知识库工作流，适合做本地优先的 AI 生产环境。 ⚡

## ✨ 为什么它“高级”

- 🧠 多智能体协同：支持角色化智能体、圆桌讨论、主持人机制、话题流转
- 🎙️ 实时互动：文本流式 + 推理流式 + 音频推流一体化
- 🔌 技能化扩展：OpenClaw skills / config skills 双生态兼容
- 🗂️ 知识库优先：热门话题抓取、分类沉淀、可复用上下文
- 🔒 本地优先架构：数据和会话主要在本地可控范围运行

## ⚡ 一行安装 / 升级

```bash
curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash
```

同一条命令即可安装和升级，重跑即更新。

## 🤖 AI 可读安装协议（Machine Readable）

```yaml
product: "Meco Studio"
repo: "https://github.com/EdenShadow/mecostudio"
install_command: "curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash"
upgrade_command: "curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash"
default_install_dir: "~/meco-studio"
default_openclaw_root: "~/.openclaw"
default_hot_topics_root: "~/Documents/知识库/热门话题"
service_url: "http://127.0.0.1:3456"
post_install_actions:
  - "openclaw install/upgrade if needed"
  - "kimi cli install if missing"
  - "whisper install for hot-topics audio analysis"
  - "sync bootstrap agents/skills (idempotent)"
  - "ensure hot-topics category folders under ~/Documents/知识库/热门话题"
  - "reset default test rooms to empty"
optional_env:
  - "MECO_INSTALL_DIR"
  - "MECO_BRANCH"
  - "MECO_START_AFTER_INSTALL"
  - "MECO_RESET_RUNTIME_STATE"
  - "MECO_UPGRADE_OPENCLAW"
  - "MECO_KIMI_API_KEY"
  - "HOT_TOPICS_ROOT"
```

## 🧩 安装后会自动做什么

- 安装/升级 OpenClaw（未安装自动安装）
- 安装 Kimi CLI（`curl -L code.kimi.com/install.sh | bash`）
- 安装 Whisper（`openai-whisper`，用于 hot-topics 音频分析）
- 拉取或更新 Meco Studio 到 `~/meco-studio`
- 安装依赖并同步初始化 agents/skills（幂等，不重复注册）
- 初始化 `~/Documents/知识库/热门话题` 及分类目录（仅补齐缺失，不覆盖已有内容）
- 默认清空测试房间数据（`data/rooms.json -> []`）
- 启动服务（默认 `http://127.0.0.1:3456`）

## 🔑 API Key 配置（首页左上角头像下拉）

打开 `http://127.0.0.1:3456`，点击左上角头像，下拉进入 **API Keys**。

推荐配置项：

- `OpenClaw Gateway Token`
- `Kimi API Key`
- `TikHub API Key`
- `MiniMax API Key`（TTS 必需）
- `OpenAI API Key`（可选，Whisper API 模式可用）

点击“确定并自动安装/激活”后会自动执行：

- 检测/安装 Kimi CLI
- 写入 Kimi 配置（`~/.kimi/config.json` / `~/.kimi/config.toml`）
- 安装 hot-topics 技能
- 安装 hot-topics 依赖（含 `openai-whisper`）
- 初始化热门话题知识库目录（仅补齐缺失）

## 🛠️ 常用高级参数（可选）

```bash
MECO_INSTALL_DIR="$HOME/meco-studio" \
MECO_BRANCH="main" \
MECO_START_AFTER_INSTALL=1 \
MECO_RESET_RUNTIME_STATE=1 \
MECO_UPGRADE_OPENCLAW=0 \
MECO_KIMI_API_KEY="sk-xxxxx" \
HOT_TOPICS_ROOT="$HOME/Documents/知识库/热门话题" \
curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash
```

## 📦 维护者打包命令

在仓库根目录执行：

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
