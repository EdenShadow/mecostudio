---
name: tikhubapi
description: Alias of tikhub-tiktok. Use this skill name when users ask for "tikhubapi" and route to the same TikHub social APIs.
---

# TikHub API Alias

`tikhubapi` is a compatibility alias for `tikhub-tiktok`.

Use the same commands from `tikhub-tiktok`, for example:

```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/tiktok_api.py video_by_url "<share_url>"
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/twitter_api.py tweet "<tweet_id_or_url>"
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py video_info "<video_id>"
```

If `TIKHUB_API_KEY` is not exported, scripts will automatically read:

- `~/.meco-studio/skill-runtime.env`
- `~/.meco-studio/app-settings.json` (`tikhubApiKey`)
