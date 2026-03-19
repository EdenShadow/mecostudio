#!/usr/bin/env python3
"""
TikHub TikTok API 查询工具
API Key: 从环境变量 TIKHUB_API_KEY 读取
"""

import sys
import json
import os
import requests
from urllib.parse import quote

API_BASE = "https://api.tikhub.io"
API_TOKEN = os.environ.get("TIKHUB_API_KEY", "").strip()
if not API_TOKEN:
    print(json.dumps({"error": "missing TIKHUB_API_KEY"}, ensure_ascii=False))
    sys.exit(1)

headers = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json"
}

def fetch_video_by_share_url(share_url):
    """根据分享链接获取视频数据 (V2 - 推荐，返回 region 字段)"""
    endpoint = f"{API_BASE}/api/v1/tiktok/app/v3/fetch_one_video_by_share_url_v2"
    params = {"share_url": share_url}
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}

def fetch_video_by_share_url_v1(share_url):
    """根据分享链接获取视频数据 V1"""
    endpoint = f"{API_BASE}/api/v1/tiktok/app/v3/fetch_one_video_by_share_url"
    params = {"share_url": share_url}
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}

def fetch_video_by_id(video_id):
    """根据视频 ID 获取视频数据"""
    endpoint = f"{API_BASE}/api/v1/tiktok/app/v3/fetch_one_video"
    params = {"video_id": video_id}
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}

def fetch_user_info(sec_user_id):
    """获取指定用户信息"""
    endpoint = f"{API_BASE}/api/v1/tiktok/app/v3/fetch_user_info"
    params = {"sec_user_id": sec_user_id}
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}

def fetch_user_posts(sec_user_id, max_cursor=0, count=10):
    """获取用户主页作品"""
    endpoint = f"{API_BASE}/api/v1/tiktok/app/v3/fetch_user_post_videos"
    params = {
        "sec_user_id": sec_user_id,
        "max_cursor": max_cursor,
        "count": count
    }
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}

def fetch_comments(video_id, cursor=0, count=20):
    """获取视频评论"""
    endpoint = f"{API_BASE}/api/v1/tiktok/app/v3/fetch_video_comments"
    params = {
        "video_id": video_id,
        "cursor": cursor,
        "count": count
    }
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}

def fetch_live_info(room_id):
    """获取直播间信息"""
    endpoint = f"{API_BASE}/api/v1/tiktok/app/v3/fetch_live_room_info"
    params = {"room_id": room_id}
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}

def check_live_status(room_ids):
    """检查直播间是否在线 (批量)"""
    endpoint = f"{API_BASE}/api/v1/tiktok/app/v3/batch_check_live_status"
    
    if isinstance(room_ids, list):
        room_ids = ",".join(room_ids)
    
    params = {"room_ids": room_ids}
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}

# ==================== Search Functions ====================

def search_general(keyword, count=20, sort_type=0, publish_time=0, offset=0):
    """综合搜索 (视频+用户+话题)"""
    endpoint = f"{API_BASE}/api/v1/tiktok/app/v3/fetch_general_search_result"
    params = {
        "keyword": keyword,
        "count": count,
        "sort_type": sort_type,
        "publish_time": publish_time,
        "offset": offset
    }
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}

def search_videos(keyword, count=20, sort_type=0, publish_time=0, region="US", offset=0):
    """搜索视频"""
    endpoint = f"{API_BASE}/api/v1/tiktok/app/v3/fetch_video_search_result"
    params = {
        "keyword": keyword,
        "count": count,
        "sort_type": sort_type,
        "publish_time": publish_time,
        "region": region,
        "offset": offset
    }
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}

def search_users(keyword, count=20, follower_filter="", offset=0):
    """搜索用户"""
    endpoint = f"{API_BASE}/api/v1/tiktok/app/v3/fetch_user_search_result"
    params = {
        "keyword": keyword,
        "count": count,
        "offset": offset
    }
    
    if follower_filter:
        params["user_search_follower_count"] = follower_filter
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}

def search_hashtags(keyword, count=20, offset=0):
    """搜索话题/Hashtag"""
    endpoint = f"{API_BASE}/api/v1/tiktok/app/v3/fetch_hashtag_search_result"
    params = {
        "keyword": keyword,
        "count": count,
        "offset": offset
    }
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}

def format_video_info(data):
    """格式化视频信息输出"""
    if not data or 'data' not in data:
        return "无法获取视频信息"
    
    try:
        details = data['data'].get('aweme_details', [{}])[0]
        
        info = {
            "视频ID": details.get('aweme_id'),
            "标题": details.get('desc'),
            "作者": details.get('author', {}).get('nickname'),
            "作者ID": details.get('author', {}).get('sec_user_id'),
            "点赞数": details.get('statistics', {}).get('digg_count'),
            "分享数": details.get('statistics', {}).get('share_count'),
            "评论数": details.get('statistics', {}).get('comment_count'),
            "播放数": details.get('statistics', {}).get('play_count'),
            "时长": f"{details.get('video', {}).get('duration', 0)}秒",
            "创建时间": details.get('create_time')
        }
        return json.dumps(info, indent=2, ensure_ascii=False)
    except Exception as e:
        return f"格式化失败: {e}"

