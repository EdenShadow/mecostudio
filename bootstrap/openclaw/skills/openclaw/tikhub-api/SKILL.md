---
name: tikhub-api
description: 使用 TikHub API 查询 TikTok、Reddit、Twitter/X、Instagram、YouTube 的帖子、用户、视频等数据
metadata:
  {
    "openclaw":
      {
        "emoji": "📊",
        "requires": { "bins": ["python3", "curl"] },
        "install":
          [
            {
              "id": "local",
              "kind": "copy",
              "files": [
                {"src": "tikhub", "dst": "~/.local/bin/tikhub"},
                {"src": "twitter_get_tweet.py", "dst": "~/.local/bin/twitter_get_tweet.py"},
                {"src": "tiktok_get_video.py", "dst": "~/.local/bin/tiktok_get_video.py"},
                {"src": "instagram_get_post.py", "dst": "~/.local/bin/instagram_get_post.py"},
                {"src": "youtube_get_video.py", "dst": "~/.local/bin/youtube_get_video.py"},
                {"src": "reddit_get_post.py", "dst": "~/.local/bin/reddit_get_post.py"}
              ],
              "label": "Install TikHub API tools",
            },
          ],
        "priority": "normal",
        "tags": ["api", "social-media", "tiktok", "twitter", "instagram", "youtube", "reddit", "data"],
      },
  }
---

# TikHub API 📊

使用 **TikHub API** 查询多个社交媒体平台的数据。

## 支持的平台

- 🎵 **TikTok** - 视频、用户信息、评论
- 🐦 **Twitter/X** - 推文详情、用户发帖、评论
- 📷 **Instagram** - 帖子、Reels、用户信息
- 📺 **YouTube** - 视频、频道信息、评论
- 🔴 **Reddit** - 帖子、评论、用户信息

## 使用方法

### 方法1: 统一 CLI 工具

```bash
# Twitter/X
tikhub twitter tweet <URL或ID>     # 获取推文详情
tikhub twitter posts <用户名>     # 获取用户最新发帖
tikhub twitter user <用户名>      # 获取用户信息

# TikTok
tikhub tiktok video <URL>        # 获取视频信息
tikhub tiktok user <用户名>      # 获取用户信息

# Instagram
tikhub instagram post <URL>      # 获取帖子信息
tikhub instagram user <用户名>   # 获取用户信息

# YouTube
tikhub youtube video <URL>       # 获取视频信息
tikhub youtube channel <ID>     # 获取频道信息

# Reddit
tikhub reddit post <URL>         # 获取帖子信息
tikhub reddit user <用户名>      # 获取用户信息
```

### 方法2: 直接调用脚本

```bash
# Twitter/X
python3 ~/.openclaw/skills/tikhub-api/twitter_get_tweet.py <URL或ID>

# TikTok
python3 ~/.openclaw/skills/tikhub-api/tiktok_get_video.py <视频URL>

# Instagram
python3 ~/.openclaw/skills/tikhub-api/instagram_get_post.py <帖子URL>

# YouTube
python3 ~/.openclaw/skills/tikhub-api/youtube_get_video.py <视频URL>

# Reddit
python3 ~/.openclaw/skills/tikhub-api/reddit_get_post.py <帖子URL>
```

### 方法3: 在 Python 中使用

```python
import sys
sys.path.insert(0, '~/.openclaw/skills/tikhub-api')
from tikhub_common import TikHubAPI

api = TikHubAPI()

# 获取推文详情
result = api.twitter_get_tweet_detail("2021387755222335901")

# 获取用户发帖
result = api.twitter_get_user_posts("elonmusk", limit=5)

# 获取最新评论
result = api.twitter_get_latest_comments("2021387755222335901")
```

## 返回数据格式

```json
{
  "code": 200,
  "data": {
    "likes": 968,
    "retweets": 64,
    "replies": 134,
    "views": "83250",
    "text": "推文内容...",
    "author": {
      "screen_name": "username",
      "name": "用户名称"
    }
  }
}
```

## API Key

已内置 API Key，可直接使用。

**注意**: 部分 API 会产生费用，详情见 TikHub 官网。
