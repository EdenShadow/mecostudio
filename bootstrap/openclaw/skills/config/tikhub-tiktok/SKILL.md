---
name: tikhub-tiktok
description: Query TikTok, YouTube, and Twitter/X data through TikHub API. Use when the user needs to fetch social media information including video details by share link, user profiles, user posts, video comments, live stream info, search videos/users, or channel data. Supports TikTok, YouTube, and Twitter/X data extraction tasks via api.tikhub.io.
---

# TikHub Social Media API Skill

Query TikTok, YouTube, and Twitter/X data through TikHub API.

## API Authentication

- **Base URL**: `https://api.tikhub.io`
- **Token**: from environment variable `TIKHUB_API_KEY`
- **Header**: `Authorization: Bearer <token>`

---

# TikTok API

## Video Data

### Fetch Video by Share URL (V2 - Recommended)
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/tiktok_api.py video_by_url "<share_url>"
```

**Supported Share URL Formats**:
- Short link: `https://www.tiktok.com/t/ZTFNEj8Hk/`
- VM link: `https://vm.tiktok.com/ZM8JQYJhQ/`
- Full link: `https://www.tiktok.com/@username/video/1234567890`

**Example**:
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/tiktok_api.py video_by_url "https://www.tiktok.com/t/ZTFNEj8Hk/"
```

### Fetch Video by ID
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/tiktok_api.py video_by_id "<video_id>"
```

## User Data

### Fetch User Info
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/tiktok_api.py user_info "<sec_user_id>"
```

### Fetch User Posts
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/tiktok_api.py user_posts "<sec_user_id>" [max_cursor]
```

## Comments

### Fetch Video Comments
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/tiktok_api.py comments "<video_id>"
```

## Live Stream

### Fetch Live Room Info
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/tiktok_api.py live_info "<room_id>"
```

### Check Live Status (Batch)
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/tiktok_api.py live_status "<room_id1,room_id2>"
```

## Search

### General Search (Videos + Users + Hashtags)
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/tiktok_api.py search "<keyword>" [count] [sort_type] [publish_time]
```

**Parameters**:
- `keyword`: Search keyword
- `count`: Number of results (default: 20)
- `sort_type`: 0-Relevance (default), 1-Most likes
- `publish_time`: 0-All time (default), 1-Last day, 7-Last week, 30-Last month, 90-Last 3 months, 180-Last 6 months

**Example**:
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/tiktok_api.py search "bodycam" 30 1 7
```

### Search Videos Only
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/tiktok_api.py search_videos "<keyword>" [count] [region]
```

**Parameters**:
- `keyword`: Search keyword
- `count`: Number of results (default: 20)
- `sort_type`: 0-Relevance (default), 1-Most likes
- `publish_time`: Time filter (0, 1, 7, 30, 90, 180)
- `region`: Region code (default: US), e.g., US, GB, CA, AU

**Example**:
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/tiktok_api.py search_videos "python tutorial" 20 US
```

### Search Users
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/tiktok_api.py search_users "<keyword>" [count] [follower_filter]
```

**Parameters**:
- `keyword`: Search keyword
- `count`: Number of results (default: 20)
- `follower_filter`: Filter by follower count
  - Empty: No filter (default)
  - `ZERO_TO_ONE_K`: 0-1K followers
  - `ONE_K_TO_TEN_K`: 1K-10K followers
  - `TEN_K_TO_ONE_H_K`: 10K-100K followers
  - `ONE_H_K_PLUS`: 100K+ followers

**Example**:
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/tiktok_api.py search_users "tech" 20 TEN_K_TO_ONE_H_K
```

### Search Hashtags
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/tiktok_api.py search_hashtags "<keyword>" [count]
```

**Example**:
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/tiktok_api.py search_hashtags "fyp" 20
```

## TikTok Response Data Fields

### Video Data Fields (from `data.aweme_details[0]`)

| Field | Description |
|-------|-------------|
| `aweme_id` | Video ID |
| `desc` | Video caption/description |
| `create_time` | Creation timestamp |
| `author.nickname` | Author display name |
| `author.sec_user_id` | Author unique ID |
| `video.play_addr.url_list` | Video playback URLs |
| `video.download_addr.url_list` | Download URLs |
| `video.duration` | Video duration in seconds |
| `statistics.digg_count` | Likes count |
| `statistics.share_count` | Shares count |
| `statistics.comment_count` | Comments count |
| `statistics.play_count` | Views count |
| `region` | Region code (V2 API only) |

### User Data Fields (from `data.user`)

| Field | Description |
|-------|-------------|
| `sec_user_id` | Secure user ID (unique) |
| `nickname` | Display name |
| `avatar_larger.url_list` | Avatar URLs |
| `signature` | Bio/description |
| `follower_count` | Followers count |
| `following_count` | Following count |
| `total_favorited` | Total likes received |
| `video_count` | Number of videos |

---

# YouTube API

## Video Data

### Get Video Information (V1)
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py video_info "<video_id>"
```

