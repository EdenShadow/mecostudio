# GitHub 提交铁律（Meco Studio）

本文件定义团队默认提交规则。除非明确说明，否则必须遵守。

## 1) 必须同步的资产（有新增/变更就要提交）

- `bootstrap/openclaw/skills/openclaw/*`（OpenClaw skills）
- `bootstrap/openclaw/skills/config/*`（Kimi CLI / config skills）
- `bootstrap/openclaw/data-agents/*`（Meco Studio 本地智能体资产）
- `bootstrap/openclaw/workspaces/*`（OpenClaw workspace 人设）
- `bootstrap/openclaw/openclaw-agents/*/agent/*`（OpenClaw 智能体配置）
- `bootstrap/openclaw/knowledge-rule-folders/*`（Rule 模式知识库文件夹）

## 2) 禁止同步的运行态数据

- `data/rooms.json`
- `data/room-covers/*`

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

## 6) AI 升级协议

- AI 按版本号更新的统一协议见：`AI-UPDATE-PROTOCOL.md`

## 7) 下发覆盖策略（安装/升级）

- 所有 bootstrap 资产采用“增量覆盖（overlay）”下发。
- 仅覆盖同名文件并新增缺失文件/目录。
- 不删除本机已有但不在仓库中的自建智能体、skills、知识库目录。
