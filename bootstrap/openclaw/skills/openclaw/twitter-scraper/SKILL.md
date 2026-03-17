---
name: twitter-scraper
description: Scrape X/Twitter posts using twitterapi.io API - get user info, tweets, followers, advanced search
metadata:
  {
    "openclaw":
      {
        "emoji": "🕸️",
        "requires": { "bins": ["twitter-scraper"] },
        "install":
          [
            {
              "id": "local",
              "kind": "node",
              "package": "~/.openclaw/skills/twitter-scraper",
              "bins": ["twitter-scraper"],
              "label": "Install twitter-scraper from local",
            },
          ],
      },
  }
---

# Twitter Scraper 🕸️

使用 twitterapi.io API 获取 X.com (Twitter) 的数据。

## 功能

- ✅ 获取用户信息（粉丝、关注、推文统计等）
- ✅ 获取用户最新推文（时间线）
- ✅ 获取单条推文详情
- ✅ 获取用户关注者/关注列表
- ✅ 高级搜索推文
- ✅ 获取热门趋势

## 安装

```bash
# 本地安装
cd ~/.openclaw/skills/twitter-scraper
npm link

# 验证安装
twitter-scraper --help
```

## 命令

### 1. 获取用户信息

```bash
twitter-scraper user <username>
```

获取用户的基本信息、统计数据和置顶推文。

**参数:**
- `username`: X/Twitter 用户名（可带 @ 也可不带）

**示例:**
```bash
twitter-scraper user elonmusk
twitter-scraper user @kimi
```

**输出示例:**
```
用户信息:

用户名: @elonmusk
显示名: Elon Musk
简介: 无

统计:
  粉丝: 234015703
  关注: 1283
  推文: 96247
  收藏: 206415
  媒体: 4346

位置: 未设置
网站: 无
创建时间: 2009-06-02T20:12:29.000000Z
蓝V认证: 是
置顶推文: 2018784828129243614
```

---

### 2. 获取用户最新推文 ⭐

```bash
twitter-scraper user-tweets <username> [count]
```

获取指定用户的最新推文时间线。

**参数:**
- `username`: X/Twitter 用户名
- `count`: 获取推文数量（可选，默认10条，最大100条）

**示例:**
```bash
# 获取马斯克最新 10 条推文
twitter-scraper user-tweets elonmusk

# 获取马斯克最新 5 条推文
twitter-scraper user-tweets elonmusk 5

# 获取马斯克最新 50 条推文
twitter-scraper user-tweets elonmusk 50
```

**输出示例:**
```
@elonmusk 的最新推文:

[1] @elonmusk - Tue Feb 03 20:33:04 +0000 2026
    Building an interstellar civilization https://t.co/jccDcLG7e7
    👍 40473 | 🔄 6078 | 💬 8704 | 🔁 644
    ID: 2018784828129243614

[2] @elonmusk - Tue Feb 03 18:15:22 +0000 2026
    Starship launch tomorrow
    👍 28934 | 🔄 4521 | 💬 3120 | 🔁 233
    ID: 2018751234567890123
```

---

### 3. 获取推文详情

```bash
twitter-scraper tweet <tweet_id>
```

获取单条推文的完整信息，包括互动数据。

**参数:**
- `tweet_id`: 推文 ID（可以从推文 URL 中提取）
  - 例如: `https://x.com/elonmusk/status/2018784828129243614` → `2018784828129243614`

**示例:**
```bash
twitter-scraper tweet 2018784828129243614
```

**输出示例:**
```
推文详情:

作者: @elonmusk (Elon Musk)
时间: Tue Feb 03 20:33:04 +0000 2026
内容: Building an interstellar civilization
https://t.co/jccDcLG7e7

统计:
  👍 点赞: 40473
  🔄 转发: 6078
  💬 回复: 8704
  🔁 引用: 644
  🔖 收藏: 3785
  👀 查看: 51173165

ID: 2018784828129243614
URL: https://x.com/elonmusk/status/2018784828129243614
```

---

## API 端点参考

twitterapi.io 提供的完整功能：

### User Endpoints
- `GET /user/info` - 获取用户信息
- `GET /user/last_tweets` - 获取用户最新推文 ⭐
- `GET /user/followers` - 获取用户关注者
- `GET /user/followings` - 获取用户关注列表
- `GET /user/mention` - 获取用户被提及的推文
- `GET /search/user` - 搜索用户

### Tweet Endpoints
- `GET /tweets` - 根据 ID 获取推文
- `GET /tweet/replies` - 获取推文回复
- `GET /tweet/quotes` - 获取引用推文
- `GET /tweet/retweeters` - 获取转发者
- `GET /search/tweets` - 高级搜索推文

### Trend Endpoints
- `GET /trends` - 获取热门趋势

## API Key

```
API Key: new1_5849159db0de4d5aba328655a5bfacf5
```

## 定价

| 功能 | 价格 |
|------|------|
| 推文详情 | $0.15/1000 条 |
| 用户资料 | $0.18/1000 个 |
| 用户关注者 | $0.15/1000 个 |
| 最低收费 | $0.00015/请求 |

## 注意事项

- **速率限制**: 免费版每 5 秒最多 1 个请求
- **付费版**: 支持更高 QPS（每秒查询率）
- **数据来源**: [twitterapi.io](https://twitterapi.io)
- **学生优惠**: 提供教育和研究折扣 🎓

## 使用场景

**追踪名人动态:**
```bash
twitter-scraper user-tweets elonmusk 5
```

**分析推文互动:**
```bash
twitter-scraper tweet 2018784828129243614
```

**研究用户画像:**
```bash
twitter-scraper user elonmusk
```