def main():
    if len(sys.argv) < 2:
        print("Usage: python tiktok_api.py <command> [args...]")
        print("\nVideo Commands:")
        print("  video_by_url <share_url>          - 通过分享链接获取视频 (V2)")
        print("  video_by_url_v1 <share_url>       - 通过分享链接获取视频 (V1)")
        print("  video_by_id <video_id>            - 通过视频ID获取视频")
        print("\nUser Commands:")
        print("  user_info <sec_user_id>           - 获取用户信息")
        print("  user_posts <sec_user_id>          - 获取用户作品")
        print("\nComment Commands:")
        print("  comments <video_id>               - 获取视频评论")
        print("\nLive Stream Commands:")
        print("  live_info <room_id>               - 获取直播间信息")
        print("  live_status <room_id1,room_id2>   - 检查直播间状态")
        print("\nSearch Commands:")
        print("  search <keyword> [count] [sort_type] [publish_time]")
        print("                                    - 综合搜索")
        print("  search_videos <keyword> [count] [region]")
        print("                                    - 搜索视频")
        print("  search_users <keyword> [count] [follower_filter]")
        print("                                    - 搜索用户")
        print("  search_hashtags <keyword> [count]")
        print("                                    - 搜索话题")
        print("\nSearch Parameters:")
        print("  sort_type: 0=Relevance(default), 1=Most likes")
        print("  publish_time: 0=All, 1=Day, 7=Week, 30=Month, 90=3Months, 180=6Months")
        print("  follower_filter: '', ZERO_TO_ONE_K, ONE_K_TO_TEN_K, TEN_K_TO_ONE_H_K, ONE_H_K_PLUS")
        print("\nExamples:")
        print('  python tiktok_api.py video_by_url "https://www.tiktok.com/t/ZTFNEj8Hk/"')
        print('  python tiktok_api.py search "bodycam" 30 1 7')
        print('  python tiktok_api.py search_videos "python tutorial" 20 US')
        print('  python tiktok_api.py search_users "tech" 20 TEN_K_TO_ONE_H_K')
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "video_by_url":
        if len(sys.argv) < 3:
            print("Error: Missing share_url")
            sys.exit(1)
        result = fetch_video_by_share_url(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "video_by_url_v1":
        if len(sys.argv) < 3:
            print("Error: Missing share_url")
            sys.exit(1)
        result = fetch_video_by_share_url_v1(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "video_by_id":
        if len(sys.argv) < 3:
            print("Error: Missing video_id")
            sys.exit(1)
        result = fetch_video_by_id(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "user_info":
        if len(sys.argv) < 3:
            print("Error: Missing sec_user_id")
            sys.exit(1)
        result = fetch_user_info(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "user_posts":
        if len(sys.argv) < 3:
            print("Error: Missing sec_user_id")
            sys.exit(1)
        sec_user_id = sys.argv[2]
        max_cursor = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        result = fetch_user_posts(sec_user_id, max_cursor)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "comments":
        if len(sys.argv) < 3:
            print("Error: Missing video_id")
            sys.exit(1)
        result = fetch_comments(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "live_info":
        if len(sys.argv) < 3:
            print("Error: Missing room_id")
            sys.exit(1)
        result = fetch_live_info(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "live_status":
        if len(sys.argv) < 3:
            print("Error: Missing room_ids")
            sys.exit(1)
        result = check_live_status(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    # Search commands
    elif command == "search":
        if len(sys.argv) < 3:
            print("Error: Missing keyword")
            sys.exit(1)
        keyword = sys.argv[2]
        count = int(sys.argv[3]) if len(sys.argv) > 3 else 20
        sort_type = int(sys.argv[4]) if len(sys.argv) > 4 else 0
        publish_time = int(sys.argv[5]) if len(sys.argv) > 5 else 0
        result = search_general(keyword, count, sort_type, publish_time)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "search_videos":
        if len(sys.argv) < 3:
            print("Error: Missing keyword")
            sys.exit(1)
        keyword = sys.argv[2]
        count = int(sys.argv[3]) if len(sys.argv) > 3 else 20
        sort_type = int(sys.argv[4]) if len(sys.argv) > 4 else 0
        publish_time = int(sys.argv[5]) if len(sys.argv) > 5 else 0
        region = sys.argv[6] if len(sys.argv) > 6 else "US"
        result = search_videos(keyword, count, sort_type, publish_time, region)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "search_users":
        if len(sys.argv) < 3:
            print("Error: Missing keyword")
            sys.exit(1)
        keyword = sys.argv[2]
        count = int(sys.argv[3]) if len(sys.argv) > 3 else 20
        follower_filter = sys.argv[4] if len(sys.argv) > 4 else ""
        result = search_users(keyword, count, follower_filter)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "search_hashtags":
        if len(sys.argv) < 3:
            print("Error: Missing keyword")
            sys.exit(1)
        keyword = sys.argv[2]
        count = int(sys.argv[3]) if len(sys.argv) > 3 else 20
        result = search_hashtags(keyword, count)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)

if __name__ == "__main__":
    main()
