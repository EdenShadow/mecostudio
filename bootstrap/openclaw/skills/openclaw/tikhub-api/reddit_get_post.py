#!/usr/bin/env python3
"""
获取 Reddit 帖子信息
用法: reddit_get_post.py <帖子URL>
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tikhub_common import TikHubAPI, print_json

def main():
    if len(sys.argv) < 2:
        print("用法: reddit_get_post.py <帖子URL>")
        print("示例: reddit_get_post.py https://www.reddit.com/r/subreddit/comments/abc123/post_title/")
        sys.exit(1)
    
    post_url = sys.argv[1]
    
    print(f"正在获取 Reddit 帖子信息: {post_url}")
    print("-" * 50)
    
    api = TikHubAPI()
    result = api.reddit_get_post(post_url)
    
    print_json(result)

if __name__ == "__main__":
    main()
