#!/usr/bin/env python3
"""
TikHub Twitter/X API 查询工具
API Key: 从环境变量 TIKHUB_API_KEY 读取
"""

import sys
import json
import os
import requests
import re

API_BASE = "https://api.tikhub.io"
API_TOKEN = os.environ.get("TIKHUB_API_KEY", "").strip()
if not API_TOKEN:
    print(json.dumps({"error": "missing TIKHUB_API_KEY"}, ensure_ascii=False))
    sys.exit(1)

headers = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json"
}


def extract_tweet_id(url_or_id):
    """从推文 URL 中提取推文 ID"""
    if url_or_id.isdigit():
        return url_or_id
    
    # 匹配 Twitter/X URL 中的 tweet ID
    patterns = [
        r'twitter\.com/\w+/status/(\d+)',
        r'x\.com/\w+/status/(\d+)',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url_or_id)
        if match:
            return match.group(1)
    
    return url_or_id


def extract_screen_name(url_or_name):
    """从 URL 中提取用户名"""
    if '/' not in url_or_name:
        return url_or_name.lstrip('@')
    
    # 匹配 Twitter/X URL 中的用户名
    patterns = [
        r'twitter\.com/(\w+)',
        r'x\.com/(\w+)',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url_or_name)
        if match:
            return match.group(1)
    
    return url_or_name.lstrip('@')


# ==================== Tweet Data ====================

def get_tweet_detail(tweet_id):
    """获取单个推文数据"""
    tweet_id = extract_tweet_id(tweet_id)
    endpoint = f"{API_BASE}/api/v1/twitter/web/fetch_tweet_detail"
    params = {"tweet_id": tweet_id}
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_comments(tweet_id, cursor=None):
    """获取推文评论"""
    tweet_id = extract_tweet_id(tweet_id)
    endpoint = f"{API_BASE}/api/v1/twitter/web/fetch_post_comments"
    params = {"tweet_id": tweet_id}
    if cursor:
        params["cursor"] = cursor
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_latest_comments(tweet_id, cursor=None):
    """获取最新的推文评论"""
    tweet_id = extract_tweet_id(tweet_id)
    endpoint = f"{API_BASE}/api/v1/twitter/web/fetch_latest_tweet_comments"
    params = {"tweet_id": tweet_id}
    if cursor:
        params["cursor"] = cursor
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_retweet_users(tweet_id, cursor=None):
    """获取转推用户列表"""
    tweet_id = extract_tweet_id(tweet_id)
    endpoint = f"{API_BASE}/api/v1/twitter/web/fetch_retweet_users"
    params = {"tweet_id": tweet_id}
    if cursor:
        params["cursor"] = cursor
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


# ==================== User Data ====================

