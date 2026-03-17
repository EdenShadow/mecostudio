# API Key 配置

Meco Studio 安装后，打开 `http://127.0.0.1:3456`，点击左上角头像下拉中的 **API Keys** 进行配置。

## 推荐配置项

- `OpenClaw Gateway Token`
- `Kimi API Key`
- `TikHub API Key`
- `MiniMax API Key`（用于 TTS）
- `OpenAI API Key`（可选，用于 Whisper API 模式）

## 自动安装与激活

在 API Keys 弹窗点击“确定并自动安装/激活”后会自动执行：

- 安装/检测 Kimi CLI
- 写入 Kimi 配置（`~/.kimi/config.json` / `~/.kimi/config.toml`）
- 安装 hot-topics 技能
- 安装 hot-topics 所需依赖（含 `openai-whisper`）
- 初始化 `~/Documents/知识库/热门话题` 及分类目录（只补齐缺失，不覆盖已有内容）
