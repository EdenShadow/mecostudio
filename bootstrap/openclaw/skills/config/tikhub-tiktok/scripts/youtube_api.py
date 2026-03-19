#!/usr/bin/env python3
"""
TikHub YouTube API 查询工具
API Key: 66ZnSGB9wUAYmCAs20fhqEot4DQx1sSGu5l0wTrbjUpz+g5YYNhp+yWWUw==
"""

import sys
import json
import requests
from urllib.parse import quote

API_BASE = "https://api.tikhub.io"
API_TOKEN = ""

headers = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json"
}


def extract_video_id(url_or_id):
    """从 YouTube URL 中提取视频 ID"""
    if len(url_or_id) == 11 and '/' not in url_or_id:
        return url_or_id
    
    # 处理各种 YouTube URL 格式
    import re
    patterns = [
        r'(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|youtube\.com/v/|youtube\.com/shorts/)([a-zA-Z0-9_-]{11})',
        r'^([a-zA-Z0-9_-]{11})$'
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url_or_id)
        if match:
            return match.group(1)
    
    return url_or_id


# ==================== Video Data ====================

def get_video_info(video_id, url_access="normal", videos="auto", audios="auto", subtitles=True, related=False):
    """获取视频信息 V1"""
    video_id = extract_video_id(video_id)
    endpoint = f"{API_BASE}/api/v1/youtube/web/get_video_info"
    params = {
        "video_id": video_id,
        "url_access": url_access,
        "videos": videos,
        "audios": audios,
        "subtitles": subtitles,
        "related": related
    }
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_video_info_v2(video_id, url_access="normal", videos="auto", audios="auto", subtitles=True):
    """获取视频信息 V2 (低成本)"""
    video_id = extract_video_id(video_id)
    endpoint = f"{API_BASE}/api/v1/youtube/web/get_video_info_v2"
    params = {
        "video_id": video_id,
        "url_access": url_access,
        "videos": videos,
        "audios": audios,
        "subtitles": subtitles
    }
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_video_info_v3(video_id, url_access="normal", videos="auto", audios="auto", subtitles=True):
    """获取视频信息 V3"""
    video_id = extract_video_id(video_id)
    endpoint = f"{API_BASE}/api/v1/youtube/web/get_video_info_v3"
    params = {
        "video_id": video_id,
        "url_access": url_access,
        "videos": videos,
        "audios": audios,
        "subtitles": subtitles
    }
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_video_subtitles(video_id, lang="en"):
    """获取视频字幕"""
    video_id = extract_video_id(video_id)
    endpoint = f"{API_BASE}/api/v1/youtube/web/get_video_subtitles"
    params = {
        "video_id": video_id,
        "lang": lang
    }
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_video_comments(video_id, continuation_token=None):
    """获取视频评论"""
    video_id = extract_video_id(video_id)
    endpoint = f"{API_BASE}/api/v1/youtube/web/get_video_comments"
    params = {"video_id": video_id}
    if continuation_token:
        params["continuation_token"] = continuation_token
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_video_sub_comments(video_id, comment_id):
    """获取视频二级评论（回复）"""
    video_id = extract_video_id(video_id)
    endpoint = f"{API_BASE}/api/v1/youtube/web/get_video_sub_comments"
    params = {
        "video_id": video_id,
        "comment_id": comment_id
    }
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_related_videos(video_id):
    """获取推荐视频"""
    video_id = extract_video_id(video_id)
    endpoint = f"{API_BASE}/api/v1/youtube/web/get_related_videos"
    params = {"video_id": video_id}
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


# ==================== Channel Data ====================

def get_channel_id(channel_url):
    """从频道 URL 获取频道 ID (V2)"""
    endpoint = f"{API_BASE}/api/v1/youtube/web/get_channel_id_from_url_v2"
    params = {"channel_url": channel_url}
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_channel_info(channel_id):
    """获取频道信息"""
    endpoint = f"{API_BASE}/api/v1/youtube/web/get_channel_info"
    params = {"channel_id": channel_id}
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_channel_description(channel_id):
    """获取频道描述信息"""
    endpoint = f"{API_BASE}/api/v1/youtube/web/get_channel_description"
    params = {"channel_id": channel_id}
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_channel_videos(channel_id, sort_by="newest", content_type="videos", next_token=None):
    """获取频道视频 V2"""
    endpoint = f"{API_BASE}/api/v1/youtube/web/get_channel_videos_v2"
    params = {
        "channel_id": channel_id,
        "sortBy": sort_by,
        "contentType": content_type
    }
    if next_token:
        params["nextToken"] = next_token
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def get_channel_shorts(channel_id, next_token=None):
    """获取频道短视频"""
    return get_channel_videos(channel_id, content_type="shorts", next_token=next_token)


