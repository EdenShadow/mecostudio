#!/usr/bin/env python3
"""
TikHub API 通用请求模块
API 文档: https://docs.tikhub.io/
"""

import json
import urllib.request
import urllib.parse
import urllib.error
import ssl
import sys
import os
import re
from pathlib import Path
from typing import Optional, Dict, Any

# API 配置
API_KEY = ""
API_BASE_URL = "https://api.tikhub.io"  # 海外用户使用 .io
API_BASE_URL_CN = "https://api.tikhub.dev"  # 国内用户使用 .dev


def resolve_tikhub_api_key(default: str = '') -> str:
    direct = os.environ.get('TIKHUB_API_KEY', '').strip()
    if direct:
        return direct
    alt = os.environ.get('MECO_TIKHUB_API_KEY', '').strip()
    if alt:
        return alt
    settings_path = Path.home() / '.meco-studio' / 'app-settings.json'
    if settings_path.exists():
        try:
            parsed = json.loads(settings_path.read_text(encoding='utf-8'))
            key = str(parsed.get('tikhubApiKey', '')).strip() if isinstance(parsed, dict) else ''
            if key:
                return key
        except Exception:
            pass
    return default.strip()

class TikHubAPI:
    """TikHub API 客户端"""
    
    def __init__(self, api_key: str = API_KEY, use_cn_domain: bool = False):
        self.api_key = resolve_tikhub_api_key(api_key)
        self.base_url = API_BASE_URL_CN if use_cn_domain else API_BASE_URL
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*",
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            )
        }
        self.ctx = ssl.create_default_context()
    
    def _request(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Dict:
        """发送 API 请求"""
        url = f"{self.base_url}{endpoint}"
        
        if params:
            query_string = urllib.parse.urlencode(params)
            url = f"{url}?{query_string}"
        
        try:
            req = urllib.request.Request(url, headers=self.headers, method='GET')
            
            with urllib.request.urlopen(req, context=self.ctx, timeout=30) as response:
                result = json.loads(response.read().decode('utf-8'))
                return result
                
        except urllib.error.HTTPError as e:
            error_msg = f"HTTP Error {e.code}: {e.reason}"
            try:
                error_body = json.loads(e.read().decode('utf-8'))
                error_msg += f"\nDetails: {error_body}"
            except:
                pass
            return {"error": error_msg, "code": e.code}
        except Exception as e:
            return {"error": str(e), "code": 500}
    
    # ========== TikTok ==========
    def tiktok_get_video(self, video_url: str) -> Dict:
        """获取 TikTok 视频信息"""
        return self._request("/api/v1/tiktok/web/fetch_post", {"url": video_url})
    
    def tiktok_get_user(self, username: str) -> Dict:
        """获取 TikTok 用户信息"""
        return self._request("/api/v1/tiktok/web/fetch_user", {"unique_id": username})
    
    # ========== Twitter/X ==========
    def twitter_get_tweet_detail(self, tweet_id: str) -> Dict:
        """获取单个推文详情"""
        return self._request("/api/v1/twitter/web/fetch_tweet_detail", {"tweet_id": tweet_id})
    
    def twitter_get_tweet(self, tweet_url: str) -> Dict:
        """获取 Twitter 推文信息（兼容旧接口）"""
        match = re.search(r'(?:twitter|x)\.com/([A-Za-z0-9_]+)/status/(\d+)', tweet_url or '')
        if match:
            screen_name = match.group(1)
            tweet_id = match.group(2)
            result = self.twitter_get_tweet_from_user_posts(screen_name, tweet_id)
            if result.get('code') == 200:
                return result
            return self.twitter_get_tweet_detail(tweet_id)
        return {"error": "Invalid tweet URL", "code": 400}
    
    def twitter_get_latest_comments(self, tweet_id: str, cursor: str = None) -> Dict:
        """获取推文最新评论"""
        params = {"tweet_id": tweet_id}
        if cursor:
            params["cursor"] = cursor
        return self._request("/api/v1/twitter/web/fetch_latest_post_comments", params)
    
    def twitter_get_user_posts(self, screen_name: str, cursor: str = None, limit: int = 20) -> Dict:
        """获取用户发帖"""
        params = {"screen_name": screen_name, "user_name": screen_name, "limit": str(limit)}
        if cursor:
            params["cursor"] = cursor
        return self._request("/api/v1/twitter/web/fetch_user_post_tweet", params)

    @staticmethod
    def _extract_timeline(result: Dict[str, Any]) -> list:
        data = result.get("data", {}) if isinstance(result, dict) else {}
        if isinstance(data, dict):
            timeline = data.get("timeline")
            if isinstance(timeline, list):
                return timeline
            nested = data.get("data")
            if isinstance(nested, dict):
                nested_timeline = nested.get("timeline")
                if isinstance(nested_timeline, list):
                    return nested_timeline
        return []

    @staticmethod
    def _extract_next_cursor(result: Dict[str, Any]) -> str:
        data = result.get("data", {}) if isinstance(result, dict) else {}
        if not isinstance(data, dict):
            return ""
        for key in ("next_cursor", "cursor", "nextCursor"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""

    @staticmethod
    def _normalize_tweet_id(tweet: Dict[str, Any]) -> str:
        if not isinstance(tweet, dict):
            return ""
        for key in ("tweet_id", "id", "rest_id"):
            value = tweet.get(key)
            if value is None:
                continue
            text = str(value).strip()
            if text:
                return text
        return ""

    def twitter_get_tweet_from_user_posts(self, screen_name: str, tweet_id: str, limit: int = 40, max_pages: int = 3) -> Dict:
        user = str(screen_name or "").strip().lstrip("@")
        target_id = str(tweet_id or "").strip()
        if not user or not target_id:
            return {"error": "missing screen_name or tweet_id", "code": 400}

        cursor = None
        last_error = None
        for _ in range(max_pages):
            result = self.twitter_get_user_posts(user, cursor=cursor, limit=limit)
            if result.get("code") != 200:
                last_error = result
                break
            timeline = self._extract_timeline(result)
            for item in timeline:
                if self._normalize_tweet_id(item) == target_id:
                    return {"code": 200, "data": item, "source": "fetch_user_post_tweet"}
            cursor = self._extract_next_cursor(result)
            if not cursor:
                break

        if isinstance(last_error, dict):
            return last_error
        return {"error": f"tweet not found in user timeline: @{user}/{target_id}", "code": 404}
    
    def twitter_get_user(self, username: str) -> Dict:
        """获取 Twitter 用户信息"""
        return self._request("/api/v1/twitter/web/fetch_user", {"screen_name": username})
    
    # ========== Instagram ==========
    def instagram_get_post(self, post_url: str) -> Dict:
        """获取 Instagram 帖子信息"""
        return self._request("/api/v1/instagram/web/fetch_post", {"url": post_url})
    
    def instagram_get_user(self, username: str) -> Dict:
        """获取 Instagram 用户信息"""
        return self._request("/api/v1/instagram/web/fetch_user", {"username": username})
    
    # ========== YouTube ==========
    def youtube_get_video(self, video_url: str) -> Dict:
        """获取 YouTube 视频信息"""
        return self._request("/api/v1/youtube/web/fetch_video", {"url": video_url})
    
    def youtube_get_channel(self, channel_id: str) -> Dict:
        """获取 YouTube 频道信息"""
        return self._request("/api/v1/youtube/web/fetch_channel", {"channel_id": channel_id})
    
    # ========== Reddit ==========
    def reddit_get_post(self, post_url: str) -> Dict:
        """获取 Reddit 帖子信息"""
        return self._request("/api/v1/reddit/web/fetch_post", {"url": post_url})
    
    def reddit_get_user(self, username: str) -> Dict:
        """获取 Reddit 用户信息"""
        return self._request("/api/v1/reddit/web/fetch_user", {"username": username})


def print_json(data: Dict):
    """美化打印 JSON"""
    print(json.dumps(data, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    api = TikHubAPI()
    # 测试连接
    print("TikHub API 模块已加载")
    print(f"API Base URL: {api.base_url}")
