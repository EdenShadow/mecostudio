# Meco Studio 安装 / 升级 / API Key 一体文档（AI 可读）

> 文档版本：`0.0.12`

## 一行安装（Install）

```bash
curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash
```

## 一行升级（Upgrade）

```bash
curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash
```

同一命令可重复执行，脚本为幂等设计。

## Windows 一行安装 / 升级（PowerShell）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.ps1 | iex"
```

说明：
- Windows 安装脚本：`scripts/install-meco-studio.ps1`
- 优先通过 `winget` 自动安装 `git / node / python`
- 若 `kimi` 命令未安装，脚本会给出手动安装提示（不阻塞主安装流程）
- 如果安装后当前终端仍找不到命令，请关闭并重开 PowerShell 再重试

## 安装脚本默认行为

- 安装 git（未安装自动安装）
- 安装 OpenClaw（未安装自动安装）；已安装时仅在版本低于最低要求时自动升级到 `openclaw@latest`
- 增加 OpenClaw 完整性自检（缺少内部模块时自动执行卸载+重装自愈）
- 安装 Python3 + pip（未安装自动安装）
- 安装 Kimi CLI（`curl -L code.kimi.com/install.sh | bash`）
- 安装 Whisper（`python3 -m pip install --user --upgrade openai-whisper`）
- 自动安装 cloudflared（可关闭）
- 拉取或更新仓库至 `~/meco-studio`
- 运行权限预检脚本（目录读写 + 网络连通 + OpenClaw 可用性）
- 安装 npm 依赖
- 自动安装 RustDesk 客户端：
  - macOS：`scripts/install-rustdesk-client-mac.sh`
  - Windows：`scripts/install-rustdesk-client-win.ps1`
- RustDesk 默认优先官方公网服务（安装时会清理旧 localhost 自建优先配置）
- 可选配置 RustDesk 本地自建服务（默认关闭）：
  - macOS/Linux：`scripts/setup-rustdesk-selfhost.sh`
  - Windows：`scripts/setup-rustdesk-selfhost.ps1`
  - 启用方式：`MECO_AUTO_SETUP_RUSTDESK_SELFHOST=1`
- 如果检测到 macOS 安装了 ClashX/ClashX Pro，会自动写入 RustDesk 直连规则（可关闭）
- 自动修正 RustDesk `local-ip-addr`（剔除 `26.x` 等虚拟网卡地址并写入真实局域网 IP），并重启 RustDesk 生效
- 自动执行 RustDesk 远控权限引导：
  - macOS：`scripts/grant-rustdesk-permissions-mac.sh`
  - Windows：`scripts/grant-rustdesk-permissions-win.ps1`
- 自动安装并启动 Cloudflare Tunnel：
  - macOS/Linux：`scripts/start-cloudflare-tunnel.sh`
  - Windows：`scripts/start-cloudflare-tunnel.ps1`
- 同步 bootstrap agents/skills/knowledge-rule-folders（幂等，不重复注册）
- 同步策略为增量覆盖：仅覆盖同名文件 + 新增缺失文件，不删除本机自建智能体/skills/知识库目录
- 同步 OpenClaw skills 开关状态（从 bootstrap manifest 读取；缺失状态默认开启）
- 自动安装 skills 依赖：
  - Python：`requests aiohttp aiofiles pillow openai openai-whisper`
  - Node：自动扫描 OpenClaw/config skills 的 `package.json` 并安装
- 初始化 `~/Documents/知识库/热门话题` 及分类目录（只补齐缺失，不覆盖已有内容）
- 首次安装默认清空测试房间数据（`data/rooms.json = []`）
- 升级默认保留已有房间数据；如需强制清空可设置：`MECO_RESET_RUNTIME_STATE_ON_UPDATE=1`
- 升级模式会先请求停止 active rooms（`POST /api/roundtable/stop-active-rooms`）再重启服务
- 自动确保 OpenClaw Gateway 已启动，并检查 `/v1/chat/completions` 端点可用
- 启动服务（默认 `http://127.0.0.1:3456`）
- 启动服务时自动处理端口冲突（优先回收旧 meco 进程，必要时切换可用端口）
- 自动写入远控默认配置（Cloudflare host/token + RustDesk Web 地址）
- 同步版本号文件：`VERSION` -> `~/.meco-studio/VERSION`

