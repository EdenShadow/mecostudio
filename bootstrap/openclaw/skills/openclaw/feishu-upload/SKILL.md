---
name: feishu-upload
description: Upload files to Feishu/Lark for sending in chats
metadata:
  {
    "openclaw":
      {
        "emoji": "📤",
        "requires": { "bins": ["curl"] },
        "install": [],
        "priority": "normal",
        "tags": ["feishu", "lark", "upload", "file", "send"]
      }
  }
---

# Feishu Upload 📤

Upload files to Feishu/Lark for sending in chats.

## Usage

```bash
# Upload a file
feishu-upload <file_path>

# Upload with custom name
feishu-upload <file_path> --name "自定义文件名"
```

## Examples

```bash
# Upload video
feishu-upload ~/Downloads/video.mp4

# Upload with custom name
feishu-upload ~/Downloads/doc.pdf --name "报告.pdf"
```

## Requirements

- Feishu app configured in OpenClaw
- curl installed
