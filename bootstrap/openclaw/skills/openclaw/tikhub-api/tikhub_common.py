#!/usr/bin/env python3
"""
TikHub API 通用请求模块
API 文档: https://docs.tikhub.io/
"""

import json
import urllib.request
import urllib.parse
import ssl
import sys
from typing import Optional, Dict, Any

# API 配置
API_KEY = "66ZnSGB9wUAYmCAs20fhqEot4DQx1sSGu5l0wTrbjUpz+g5YYNhp+yWWUw=="
API_BASE_URL = "https://api.tikhub.io"  # 海外用户使用 .io
API_BASE_URL_CN = "https://api.tikhub.dev"  # 国内用户使用 .dev

class TikHubAPI:
    """TikHub API 客户端"""
    
    def __init__(self, api_key: str = API_KEY, use_cn_domain: bool = False):
        self.api_key = api_key
        self.base_url = API_BASE_URL_CN if use_cn_domain else API_BASE_URL
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "OpenClaw-TikHub/1.0"
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
        import re
        match = re.search(r'status/(\d+)', tweet_url)
        if match:
            return self.twitter_get_tweet_detail(match.group(1))
        return {"error": "Invalid tweet URL", "code": 400}
    
    def twitter_get_latest_comments(self, tweet_id: str, cursor: str = None) -> Dict:
        """获取推文最新评论"""
        params = {"tweet_id": tweet_id}
        if cursor:
            params["cursor"] = cursor
        return self._request("/api/v1/twitter/web/fetch_latest_post_comments", params)
    
    def twitter_get_user_posts(self, screen_name: str, cursor: str = None, limit: int = 20) -> Dict:
        """获取用户发帖"""
        params = {"screen_name": screen_name, "limit": str(limit)}
        if cursor:
            params["cursor"] = cursor
        return self._request("/api/v1/twitter/web/fetch_user_post_tweet", params)
    
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