## Git 同步范围（安装/更新自动下发）

会同步：
- `bootstrap/openclaw/skills/openclaw/*`（OpenClaw skills）
- `bootstrap/openclaw/skills/config/*`（Kimi CLI/config skills）
- `bootstrap/openclaw/data-agents/*`（Meco Studio 智能体资产）
- `bootstrap/openclaw/workspaces/*`（OpenClaw workspace 人设文件）
- `bootstrap/openclaw/openclaw-agents/*/agent/*`（OpenClaw 智能体配置）
- `bootstrap/openclaw/knowledge-rule-folders/*`（知识库 Rule 文件夹）

同步行为：
- 增量覆盖（overlay），不会清理目标目录里用户自行新增的文件/文件夹
- 不会删除本机已存在但不在仓库 bootstrap 中的 OpenClaw 智能体与 skills

不会同步：
- `data/rooms.json`
- `data/room-covers/*`
- `~/.meco-studio/remote-devices.json`
- `data/remote-devices*.json`

## 提交铁律与版本号

- 规则文档：`GITHUB-SYNC-RULES.md`
- 上传策略文档：`GITHUB-UPLOAD-RULES.md`
- AI 安装/升级协议：`AI-UPDATE-PROTOCOL.md`
- 仓库统一版本文件：`VERSION`（默认 `0.0.1`）
- 本机版本文件：`~/.meco-studio/VERSION`
- 提交前建议执行：`bash scripts/sync-bootstrap-and-version.sh`
- 需要升版本时执行：`bash scripts/sync-bootstrap-and-version.sh <x.y.z>`

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
- `Doubao O2O AppID / Token`（豆包语音克隆）
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
MECO_RUN_PERMISSION_PREFLIGHT=1 \
MECO_UPGRADE_OPENCLAW=0 \
MECO_MIN_OPENCLAW_VERSION="2026.3.31" \
MECO_OPENCLAW_MODEL="kimi-coding/k2p5" \
MECO_OPENCLAW_MODEL_API_KEY="sk-xxxxx" \
MECO_KIMI_CODING_API_KEY="sk-xxxxx" \
MECO_MINIMAX_API_KEY="xxxx" \
MECO_DOUBAO_O2O_APP_ID="5022xxxxxx" \
MECO_DOUBAO_O2O_TOKEN="xxxx" \
MECO_DOUBAO_O2O_APP_KEY="<optional-doubao-o2o-appkey>" \
MECO_DOUBAO_O2O_RESOURCE_ID="${MECO_DOUBAO_O2O_RESOURCE_ID:-seed-icl-2.0}" \
MECO_DOUBAO_O2O_ACCESS_KEY_ID="<your-doubao-o2o-access-key-id>" \
MECO_DOUBAO_O2O_SECRET_ACCESS_KEY="<your-doubao-o2o-secret-access-key>" \
MECO_TIKHUB_API_KEY="xxxx" \
MECO_MEOWLOAD_API_KEY="xxxx" \
MECO_OSS_ENDPOINT="https://oss-cn-hongkong.aliyuncs.com/" \
MECO_OSS_BUCKET="cfplusvideo" \
MECO_OSS_ACCESS_KEY_ID="<your-oss-access-key-id>" \
MECO_OSS_ACCESS_KEY_SECRET="<your-oss-access-key-secret>" \
MECO_OPENAI_API_KEY="" \
MECO_CLOUDFLARE_PUBLIC_HOST="https://mecoclaw.com" \
MECO_CLOUDFLARE_TUNNEL_TOKEN="<built-in-default-or-your-token>" \
MECO_RUSTDESK_WEB_BASE_URL="/rustdesk-web/" \
MECO_RUSTDESK_PREFERRED_RENDEZVOUS="" \
MECO_RUSTDESK_SELFHOST_BACKEND="docker" \
MECO_AUTO_INSTALL_CLOUDFLARED=1 \
MECO_AUTO_INSTALL_DOCKER=1 \
MECO_AUTO_INSTALL_RUSTDESK_CLIENT=1 \
MECO_AUTO_SETUP_RUSTDESK_SELFHOST=0 \
MECO_AUTO_GRANT_RUSTDESK_PERMISSIONS=1 \
MECO_AUTO_CONFIGURE_CLASH_RUSTDESK_DIRECT=1 \
MECO_AUTO_NORMALIZE_RUSTDESK_NETWORK=1 \
MECO_AUTO_START_CLOUDFLARE_TUNNEL=1 \
HOT_TOPICS_ROOT="$HOME/Documents/知识库/热门话题" \
curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash
```

说明：
- `MECO_MIN_OPENCLAW_VERSION` 可选；用于指定本次安装/更新要求的 OpenClaw 最低版本。
- 未显式传入时，安装脚本会读取仓库根目录 `OPENCLAW_MIN_VERSION`。
- 仅当本机 OpenClaw 版本低于最低要求时才会自动升级；高于或等于则保持不动。

Windows PowerShell（等价变量）：

```powershell
$env:MECO_INSTALL_DIR = "$env:USERPROFILE\\meco-studio"
$env:MECO_OPENCLAW_MODEL = "kimi-coding/k2p5"
$env:MECO_MIN_OPENCLAW_VERSION = "2026.3.31" # optional
$env:MECO_KIMI_CODING_API_KEY = "<your-kimi-coding-key>"
$env:MECO_MINIMAX_API_KEY = "<your-minimax-key>"
$env:MECO_DOUBAO_O2O_APP_ID = "<your-doubao-o2o-appid>"
$env:MECO_DOUBAO_O2O_TOKEN = "<your-doubao-o2o-token>"
$env:MECO_DOUBAO_O2O_APP_KEY = "<your-doubao-o2o-appkey-optional>"
$env:MECO_DOUBAO_O2O_RESOURCE_ID = "seed-icl-2.0" # optional
$env:MECO_DOUBAO_O2O_ACCESS_KEY_ID = "<your-doubao-o2o-access-key-id>" # optional
$env:MECO_DOUBAO_O2O_SECRET_ACCESS_KEY = "<your-doubao-o2o-secret-access-key>" # optional
$env:MECO_TIKHUB_API_KEY = "<your-tikhub-key>"
$env:MECO_MEOWLOAD_API_KEY = "<your-meowload-key>"
$env:MECO_OSS_ENDPOINT = "https://oss-cn-hongkong.aliyuncs.com/"
$env:MECO_OSS_BUCKET = "cfplusvideo"
$env:MECO_OSS_ACCESS_KEY_ID = "<your-oss-access-key-id>"
$env:MECO_OSS_ACCESS_KEY_SECRET = "<your-oss-access-key-secret>"
$env:MECO_CLOUDFLARE_PUBLIC_HOST = "https://mecoclaw.com"
$env:MECO_CLOUDFLARE_TUNNEL_TOKEN = "<built-in-default-or-your-token>"
$env:MECO_RUSTDESK_WEB_BASE_URL = "/rustdesk-web/"
$env:MECO_RUSTDESK_PREFERRED_RENDEZVOUS = ""
$env:MECO_RUSTDESK_SELFHOST_BACKEND = "auto"
$env:MECO_AUTO_INSTALL_CLOUDFLARED = "1"
$env:MECO_AUTO_INSTALL_DOCKER = "1"
$env:MECO_AUTO_INSTALL_RUSTDESK_CLIENT = "1"
$env:MECO_AUTO_SETUP_RUSTDESK_SELFHOST = "0"
$env:MECO_AUTO_GRANT_RUSTDESK_PERMISSIONS = "1"
$env:MECO_AUTO_CONFIGURE_CLASH_RUSTDESK_DIRECT = "1"
$env:MECO_AUTO_NORMALIZE_RUSTDESK_NETWORK = "1"
$env:MECO_AUTO_START_CLOUDFLARE_TUNNEL = "1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.ps1 | iex"
```

## 快速填参一键安装/更新

将占位符替换为你的真实 Key，同一条命令即可安装或升级：

```bash
MECO_KIMI_CODING_API_KEY="<your-kimi-coding-key>" \
MECO_MINIMAX_API_KEY="<your-minimax-key>" \
MECO_DOUBAO_O2O_APP_ID="<your-doubao-o2o-appid>" \
MECO_DOUBAO_O2O_TOKEN="<your-doubao-o2o-token>" \
MECO_DOUBAO_O2O_APP_KEY="<your-doubao-o2o-appkey-optional>" \
MECO_DOUBAO_O2O_RESOURCE_ID="seed-icl-2.0" \
MECO_DOUBAO_O2O_ACCESS_KEY_ID="<your-doubao-o2o-access-key-id>" \
MECO_DOUBAO_O2O_SECRET_ACCESS_KEY="<your-doubao-o2o-secret-access-key>" \
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
- `~/Meco Studio/public/uploads/knowledge-rule-folders`

