#!/usr/bin/env python3
"""
获取 Twitter/X 推文信息
用法: twitter_get_tweet.py <推文URL或ID>
"""

import sys
import os
import re

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tikhub_common import TikHubAPI, print_json

def main():
    if len(sys.argv) < 2:
        print("用法: twitter_get_tweet.py <推文URL或ID>")
        print("示例: twitter_get_tweet.py https://x.com/username/status/1234567890")
        print("示例: twitter_get_tweet.py 1234567890")
        sys.exit(1)
    
    param = sys.argv[1]
    
    # 提取 tweet_id
    tweet_id = param
    match = re.search(r'status/(\d+)', param)
    if match:
        tweet_id = match.group(1)
    
    print(f"获取 Twitter 推文: {tweet_id}")
    print("-" * 50)
    
    api = TikHubAPI()
    result = api.twitter_get_tweet_detail(tweet_id)
    
    print_json(result)

if __name__ == "__main__":
    main()
