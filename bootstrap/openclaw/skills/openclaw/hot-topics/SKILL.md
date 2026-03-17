---
name: hot-topics
description: 自动抓取关注博主的热门话题，生成统一的帖子格式
metadata:
  {
    "openclaw":
      {
        "emoji": "🔥",
        "requires": { "bins": ["python3", "kimi"] },
        "install": [],
        "priority": "medium",
        "tags": ["hot-topics", "twitter", "social-media", "content", "kimi"]
      }
  }
---

# Hot Topics Fetcher v2.2

自动抓取关注博主的热门话题，使用 Kimi AI 分析内容并生成吸引人的标题。

## Features

- 从知识库读取关注的博主分类
- 使用 TikHub API 获取真实推文数据（点赞、转发、评论、浏览量）
- **Kimi CLI 智能分析**生成话题标题（带emoji，15-20字）
- 智能分类（AI_Tech、Food、Health、Finance 等）
- **视频处理**：
  - 从 variants 提取最高质量 MP4
  - 视频首帧自动裁剪为 1:1 封面
- **图片处理**：
  - 单图自动裁剪为 1:1
  - 多图使用 Pillow 合并为 2x2 collage
- **评论提取**：抓取真实热门评论（前10条，按点赞排序）
- **文件夹重命名**：提取到标题后自动重命名为 `标题`

## Workflow

```
1. 读取知识库中的关注博主列表
2. 随机选择 1-5 位博主获取最新推文
3. 下载推文媒体（图片/视频）
4. 提取推文统计数据和热门评论
5. Kimi CLI 分析内容生成标题
6. 生成 1:1 封面图
7. 保存 post.json
8. 文件夹重命名为 AI 生成的标题
```

## Output Format

```
~/Documents/知识库/热门话题/
├── AI_Tech/
│   └── 🤣Seedance2.0禁真人出镜真相/
│       ├── cover.jpg          # 1:1 封面
│       ├── video.mp4          # 下载的视频（如有）
│       ├── _kimi_analysis.txt # Kimi 原始分析
│       └── post.json          # 完整数据
├── Food/
│   └── 💡宝藏餐厅揭秘/
│       └── ...
└── ...
```

## post.json Structure

```json
{
  "platform": "X (Twitter)",
  "title": "🤣Seedance2.0禁真人出镜真相",
  "topic": "🤣Seedance2.0禁真人出镜真相",
  "category": "AI_Tech",
  "author": {
    "username": "@xiaohu",
    "name": "小互"
  },
  "description": "推文内容摘要...",
  "content": "【推文内容】...\n【深度分析】...\n【统计数据】...\n【热门评论】...",
  "stats": {
    "likes": 0,
    "retweets": 79,
    "replies": 227,
    "views": "680895"
  },
  "comments": [
    {
      "author": "Grok",
      "author_screen": "grok",
      "text": "评论内容...",
      "likes": 1,
      "replies": 0
    }
  ],
  "comments_count": 10,
  "url": "https://x.com/xiaohu/status/...",
  "created_at": "Tue Feb 10 04:58:05 +0000 2026",
  "fetched_at": "2026-02-11 16:15:08",
  "has_media": true,
  "has_video": true,
  "media_count": 1,
  "status": "COMPLETED",
  "kimi_analysis": "Kimi 完整分析内容..."
}
```

## Usage

```bash
# 直接运行
openclaw skill hot-topics

# 或通过 CLI
python3 ~/.openclaw/skills/hot-topics/skill.py

# 处理单条推文
python3 -c "
from skill import process_tweet
from tikhub_common import TikHubAPI

api = TikHubAPI()
result = api.twitter_get_tweet_detail('2021086246614008241')
if result.get('code') == 200:
    tweet = result.get('data', {})
    author = tweet.get('author', {}).get('screen_name', 'xiaohu')
    info = process_tweet(tweet, author, api, language='zh')
    print(f'Title: {info[\"suggested_title\"]}')
"
```

## Dependencies

- **tikhub-api**: 获取推文数据（API Key 需配置在 `tikhub_common.py`）
- **kimi**: Kimi CLI 用于内容分析（需 `kimi login`）
- **Pillow**: Python 图片处理库
- **ffmpeg**: 视频封面提取
- **curl**: 下载媒体文件

## Configuration

### 1. 关注博主列表

在 `~/Documents/知识库/我的助手/` 下创建分类文件夹：

```
我的助手/
├── AI_Tech/
│   └── 关注列表.txt  (每行一个 @username)
├── Food/
│   └── 推荐.txt
└── ...
```

### 2. TikHub API Key

编辑 `~/.openclaw/skills/tikhub-api/tikhub_common.py`：

```python
API_KEY = "your-api-key-here"
BASE_URL = "https://api.tikhub.io"
```

### 3. Kimi CLI

确保已登录：

```bash
kimi login
```

## 标题生成规则

1. Kimi 分析推文内容和封面图
2. 生成带 emoji 的中文标题（15-20字）
3. 包含关键术语（产品名、技术名等）
4. 格式：**标题：** 🤣Seedance2.0禁真人出镜真相

## Language Support

支持中英文输出：

```python
# 中文
process_tweet(tweet, author, api, language='zh')

# 英文
process_tweet(tweet, author, api, language='en')
```

## Changelog

### v2.2
- 修复标题提取正则表达式（支持 `**标题：**` 格式）
- 添加文件夹自动重命名功能
- 优化视频下载（从 variants 选择最高质量 MP4）

### v2.1
- 支持多图 collage 生成
- 添加评论提取功能
- 支持英文/中文输出

### v2.0
- 集成 TikHub API
- 集成 Kimi CLI 分析
- 初始版本