默认仅打包并提交 6 个内置智能体：`main,gates,hawking,jobs,kobe,munger`。  
其他本机新建智能体默认不入 GitHub（白名单策略）。

临时覆盖白名单打包：

```bash
MECO_BOOTSTRAP_AGENTS="main,gates,hawking,jobs,kobe,munger" \
MECO_BOOTSTRAP_OPENCLAW_SKILLS="hot-topics,kimi-search,twitter-scraper,tikhub-api,x-grok" \
MECO_BOOTSTRAP_CONFIG_SKILLS="hot-topics,tikhub-tiktok,tikhubapi" \
bash scripts/build-bootstrap-package.sh
```

输出目录：`bootstrap/openclaw/`

## Machine Readable Spec (for AI Agent)

```yaml
name: "Meco Studio"
type: "OpenClaw multi-agent management platform"
update_protocol_doc: "AI-UPDATE-PROTOCOL.md"
install:
  command: "curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash"
  command_windows: "powershell -NoProfile -ExecutionPolicy Bypass -Command \"irm https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.ps1 | iex\""
  idempotent: true
defaults:
  install_dir: "~/meco-studio"
  service_url: "http://127.0.0.1:3456"
  openclaw_root: "~/.openclaw"
  openclaw_min_version_file: "OPENCLAW_MIN_VERSION"
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
  - "install openclaw when missing; upgrade only when installed version is lower than required minimum"
  - "install python3/pip if missing"
  - "git pull latest code to install dir"
  - "run permission preflight (folder read/write + network + openclaw status)"
  - "auto discover openclaw http/ws/token from local config"
  - "bootstrap openclaw kimi-code auth profile to avoid moonshot 401 mismatch"
  - "write openclaw model + provider defaults (kimi-coding/k2p5)"
  - "ensure OpenClaw gateway is running and chat-completions endpoint is ready"
  - "install kimi cli"
  - "install RustDesk client (macOS/Windows)"
  - "prefer RustDesk public rendezvous by default; optional self-host setup via env switch"
  - "if ClashX/ClashX Pro is installed on macOS, auto-patch RustDesk DIRECT rules in clash config"
  - "normalize RustDesk local-ip-addr to real LAN IP and remove stale virtual adapter IPs (26.x etc)"
  - "run RustDesk local permission guidance (screen/accessibility/firewall)"
  - "install cloudflared and auto start tunnel with preset token"
  - "install skills runtime deps (python + node, including whisper)"
  - "sync OpenClaw skills + Kimi CLI skills"
  - "sync OpenClaw agents/workspaces + local data-agents"
  - "sync rule knowledge folders to upload root"
  - "init hot-topics folders"
  - "start/restart OpenClaw gateway + Meco Studio with port-conflict handling"
  - "sync repo VERSION to ~/.meco-studio/VERSION"
```

手动权限预检：

```bash
bash scripts/openclaw-permission-preflight.sh
```

## Security Policy

- Do not commit real API keys/AccessKeys to repository files.
- Private deployment preset may include default Cloudflare/Mesh bootstrap values; rotate immediately before sharing/forking.
- Configure secrets only via local UI settings or environment variables.
- Remote bind store is local only (`~/.meco-studio/remote-devices.json`), and `.gitignore` blocks `remote-devices*.json`.
- Rotate keys immediately if any leakage is suspected.
- UI 保存的密钥默认写入 `~/.meco-studio/app-settings.json`（不在仓库目录）。
