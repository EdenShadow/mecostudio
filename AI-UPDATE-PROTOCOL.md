# AI Update Protocol (Version-Driven, Machine Readable)

本协议用于 AI Agent 在多端执行 Meco Studio 的安装/升级，确保流程可重复、可回滚判断、可审计。

## Protocol YAML

```yaml
protocol:
  name: "meco-studio-update-protocol"
  protocol_version: "1.0.0"
  scope: "install_and_upgrade"

source:
  repo: "https://github.com/EdenShadow/mecostudio"
  branch: "main"
  install_script: "scripts/install-meco-studio.sh"

versioning:
  repo_version_file: "VERSION"
  local_version_file: "~/.meco-studio/VERSION"
  maintainer_bump_command: "bash scripts/sync-bootstrap-and-version.sh <x.y.z>"
  rules:
    - "维护者通过 VERSION 控制发布版本"
    - "安装/升级后，本地版本号必须与仓库 VERSION 一致"
    - "若版本号相同，流程仍可执行（幂等更新）"

upgrade_plan:
  - step: "fetch_or_update_repo"
    action: "git clone/pull to install dir"
    expected: "工作目录更新到目标分支最新提交"

  - step: "permission_preflight"
    action: "run scripts/openclaw-permission-preflight.sh"
    expected: "提前发现目录读写/网络/权限限制，避免远控时隐性失败"

  - step: "install_runtime_dependencies"
    action: "install git/node/npm/python/pip as needed + npm install"
    expected: "服务运行依赖完整"

  - step: "install_or_update_openclaw"
    action: "ensure openclaw exists; optional upgrade by flag"
    expected: "openclaw 可用"

  - step: "configure_openclaw_model_and_auth"
    action: "configure kimi-code auth + model defaults"
    expected: "openclaw 调用模型链路可用"

  - step: "install_or_update_kimi_cli"
    action: "ensure kimi cli installed"
    expected: "kimi 命令可用"

  - step: "sync_bootstrap_assets"
    action: "overlay bootstrap assets to target paths"
    assets:
      - src: "bootstrap/openclaw/skills/openclaw/*"
        dst: "~/.openclaw/skills/"
      - src: "bootstrap/openclaw/skills/config/*"
        dst: "~/.config/agents/skills/"
      - src: "bootstrap/openclaw/openclaw-agents/*/agent/*"
        dst: "~/.openclaw/agents/<agentId>/agent/"
      - src: "bootstrap/openclaw/workspaces/*"
        dst: "~/.openclaw/<workspaceDir>/"
      - src: "bootstrap/openclaw/data-agents/*"
        dst: "<install_dir>/data/agents/<agentId>/"
      - src: "bootstrap/openclaw/knowledge-rule-folders/*"
        dst: "~/Meco Studio/public/uploads/knowledge-rule-folders/"
    expected: "skills/agents/persona/rule 知识库文件夹全部到位"

  - step: "install_skill_runtime_dependencies"
    action: "install python/node deps required by synced skills"
    expected: "skills 可直接执行"

  - step: "ensure_hot_topics_kb_layout"
    action: "create missing category dirs under ~/Documents/知识库/热门话题"
    expected: "知识库目录齐全且不覆盖已有数据"

  - step: "restart_services"
    action: "restart openclaw gateway (on update) + restart meco studio"
    expected: "新配置与新资产生效"

  - step: "sync_local_version_marker"
    action: "write repo VERSION -> ~/.meco-studio/VERSION"
    expected: "本地版本标记完成"

idempotency:
  rules:
    - "重复执行不应破坏已有目录结构"
    - "同版本可重跑用于自愈（依赖缺失/服务异常）"
    - "密钥文件采用本地优先，不回写到仓库"

security:
  rules:
    - "禁止提交真实 API Key/Secret 到仓库"
    - "密钥只允许出现在本地环境变量或本地配置文件"

excluded_from_repo:
  - "data/rooms.json"
  - "data/room-covers/*"
  - "uploads/*"
  - "temp_uploads/*"

operator_commands:
  install_or_upgrade: "curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash"
  package_sync_before_commit: "bash scripts/sync-bootstrap-and-version.sh"
  package_sync_with_bump: "bash scripts/sync-bootstrap-and-version.sh <x.y.z>"
  permission_preflight: "bash scripts/openclaw-permission-preflight.sh"
```

## Notes for AI Agent

1. 推荐策略：始终执行同一安装命令，依赖脚本幂等性完成安装或升级。  
2. 版本判断用于“是否升级成功”的判定，而不是决定“是否执行更新流程”。  
3. 当检测到资产变更（skills/agents/rules）时，先执行维护者打包流程再提交。  
