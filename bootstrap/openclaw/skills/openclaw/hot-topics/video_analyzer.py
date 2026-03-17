#!/usr/bin/env python3
"""视频推文深度分析器
- 下载视频
- 提取视频帧 (1x1 封面 + 多帧分析)
- 使用 kimi cli 分析视频内容
- 生成完整描述
"""

import sys
import os
import subprocess
import json
import shutil
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/tikhub-api'))
from tikhub_common import TikHubAPI

HOT_TOPICS = os.path.expanduser('~/Documents/知识库/热门话题')

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def download_video(video_url, output_path):
    """下载视频"""
    try:
        log(f"  下载视频: {video_url[:60]}...")
        result = subprocess.run(
            ['curl', '-sL', '-o', output_path, video_url],
            capture_output=True,
            timeout=120
        )
        if os.path.exists(output_path) and os.path.getsize(output_path) > 10000:
            size_mb = os.path.getsize(output_path) / (1024*1024)
            log(f"  ✓ 视频下载成功: {size_mb:.1f}MB")
            return True
    except Exception as e:
        log(f"  ✗ 下载失败: {e}")
    return False

def extract_video_frames(video_path, output_folder, num_frames=5):
    """提取视频帧"""
    try:
        log(f"  提取视频帧...")
        os.makedirs(output_folder, exist_ok=True)
        
        # 获取视频时长
        probe = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'default=noprint_wrappers=1:nokey=1', video_path],
            capture_output=True, text=True
        )
        duration = float(probe.stdout.strip())
        
        # 提取多帧
        frames = []
        for i in range(num_frames):
            timestamp = (duration / (num_frames + 1)) * (i + 1)
            frame_path = os.path.join(output_folder, f'frame_{i:02d}.jpg')
            subprocess.run([
                'ffmpeg', '-y', '-ss', str(timestamp), '-i', video_path,
                '-vframes', '1', '-q:v', '2', frame_path
            ], capture_output=True, timeout=30)
            if os.path.exists(frame_path):
                frames.append(frame_path)
        
        log(f"  ✓ 提取了 {len(frames)} 帧")
        return frames
    except Exception as e:
        log(f"  ✗ 提取失败: {e}")
        return []

def create_1x1_cover_from_video(video_path, output_path):
    """从视频创建1:1封面"""
    try:
        # 提取中间帧
        subprocess.run([
            'ffmpeg', '-y', '-ss', '00:00:01', '-i', video_path,
            '-vframes', '1', '-q:v', '2', '/tmp/video_cover.jpg'
        ], capture_output=True, timeout=30)
        
        if os.path.exists('/tmp/video_cover.jpg'):
            # 裁剪为1:1
            subprocess.run([
                'ffmpeg', '-y', '-i', '/tmp/video_cover.jpg',
                '-vf', 'crop=min(iw\,ih):min(iw\,ih),scale=800:800',
                '-q:v', '2', output_path
            ], capture_output=True, timeout=30)
            
            if os.path.exists(output_path):
                return True
    except:
        pass
    return False

def analyze_video_with_kimi(video_path, frames, output_folder):
    """使用 kimi cli 分析视频"""
    analysis = {
        'visual_summary': '',
        'audio_summary': '',
        'content_description': '',
        'key_moments': []
    }
    
    # 创建分析提示
    frames_list = ' '.join(frames[:3])  # 前3帧用于分析
    
    # 调用 kimi cli 分析视频帧
    try:
        log(f"  使用 kimi 分析视频内容...")
        
        # 准备提示文件
        prompt = f"""分析这个视频的视觉内容。

视频帧路径: {frames_list}

请描述:
1. 视频画面的主要内容、场景、人物/物体
2. 视频的风格和氛围
3. 关键视觉元素

用中文简洁描述:"""
        
        prompt_file = os.path.join(output_folder, '_kimi_prompt.txt')
        with open(prompt_file, 'w') as f:
            f.write(prompt)
        
        # 调用 kimi CLI (使用用户的配置)
        result = subprocess.run(
            ['kimi', 'ask', prompt],
            capture_output=True,
            text=True,
            timeout=120
        )
        
        if result.returncode == 0:
            analysis['visual_summary'] = result.stdout.strip()
            log(f"  ✓ kimi 视觉分析完成")
        else:
            log(f"  ✗ kimi 分析失败: {result.stderr}")
            analysis['visual_summary'] = "视频画面分析暂不可用"
            
    except Exception as e:
        log(f"  ✗ kimi 调用失败: {e}")
        analysis['visual_summary'] = "视频画面分析暂不可用"
    
    # 基础描述
    analysis['content_description'] = analysis['visual_summary'] or "视频内容待分析"
    
    return analysis

