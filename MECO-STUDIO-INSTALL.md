# Meco Studio 安装 / 升级 / API Key 一体文档（AI 可读）

## 一行安装（Install）

```bash
curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash
```

## 一行升级（Upgrade）

```bash
curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash
```

同一命令可重复执行，脚本为幂等设计。

## 安装脚本默认行为

- 安装/升级 OpenClaw（未安装自动安装）
- 安装 Kimi CLI（`curl -L code.kimi.com/install.sh | bash`）
- 安装 Whisper（`python3 -m pip install --user --upgrade openai-whisper`）
- 拉取或更新仓库至 `~/meco-studio`
- 安装 npm 依赖
- 同步 bootstrap agents/skills（幂等，不重复注册）
- 初始化 `~/Documents/知识库/热门话题` 及分类目录（只补齐缺失，不覆盖已有内容）
- 默认清空测试房间数据（`data/rooms.json = []`）
- 启动服务（默认 `http://127.0.0.1:3456`）

分类目录：

- `AI_Tech`
- `Entertainment`
- `Military`
- `Sports`
- `Design`
- `Health`
- `Politics`
- `Technology`
- `Economy`
- `Medical`
- `Society`
- `Trending`

## API Key 配置（UI）

安装后访问 `http://127.0.0.1:3456`，点击左上角头像下拉，进入 **API Keys**。

OpenClaw 连接项（HTTP URL / WS URL / Gateway Token）已改为自动发现，不需要填写。

推荐配置项：

- `Kimi Coding API Key`
- `TikHub API Key`
- `MiniMax API Key`（TTS）

点击“确定并自动安装/激活”后自动执行：

- 检测/安装 Kimi CLI
- 写入 `~/.kimi/config.json` / `~/.kimi/config.toml`
- 安装 hot-topics 技能
- 安装 hot-topics 依赖（含 whisper）
- 自动确定 `Kimi CLI Command` 与 `Hot Topics KB Path`
- 初始化热门话题知识库目录（只补齐缺失）

## 可选环境变量

```bash
MECO_INSTALL_DIR="$HOME/meco-studio" \
MECO_BRANCH="main" \
MECO_START_AFTER_INSTALL=1 \
MECO_RESET_RUNTIME_STATE=1 \
MECO_UPGRADE_OPENCLAW=0 \
MECO_OPENCLAW_MODEL="kimi-openai/kimi-k2.5" \
MECO_OPENCLAW_MODEL_API_KEY="sk-xxxxx" \
MECO_KIMI_CODING_API_KEY="sk-xxxxx" \
MECO_KIMI_API_KEY="sk-xxxxx" \
MECO_MINIMAX_API_KEY="xxxx" \
MECO_TIKHUB_API_KEY="xxxx" \
MECO_OPENAI_API_KEY="" \
HOT_TOPICS_ROOT="$HOME/Documents/知识库/热门话题" \
curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash
```

## 维护者打包命令

```bash
bash scripts/build-bootstrap-package.sh
```

定向打包：

```bash
MECO_BOOTSTRAP_AGENTS="main,gates,hawking,jobs,kobe,munger" \
MECO_BOOTSTRAP_OPENCLAW_SKILLS="hot-topics,kimi-search,twitter-scraper,tikhub-api,x-grok" \
MECO_BOOTSTRAP_CONFIG_SKILLS="hot-topics" \
bash scripts/build-bootstrap-package.sh
```

输出目录：`bootstrap/openclaw/`

## Machine Readable Spec (for AI Agent)

```yaml
name: "Meco Studio"
type: "OpenClaw multi-agent management platform"
install:
  command: "curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash"
  idempotent: true
defaults:
  install_dir: "~/meco-studio"
  service_url: "http://127.0.0.1:3456"
  openclaw_root: "~/.openclaw"
  hot_topics_root: "~/Documents/知识库/热门话题"
api_keys:
  required:
    - "Kimi Coding API Key"
    - "TikHub API Key"
    - "MiniMax API Key"
  optional:
    - "OpenAI API Key"
post_install_auto:
  - "install/update openclaw"
  - "auto discover openclaw http/ws/token from local config"
  - "write openclaw model + provider api key defaults"
  - "install kimi cli"
  - "install whisper deps"
  - "sync agents and skills"
  - "init hot-topics folders"
```