**Parameters**:
- `video_id`: YouTube video ID (e.g., `LuIL5JATZsc`)
- `url_access`: `normal` (include direct URLs) | `blocked` (exclude direct URLs)
- `videos`: `auto` | `true` | `raw` | `false`
- `audios`: `auto` | `true` | `raw` | `false`
- `subtitles`: `true` | `false`
- `related`: `true` | `false`

**Example**:
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py video_info "LuIL5JATZsc"
```

### Get Video Information (V2 - Lower cost)
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py video_info_v2 "<video_id>"
```

**Note**: V2 costs 0.001$/request vs V1 0.002$/request, but stability not guaranteed.

### Get Video Information (V3)
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py video_info_v3 "<video_id>"
```

### Get Video Subtitles
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py video_subtitles "<video_id>"
```

### Get Video Comments
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py video_comments "<video_id>"
```

### Get Video Sub-comments (Replies)
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py video_sub_comments "<video_id>" "<comment_id>"
```

### Get Related Videos
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py related_videos "<video_id>"
```

## Channel Data

### Get Channel ID from URL
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py channel_id "<channel_url>"
```

**Example**:
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py channel_id "https://www.youtube.com/@LinusTechTips"
```

### Get Channel Information
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py channel_info "<channel_id>"
```

### Get Channel Description
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py channel_description "<channel_id>"
```

### Get Channel Videos (V2 - Recommended)
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py channel_videos "<channel_id>"
```

**Parameters**:
- `channel_id`: Channel ID (e.g., `UCXuqSBlHAE6Xw-yeJA0Tunw`) or name with `@` (e.g., `@LinusTechTips`)
- `sortBy`: `newest` | `oldest` | `mostPopular`
- `contentType`: `videos` | `shorts` | `live`
- `nextToken`: Pagination token for next page

### Get Channel Short Videos
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py channel_shorts "<channel_id>"
```

## Search

### Search Videos
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py search_video "<query>"
```

**Parameters**:
- `search_query`: Search keyword
- `order_by`: `this_month` | `this_week` | `this_year` | `last_hour` | `today`
- `language_code`: e.g., `en`, `zh-CN`
- `country_code`: e.g., `us`, `cn`
- `continuation_token`: Pagination token

**Example**:
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py search_video "Minecraft"
```

### Search with Filters (General Search)
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py search_filter "<query>" "<filter_type>"
```

**Filter Types**: `video`, `channel`, `playlist`, `movie`

### Search YouTube Shorts
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py search_shorts "<query>"
```

### Search Channels
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py search_channel "<query>"
```

## Trending

### Get Trending Videos
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/youtube_api.py trending
```

## YouTube Response Data Fields

### Video Data Fields (from `data`)

| Field | Description |
|-------|-------------|
| `video_id` | YouTube video ID |
| `title` | Video title |
| `description` | Video description |
| `duration` | Video duration (seconds) |
| `view_count` | View count |
| `like_count` | Like count |
| `comment_count` | Comment count |
| `upload_date` | Upload date |
| `uploader` | Channel name |
| `uploader_id` | Channel ID |
| `thumbnail` | Thumbnail URL |
| `formats` | Video/audio formats (when url_access=normal) |
| `subtitles` | Subtitle data (when subtitles=true) |

### Channel Data Fields (from `data`)

| Field | Description |
|-------|-------------|
| `channel_id` | Channel ID |
| `channel_name` | Channel name |
| `description` | Channel description |
| `subscriber_count` | Subscriber count |
| `video_count` | Total videos |
| `view_count` | Total views |
| `banner` | Banner image URL |
| `avatar` | Avatar URL |

---

# Twitter/X API

## Tweet Data

### Get Tweet Detail
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/twitter_api.py tweet "<tweet_id_or_url>"
```

**Supported Tweet URL Formats**:
- `https://twitter.com/username/status/1808168603721650364`
- `https://x.com/username/status/1808168603721650364`
- Direct tweet ID: `1808168603721650364`

**Example**:
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/twitter_api.py tweet "1808168603721650364"
```

### Get Tweet Comments
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/twitter_api.py comments "<tweet_id>" [cursor]
```

