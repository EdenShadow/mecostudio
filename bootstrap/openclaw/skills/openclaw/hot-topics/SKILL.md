---
name: hot-topics
description: Automatically fetch tweets from followed influencers, analyze content using AI, and generate formatted posts with media processing. Features include contextual title generation (based on user's question), deduplication, fast concurrent processing, and smart media handling.
---

# Hot Topics Fetcher

Automatically fetch tweets from followed influencers, analyze content using Kimi AI, and generate formatted posts with media processing. **Now with contextual title generation** - titles consider user's questions for better relevance!

## 🆕 What's New in v5.0

| Feature | Description | Command |
|---------|-------------|---------|
| **Contextual Titles** ⭐ | Generate titles based on user's question/intent | `--query "你对伊朗局势怎么看"` |
| **Deduplication** | Skip already-fetched tweets automatically | Built into advanced version |
| **Fast Concurrent** | Process multiple users in parallel (10x faster) | `--batch --max-users 20` |
| **Smart Video** | Skip long videos (>3min), use thumbnails only | Automatic |

## Features

- Read followed influencers from knowledge base categories
- Fetch real tweet data via TikHub API (likes, retweets, comments, views)
- **Contextual title generation** with emoji - considers user's question when provided
- Smart categorization (AI_Tech, Food, Health, Finance, Military, Sports, etc.)
- Automatic deduplication - skips already-fetched tweets
- Fast concurrent processing for batch operations
- Media processing:
  - **Comprehensive media support** - Handles all media types with full protection
  - **Smart media priority**: Card images > Regular media > Video thumbnails > Category defaults
  - **Smart video thumbnail**: Use Twitter/X video thumbnail URL directly - NO video download needed for cover!
  - **Smart video handling**: Videos >3 minutes skip download entirely, use thumbnail only
  - Extract video frames for analysis (short videos only)
  - Extract audio from videos (short videos only)
  - **Audio content analysis** (local Whisper, short videos only) - transcribe and analyze speech for FREE
  - Auto-crop single images to 1:1 ratio
  - Merge multiple images into 2x2 collage
- Comment extraction (top 10 by likes, using `fetch_post_comments` API)
- Auto-rename folders with generated titles

## 🚀 Quick Start

### Version Selection Guide

| Version | Best For | Speed | Features |
|---------|----------|-------|----------|
| `fetch_tweets.py` | Daily use, stability | Normal | Full features |
| `fetch_tweets_fast.py` | Batch processing | 🚀 10x faster | Concurrent downloads |
| `fetch_tweets_dedup.py` | Scheduled tasks | Normal | Auto-skip duplicates |
| `fetch_tweets_contextual.py` | Single URL with question | Normal | Contextual titles |
| `fetch_tweets_advanced.py` ⭐ | Production, all features | 🚀 Fast | Everything combined |

### Fetch by Random Mode (Default)
```bash
python3 ~/.config/agents/skills/hot-topics/scripts/fetch_tweets.py
```

### Fetch Specific Tweet by URL
```bash
python3 ~/.config/agents/skills/hot-topics/scripts/fetch_tweets.py --url "https://x.com/username/status/1234567890"
```

### Fetch with User's Question (Contextual Title) ⭐

When user asks a specific question about the tweet, use `--query` to generate a contextual title:

```bash
python3 ~/.config/agents/skills/hot-topics/scripts/fetch_tweets_contextual.py \
  --url "https://x.com/username/status/1234567890" \
  --query "你对这里说的伊朗局势怎么看"
```

**Example Output:**
```
# Without --query (generic title):
"中东地区发生冲突多方关注局势发展🕊️"

# With --query (contextual title):
"伊朗局势升级影响中东格局，专家分析后续走向🔥"
         ^^^^^^^^
         Reflects user's specific interest
```

### Fetch User's Latest Tweets
```bash
python3 ~/.config/agents/skills/hot-topics/scripts/fetch_tweets.py --user elonmusk --count 3
```

### Batch Processing (Fast Mode)
```bash
# Process 20 users concurrently (10x faster)
python3 ~/.config/agents/skills/hot-topics/scripts/fetch_tweets_fast.py \
  --batch --max-users 20
```

### With Deduplication (Recommended for Cron Jobs)
```bash
# Automatically skip already-fetched tweets
python3 ~/.config/agents/skills/hot-topics/scripts/fetch_tweets_dedup.py \
  --batch --max-users 20

# Check deduplication stats
python3 ~/.config/agents/skills/hot-topics/scripts/fetch_tweets_dedup.py --stats

# Reset deduplication index
python3 ~/.config/agents/skills/hot-topics/scripts/fetch_tweets_dedup.py --reset-index
```

### Ultimate Version (All Features)
```bash
# Fast + Deduplication + Contextual titles
python3 ~/.config/agents/skills/hot-topics/scripts/fetch_tweets_advanced.py \
  --url "https://x.com/..." \
  --query "你对伊朗局势怎么看"
```

### Force Language
```bash
python3 ~/.config/agents/skills/hot-topics/scripts/fetch_tweets.py --user elonmusk --lang en
```

### Enable Audio Analysis (Local Whisper)
```bash
# 1. Install whisper first (one-time setup)
pip install openai-whisper

# 2. Run with audio analysis
python3 ~/.config/agents/skills/hot-topics/scripts/fetch_tweets.py \
  --user elonmusk --analyze-audio
```

## Configuration

### 1. Knowledge Base Structure

Create category folders under `~/Documents/知识库/我的助手/`:

```
我的助手/
├── AI_Tech/
│   └── 关注列表.txt    # One @username per line
├── Food/
│   └── 推荐.txt
├── Health/
└── Finance/
```

File format (any .txt file):
```
@elonmusk
@levelsio
@xiaohu
```

### 2. TikHub API Key

Edit the API key in the script or set environment variable:

```bash
export TIKHUB_API_KEY=""
```

Default API key is embedded in the script.

### 3. Output Location

Results are saved to `~/Documents/知识库/热门话题/`:

```
热门话题/
├── AI_Tech/
│   └── 🤖AI新功能发布/
│       ├── cover.jpg                   # 1:1 cover image
│       ├── video.mp4                   # Downloaded video (if any)
│       ├── frames/                     # Extracted video frames
│       ├── audio.mp3                   # Extracted audio (if video)
│       ├── _kimi_analysis.txt          # Full AI analysis
│       ├── _audio_transcription.txt    # Audio transcription & analysis (if --analyze-audio)
│       └── post.json                   # Complete data
├── Food/
└── ...
```

## Post.json Structure

```json
{
  "platform": "X (Twitter)",
  "title": "🤖AI新功能发布引发热议",
  "topic": "🤖AI新功能发布引发热议",
  "category": "AI_Tech",
  "author": {
    "username": "@xiaohu",
    "name": "小互"
  },
  "description": "推文摘要...",
  "content": "【推文内容】...\n【媒体分析】...\n【音频分析】...\n【深度分析】...\n【统计数据】...\n【热门评论】...",
  "stats": {
    "likes": 1234,
    "retweets": 567,
    "replies": 89,
    "views": "1234567"
  },
  "comments": [
    {
      "author": "User Name",
      "author_screen": "username",
      "text": "评论内容",
      "likes": 100,
      "replies": 5
    }
  ],
  "url": "https://x.com/username/status/123456",
  "created_at": "2026-02-10T04:58:05Z",
  "fetched_at": "2026-02-11 16:15:08",
  "has_media": true,
  "has_video": false,
  "media_count": 2,
  "video_duration": 145.5,
  "status": "COMPLETED",
  "kimi_analysis": "AI analysis content...",
  "media_analysis": "Visual content description...",
  "audio_analysis": "Audio transcription and analysis (if --analyze-audio)",
  "user_query": "你对这里说的伊朗局势怎么看",
  "contextual_title": true
}
```

## Categories

Auto-detected categories based on content and author:

| Category | Keywords/Authors |
|----------|-----------------|
| AI_Tech | ai, gpt, claude, coding, tech, software, algorithm, deepseek, machine learning |
| Design | design, ui, ux, graphic, illustration, brand, logo, typography, visual |
| Entertainment | movie, film, music, netflix, disney, celebrity, hollywood |
| Food | food, restaurant, recipe, cooking, cuisine, chef, baking |
| Health | health, wellness, fitness, exercise, diet, nutrition, yoga, meditation |
| Military | military, defense, army, navy, pentagon, weapon, drone, tactical |
| Society | education, school, community, social, culture |
| Sports | sports, basketball, football, soccer, olympics, championship |
| Technology | computer, hardware, chip, electronics, gadget, robot, iot |
| Trending | trending, viral, popular (fallback) |

## Title Generation Rules

### Standard Mode (v3.0)
1. Kimi analyzes tweet text and cover images
2. Generates emoji title (15-20 Chinese chars or 10-15 English words)
3. Includes key terms (product names, tech names)
4. Format: `**标题：** 🤖AI新功能发布引发热议`

### Contextual Mode (v4.1+) ⭐
When `--query` is provided:
1. Kimi analyzes tweet text, images, AND user's question
2. Generates title that **responds to user's specific interest**
3. Title reflects both tweet content AND user's focus
4. Example:
   - User question: "你对伊朗局势怎么看"
   - Generic title: "中东地区发生冲突多方关注🕊️"
   - Contextual title: "伊朗局势升级影响中东格局，专家分析后续走向🔥"

## Dependencies

### Required
- **tikhub-api**: Tweet data fetching (built-in)
- **kimi**: AI analysis (requires `kimi login`)
- **Pillow**: Python image processing
- **ffmpeg**: Video frame extraction and audio extraction
- **curl**: Media download

### For Fast Version
- **aiohttp**: Async HTTP client
- **aiofiles**: Async file operations
```bash
pip install aiohttp aiofiles
```

### Optional (for audio analysis)
- **openai-whisper**: Local audio transcription (RECOMMENDED - free, privacy-friendly)
  ```bash
  pip install openai-whisper
  ```

## Installing Whisper (Local)

**Recommended**: Use local Whisper for free, privacy-friendly audio transcription.

### Step 1: Install
```bash
pip install openai-whisper
```

### Step 2: Verify Installation
```bash
whisper --version
```

### Step 3: First Run (Download Model)
```bash
# The model will be auto-downloaded on first use
# base model (~74 MB) is used by default
whisper sample.mp3 --model base
```

### Model Options

| Model | Size | Speed | Accuracy | VRAM Required |
|-------|------|-------|----------|---------------|
| tiny | ~39 MB | Fastest | Low | ~1 GB |
| base | ~74 MB | Fast | Good | ~1 GB |
| small | ~244 MB | Medium | Better | ~2 GB |
| medium | ~769 MB | Slow | High | ~5 GB |
| large | ~1550 MB | Slowest | Best | ~10 GB |

**Default**: `base` model - good balance of speed and accuracy.

### Using Different Models

The model is hardcoded to `base` in the current version for optimal balance. If you need different accuracy/speed trade-offs, edit `audio_utils.py`:

```python
# In analyze_audio_content function
transcription_result = transcribe_audio(audio_path, method="local", model="small")
```

## Troubleshooting

### No users found
- Check `~/Documents/知识库/我的助手/` exists with .txt files
- Ensure @username format in files

### API errors
- Verify TikHub API key is valid
- Check network connection

### Kimi analysis fails
- Ensure `kimi login` has been run
- Check kimi CLI is installed

### Video download fails
- Verify ffmpeg is installed
- Check disk space

### Deduplication not working
- Run with `--stats` to check index status
- Use `--reset-index` to rebuild index if needed

### Performance Optimizations

The script includes multiple optimizations for speed and reliability:

| Feature | Implementation | Benefit |
|---------|---------------|---------|
| **Retry Logic** | All network operations have automatic retry (max 2 attempts) | More reliable downloads |
| **Timeout Reduction** | Kimi analysis: 60s (was 120s), Title generation: 45s (was 90s) | Faster failure recovery |
| **Video Thumbnail Direct** | Use Twitter/X thumbnail URL without downloading video | Instant cover for all videos |
| **Long Video Skip** | Videos >3min skip download entirely | 90%+ time savings |
| **Concurrent Processing** | Multiple users processed in parallel | 10x speedup for batch |
| **Deduplication** | Skip already-fetched tweets | Save API calls & time |
| **Progress Logging** | Real-time progress updates with timestamps | Better visibility |

### Long video handling (>3 minutes)
For videos longer than 3 minutes (180 seconds), the script will:
- ✅ **Skip video download entirely** (big time saver!)
- ✅ **Use video thumbnail URL directly** from Twitter/X
- ✅ Skip audio extraction/transcription/analysis
- ✅ Download only the thumbnail for cover and light analysis
- ✅ Video duration obtained from API metadata (no ffprobe needed)

### Short video handling (≤3 minutes)
For short videos, the script will:
- ✅ Download the video for full analysis (with retry on failure)
- ✅ Extract 5 frames for visual analysis (60s timeout, 1 retry)
- ✅ Extract audio for transcription (if `--analyze-audio` enabled)
- ✅ Use video thumbnail as initial cover, then improve with extracted frame
- ✅ Generate title with 45s timeout (1 retry for reliability)

### Audio analysis fails

1. **Check Whisper installation:**
   ```bash
   whisper --version
   # Should show version number
   ```

2. **If not installed:**
   ```bash
   pip install openai-whisper
   ```

3. **Check ffmpeg can extract audio:**
   ```bash
   ffmpeg -i video.mp4 -vn -acodec libmp3lame audio.mp3
   ```

4. **First run downloads model** - may take a few minutes:
   ```bash
   # Pre-download base model
   whisper --model base dummy.mp3 2>/dev/null || true
   ```

5. **Model storage location**:
   - macOS/Linux: `~/.cache/whisper/`
   - Windows: `%USERPROFILE%\.cache\whisper\`

## Advanced Usage

### Process Single Tweet with Context
```python
from fetch_tweets_contextual import fetch_by_url_with_context
from fetch_tweets import TikHubAPI

api = TikHubAPI()
result = fetch_by_url_with_context(
    "https://x.com/username/status/123456",
    api,
    language='zh',
    user_query="你对伊朗局势怎么看"
)
print(f"Contextual Title: {result['suggested_title']}")
```

### Batch Processing with Context
```python
from fetch_tweets_fast import process_multiple_users
import asyncio

async def batch_fetch():
    users = ["user1", "user2", "user3"]
    results = await process_multiple_users(
        users, 
        tweets_per_user=2,
        language='zh'
    )
    return results

results = asyncio.run(batch_fetch())
```

### Custom Knowledge Base Path
```bash
export HOT_TOPICS_KB_PATH="/custom/path/to/knowledge/base"
python3 ~/.config/agents/skills/hot-topics/scripts/fetch_tweets.py
```

### Scheduled Updates with Deduplication
```bash
# Add to crontab for hourly updates
crontab -e

# Every hour, fetch new tweets (skipping duplicates)
0 * * * * cd ~/.config/agents/skills/hot-topics && \
  python3 scripts/fetch_tweets_dedup.py --batch --max-users 20 >> /tmp/hot_topics.log 2>&1
```

## Script Reference

| Script | Description | Best For |
|--------|-------------|----------|
| `fetch_tweets.py` | Original stable version | Daily use |
| `fetch_tweets_fast.py` | Async concurrent processing | Batch operations |
| `fetch_tweets_dedup.py` | Deduplication support | Scheduled tasks |
| `fetch_tweets_contextual.py` | Contextual title generation | Single URL with question |
| `fetch_tweets_advanced.py` | All features combined | Production use |

## Version History

- **v3.0**: Original stable version
- **v4.0 Fast**: Added async concurrent processing (10x speed)
- **v4.0 Dedup**: Added deduplication support
- **v4.1 Context**: Added contextual title generation
- **v5.0 Advanced**: Combined all features (fast + dedup + context)