def get_user_profile(screen_name=None, rest_id=None):
    """获取用户资料"""
    endpoint = f"{API_BASE}/api/v1/twitter/web/fetch_user_profile"
    params = {}
    
    if rest_id:
        params["rest_id"] = rest_id
    elif screen_name:
        params["screen_name"] = extract_screen_name(screen_name)
    else:
        return {"error": "Must provide either screen_name or rest_id"}
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_user_posts(screen_name=None, rest_id=None, cursor=None):
    """获取用户发帖"""
    endpoint = f"{API_BASE}/api/v1/twitter/web/fetch_user_post_tweet"
    params = {}
    
    if rest_id:
        params["rest_id"] = rest_id
    elif screen_name:
        params["screen_name"] = extract_screen_name(screen_name)
    else:
        return {"error": "Must provide either screen_name or rest_id"}
    
    if cursor:
        params["cursor"] = cursor
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_user_replies(screen_name=None, rest_id=None, cursor=None):
    """获取用户推文回复"""
    endpoint = f"{API_BASE}/api/v1/twitter/web/fetch_user_tweet_replies"
    params = {}
    
    if rest_id:
        params["rest_id"] = rest_id
    elif screen_name:
        params["screen_name"] = extract_screen_name(screen_name)
    else:
        return {"error": "Must provide either screen_name or rest_id"}
    
    if cursor:
        params["cursor"] = cursor
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_user_highlights(screen_name=None, rest_id=None, cursor=None):
    """获取用户高光推文（已弃用）"""
    endpoint = f"{API_BASE}/api/v1/twitter/web/fetch_user_highlights_tweets"
    params = {}
    
    if rest_id:
        params["rest_id"] = rest_id
    elif screen_name:
        params["screen_name"] = extract_screen_name(screen_name)
    else:
        return {"error": "Must provide either screen_name or rest_id"}
    
    if cursor:
        params["cursor"] = cursor
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_user_media(screen_name=None, rest_id=None, cursor=None):
    """获取用户媒体"""
    endpoint = f"{API_BASE}/api/v1/twitter/web/fetch_user_media"
    params = {}
    
    if rest_id:
        params["rest_id"] = rest_id
    elif screen_name:
        params["screen_name"] = extract_screen_name(screen_name)
    else:
        return {"error": "Must provide either screen_name or rest_id"}
    
    if cursor:
        params["cursor"] = cursor
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_user_followings(screen_name, cursor=None):
    """获取用户关注"""
    endpoint = f"{API_BASE}/api/v1/twitter/web/fetch_user_followings"
    params = {"screen_name": extract_screen_name(screen_name)}
    if cursor:
        params["cursor"] = cursor
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_user_followers(screen_name, cursor=None):
    """获取用户粉丝"""
    endpoint = f"{API_BASE}/api/v1/twitter/web/fetch_user_followers"
    params = {"screen_name": extract_screen_name(screen_name)}
    if cursor:
        params["cursor"] = cursor
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


# ==================== Search ====================

def search(query, cursor=None):
    """搜索推文"""
    endpoint = f"{API_BASE}/api/v1/twitter/web/fetch_search"
    params = {"query": query}
    if cursor:
        params["cursor"] = cursor
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


# ==================== Trending ====================

def get_trending(country="UnitedStates"):
    """获取趋势"""
    endpoint = f"{API_BASE}/api/v1/twitter/web/fetch_trending"
    params = {"country": country}
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


# ==================== Format Output ====================

def format_tweet_info(data):
    """格式化推文信息输出"""
    if not data or 'data' not in data:
        return "无法获取推文信息"
    
    try:
        tweet = data['data']
        
        info = {
            "推文ID": tweet.get('id') or tweet.get('tweet_id'),
            "内容": tweet.get('text') or tweet.get('content'),
            "作者": tweet.get('user', {}).get('name') if tweet.get('user') else None,
            "用户名": tweet.get('user', {}).get('screen_name') if tweet.get('user') else None,
            "发布时间": tweet.get('created_at'),
            "转发数": tweet.get('retweet_count'),
            "引用数": tweet.get('quote_count'),
            "回复数": tweet.get('reply_count'),
            "点赞数": tweet.get('favorite_count') or tweet.get('like_count'),
            "媒体": "有" if tweet.get('media') else "无",
        }
        
        # 清理 None 值
        info = {k: v for k, v in info.items() if v is not None}
        
        return json.dumps(info, indent=2, ensure_ascii=False)
    except Exception as e:
        return f"格式化失败: {e}"


def format_user_info(data):
    """格式化用户信息输出"""
    if not data or 'data' not in data:
        return "无法获取用户信息"
    
    try:
        user = data['data']
        
        info = {
            "用户ID": user.get('id') or user.get('rest_id'),
            "名称": user.get('name'),
            "用户名": user.get('screen_name'),
            "简介": user.get('description'),
            "关注数": user.get('friends_count') or user.get('following_count'),
            "粉丝数": user.get('followers_count'),
            "推文数": user.get('statuses_count'),
            "头像": user.get('profile_image_url'),
            "认证": user.get('verified'),
        }
        
        # 清理 None 值
        info = {k: v for k, v in info.items() if v is not None}
        
        return json.dumps(info, indent=2, ensure_ascii=False)
    except Exception as e:
        return f"格式化失败: {e}"


# ==================== Main ====================