### Get Retweet Users
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/twitter_api.py retweet_users "<tweet_id>" [cursor]
```

## User Data

### Get User Profile
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/twitter_api.py user "<screen_name>"
```

**Example**:
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/twitter_api.py user "elonmusk"
```

### Get User Posts
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/twitter_api.py posts "<screen_name>" [cursor]
```

### Get User Replies
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/twitter_api.py replies "<screen_name>" [cursor]
```

### Get User Media
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/twitter_api.py media "<screen_name>" [cursor]
```

### Get User Followings
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/twitter_api.py followings "<screen_name>" [cursor]
```

### Get User Followers
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/twitter_api.py followers "<screen_name>" [cursor]
```

## Search

### Search Tweets
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/twitter_api.py search "<query>" [cursor]
```

**Example**:
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/twitter_api.py search "Python"
```

## Trending

### Get Trending Topics
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/twitter_api.py trending [country]
```

**Available Countries**:
- `UnitedStates` (default), `China`, `India`, `Japan`, `Russia`
- `Germany`, `Indonesia`, `Brazil`, `France`, `UnitedKingdom`
- `Turkey`, `Italy`, `Mexico`, `SouthKorea`, `Canada`
- And more...

**Example**:
```bash
python3 ~/.config/agents/skills/tikhub-tiktok/scripts/twitter_api.py trending UnitedStates
```

## Twitter Response Data Fields

### Tweet Data Fields (from `data`)

| Field | Description |
|-------|-------------|
| `id` / `tweet_id` | Tweet ID |
| `text` / `content` | Tweet content |
| `created_at` | Post time |
| `user.name` | Author display name |
| `user.screen_name` | Author username |
| `retweet_count` | Retweet count |
| `quote_count` | Quote tweet count |
| `reply_count` | Reply count |
| `favorite_count` / `like_count` | Like count |
| `media` | Media attachments |

### User Data Fields (from `data`)

| Field | Description |
|-------|-------------|
| `id` / `rest_id` | User ID |
| `name` | Display name |
| `screen_name` | Username |
| `description` | Bio |
| `followers_count` | Followers count |
| `friends_count` / `following_count` | Following count |
| `statuses_count` | Total tweets |
| `profile_image_url` | Avatar URL |
| `verified` | Verified badge |

---

# Common Response Format

All API responses follow this JSON structure:

```json
{
  "code": 200,
  "message": "Request successful",
  "request_id": "uuid-string",
  "data": { ... },
  "time": "2025-02-17T10:30:00Z",
  "time_stamp": 1708167000,
  "time_zone": "UTC"
}
```

---

# Workflows

## TikTok: Get Video Info from Share Link

1. Extract the share URL from user's request
2. Execute: `python3 .../tiktok_api.py video_by_url "<url>"`
3. Check `code == 200` for success
4. Extract relevant data from `data.aweme_details[0]`
5. Present key information (title, author, stats, video URLs)

## TikTok: Get User's Videos

1. Get sec_user_id (from previous video data or user's input)
2. Execute: `python3 .../tiktok_api.py user_posts "<sec_user_id>"`
3. Extract video list from response
4. For pagination, use `max_cursor` value from response for next page

## YouTube: Get Video Info

1. Extract video ID from URL or user's input
2. Execute: `python3 .../youtube_api.py video_info "<video_id>"`
3. Check `code == 200` for success
4. Extract data from `data`
5. Present key information (title, channel, stats, formats)

## YouTube: Search Videos

1. Get search query from user
2. Execute: `python3 .../youtube_api.py search_video "<query>"`
3. Extract results from `data.results`
4. For pagination, use `continuation_token` from response

## YouTube: Get Channel Videos

1. Get channel ID or handle (e.g., `@LinusTechTips`)
2. Execute: `python3 .../youtube_api.py channel_videos "<channel_id>"`
3. Extract videos from `data.videos`
4. For pagination, use `nextToken` from response

## Twitter: Get Tweet Info

1. Extract tweet ID or URL from user's request
2. Execute: `python3 .../twitter_api.py tweet "<tweet_id_or_url>"`
3. Check `code == 200` for success
4. Extract data from `data`
5. Present key information (content, author, stats)

## Twitter: Get User's Posts

1. Get screen_name (e.g., `elonmusk`)
2. Execute: `python3 .../twitter_api.py posts "<screen_name>"`
3. Extract tweets from response
4. For pagination, use `cursor` value from response for next page

## Twitter: Search Tweets

1. Get search query from user
2. Execute: `python3 .../twitter_api.py search "<query>"`
3. Extract results from response
4. For pagination, use `cursor` from response

---

# Error Handling

Common response codes:

| Code | Meaning | Solution |
|------|---------|----------|
| 200 | Success | - |
| 400 | Bad Request | Check parameters |
| 401 | Unauthorized | Token issue |
| 404 | Not Found | Video/user/channel doesn't exist or is private |
| 429 | Rate Limited | Wait before retry |
| 500 | Server Error | Retry later |

---

# Rate Limits & Billing

- Each request is billed separately
- Successful requests (code 200) incur charges
- Responses include `cache_url` for 24-hour caching
- Accessing cached results does not incur additional charges

**YouTube API Pricing (approximate)**:
- Get video info V1: 0.002$/request
- Get video info V2: 0.001$/request
- Other endpoints: Varies by complexity

---

# API Endpoints Reference

## TikTok Endpoints

| Function | Endpoint |
|----------|----------|
| video_by_url | `GET /api/v1/tiktok/app/v3/fetch_one_video_by_share_url_v2` |
| video_by_url_v1 | `GET /api/v1/tiktok/app/v3/fetch_one_video_by_share_url` |
| video_by_id | `GET /api/v1/tiktok/app/v3/fetch_one_video` |
| user_info | `GET /api/v1/tiktok/app/v3/fetch_user_info` |
| user_posts | `GET /api/v1/tiktok/app/v3/fetch_user_post_videos` |
| comments | `GET /api/v1/tiktok/app/v3/fetch_video_comments` |
| live_info | `GET /api/v1/tiktok/app/v3/fetch_live_room_info` |
| live_status | `GET /api/v1/tiktok/app/v3/batch_check_live_status` |
| search | `GET /api/v1/tiktok/app/v3/fetch_general_search_result` |
| search_videos | `GET /api/v1/tiktok/app/v3/fetch_video_search_result` |
| search_users | `GET /api/v1/tiktok/app/v3/fetch_user_search_result` |
| search_hashtags | `GET /api/v1/tiktok/app/v3/fetch_hashtag_search_result` |

## YouTube Endpoints

| Function | Endpoint |
|----------|----------|
| video_info | `GET /api/v1/youtube/web/get_video_info` |
| video_info_v2 | `GET /api/v1/youtube/web/get_video_info_v2` |
| video_info_v3 | `GET /api/v1/youtube/web/get_video_info_v3` |
| video_subtitles | `GET /api/v1/youtube/web/get_video_subtitles` |
| video_comments | `GET /api/v1/youtube/web/get_video_comments` |
| video_sub_comments | `GET /api/v1/youtube/web/get_video_sub_comments` |
| related_videos | `GET /api/v1/youtube/web/get_related_videos` |
| channel_id | `GET /api/v1/youtube/web/get_channel_id` |
| channel_info | `GET /api/v1/youtube/web/get_channel_info` |
| channel_description | `GET /api/v1/youtube/web/get_channel_description` |
| channel_videos | `GET /api/v1/youtube/web/get_channel_videos_v2` |
| channel_shorts | `GET /api/v1/youtube/web/get_channel_shorts` |
| search_video | `GET /api/v1/youtube/web/search_video` |
| search_filter | `GET /api/v1/youtube/web/general_search` |
| search_shorts | `GET /api/v1/youtube/web/get_shorts_search` |
| search_channel | `GET /api/v1/youtube/web/search_channel` |
| trending | `GET /api/v1/youtube/web/get_trending_videos` |

## Twitter Endpoints

| Function | Endpoint |
|----------|----------|
| tweet | `GET /api/v1/twitter/web/fetch_tweet_detail` |
| comments | `GET /api/v1/twitter/web/fetch_post_comments` |
| latest_comments | `GET /api/v1/twitter/web/fetch_latest_tweet_comments` |
| retweet_users | `GET /api/v1/twitter/web/fetch_retweet_users` |
| user | `GET /api/v1/twitter/web/fetch_user_profile` |
| posts | `GET /api/v1/twitter/web/fetch_user_post_tweet` |
| replies | `GET /api/v1/twitter/web/fetch_user_tweet_replies` |
| media | `GET /api/v1/twitter/web/fetch_user_media` |
| followings | `GET /api/v1/twitter/web/fetch_user_followings` |
| followers | `GET /api/v1/twitter/web/fetch_user_followers` |
| search | `GET /api/v1/twitter/web/fetch_search` |
| trending | `GET /api/v1/twitter/web/fetch_trending` |

Full documentation: https://docs.tikhub.io
