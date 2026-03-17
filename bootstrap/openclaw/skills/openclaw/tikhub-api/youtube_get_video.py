#!/usr/bin/env python3
"""
获取 YouTube 视频信息
用法: youtube_get_video.py <视频URL>
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tikhub_common import TikHubAPI, print_json

def main():
    if len(sys.argv) < 2:
        print("用法: youtube_get_video.py <视频URL>")
        print("示例: youtube_get_video.py https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        sys.exit(1)
    
    video_url = sys.argv[1]
    
    print(f"正在获取 YouTube 视频信息: {video_url}")
    print("-" * 50)
    
    api = TikHubAPI()
    result = api.youtube_get_video(video_url)
    
    print_json(result)

if __name__ == "__main__":
    main()
