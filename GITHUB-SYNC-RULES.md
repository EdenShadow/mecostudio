# GitHub 提交铁律（Meco Studio）

本文件定义团队默认提交规则。除非明确说明，否则必须遵守。

## 1) 必须同步的资产（有新增/变更就要提交）

- `bootstrap/openclaw/skills/openclaw/*`（OpenClaw skills）
- `bootstrap/openclaw/skills/config/*`（Kimi CLI / config skills）
- `bootstrap/openclaw/data-agents/*`（Meco Studio 本地智能体资产）
- `bootstrap/openclaw/workspaces/*`（OpenClaw workspace 人设）
- `bootstrap/openclaw/openclaw-agents/*/agent/*`（OpenClaw 智能体配置）
- `bootstrap/openclaw/knowledge-rule-folders/*`（Rule 模式知识库文件夹）

### 1.2 智能体白名单（强制）

GitHub 仅提交以下 6 个内置智能体：

- `main`
- `gates`（比尔盖茨）
- `hawking`（霍金）
- `jobs`（乔布斯）
- `kobe`（科比）
- `munger`（芒格）

说明：
- 其他本地新建智能体属于运行态/个性化资产，不提交到 GitHub。
- `scripts/build-bootstrap-package.sh` 默认白名单即上述 6 个（可通过 `MECO_BOOTSTRAP_AGENTS` 显式覆盖）。

### 1.1 打包依赖铁律（每次“打包/发布”都要核对）

以下 6 类是强依赖，打包提交时必须逐项确认，不得漏项：

1. OpenClaw：`bootstrap/openclaw/workspaces/*` + `bootstrap/openclaw/openclaw-agents/*/agent/*`
2. 智能体资产：`bootstrap/openclaw/data-agents/*`
3. 知识库（Rule）：`bootstrap/openclaw/knowledge-rule-folders/*`
4. OpenClaw skills：`bootstrap/openclaw/skills/openclaw/*`
5. Kimi CLI：`bootstrap/openclaw/skills/config/*`
6. Kimi CLI skills：`bootstrap/openclaw/skills/config/*`（含其子技能目录与脚本）

说明：
- 即使本次改动主要在前端/服务端，凡涉及“打包发布”，也必须先执行 `scripts/sync-bootstrap-and-version.sh`，并核对上面 6 类目录的变更是否符合预期。

## 2) 禁止同步的运行态数据

- `data/rooms.json`
- `data/room-covers/*`
- `~/.meco-studio/remote-devices.json`

说明：房间与封面属于运行态，不进入 GitHub。

## 3) 版本号规则

- 仓库根目录维护统一版本文件：`VERSION`
- 默认初始版本：`0.0.1`
- 该文件可按需要选择性更新（例如跨端发布或升级协议变更）
- 本机同步文件：`~/.meco-studio/VERSION`
- 安装/升级脚本会自动将仓库 `VERSION` 同步到本机 `~/.meco-studio/VERSION`

## 4) 提交流程（标准）

1. 运行：`bash scripts/sync-bootstrap-and-version.sh`
2. 如需发布版本：`bash scripts/sync-bootstrap-and-version.sh <new-version>`
3. 检查变更并提交：`git add ... && git commit && git push`

## 5) 安全规则

- 仓库不得提交真实密钥。
- 打包脚本会做脱敏，但提交前仍需人工复核。
- 例外：默认角色 `data/agents/*/meta.json` 的 `podcastApiKey` + `podcastAgentId` 作为房间创建必需注册信息，禁止被清空。

## 6) AI 升级协议

- AI 按版本号更新的统一协议见：`AI-UPDATE-PROTOCOL.md`

## 7) 下发覆盖策略（安装/升级）

- 所有 bootstrap 资产采用“增量覆盖（overlay）”下发。
- 仅覆盖同名文件并新增缺失文件/目录。
- 不删除本机已有但不在仓库中的自建智能体、skills、知识库目录。
