# GitHub 上传铁律（Upload Policy）

本文件专门约束“上传/附件/知识库 Rule 文件夹”相关的 GitHub 提交策略，长期执行。

## 1) 上传相关必须提交（有变更就提交）

- `bootstrap/openclaw/knowledge-rule-folders/*`（Rule 模式知识库文件夹）
- `scripts/build-bootstrap-package.sh`（上传资产打包逻辑）
- `scripts/install-meco-studio.sh`（安装/更新下发逻辑）
- `README.md` / `MECO-STUDIO-INSTALL.md` / `GITHUB-SYNC-RULES.md`（策略文档）

### 1.2 智能体白名单（强制）

上传/打包到 GitHub 时，智能体仅允许：

- `main`
- `gates`
- `hawking`
- `jobs`
- `kobe`
- `munger`

其他本机新建智能体不进入仓库。

### 1.1 打包依赖铁律（强制）

凡是“打包提交”必须检查并同步以下依赖范围（按业务口径）：

1. OpenClaw（`workspaces` + `openclaw-agents`）
2. 智能体（`data-agents`）
3. 知识库（`knowledge-rule-folders`）
4. skills（`skills/openclaw`）
5. Kimi CLI（`skills/config`）
6. Kimi CLI skills（`skills/config` 下的子技能与脚本）

对应路径：
- `bootstrap/openclaw/workspaces/*`
- `bootstrap/openclaw/openclaw-agents/*/agent/*`
- `bootstrap/openclaw/data-agents/*`
- `bootstrap/openclaw/knowledge-rule-folders/*`
- `bootstrap/openclaw/skills/openclaw/*`
- `bootstrap/openclaw/skills/config/*`

## 2) 上传相关禁止提交（运行态/临时态）

- `uploads/*`（运行时附件）
- `temp_uploads/*`
- `data/rooms.json`
- `data/room-covers/*`
- `~/.meco-studio/remote-devices.json`（本机绑定设备清单，不入仓库）
- `*.log`、调试临时输出
- 本机密钥与本地设置（如 `data/app-settings.json`）

## 3) 成本控制铁律（仓库体积与拉取速度）

- 不提交无必要的大二进制文件。
- 单文件建议不超过 `20MB`；超出时优先压缩/抽样/转文本摘要。
- 同一功能变更中，优先提交“可重建资产”（脚本+元数据）而不是重复提交原始大文件。
- Rule 文件夹只提交“训练/执行必需文件”，删除冗余缓存和临时文件。

## 4) 安全铁律（必须执行）

- 禁止提交任何真实 API Key / Token / Secret。
- 所有密钥仅保存在本地 UI 配置或环境变量。
- 怀疑泄漏时立即轮换密钥并补充脱敏提交。
- 例外：默认角色 `data/agents/*/meta.json` 的 `podcastApiKey` + `podcastAgentId` 作为 Podcast 房间创建必需注册信息，需要随打包同步，禁止误清空。

## 5) 提交前检查（固定流程）

1. `bash scripts/sync-bootstrap-and-version.sh`
2. `git status`
3. 检查是否误带运行态目录：`uploads/`、`temp_uploads/`、`data/rooms.json`、`data/room-covers/`
4. 检查是否误带敏感信息（Key/Token/Secret）
5. `git add` + `git commit` + `git push`

## 6) 与其他铁律关系

- 本文是“上传策略专项铁律”。
- 通用同步规则见：`GITHUB-SYNC-RULES.md`。
