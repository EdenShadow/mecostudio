---
name: media-downloader
description: 使用哼哼猫 API 下载各种网站的视频和图片，支持 YouTube、Bilibili、Twitter、Instagram、TikTok 等
metadata:
  {
    "openclaw":
      {
        "emoji": "📥",
        "requires": { "bins": ["python3"] },
        "install":
          [
            {
              "id": "local",
              "kind": "copy",
              "files": [{"src": "download_media", "dst": "~/.local/bin/download_media"}],
              "label": "Install media-downloader script",
            },
          ],
        "priority": "normal",
        "tags": ["download", "video", "image", "media"],
      },
  }
---

# Media Downloader 📥

使用 **哼哼猫 (MeowLoad) API** 下载各种网站的视频和图片。

## 支持的网站

- YouTube
- Bilibili
- Twitter/X
- Instagram
- TikTok
- 以及其他哼哼猫支持的网站

## 使用方式

```bash
# 下载视频
download_media <视频链接>

# 下载图片
download_media <图片链接> --type image

# 保存到指定目录
download_media <链接> --output ~/Downloads
```

## 配置

需要配置环境变量（由 Meco Studio API Keys 面板统一写入）：

- `MEOWLOAD_API_KEY`（或兼容变量 `HENGHENGMAO_API_KEY`）
- 可选：`MEOWLOAD_BASE_URL`（默认 `https://api.meowload.com`）