# ==================== Search ====================

def search_video(search_query, order_by="this_month", language_code="en", country_code="us", continuation_token=None):
    """搜索视频"""
    endpoint = f"{API_BASE}/api/v1/youtube/web/search_video"
    params = {
        "search_query": search_query,
        "order_by": order_by,
        "language_code": language_code,
        "country_code": country_code
    }
    if continuation_token:
        params["continuation_token"] = continuation_token
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def search_with_filter(search_query, filter_type="video", continuation_token=None):
    """综合搜索（支持过滤条件）"""
    endpoint = f"{API_BASE}/api/v1/youtube/web/general_search"
    params = {
        "search_query": search_query,
        "filter": filter_type
    }
    if continuation_token:
        params["continuation_token"] = continuation_token
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def search_shorts(search_query, continuation_token=None):
    """搜索 YouTube Shorts"""
    endpoint = f"{API_BASE}/api/v1/youtube/web/get_shorts_search"
    params = {"search_query": search_query}
    if continuation_token:
        params["continuation_token"] = continuation_token
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


def search_channel(channel_id, continuation_token=None):
    """搜索频道"""
    endpoint = f"{API_BASE}/api/v1/youtube/web/search_channel"
    params = {"channel_id": channel_id}
    if continuation_token:
        params["continuation_token"] = continuation_token
    
    try:
        response = requests.get(endpoint, headers=headers, params=params, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


# ==================== Trending ====================

def get_trending_videos():
    """获取趋势视频"""
    endpoint = f"{API_BASE}/api/v1/youtube/web/get_trending_videos"
    
    try:
        response = requests.get(endpoint, headers=headers, timeout=30)
        return response.json()
    except Exception as e:
        return {"error": str(e)}


# ==================== Format Output ====================

def format_video_info(data):
    """格式化视频信息输出"""
    if not data or 'data' not in data:
        return "无法获取视频信息"
    
    try:
        video = data['data']
        
        info = {
            "视频ID": video.get('video_id') or video.get('id'),
            "标题": video.get('title'),
            "描述": video.get('description', '')[:200] + "..." if video.get('description') and len(video.get('description')) > 200 else video.get('description'),
            "频道": video.get('uploader') or video.get('channel'),
            "频道ID": video.get('uploader_id') or video.get('channel_id'),
            "观看数": video.get('view_count'),
            "点赞数": video.get('like_count'),
            "评论数": video.get('comment_count'),
            "时长": f"{video.get('duration', 0)}秒" if video.get('duration') else None,
            "上传日期": video.get('upload_date'),
            "缩略图": video.get('thumbnail'),
        }
        
        # 清理 None 值
        info = {k: v for k, v in info.items() if v is not None}
        
        return json.dumps(info, indent=2, ensure_ascii=False)
    except Exception as e:
        return f"格式化失败: {e}"


def format_channel_info(data):
    """格式化频道信息输出"""
    if not data or 'data' not in data:
        return "无法获取频道信息"
    
    try:
        channel = data['data']
        
        info = {
            "频道ID": channel.get('channel_id'),
            "频道名称": channel.get('channel_name') or channel.get('title'),
            "描述": channel.get('description', '')[:200] + "..." if channel.get('description') and len(channel.get('description')) > 200 else channel.get('description'),
            "订阅数": channel.get('subscriber_count'),
            "视频数": channel.get('video_count'),
            "总观看数": channel.get('view_count'),
            "头像": channel.get('avatar'),
        }
        
        # 清理 None 值
        info = {k: v for k, v in info.items() if v is not None}
        
        return json.dumps(info, indent=2, ensure_ascii=False)
    except Exception as e:
        return f"格式化失败: {e}"


def format_search_results(data):
    """格式化搜索结果输出"""
    if not data or 'data' not in data:
        return "无法获取搜索结果"
    
    try:
        results = data['data']
        if isinstance(results, dict):
            videos = results.get('videos', []) or results.get('results', [])
        else:
            videos = results if isinstance(results, list) else []
        
        formatted = []
        for i, video in enumerate(videos[:10], 1):  # 只显示前10个
            info = {
                "序号": i,
                "标题": video.get('title'),
                "频道": video.get('uploader') or video.get('channel'),
                "观看数": video.get('view_count'),
                "视频ID": video.get('video_id') or video.get('id')
            }
            formatted.append({k: v for k, v in info.items() if v is not None})
        
        return json.dumps(formatted, indent=2, ensure_ascii=False)
    except Exception as e:
        return f"格式化失败: {e}"


# ==================== Main ====================

def main():
    if len(sys.argv) < 2:
        print("Usage: python youtube_api.py <command> [args...]")
        print("\nVideo Commands:")
        print("  video_info <video_id/url>              - 获取视频信息 V1")
        print("  video_info_v2 <video_id/url>           - 获取视频信息 V2 (低成本)")
        print("  video_info_v3 <video_id/url>           - 获取视频信息 V3")
        print("  video_subtitles <video_id> [lang]      - 获取视频字幕")
        print("  video_comments <video_id>              - 获取视频评论")
        print("  video_sub_comments <video_id> <comment_id> - 获取评论回复")
        print("  related_videos <video_id>              - 获取推荐视频")
        print("\nChannel Commands:")
        print("  channel_id <channel_url>               - 从URL获取频道ID")
        print("  channel_info <channel_id>              - 获取频道信息")
        print("  channel_description <channel_id>       - 获取频道描述")
        print("  channel_videos <channel_id>            - 获取频道视频")
        print("  channel_shorts <channel_id>            - 获取频道短视频")
        print("\nSearch Commands:")
        print("  search_video <query>                   - 搜索视频")
        print("  search_filter <query> <filter_type>    - 综合搜索 (video/channel/playlist)")
        print("  search_shorts <query>                  - 搜索 Shorts")
        print("  search_channel <query>                 - 搜索频道")
        print("\nTrending Commands:")
        print("  trending                               - 获取趋势视频")
        print("\nExamples:")
        print('  python youtube_api.py video_info "LuIL5JATZsc"')
        print('  python youtube_api.py channel_videos "UCXuqSBlHAE6Xw-yeJA0Tunw"')
        print('  python youtube_api.py search_video "Python Tutorial"')
        sys.exit(1)
    
    command = sys.argv[1]
    
    # Video commands
    if command == "video_info":
        if len(sys.argv) < 3:
            print("Error: Missing video_id")
            sys.exit(1)
        result = get_video_info(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "video_info_v2":
        if len(sys.argv) < 3:
            print("Error: Missing video_id")
            sys.exit(1)
        result = get_video_info_v2(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "video_info_v3":
        if len(sys.argv) < 3:
            print("Error: Missing video_id")
            sys.exit(1)
        result = get_video_info_v3(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "video_subtitles":
        if len(sys.argv) < 3:
            print("Error: Missing video_id")
            sys.exit(1)
        lang = sys.argv[3] if len(sys.argv) > 3 else "en"
        result = get_video_subtitles(sys.argv[2], lang)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "video_comments":
        if len(sys.argv) < 3:
            print("Error: Missing video_id")
            sys.exit(1)
        result = get_video_comments(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "video_sub_comments":
        if len(sys.argv) < 4:
            print("Error: Missing video_id or comment_id")
            sys.exit(1)
        result = get_video_sub_comments(sys.argv[2], sys.argv[3])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "related_videos":
        if len(sys.argv) < 3:
            print("Error: Missing video_id")
            sys.exit(1)
        result = get_related_videos(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    # Channel commands
    elif command == "channel_id":
        if len(sys.argv) < 3:
            print("Error: Missing channel_url")
            sys.exit(1)
        result = get_channel_id(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "channel_info":
        if len(sys.argv) < 3:
            print("Error: Missing channel_id")
            sys.exit(1)
        result = get_channel_info(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "channel_description":
        if len(sys.argv) < 3:
            print("Error: Missing channel_id")
            sys.exit(1)
        result = get_channel_description(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "channel_videos":
        if len(sys.argv) < 3:
            print("Error: Missing channel_id")
            sys.exit(1)
        result = get_channel_videos(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "channel_shorts":
        if len(sys.argv) < 3:
            print("Error: Missing channel_id")
            sys.exit(1)
        result = get_channel_shorts(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    # Search commands
    elif command == "search_video":
        if len(sys.argv) < 3:
            print("Error: Missing search_query")
            sys.exit(1)
        result = search_video(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "search_filter":
        if len(sys.argv) < 4:
            print("Error: Missing search_query or filter_type")
            sys.exit(1)
        result = search_with_filter(sys.argv[2], sys.argv[3])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "search_shorts":
        if len(sys.argv) < 3:
            print("Error: Missing search_query")
            sys.exit(1)
        result = search_shorts(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    elif command == "search_channel":
        if len(sys.argv) < 3:
            print("Error: Missing search_query")
            sys.exit(1)
        result = search_channel(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    # Trending commands
    elif command == "trending":
        result = get_trending_videos()
        print(json.dumps(result, indent=2, ensure_ascii=False))
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