def main():
    if len(sys.argv) < 2:
        print("Usage: python twitter_api.py <command> [args...]")
        print("\nTweet Commands:")
        print("  tweet <tweet_id/url>                   - 获取推文详情")
        print("  comments <tweet_id/url> [cursor]       - 获取推文评论")
        print("  latest_comments <tweet_id/url> [cursor] - 获取最新评论")
        print("  retweet_users <tweet_id/url> [cursor]  - 获取转推用户")
        print("\nUser Commands:")
        print("  user <screen_name>                     - 获取用户资料")
        print("  posts <screen_name> [cursor]           - 获取用户发帖")
        print("  replies <screen_name> [cursor]         - 获取用户回复")
        print("  media <screen_name> [cursor]           - 获取用户媒体")
        print("  followings <screen_name> [cursor]      - 获取用户关注")
        print("  followers <screen_name> [cursor]       - 获取用户粉丝")
        print("\nSearch Commands:")
        print("  search <query> [cursor]                - 搜索推文")
        print("\nTrending Commands:")
        print("  trending [country]                     - 获取趋势 (默认: UnitedStates)")
        print("\nExamples:")
        print('  python twitter_api.py tweet "1808168603721650364"')
        print('  python twitter_api.py user elonmusk')
        print('  python twitter_api.py search "Python"')
        sys.exit(1)
    
    command = sys.argv[1]
    
    # Tweet commands
    if command == "tweet":
        if len(sys.argv) < 3:
            print("Error: Missing tweet_id")
            sys.exit(1)
        result = get_tweet_detail(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "comments":
        if len(sys.argv) < 3:
            print("Error: Missing tweet_id")
            sys.exit(1)
        cursor = sys.argv[3] if len(sys.argv) > 3 else None
        result = get_comments(sys.argv[2], cursor)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "latest_comments":
        if len(sys.argv) < 3:
            print("Error: Missing tweet_id")
            sys.exit(1)
        cursor = sys.argv[3] if len(sys.argv) > 3 else None
        result = get_latest_comments(sys.argv[2], cursor)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "retweet_users":
        if len(sys.argv) < 3:
            print("Error: Missing tweet_id")
            sys.exit(1)
        cursor = sys.argv[3] if len(sys.argv) > 3 else None
        result = get_retweet_users(sys.argv[2], cursor)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    # User commands
    elif command == "user":
        if len(sys.argv) < 3:
            print("Error: Missing screen_name")
            sys.exit(1)
        result = get_user_profile(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "posts":
        if len(sys.argv) < 3:
            print("Error: Missing screen_name")
            sys.exit(1)
        cursor = sys.argv[3] if len(sys.argv) > 3 else None
        result = get_user_posts(sys.argv[2], cursor=cursor)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "replies":
        if len(sys.argv) < 3:
            print("Error: Missing screen_name")
            sys.exit(1)
        cursor = sys.argv[3] if len(sys.argv) > 3 else None
        result = get_user_replies(sys.argv[2], cursor=cursor)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "media":
        if len(sys.argv) < 3:
            print("Error: Missing screen_name")
            sys.exit(1)
        cursor = sys.argv[3] if len(sys.argv) > 3 else None
        result = get_user_media(sys.argv[2], cursor=cursor)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "followings":
        if len(sys.argv) < 3:
            print("Error: Missing screen_name")
            sys.exit(1)
        cursor = sys.argv[3] if len(sys.argv) > 3 else None
        result = get_user_followings(sys.argv[2], cursor)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "followers":
        if len(sys.argv) < 3:
            print("Error: Missing screen_name")
            sys.exit(1)
        cursor = sys.argv[3] if len(sys.argv) > 3 else None
        result = get_user_followers(sys.argv[2], cursor)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    # Search commands
    elif command == "search":
        if len(sys.argv) < 3:
            print("Error: Missing query")
            sys.exit(1)
        cursor = sys.argv[3] if len(sys.argv) > 3 else None
        result = search(sys.argv[2], cursor)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    # Trending commands
    elif command == "trending":
        country = sys.argv[2] if len(sys.argv) > 2 else "UnitedStates"
        result = get_trending(country)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
