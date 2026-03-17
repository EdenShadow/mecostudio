#!/usr/bin/env python3
"""
TikHub TikTok API 使用示例
"""

import json
import tiktok_api as api

def example_1_video_by_url():
    """示例1: 通过分享链接获取视频信息"""
    print("=" * 50)
    print("示例1: 获取视频信息")
    print("=" * 50)
    
    # 分享链接
    share_url = "https://www.tiktok.com/t/ZTFNEj8Hk/"
    
    print(f"\n分享链接: {share_url}")
    print("正在查询...\n")
    
    result = api.fetch_video_by_share_url(share_url)
    
    if result.get('code') == 200:
        video = result['data']['aweme_details'][0]
        stats = video['statistics']
        
        print(f"✅ 查询成功!")
        print(f"🎵 音乐: {video.get('music', {}).get('title', 'N/A')}")
        print(f"👤 作者: {video['author']['nickname']}")
        print(f"❤️  点赞: {stats['digg_count']}")
        print(f"💬 评论: {stats['comment_count']}")
        print(f"🔄 分享: {stats['share_count']}")
        print(f"👁️  播放: {stats['play_count']}")
        
        # 获取无水印视频链接
        video_urls = video.get('video', {}).get('play_addr', {}).get('url_list', [])
        if video_urls:
            print(f"\n📹 视频链接: {video_urls[0][:80]}...")
    else:
        print(f"❌ 查询失败: {result.get('message')}")

def example_2_user_info():
    """示例2: 获取用户信息"""
    print("\n" + "=" * 50)
    print("示例2: 获取用户信息")
    print("=" * 50)
    
    # 从上一个示例中获取的用户ID
    sec_user_id = "MS4wLjABAAAAVViN2YQW8z_yf8fF4qfLmQF9gR5h3x5x3x5x3x5x3x5"
    
    print(f"\n用户ID: {sec_user_id}")
    print("正在查询...\n")
    
    result = api.fetch_user_info(sec_user_id)
    
    if result.get('code') == 200:
        user = result.get('data', {}).get('user', {})
        
        print(f"✅ 查询成功!")
        print(f"👤 昵称: {user.get('nickname')}")
        print(f"📝 简介: {user.get('signature', 'N/A')[:50]}...")
        print(f"👥 粉丝: {user.get('follower_count')}")
        print(f"➡️  关注: {user.get('following_count')}")
        print(f"❤️  获赞: {user.get('total_favorited')}")
    else:
        print(f"❌ 查询失败: {result.get('message')}")

def example_3_batch_analysis():
    """示例3: 批量分析多个视频"""
    print("\n" + "=" * 50)
    print("示例3: 批量视频分析")
    print("=" * 50)
    
    # 多个分享链接
    urls = [
        "https://www.tiktok.com/t/ZTFNEj8Hk/",
        "https://www.tiktok.com/t/ZTxxxxxxxx/",
    ]
    
    results = []
    for url in urls:
        print(f"\n查询: {url}")
        result = api.fetch_video_by_share_url(url)
        
        if result.get('code') == 200:
            video = result['data']['aweme_details'][0]
            stats = video['statistics']
            
            results.append({
                'url': url,
                'title': video.get('desc', 'N/A')[:30],
                'likes': stats.get('digg_count', 0),
                'shares': stats.get('share_count', 0),
                'views': stats.get('play_count', 0)
            })
    
    # 输出汇总
    print("\n📊 批量分析结果:")
    print("-" * 70)
    for r in results:
        print(f"标题: {r['title']}")
        print(f"点赞: {r['likes']:,} | 分享: {r['shares']:,} | 播放: {r['views']:,}")
        print("-" * 70)

if __name__ == "__main__":
    print("TikHub TikTok API 使用示例")
    print()
    
    # 运行示例
    example_1_video_by_url()
    # example_2_user_info()  # 需要提供有效的用户ID
    # example_3_batch_analysis()  # 需要提供有效的分享链接
    
    print("\n" + "=" * 50)
    print("提示: 修改示例代码中的参数以查询不同的视频/用户")
    print("=" * 50)
