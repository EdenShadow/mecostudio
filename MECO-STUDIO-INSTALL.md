# Meco Studio 一键安装/升级（给智能体执行）

## 1) 一键安装并启动

```bash
curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash
```

这个命令会自动完成：
- 安装/升级 OpenClaw（若未安装会自动安装）
- 安装 Kimi CLI（命令：`curl -L code.kimi.com/install.sh | bash`）
- 安装 Whisper（`python3 -m pip install --user --upgrade openai-whisper`，用于 hot-topics 音频分析）
- 拉取或更新 Meco Studio 到 `~/meco-studio`
- 安装依赖并同步初始化智能体与技能（含 hot-topics，幂等，不重复注册）
- 初始化知识库目录 `~/Documents/知识库/热门话题` 及分类目录（只补齐缺失目录，不覆盖已有内容）
  - 分类目录：`AI_Tech`、`Entertainment`、`Military`、`Sports`、`Design`、`Health`、`Politics`、`Technology`、`Economy`、`Medical`、`Society`、`Trending`
- 清空默认测试房间（`data/rooms.json` 变为 `[]`）
- 启动服务（默认 `http://127.0.0.1:3456`）

## 2) 一键升级

升级和安装使用同一个命令，直接重跑即可：

```bash
curl -fsSL https://raw.githubusercontent.com/EdenShadow/mecostudio/main/scripts/install-meco-studio.sh | bash
```

## 3) 常用参数（可选）

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

## 4) 维护者：更新初始化包（agents/skills）

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
