# feishu-send-media

Send media files (images, videos, audio, documents) to Feishu users or chats.

## Usage

```bash
~/.openclaw/skills/feishu-send-media/skill.sh <file_path> [receive_id]
```

### Parameters

- **file_path** (required): Path to the file to send
- **receive_id** (optional): Feishu user ID. Defaults to: `ou_8aabc219e4883cf1204157d904d54021`

### Examples

```bash
# Send a video
~/.openclaw/skills/feishu-send-media/skill.sh /path/to/video.mp4

# Send an image
~/.openclaw/skills/feishu-send-media/skill.sh /path/to/image.png

# Send to specific user
~/.openclaw/skills/feishu-send-media/skill.sh /path/to/document.pdf ou_123456

# Send audio
~/.openclaw/skills/feishu-send-media/skill.sh /path/to/podcast.mp3
```

## Supported File Types

| File Type | Message Type | Extensions |
|-----------|-------------|------------|
| Image | image | jpg, jpeg, png, gif, webp, bmp |
| Video | media | mp4, mov, avi |
| Audio | audio | mp3, wav, opus |
| File | file | pdf, doc, xls, ppt, others |

## Files

```
~/.openclaw/skills/feishu-send-media/
├── skill.sh      # Entry point (wrapper)
├── skill.mjs     # Main script (runs from feishu plugin dir)
└── SKILL.md      # This documentation
```

## How It Works

1. **Upload**: File is uploaded to Feishu cloud via `im.file.create` API
2. **Send**: File key is sent as message via `im.message.create` API

## Requirements

- OpenClaw with feishu plugin configured
- Feishu application must have:
  - Bot capability enabled
  - File upload permissions (`im:resource:upload`)
  - Message send permissions (`im:message:send_as_bot`)

## Configuration

Uses OpenClaw feishu configuration:
- Reads `~/.openclaw/openclaw.json`
- Requires `channels.feishu.appId` and `channels.feishu.appSecret`

## Notes

- Runs from `~/.openclaw/extensions/feishu/` to access `@larksuiteoapi/node-sdk`
- Default recipient is configured in `skill.mjs`
- Automatically detects file type based on extension
