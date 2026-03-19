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
- 安装 Python3 + pip（未安装自动安装）
- 安装 Kimi CLI（`curl -L code.kimi.com/install.sh | bash`）
- 安装 Whisper（`python3 -m pip install --user --upgrade openai-whisper`）
- 拉取或更新仓库至 `~/meco-studio`
- 安装 npm 依赖
- 同步 bootstrap agents/skills（幂等，不重复注册）
- 自动安装 skills 依赖：
  - Python：`requests aiohttp aiofiles pillow openai openai-whisper`
  - Node：自动扫描 OpenClaw/config skills 的 `package.json` 并安装
- 初始化 `~/Documents/知识库/热门话题` 及分类目录（只补齐缺失，不覆盖已有内容）
- 默认清空测试房间数据（`data/rooms.json = []`）
- 启动服务（默认 `http://127.0.0.1:3456`）
- 若为升级流程：完成后自动重启 OpenClaw Gateway 与 Meco Studio

## Git 同步范围（安装/更新自动下发）

会同步：
- `bootstrap/openclaw/skills/openclaw/*`（OpenClaw skills）
- `bootstrap/openclaw/skills/config/*`（Kimi CLI/config skills）
- `bootstrap/openclaw/data-agents/*`（Meco Studio 智能体资产）
- `bootstrap/openclaw/workspaces/*`（OpenClaw workspace 人设文件）
- `bootstrap/openclaw/openclaw-agents/*/agent/*`（OpenClaw 智能体配置）

不会同步：
- `data/rooms.json`
- `data/room-covers/*`

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

- `OpenClaw Model API Key`（`MECO_OPENCLAW_MODEL_API_KEY`）
- `Kimi CLI API Key`（`MECO_KIMI_CODING_API_KEY`）
- `TikHub API Key`
- `MeowLoad API Key`（哼哼猫 / media-downloader）
- `MiniMax API Key`（TTS）
- `Aliyun OSS Endpoint`（默认：`https://oss-cn-hongkong.aliyuncs.com/`）
- `Aliyun OSS Bucket`（固定默认：`cfplusvideo`）
- `Aliyun OSS AccessKey ID`（仓库不内置默认值，需手动填写）
- `Aliyun OSS AccessKey Secret`（仓库不内置默认值，需手动填写）
- `OpenAI API Key`（Whisper 可选）

点击“确定并自动安装/激活”后自动执行：

- 检测/安装 Kimi CLI
- 写入 `~/.kimi/config.json` / `~/.kimi/config.toml`
- 通过 `openclaw onboard --auth-choice kimi-code-api-key` 自动配置 OpenClaw 的 Kimi Coding 认证
- 安装 hot-topics 技能
- 安装 hot-topics 依赖（含 whisper）
- 自动确定 `Kimi CLI Command` 与 `Hot Topics KB Path`
- 初始化热门话题知识库目录（只补齐缺失）

## Kimi + OpenClaw 避坑说明

- Kimi Coding 套餐请使用：`kimi-coding/k2p5`。
- 不要手工把 `kimi-coding` provider 配成 Moonshot Open Platform 风格（`api.moonshot.cn/v1 + openai-completions`）。
- 错误配置时，常见现象是：`HTTP 401: Invalid Authentication`。
- 当前安装脚本已经内置修复：自动走 `kimi-code-api-key` 并写入 `api.kimi.com/coding/ + anthropic-messages`。

## 可选环境变量

```bash
MECO_INSTALL_DIR="$HOME/meco-studio" \
MECO_BRANCH="main" \
MECO_START_AFTER_INSTALL=1 \
MECO_RESET_RUNTIME_STATE=1 \
MECO_UPGRADE_OPENCLAW=0 \
MECO_OPENCLAW_MODEL="kimi-coding/k2p5" \
MECO_OPENCLAW_MODEL_API_KEY="sk-xxxxx" \
MECO_KIMI_CODING_API_KEY="sk-xxxxx" \
MECO_MINIMAX_API_KEY="xxxx" \
MECO_TIKHUB_API_KEY="xxxx" \
MECO_MEOWLOAD_API_KEY="xxxx" \
MECO_OSS_ENDPOINT="https://oss-cn-hongkong.aliyuncs.com/" \
MECO_OSS_BUCKET="cfplusvideo" \
MECO_OSS_ACCESS_KEY_ID="<your-oss-access-key-id>" \
MECO_OSS_ACCESS_KEY_SECRET="<your-oss-access-key-secret>" \
MECO_OPENAI_API_KEY="" \
HOT_TOPICS_ROOT="$HOME/Documents/知识库/热门话题" \
curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash
```

## 快速填参一键安装/更新

将占位符替换为你的真实 Key，同一条命令即可安装或升级：

```bash
MECO_KIMI_CODING_API_KEY="<your-kimi-coding-key>" \
MECO_MINIMAX_API_KEY="<your-minimax-key>" \
MECO_TIKHUB_API_KEY="<your-tikhub-key>" \
MECO_MEOWLOAD_API_KEY="<your-meowload-key>" \
MECO_OSS_ENDPOINT="https://oss-cn-hongkong.aliyuncs.com/" \
MECO_OSS_BUCKET="cfplusvideo" \
MECO_OSS_ACCESS_KEY_ID="<your-oss-access-key-id>" \
MECO_OSS_ACCESS_KEY_SECRET="<your-oss-access-key-secret>" \
MECO_OPENAI_API_KEY="<your-openai-key-optional>" \
curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash
```

## 维护者打包命令

```bash
bash scripts/build-bootstrap-package.sh
```

该命令会从本机自动收集并写回 `bootstrap/openclaw/`：
- `~/.openclaw/skills`
- `~/.config/agents/skills`
- `~/.openclaw/workspace-*`
- `~/.openclaw/agents/*/agent`
- `./data/agents`

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
    - "OpenClaw Model API Key"
    - "Kimi CLI API Key"
    - "TikHub API Key"
    - "MeowLoad API Key"
    - "MiniMax API Key"
    - "Aliyun OSS AccessKey ID"
    - "Aliyun OSS AccessKey Secret"
  optional:
    - "OpenAI API Key"
post_install_auto:
  - "install/update openclaw"
  - "install python3/pip if missing"
  - "auto discover openclaw http/ws/token from local config"
  - "bootstrap openclaw kimi-code auth profile to avoid moonshot 401 mismatch"
  - "write openclaw model + provider defaults (kimi-coding/k2p5)"
  - "install kimi cli"
  - "install skills runtime deps (python + node, including whisper)"
  - "sync agents and skills"
  - "init hot-topics folders"
  - "restart OpenClaw gateway and Meco Studio on upgrade"
```

## Security Policy

- Do not commit real API keys/AccessKeys to repository files.
- Configure secrets only via local UI settings or environment variables.
- Rotate keys immediately if any leakage is suspected.
- UI 保存的密钥默认写入 `~/.meco-studio/app-settings.json`（不在仓库目录）。