def process_video_tweet(tweet_id, username):
    """处理视频推文"""
    log(f"处理视频推文: {tweet_id}")
    
    # 获取推文详情
    api = TikHubAPI()
    result = api.twitter_get_tweet_detail(tweet_id)
    
    if result.get('code') != 200:
        log(f"✗ 获取推文失败")
        return
    
    data = result.get('data', {})
    tweet = data.get('tweet', data)
    
    text = tweet.get('text', '')
    author = tweet.get('author', {}).get('name', username)
    
    # 获取视频信息
    media = tweet.get('media', {})
    if isinstance(media, dict) and 'video' in media:
        video_info = media['video'][0]
        video_url = None
        
        # 找最高质量的 mp4
        for variant in video_info.get('variants', []):
            if variant.get('content_type') == 'video/mp4':
                video_url = variant.get('url')
                break
        
        if not video_url:
            log(f"✗ 未找到视频URL")
            return
        
        # 创建临时文件夹
        temp_id = datetime.now().strftime('%H%M%S')
        temp_name = f"_待优化_{username}_{temp_id}_视频"
        folder_path = os.path.join(HOT_TOPICS, '热门分享', temp_name)
        os.makedirs(folder_path, exist_ok=True)
        
        # 下载视频
        video_path = os.path.join(folder_path, 'video.mp4')
        if not download_video(video_url, video_path):
            log(f"✗ 视频下载失败")
            return
        
        # 创建1:1封面
        cover_path = os.path.join(folder_path, 'cover.jpg')
        create_1x1_cover_from_video(video_path, cover_path)
        
        # 提取视频帧
        frames_folder = os.path.join(folder_path, 'frames')
        frames = extract_video_frames(video_path, frames_folder)
        
        # 使用 kimi 分析视频
        analysis = analyze_video_with_kimi(video_path, frames, folder_path)
        
        # 提取评论
        comments = []
        try:
            r = api.twitter_get_latest_comments(tweet_id)
            if r.get('code') == 200:
                for item in r.get('data', {}).get('timeline', [])[:10]:
                    author_info = item.get('user_info', {})
                    comments.append({
                        'author': author_info.get('name', 'Unknown'),
                        'text': item.get('text', ''),
                        'likes': item.get('favorites', 0)
                    })
        except:
            pass
        
        # 构建完整描述
        content_parts = [
            f"【视频推文】\n\n",
            f"原始内容:\n{text}\n\n",
            f"【视频分析】\n",
            f"视频时长: {video_info.get('duration', 0)/1000:.1f}秒\n",
            f"分辨率: {video_info.get('original_info', {}).get('width', 0)}x{video_info.get('original_info', {}).get('height', 0)}\n\n",
            f"【视觉内容分析】\n{analysis['visual_summary'] or '视频画面分析中...'}\n\n",
            f"【视频文件】\n",
            f"本地路径: video.mp4\n",
            f"视频帧: frames/ 文件夹"
        ]
        
        full_content = ''.join(content_parts)
        
        # 保存数据
        data = {
            'platform': 'X (Twitter)',
            'title': '[待优化标题-视频推文]',
            'topic': '[待优化标题-视频推文]',
            'category': '热门分享',
            'author': {
                'username': f"@{username}",
                'name': author
            },
            'description': text[:300],
            'content': full_content,
            'is_retweet': text.strip().upper().startswith('RT '),
            'stats': {
                'likes': tweet.get('favorites', 0),
                'retweets': tweet.get('retweets', 0),
                'replies': tweet.get('replies', 0),
                'views': str(tweet.get('views', '0')).replace(',', '')
            },
            'comments': comments,
            'comments_count': len(comments),
            'url': f"https://x.com/{username}/status/{tweet_id}",
            'original_url': f"https://x.com/{username}/status/{tweet_id}",
            'created_at': tweet.get('created_at', datetime.now().isoformat()),
            'fetched_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'has_media': True,
            'has_video': True,
            'video_info': {
                'path': 'video.mp4',
                'duration': video_info.get('duration', 0),
                'width': video_info.get('original_info', {}).get('width'),
                'height': video_info.get('original_info', {}).get('height'),
                'aspect_ratio': video_info.get('aspect_ratio')
            },
            'media_count': 1,
            'video_analysis': {
                'visual_summary': analysis['visual_summary'],
                'frames_count': len(frames),
                'frames_folder': 'frames/'
            },
            'status': 'PENDING_TITLE'
        }
        
        json_path = os.path.join(folder_path, 'post.json')
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        # 保存原文
        with open(os.path.join(folder_path, '_original.txt'), 'w', encoding='utf-8') as f:
            f.write(f"作者: @{username}\n视频推文\n\n原文:\n{text}\n\n视频分析:\n{analysis['visual_summary']}")
        
        log(f"✓ 视频推文处理完成!")
        log(f"  文件夹: {folder_path}")
        log(f"  视频: video.mp4")
        log(f"  封面: cover.jpg")
        log(f"  帧图: frames/ ({len(frames)}张)")
        log(f"  分析: {analysis['visual_summary'][:80]}...")
        
        return folder_path

if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1:
        tweet_id = sys.argv[1]
        username = sys.argv[2] if len(sys.argv) > 2 else 'unknown'
    else:
        # 默认处理用户指定的推文
        tweet_id = '2008745474887757938'
        username = 'ring_hyacinth'
    
    process_video_tweet(tweet_id, username)
