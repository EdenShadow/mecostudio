#!/usr/bin/env python3
"""
Hot Topics Fetcher v3.0 for Kimi CLI
Auto-fetch tweets from followed influencers, analyze with AI, generate formatted posts
"""

import sys
import os
import re
import json
import random
import subprocess
import shutil
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

# Configuration
TIKHUB_API_KEY = os.environ.get("TIKHUB_API_KEY", "")
TIKHUB_BASE_URL = "https://api.tikhub.io"

KNOWLEDGE_BASE = os.environ.get("HOT_TOPICS_KB_PATH", os.path.expanduser("~/Documents/知识库"))
MY_ASSISTANT = os.path.join(KNOWLEDGE_BASE, '我的助手')
HOT_TOPICS = os.path.join(KNOWLEDGE_BASE, '热门话题')

COVER_POOL = {
    'AI_Tech': [
        'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&h=800&fit=crop',
        'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=800&h=800&fit=crop'
    ],
    'Design': [
        'https://images.unsplash.com/photo-1561070791-2526d30994b5?w=800&h=800&fit=crop',
        'https://images.unsplash.com/photo-1558655146-9f40138edfeb?w=800&h=800&fit=crop'
    ],
    'Entertainment': [
        'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=800&h=800&fit=crop'
    ],
    'Food': [
        'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&h=800&fit=crop'
    ],
    'Health': [
        'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=800&h=800&fit=crop'
    ],
    'Finance': [
        'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&h=800&fit=crop'
    ],
    'Military': [
        'https://images.unsplash.com/photo-1559666126-84f389727b9a?w=800&h=800&fit=crop'
    ],
    'Society': [
        'https://images.unsplash.com/photo-1491438590914-bc09fcaaf77a?w=800&h=800&fit=crop'
    ],
    'Sports': [
        'https://images.unsplash.com/photo-1461896836934- voices-0041080a?w=800&h=800&fit=crop'
    ],
    'Technology': [
        'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&h=800&fit=crop'
    ],
    'Trending': [
        'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&h=800&fit=crop'
    ],
    'Default': [
        'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&h=800&fit=crop'
    ]
}


# ============== TikHub API Client ==============

class TikHubAPI:
    """TikHub API Client"""
    
    def __init__(self, api_key=None, base_url=None):
        self.api_key = api_key or TIKHUB_API_KEY
        self.base_url = base_url or TIKHUB_BASE_URL
        self.headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': (
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/124.0.0.0 Safari/537.36'
            )
        }
    
    def _request(self, endpoint, params=None):
        """Make HTTP request using requests first, urllib fallback"""
        url = f"{self.base_url}{endpoint}"
        clean_params = {}
        for key, value in (params or {}).items():
            if value is None:
                continue
            val = str(value).strip()
            if val == '':
                continue
            clean_params[key] = val
        if clean_params:
            url = f"{url}?{urllib.parse.urlencode(clean_params)}"

        try:
            import requests
            response = requests.get(url, headers=self.headers, timeout=30)
            try:
                payload = response.json()
            except Exception:
                payload = {'code': response.status_code, 'message': (response.text or '')[:500]}
            if isinstance(payload, dict) and 'code' not in payload:
                payload['code'] = response.status_code
            return payload
        except Exception:
            try:
                req = urllib.request.Request(url, headers=self.headers, method='GET')
                with urllib.request.urlopen(req, timeout=30) as response:
                    body = response.read().decode('utf-8', errors='replace')
                    try:
                        payload = json.loads(body)
                    except Exception:
                        payload = {'code': response.status, 'message': body[:500]}
                    if isinstance(payload, dict) and 'code' not in payload:
                        payload['code'] = response.status
                    return payload
            except urllib.error.HTTPError as e:
                raw = ''
                try:
                    raw = e.read().decode('utf-8', errors='replace')
                except Exception:
                    raw = str(e)
                try:
                    parsed = json.loads(raw)
                    if isinstance(parsed, dict):
                        parsed.setdefault('code', e.code)
                        return parsed
                except Exception:
                    pass
                return {'code': e.code, 'message': raw[:500] or str(e)}
            except Exception as e:
                return {'code': 500, 'message': str(e)}

    @staticmethod
    def _extract_timeline(result):
        data = result.get('data', {}) if isinstance(result, dict) else {}
        if isinstance(data, dict):
            timeline = data.get('timeline')
            if isinstance(timeline, list):
                return timeline
            nested = data.get('data')
            if isinstance(nested, dict):
                nested_timeline = nested.get('timeline')
                if isinstance(nested_timeline, list):
                    return nested_timeline
        return []

    @staticmethod
    def _extract_next_cursor(result):
        data = result.get('data', {}) if isinstance(result, dict) else {}
        if not isinstance(data, dict):
            return ''
        for key in ('next_cursor', 'cursor', 'nextCursor'):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ''

    @staticmethod
    def _normalize_tweet_id(tweet):
        if not isinstance(tweet, dict):
            return ''
        for key in ('tweet_id', 'id', 'rest_id'):
            value = tweet.get(key)
            if value is None:
                continue
            text = str(value).strip()
            if text:
                return text
        return ''
    
    def twitter_get_tweet_detail(self, tweet_id):
        """Get tweet detail by ID"""
        return self._request('/api/v1/twitter/web/fetch_tweet_detail', {'tweet_id': tweet_id})
    
    def twitter_get_user_posts(self, screen_name, limit=5, cursor=None):
        """Get user's posts"""
        params = {
            'screen_name': screen_name,
            'user_name': screen_name,
            'limit': limit
        }
        if cursor:
            params['cursor'] = cursor
        return self._request('/api/v1/twitter/web/fetch_user_post_tweet', params)

    def twitter_get_tweet_from_user_posts(self, screen_name, tweet_id, limit=40, max_pages=3):
        """
        Resolve tweet from user timeline first.
        More stable than fetch_tweet_detail in some environments.
        """
        user = str(screen_name or '').strip().lstrip('@')
        target_id = str(tweet_id or '').strip()
        if not user or not target_id:
            return {'code': 400, 'message': 'missing screen_name or tweet_id'}

        cursor = None
        last_err = None
        for _ in range(max_pages):
            result = self.twitter_get_user_posts(user, limit=limit, cursor=cursor)
            if result.get('code') != 200:
                last_err = result
                break
            timeline = self._extract_timeline(result)
            for item in timeline:
                if self._normalize_tweet_id(item) == target_id:
                    return {'code': 200, 'data': item, 'source': 'fetch_user_post_tweet'}
            cursor = self._extract_next_cursor(result)
            if not cursor:
                break

        if isinstance(last_err, dict):
            return last_err
        return {'code': 404, 'message': f'tweet not found in user timeline: @{user}/{target_id}'}
    
    def twitter_get_comments(self, tweet_id):
        """Get tweet comments (using fetch_post_comments for better results)"""
        return self._request('/api/v1/twitter/web/fetch_post_comments', {
            'tweet_id': tweet_id
        })


# ============== Utility Functions ==============

def log(msg):
    """Print timestamped log"""
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def run_with_retry(cmd, timeout, cwd=None, max_retries=2, retry_delay=3):
    """Run command with retry logic"""
    for attempt in range(max_retries + 1):
        try:
            if attempt > 0:
                log(f"  🔄 Retry attempt {attempt}/{max_retries}...")
                import time
                time.sleep(retry_delay * attempt)
            
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd
            )
            
            if result.returncode == 0:
                return result
            elif attempt < max_retries:
                log(f"  ⚠ Command failed (exit {result.returncode}), will retry...")
            else:
                return result
                
        except subprocess.TimeoutExpired:
            if attempt < max_retries:
                log(f"  ⏱️ Timeout, retrying...")
            else:
                log(f"  ⏱️ Timeout after {max_retries + 1} attempts")
                raise
        except Exception as e:
            if attempt < max_retries:
                log(f"  ⚠ Error: {e}, retrying...")
            else:
                raise
    
    return result


def load_categories():
    """Load categories and influencers from knowledge base"""
    categories = {}
    if not os.path.exists(MY_ASSISTANT):
        log(f"Knowledge base not found: {MY_ASSISTANT}")
        return categories
    
    for item in os.listdir(MY_ASSISTANT):
        item_path = os.path.join(MY_ASSISTANT, item)
        if os.path.isdir(item_path):
            category_name = item
            categories[category_name] = {'users': [], 'files': []}
            
            for root, dirs, files in os.walk(item_path):
                for f in files:
                    if f.endswith('.txt'):
                        file_path = os.path.join(root, f)
                        categories[category_name]['files'].append(file_path)
                        
                        try:
                            with open(file_path, 'r', encoding='utf-8') as fp:
                                content = fp.read()
                                users = re.findall(r'@([a-zA-Z0-9_]+)', content)
                                categories[category_name]['users'].extend(users)
                        except:
                            pass
    
    return categories


def smart_categorize(text, author):
    """Smart categorization based on content and author"""
    text_lower = (text + ' ' + author).lower()
    
    # Priority 1: Check author
    author_categories = {
        'Military': ['usarmy', 'usnavy', 'usairforce', 'deptofdefense', 'nato', 'defense', 'warmonitor', 'osint', 'military'],
        'Sports': ['nba', 'nfl', 'mlb', 'fifa', 'espn', 'sports', 'olympic', 'athlete'],
        'Entertainment': ['variety', 'billboard', 'hollywood', 'netflix', 'disney', 'hbo', 'spotify', 'tmz', 'popcrave'],
        'Technology': ['apple', 'google', 'microsoft', 'meta', 'tesla', 'spacex', 'openai', 'anthropic'],
        'Politics': ['whitehouse', 'potus', 'congress', 'senate', 'gop', 'democrats', 'republicans'],
        'Economy': ['federalreserve', 'wsj', 'ft', 'economist', 'bloomberg', 'marketwatch'],
        'Science': ['nasa', 'spacex', 'science', 'nature', 'research'],
        'Medical': ['who', 'cdc', 'fda', 'medical', 'healthcare', 'hospital'],
    }
    
    for cat, authors in author_categories.items():
        if any(a in author.lower() for a in authors):
            return cat
    
    # Priority 2: Check content keywords
    categories = {
        'Military': ['military', 'defense', 'army', 'navy', 'air force', 'pentagon', 'tactical', 'infantry', 'squad', 'soldier', 'combat', 'weapon', 'drone', 'warfare', 'tank', 'missile'],
        'Politics': ['politics', 'government', 'election', 'vote', 'democracy', 'senator', 'congress', 'president', 'policy', 'legislation'],
        'Economy': ['economy', 'economic', 'finance', 'financial', 'stock', 'market', 'trade', 'inflation', 'recession', 'gdp', 'investment', 'crypto', 'bitcoin'],
        'AI_Tech': ['ai', 'gpt', 'claude', 'coding', 'tech', 'technology', 'algorithm', 'deepseek', 'opus', 'seedance', 'software', 'app', 'digital', 'machine learning', 'ml', 'neural network'],
        'Design': ['design', 'ui', 'ux', 'graphic', 'illustration', 'brand', 'logo', 'typography', 'color', 'layout', 'creative', 'artwork', 'visual', 'interface'],
        'Entertainment': ['movie', 'film', 'cinema', 'actor', 'actress', 'celebrity', 'hollywood', 'music', 'song', 'album', 'concert', 'tv', 'show', 'netflix', 'disney', 'marvel', 'avengers'],
        'Sports': ['sports', 'game', 'match', 'team', 'player', 'basketball', 'football', 'soccer', 'baseball', 'tennis', 'olympics', 'championship'],
        'Technology': ['computer', 'hardware', 'chip', 'semiconductor', 'gadget', 'device', 'electronics', 'robot', 'automation', 'iot'],
        'Culture': ['culture', 'art', 'museum', 'gallery', 'book', 'literature', 'fashion', 'lifestyle', 'travel'],
        'Society': ['society', 'social', 'community', 'education', 'school', 'university', 'student', 'teacher'],
        'Science': ['science', 'scientific', 'research', 'study', 'discovery', 'space', 'nasa', 'physics', 'chemistry', 'biology'],
        'History': ['history', 'historical', 'museum', 'heritage', 'ancient', 'archive'],
        'Health': ['health', 'wellness', 'fitness', 'exercise', 'diet', 'nutrition', 'mental health', 'yoga', 'meditation'],
        'Medical': ['medical', 'healthcare', 'hospital', 'doctor', 'medicine', 'disease', 'treatment', 'vaccine', 'pharma'],
        'Food': ['food', 'restaurant', 'recipe', 'cooking', 'delicious', 'cuisine', 'chef', 'baking', 'meal'],
    }
    
    for cat, keywords in categories.items():
        if any(kw in text_lower for kw in keywords):
            return cat
    
    return 'Society'  # Default category


def contains_chinese(text):
    """Check if text contains Chinese characters"""
    for char in text:
        if '\u4e00' <= char <= '\u9fff':
            return True
    return False

EN_FRAGMENT_ENDINGS = {
    'to', 'for', 'with', 'of', 'in', 'on', 'at', 'by', 'from', 'as',
    'about', 'into', 'onto', 'over', 'under', 'through', 'during',
    'without', 'within', 'and', 'or', 'but', 'the', 'a', 'an'
}


def normalize_inline_text(text):
    """Normalize whitespace and trim quotes-like wrappers"""
    cleaned = re.sub(r'\s+', ' ', (text or '')).strip()
    return cleaned.strip(' "\'“”‘’')


def trim_en_fragment_tail(text):
    """Trim trailing ellipsis and dangling preposition/article words"""
    candidate = re.sub(r'(?:\.\.\.|…)+$', '', normalize_inline_text(text)).strip()
    if not candidate:
        return ''
    words = candidate.split()
    while words:
        last = re.sub(r'[^a-z]', '', words[-1].lower())
        if last and last in EN_FRAGMENT_ENDINGS and len(words) > 3:
            words.pop()
            continue
        break
    return ' '.join(words).strip()


def build_media_fallback_summary(files_to_analyze, has_audio, audio_path, language='zh'):
    """Build a deterministic media summary when Kimi output is unavailable"""
    image_count = len([f for f in files_to_analyze if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))])
    frame_count = len([f for f in files_to_analyze if 'frame_' in os.path.basename(f).lower()])
    preview_count = len([f for f in files_to_analyze if 'video_preview' in os.path.basename(f).lower()])
    audio_seconds = None

    if has_audio and audio_path and os.path.exists(audio_path):
        try:
            probe = subprocess.run(
                ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                 '-of', 'default=noprint_wrappers=1:nokey=1', audio_path],
                capture_output=True, text=True, timeout=10
            )
            if probe.returncode == 0:
                audio_seconds = float(probe.stdout.strip())
        except Exception:
            audio_seconds = None

    if language == 'en':
        parts = [f"- Visual files detected: {image_count} image/frame file(s)"]
        if frame_count > 0:
            parts.append(f"- Video frame extraction completed: {frame_count} frame(s)")
        if preview_count > 0:
            parts.append(f"- Long-video preview frame detected: {preview_count} file(s)")
        if has_audio:
            if audio_seconds:
                parts.append(f"- Audio track detected: {audio_seconds:.2f}s")
            else:
                parts.append("- Audio track detected")
        parts.append("- AI media deep analysis unavailable this time, using metadata fallback.")
        return '\n'.join(parts)

    parts = [f"- 检测到可分析视觉文件：{image_count} 个"]
    if frame_count > 0:
        parts.append(f"- 已完成视频抽帧：{frame_count} 帧")
    if preview_count > 0:
        parts.append(f"- 检测到长视频预览帧：{preview_count} 张")
    if has_audio:
        if audio_seconds:
            parts.append(f"- 检测到音频轨：约 {audio_seconds:.2f} 秒")
        else:
            parts.append("- 检测到音频轨")
    parts.append("- 本次媒体深度分析结果不完整，已使用媒体元数据兜底。")
    return '\n'.join(parts)


def is_meaningful_media_analysis(text):
    """Check if media analysis has useful semantic content"""
    value = normalize_inline_text(text)
    if not value:
        return False

    bad_markers = [
        'StepInterrupted(',
        'ToolCall(',
        'ToolResult(',
        'Error code:',
        'content_filter',
        'Request id:',
        'Kimi timed out'
    ]
    if any(marker.lower() in value.lower() for marker in bad_markers):
        return False

    if len(value) < 24:
        return False
    return True


def sanitize_folder_name(name):
    """Clean folder name, remove invalid characters"""
    name = re.sub(r'[\\/:*?"<>|]', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    if len(name) > 80:
        name = name[:80]
    return name


# ============== Media Processing ==============

def download_image(url, output_path):
    """Download image using curl"""
    try:
        subprocess.run(['curl', '-sL', '-o', output_path, url], timeout=30)
        return os.path.exists(output_path) and os.path.getsize(output_path) > 1000
    except:
        return False


def download_video(video_url, output_path, max_retries=1):
    """Download video using curl with retry"""
    for attempt in range(max_retries + 1):
        try:
            if attempt > 0:
                log(f"  🔄 Retrying video download ({attempt}/{max_retries})...")
                import time
                time.sleep(2)
            
            # Use shorter timeout with retry for faster failure
            timeout = 60 if attempt == 0 else 90
            
            result = subprocess.run(
                ['curl', '-sL', '-o', output_path, video_url],
                capture_output=True,
                timeout=timeout
            )
            
            success = os.path.exists(output_path) and os.path.getsize(output_path) > 10000
            if success:
                return True
            elif attempt < max_retries:
                log(f"  ⚠ Video download incomplete, retrying...")
            else:
                return False
                
        except subprocess.TimeoutExpired:
            if attempt < max_retries:
                log(f"  ⏱️ Video download timeout, retrying...")
            else:
                log(f"  ⏱️ Video download timeout after {max_retries + 1} attempts")
                return False
        except Exception as e:
            if attempt < max_retries:
                log(f"  ⚠ Video download error: {e}, retrying...")
            else:
                return False
    
    return False


def create_1x1_cover(image_paths, output_path):
    """Create 1:1 cover using Pillow"""
    try:
        from PIL import Image
        
        target_size = 800
        
        if len(image_paths) == 1:
            img = Image.open(image_paths[0])
            width, height = img.size
            
            if width > height:
                left = (width - height) // 2
                top = 0
                right = left + height
                bottom = height
            else:
                left = 0
                top = (height - width) // 2
                right = width
                bottom = top + width
            
            img_cropped = img.crop((left, top, right, bottom))
            img_resized = img_cropped.resize((target_size, target_size), Image.LANCZOS)
            img_resized.save(output_path, 'JPEG', quality=90)
            return True
        else:
            cell_size = target_size // 2
            collage = Image.new('RGB', (target_size, target_size), (255, 255, 255))
            
            for i, img_path in enumerate(image_paths[:4]):
                try:
                    img = Image.open(img_path)
                    width, height = img.size
                    
                    if width > height:
                        left = (width - height) // 2
                        top = 0
                        right = left + height
                        bottom = height
                    else:
                        left = 0
                        top = (height - width) // 2
                        right = width
                        bottom = top + width
                    
                    img_cropped = img.crop((left, top, right, bottom))
                    img_resized = img_cropped.resize((cell_size, cell_size), Image.LANCZOS)
                    
                    x = (i % 2) * cell_size
                    y = (i // 2) * cell_size
                    collage.paste(img_resized, (x, y))
                except:
                    continue
            
            collage.save(output_path, 'JPEG', quality=90)
            return True
    except:
        return False


def create_video_cover(video_path, output_path):
    """Extract 1:1 cover from video"""
    try:
        subprocess.run([
            'ffmpeg', '-y', '-ss', '00:00:01', '-i', video_path,
            '-vframes', '1', '-q:v', '2', '/tmp/video_frame.jpg'
        ], capture_output=True, timeout=30)
        
        if os.path.exists('/tmp/video_frame.jpg'):
            from PIL import Image
            img = Image.open('/tmp/video_frame.jpg')
            width, height = img.size
            
            if width > height:
                left = (width - height) // 2
                top = 0
                right = left + height
                bottom = height
            else:
                left = 0
                top = (height - width) // 2
                right = width
                bottom = top + width
            
            img_cropped = img.crop((left, top, right, bottom))
            img_resized = img_cropped.resize((800, 800), Image.LANCZOS)
            img_resized.save(output_path, 'JPEG', quality=90)
            return True
    except:
        pass
    return False


def get_cover_for_category(category):
    """Get default cover for category"""
    urls = COVER_POOL.get(category, COVER_POOL['Default'])
    return random.choice(urls)


def get_video_duration(video_path):
    """Get video duration in seconds using ffprobe"""
    try:
        probe = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'default=noprint_wrappers=1:nokey=1', video_path],
            capture_output=True, text=True, timeout=10
        )
        if probe.returncode == 0:
            return float(probe.stdout.strip())
    except:
        pass
    return 0


def is_long_video(video_path, max_duration=180):
    """Check if video duration exceeds max_duration (default 3 minutes = 180s)"""
    duration = get_video_duration(video_path)
    return duration > max_duration, duration


def extract_video_frames(video_path, output_folder, num_frames=5):
    """Extract video frames at evenly spaced intervals"""
    try:
        os.makedirs(output_folder, exist_ok=True)
        
        # Get video duration
        probe = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'default=noprint_wrappers=1:nokey=1', video_path],
            capture_output=True, text=True, timeout=10
        )
        duration = float(probe.stdout.strip()) if probe.returncode == 0 else 0
        
        if duration == 0:
            duration = 30
        
        interval = duration / (num_frames + 1)
        frame_paths = []
        
        for i in range(num_frames):
            time_point = interval * (i + 1)
            frame_path = os.path.join(output_folder, f'frame_{i+1:02d}.jpg')
            
            subprocess.run([
                'ffmpeg', '-y', '-ss', str(time_point), '-i', video_path,
                '-vframes', '1', '-q:v', '2', frame_path
            ], capture_output=True, timeout=30)
            
            if os.path.exists(frame_path):
                frame_paths.append(frame_path)
        
        return frame_paths
    except:
        return []


def extract_audio(video_path, output_path):
    """Extract audio from video"""
    try:
        subprocess.run([
            'ffmpeg', '-y', '-i', video_path,
            '-vn', '-acodec', 'libmp3lame', '-q:a', '2', output_path
        ], capture_output=True, timeout=60)
        
        if os.path.exists(output_path) and os.path.getsize(output_path) > 1000:
            return output_path
    except:
        pass
    return None


# ============== Comment Extraction ==============

def extract_top_comments(tweet_id, api, limit=10):
    """Extract top comments by likes (using fetch_post_comments API)"""
    comments = []
    try:
        result = api.twitter_get_comments(tweet_id)
        if result.get('code') == 200:
            data = result.get('data', {})
            # fetch_post_comments returns comments in 'thread' field
            thread = data.get('thread', [])
            
            # Sort by likes (handle None values)
            sorted_comments = sorted(
                thread,
                key=lambda x: x.get('likes') or 0,
                reverse=True
            )
            
            for item in sorted_comments[:limit]:
                author_info = item.get('author', {})
                comment = {
                    'author': author_info.get('name', 'Unknown'),
                    'author_screen': author_info.get('screen_name', ''),
                    'text': item.get('text', ''),
                    'likes': item.get('likes', 0),
                    'replies': item.get('replies', 0)
                }
                comments.append(comment)
    except Exception as e:
        log(f"  Failed to get comments: {e}")
    
    return comments


def extract_original_from_rt(text):
    """Extract original content from RT"""
    clean = re.sub(r'^RT\s+@\w+:\s*', '', text, flags=re.IGNORECASE)
    return clean.strip()


# ============== Kimi AI Analysis ==============

def extract_kimi_text_content(output):
    """Extract clean text from Kimi CLI output"""
    try:
        # Find TextPart content
        pattern = r"TextPart\(\s*type=['\"]text['\"],\s*text=['\"](.+?)['\"]\s*\)"
        matches = re.findall(pattern, output, re.DOTALL)
        
        for match in matches:
            text = match.replace('\\n', '\n').replace("\\'", "'").replace('\\"', '"').replace('\\\\', '\\')
            text = re.sub(r'<image[^>]*>', '[Image analyzed]', text)
            text = re.sub(r'</image>', '', text)
            if len(text) > 50:
                return text.strip()
        
        # Fallback: filter out internal data
        lines = output.split('\n')
        skip_patterns = [
            'ToolCall(', 'ToolResult(', 'ThinkPart(', 'StatusUpdate(',
            'StepBegin(', 'TurnBegin(', 'TurnEnd(', 'FunctionBody(',
            'ToolCallPart(', 'FunctionReturnValue(', 'StepInterrupted(',
            'Error code:', 'content_filter', 'Request id:'
        ]
        
        result_lines = []
        for line in lines:
            skip = any(pattern in line for pattern in skip_patterns)
            if '<image' in line or 'base64' in line:
                skip = True
            if not skip and line.strip():
                result_lines.append(line)
        
        result = '\n'.join(result_lines)
        result = re.sub(r'<image[^>]*>', '[Image analyzed]', result)
        result = re.sub(r'</image>', '', result)
        result = re.sub(r'^.*StepInterrupted.*$', '', result, flags=re.MULTILINE)
        result = re.sub(r'^.*Error code:.*$', '', result, flags=re.MULTILINE)
        result = re.sub(r'^.*Request id:.*$', '', result, flags=re.MULTILINE)
        result = re.sub(r'\n{3,}', '\n\n', result)
        return result.strip()
    except:
        return output



def extract_title_from_kimi_output(output, language='zh'):
    """Extract title from Kimi output - handles multi-line titles"""
    try:
        text_content = extract_kimi_text_content(output)
        lines = text_content.split('\n')
        
        for i in range(len(lines) - 1, -1, -1):
            line = lines[i].strip()
            
            if language == 'zh':
                if '**标题：**' in line or '**标题:' in line:
                    match = re.search(r'\*\*\s*标题\s*[:：]\*\*\s*(.+)', line)
                    if match:
                        title = match.group(1).strip()
                        j = i + 1
                        while j < len(lines):
                            next_line = lines[j].strip()
                            if not next_line or next_line.startswith('**'):
                                break
                            title += next_line
                            j += 1
                        title = re.sub(r'^[\*\s\-\'"]+|[\*\s\'"]+$', '', title)
                        title = re.sub(r'\s+', ' ', title)
                        title = re.sub(r'(?:\.\.\.|…)+$', '', title).strip()
                        if len(title) >= 5 and len(title) <= 150:
                            return title
            else:
                if '**TITLE:**' in line.upper() or '**TITLE：' in line.upper():
                    match = re.search(r'\*\*\s*Title\s*[:：]\*\*\s*(.+)', line, re.IGNORECASE)
                    if match:
                        title = match.group(1).strip()
                        j = i + 1
                        while j < len(lines):
                            next_line = lines[j].strip()
                            if not next_line or next_line.startswith('**'):
                                break
                            title += ' ' + next_line
                            j += 1
                        title = re.sub(r'^[\*\s\-\'"]+|[\*\s\'"]+$', '', title)
                        title = re.sub(r'\s+', ' ', title)
                        title = trim_en_fragment_tail(title)
                        words = title.split()
                        if len(words) < 4 and len(title) < 20:
                            continue
                        if len(title) >= 5 and len(title) <= 150:
                            return title
        
        return None
    except:
        return None


def generate_fallback_title(text, language='zh'):
    """Generate fallback title when Kimi fails"""
    clean_text = re.sub(r'https?://\S+', '', text)
    clean_text = re.sub(r'RT\s+@\w+:\s*', '', clean_text)
    clean_text = normalize_inline_text(clean_text)
    
    if language == 'en':
        emojis = ['🔥', '💡', '📌', '✨', '🎯']
        emoji = random.choice(emojis)
        sentence_candidates = [s.strip() for s in re.split(r'[.!?\n]+', clean_text) if s.strip()]
        base = sentence_candidates[0] if sentence_candidates else clean_text
        clause_candidates = [s.strip() for s in re.split(r'[,;:]+', base) if s.strip()]
        if clause_candidates:
            base = clause_candidates[0]
        base = trim_en_fragment_tail(base)
        if not base:
            base = "Topic update worth discussing"
        if len(base) > 130:
            cut = base[:130]
            if ' ' in cut:
                cut = cut[:cut.rfind(' ')]
            base = cut.strip()
        title = f"{emoji} {base}"
    else:
        emojis = ['🔥', '💡', '📌', '✨', '🎯', '🤔', '👀']
        emoji = random.choice(emojis)
        base = clean_text[:35] if len(clean_text) > 35 else clean_text
        title = f"{emoji}{base}" if base else f"{emoji}热门话题更新"
    
    return title.strip()


def analyze_with_kimi(media_files, text_content, folder_path, language='zh', analyze_audio=False, skip_video_analysis=False):
    """Analyze media with Kimi CLI
    
    Args:
        skip_video_analysis: If True, skip frame extraction and audio analysis for long videos
    """
    try:
        image_files = [f for f in media_files if f and os.path.exists(f) and f.endswith(('.jpg', '.png', '.jpeg'))]
        video_files = [f for f in media_files if f and os.path.exists(f) and f.endswith('.mp4')]
        
        files_to_analyze = []
        media_analysis = "No media to analyze"
        audio_analysis_text = ""
        audio_path = os.path.join(folder_path, 'audio.mp3')
        
        # Process video
        if video_files:
            video_path = video_files[0]
            
            # Check if it's a long video
            if skip_video_analysis:
                log(f"  🎬 Video detected (long video >3min, skipping deep analysis)")
                # For long videos, just capture a single frame for visual context
                # but don't extract multiple frames or audio
                try:
                    # Extract just 1 frame for visual reference
                    single_frame = os.path.join(folder_path, 'video_preview.jpg')
                    subprocess.run([
                        'ffmpeg', '-y', '-ss', '00:00:01', '-i', video_path,
                        '-vframes', '1', '-q:v', '2', single_frame
                    ], capture_output=True, timeout=15)
                    
                    if os.path.exists(single_frame):
                        files_to_analyze.append('video_preview.jpg')
                        media_analysis = "Video content (duration >3min, only single frame analyzed for speed)"
                        log(f"  ✓ Extracted preview frame from long video")
                except:
                    media_analysis = "Video content (long video, frame extraction skipped)"
            else:
                # Normal video processing for short videos
                log(f"  🎬 Processing video...")
                
                frames_folder = os.path.join(folder_path, 'frames')
                frame_paths = extract_video_frames(video_path, frames_folder, num_frames=5)
                
                if frame_paths:
                    log(f"  ✓ Extracted {len(frame_paths)} frames")
                    for fp in frame_paths:
                        rel_path = os.path.relpath(fp, folder_path)
                        files_to_analyze.append(rel_path)
                
                # Extract and optionally analyze audio
                if extract_audio(video_path, audio_path):
                    log(f"  ✓ Extracted audio")
                    files_to_analyze.append('audio.mp3')
                    
                    # Analyze audio if requested and tools available
                    if analyze_audio:
                        try:
                            from audio_utils import analyze_audio_content
                            log(f"  🎙️ Analyzing audio content...")
                            audio_result = analyze_audio_content(audio_path)
                            if audio_result:
                                audio_analysis_text = audio_result.get('analysis', '')
                                # Save transcription
                                with open(os.path.join(folder_path, '_audio_transcription.txt'), 'w', encoding='utf-8') as f:
                                    f.write(f"Transcription:\n{audio_result.get('transcription', '')}\n\n")
                                    f.write(f"Analysis:\n{audio_analysis_text}\n")
                                log(f"  ✓ Audio analysis saved")
                        except Exception as e:
                            log(f"  ⚠ Audio analysis failed: {e}")
        
        # Process images
        if image_files:
            log(f"  🖼️ Processing {len(image_files)} images...")
            for img_path in image_files[:4]:
                rel_path = os.path.relpath(img_path, folder_path)
                files_to_analyze.append(rel_path)

        # De-duplicate while preserving order
        files_to_analyze = list(dict.fromkeys(files_to_analyze))
        has_audio_file = os.path.exists(audio_path) and os.path.getsize(audio_path) > 1000
        if has_audio_file and 'audio.mp3' not in files_to_analyze:
            files_to_analyze.append('audio.mp3')
        
        # Analyze media with Kimi
        if files_to_analyze:
            file_list_str = "\n".join([f"  - {f}" for f in files_to_analyze])
            
            if language == 'en':
                media_prompt = f"""Please analyze these media files in the current directory:
{file_list_str}

For each image/video frame, describe:
1. Visual content: What is shown?
2. Visual style: colors, lighting, composition
3. Text: Any visible text in the images
4. Overall impression

Be concise but descriptive."""
            else:
                media_prompt = f"""请分析当前目录下的以下媒体文件：
{file_list_str}

对每张图片/视频帧，描述：
1. 画面内容：展示了什么？（人物、物品、场景、动作）
2. 视觉风格：色彩、光线、构图
3. 文字信息：图片中是否有可见文字
4. 整体印象

请简洁但描述性强。"""
            
            log(f"  🤖 Analyzing media with Kimi... (timeout: 60s, max 2 attempts)")
            cmd = ['kimi', '--print', '--yolo', '--prompt', media_prompt]
            
            try:
                # Reduced timeout with retry for faster failure recovery
                result = run_with_retry(cmd, timeout=60, cwd=folder_path, max_retries=1, retry_delay=2)
                
                if result.returncode == 0:
                    extracted_media = extract_kimi_text_content(result.stdout)
                    if is_meaningful_media_analysis(extracted_media):
                        media_analysis = extracted_media
                        log(f"  ✓ Media analysis complete")
                    else:
                        media_analysis = build_media_fallback_summary(files_to_analyze, has_audio_file, audio_path, language)
                        log(f"  ⚠ Media analysis content incomplete, using metadata fallback")
                else:
                    media_analysis = build_media_fallback_summary(files_to_analyze, has_audio_file, audio_path, language)
                    log(f"  ⚠ Media analysis failed, using fallback")
            except subprocess.TimeoutExpired:
                log(f"  ⏱️ Media analysis timeout, using fallback")
                media_analysis = build_media_fallback_summary(files_to_analyze, has_audio_file, audio_path, language)
            except Exception as e:
                log(f"  ✗ Media analysis error: {e}")
                media_analysis = build_media_fallback_summary(files_to_analyze, has_audio_file, audio_path, language)
        else:
            media_analysis = build_media_fallback_summary(files_to_analyze, has_audio_file, audio_path, language) \
                if (files_to_analyze or has_audio_file) else ("No media to analyze" if language == 'en' else "无媒体需要分析")

        if not is_meaningful_media_analysis(media_analysis):
            media_analysis = build_media_fallback_summary(files_to_analyze, has_audio_file, audio_path, language)
        
        # Generate title with audio context
        audio_section = ""
        if audio_analysis_text:
            if language == 'en':
                audio_section = f"\n\nAudio Content Analysis:\n{audio_analysis_text[:500]}"
            else:
                audio_section = f"\n\n音频内容分析：\n{audio_analysis_text[:500]}"
        
        if language == 'en':
            title_prompt = f"""Based on the following information, generate an engaging title:

Tweet Text:
{text_content[:500]}

Media Analysis:
{media_analysis[:1000]}{audio_section}

CRITICAL REQUIREMENTS:
1. The tweet is in ENGLISH - generate an ENGLISH title only
2. Title must be in English (with emoji, 10-15 words) - must start with **Title:**
3. Capture the essence of text, visual AND audio content
4. Make it catchy and shareable

Format:
**Title:** [your English emoji title here]
**Why:** Brief explanation of why this title fits"""
        else:
            title_prompt = f"""基于以下信息，生成一个有吸引力的标题：

推文内容：
{text_content[:500]}

媒体分析：
{media_analysis[:1000]}{audio_section}

关键要求：
1. 推文内容是中文 - 必须生成中文标题
2. 标题必须使用中文（带emoji，15-20字）- 必须以 **标题：** 开头
3. 准确概括文字、视觉和音频内容
4. 有吸引力、适合社交媒体传播

格式：
**标题：** [中文emoji标题]
**理由：** 简要说明为什么这个标题合适"""
        
        log(f"  🤖 Generating title... (timeout: 45s, max 2 attempts)")
        cmd = ['kimi', '--print', '--yolo', '--prompt', title_prompt]
        
        try:
            # Reduced timeout with retry for faster failure recovery
            result = run_with_retry(cmd, timeout=45, cwd=folder_path, max_retries=1, retry_delay=2)
            
            if result.returncode == 0:
                output = result.stdout
                extracted_title = extract_title_from_kimi_output(output, language)
                
                if extracted_title:
                    log(f"  ✓ Title: {extracted_title[:50]}...")
                else:
                    log(f"  ⚠ No title extracted, using fallback")
                    extracted_title = generate_fallback_title(text_content, language)
                
                # Save analysis
                full_analysis = f"""=== MEDIA ANALYSIS ===
{media_analysis}

=== TITLE GENERATION ===
{extract_kimi_text_content(output)}"""
                
                with open(os.path.join(folder_path, '_kimi_analysis.txt'), 'w', encoding='utf-8') as f:
                    f.write(full_analysis)
                
                return {
                    'full_analysis': full_analysis,
                    'media_analysis': media_analysis,
                    'title': extracted_title,
                    'audio_analysis': audio_analysis_text
                }
            else:
                log(f"  ⚠ Title generation failed: {result.stderr[:200]}")
                raise Exception(f"Title generation failed: {result.stderr[:200]}")
                
        except subprocess.TimeoutExpired:
            log(f"  ⏱️ Title generation timeout, using fallback")
            fallback = generate_fallback_title(text_content, language)
            return {
                'full_analysis': "Title generation timeout",
                'media_analysis': media_analysis,
                'title': fallback,
                'audio_analysis': audio_analysis_text
            }
        except Exception as e:
            log(f"  ✗ Title generation error: {e}")
            fallback = generate_fallback_title(text_content, language)
            return {
                'full_analysis': f"Error: {e}",
                'media_analysis': media_analysis,
                'title': fallback,
                'audio_analysis': audio_analysis_text
            }
    
    except Exception as e:
        log(f"  ✗ Analysis error: {e}")
        import traceback
        traceback.print_exc()
        fallback = generate_fallback_title(text_content, language)
        return {
            'full_analysis': f"Error: {e}",
            'media_analysis': media_analysis if 'media_analysis' in locals() else ("No media to analyze" if language == 'en' else "无媒体需要分析"),
            'title': fallback,
            'audio_analysis': ""
        }


# ============== Main Processing ==============

def process_tweet(tweet, author, api, language='zh', analyze_audio=False):
    """Process single tweet"""
    text = tweet.get('text', '')
    tweet_id = tweet.get('tweet_id') or tweet.get('id', '')
    
    category = smart_categorize(text, author)
    
    temp_id = datetime.now().strftime('%H%M%S')
    temp_name = f"_pending_{author}_{temp_id}"
    folder_path = os.path.join(HOT_TOPICS, category, temp_name)
    os.makedirs(folder_path, exist_ok=True)
    
    # ============================================================
    # Media Extraction - Handles all cases with comprehensive protection
    # ============================================================
    # Cases handled:
    # 1. Regular media (photo/video) in tweet.media
    # 2. Card media (link preview) in tweet.card.media.image_url
    # 3. Retweet media in tweet.retweeted_tweet.media
    # 4. Retweet card in tweet.retweeted_tweet.card
    # 5. Mixed media (card + regular)
    # ============================================================
    
    def extract_card_image(card_obj):
        """Safely extract card image URL with full protection"""
        if not card_obj or not isinstance(card_obj, dict):
            return None
        try:
            # Case 1: card.media.image_url
            if card_obj.get('media') and isinstance(card_obj['media'], dict):
                if 'image_url' in card_obj['media']:
                    return card_obj['media']['image_url']
            # Case 2: card.image_url
            if 'image_url' in card_obj:
                return card_obj['image_url']
        except Exception as e:
            log(f"  ⚠ Card extraction error: {e}")
        return None
    
    def extract_media_list(media_obj):
        """Safely extract media list with full protection"""
        if not media_obj:
            return []
        try:
            if isinstance(media_obj, dict):
                if 'photo' in media_obj:
                    return media_obj['photo'] if isinstance(media_obj['photo'], list) else [media_obj['photo']]
                elif 'video' in media_obj:
                    return media_obj['video'] if isinstance(media_obj['video'], list) else [media_obj['video']]
                else:
                    return [media_obj]
            elif isinstance(media_obj, list):
                return media_obj
        except Exception as e:
            log(f"  ⚠ Media extraction error: {e}")
        return []
    
    # Step 1: Check current tweet's card (highest priority for cover)
    card = tweet.get('card')
    card_image_url = extract_card_image(card)
    
    # Step 2: Check current tweet's regular media
    media = extract_media_list(tweet.get('media'))
    
    # Step 3: If this is a retweet, also check retweeted tweet
    retweeted_tweet = tweet.get('retweeted_tweet')
    if retweeted_tweet and isinstance(retweeted_tweet, dict):
        # Check retweeted tweet's media if no media in current tweet
        if not media:
            media = extract_media_list(retweeted_tweet.get('media'))
            if media:
                log(f"  📎 Using media from retweeted tweet")
        
        # Check retweeted tweet's card if no card image yet
        if not card_image_url:
            card_image_url = extract_card_image(retweeted_tweet.get('card'))
            if card_image_url:
                log(f"  📎 Using card image from retweeted tweet")
    
    downloaded_images = []
    video_path = None
    has_video = False
    video_thumbnail_url = None  # Store video thumbnail URL
    video_duration = 0
    is_long_video_flag = False
    
    # Track if we used card image
    used_card_image = False
    
    # First pass: collect media info
    # Priority 1: Download card image first (if available)
    if card_image_url:
        log(f"  📎 Card image found, downloading...")
        card_img_path = os.path.join(folder_path, 'image_0.jpg')
        if download_image(card_image_url, card_img_path):
            downloaded_images.append(card_img_path)
            log(f"  ✓ Downloaded card image (priority)")
            used_card_image = True
    
    # Priority 2: Process regular media (if no card image or additional media)
    if media:
        start_idx = 1 if used_card_image else 0  # Start from image_1 if card was downloaded
        for i, m in enumerate(list(media)[:4]):
            if isinstance(m, dict):
                if m.get('type') == 'video' or 'video_info' in m or 'variants' in m:
                    has_video = True
                    # Get video thumbnail URL (priority: avoid downloading full video)
                    video_thumbnail_url = m.get('media_url_https')
                    
                    # Get video duration if available
                    video_info = m.get('video_info', {})
                    duration_millis = video_info.get('duration_millis', 0)
                    video_duration = duration_millis / 1000  # Convert to seconds
                    
                    # Check if it's a long video (>3min)
                    if video_duration > 180:
                        is_long_video_flag = True
                        log(f"  ⏱️ Long video detected ({int(video_duration//60)}:{int(video_duration%60):02d} > 3min), will use thumbnail only")
                else:
                    # It's an image
                    url = m.get('media_url_https') or m.get('url')
                    if url:
                        img_idx = start_idx + i
                        img_path = os.path.join(folder_path, f'image_{img_idx}.jpg')
                        if download_image(url, img_path):
                            downloaded_images.append(img_path)
                            log(f"  ✓ Downloaded image {img_idx + 1}")
    
    # Handle video download (only for short videos that need deep analysis)
    if has_video and video_thumbnail_url:
        # Strategy: Use thumbnail for cover, only download video if needed for analysis
        if not is_long_video_flag:
            # Short video: download for full analysis
            log(f"  🎬 Short video detected ({int(video_duration)}s), downloading for analysis...")
            
            # Find video URL from variants
            video_url = None
            for m in list(media)[:4]:
                if isinstance(m, dict) and (m.get('type') == 'video' or 'variants' in m):
                    variants = m.get('variants', [])
                    mp4_variants = [v for v in variants if v.get('content_type') == 'video/mp4']
                    if mp4_variants:
                        best = max(mp4_variants, key=lambda x: x.get('bitrate', 0))
                        video_url = best.get('url')
                        break
            
            if video_url:
                video_path = os.path.join(folder_path, 'video.mp4')
                if download_video(video_url, video_path):
                    file_size = os.path.getsize(video_path)/1024
                    log(f"  ✓ Video downloaded: {file_size:.1f}KB")
                else:
                    log(f"  ✗ Video download failed, will use thumbnail")
                    video_path = None
        else:
            # Long video: skip download, use thumbnail only
            log(f"  🎬 Using video thumbnail (no download needed)")
    
    # Create cover
    cover_path = os.path.join(folder_path, 'cover.jpg')
    
    # Priority 1: Use card image as cover (if available)
    if used_card_image and downloaded_images:
        log(f"  Using card image as cover (priority)...")
        # Card image is already image_0.jpg, use it directly
        card_img_path = downloaded_images[0]
        if card_img_path != cover_path:
            import shutil
            shutil.copy2(card_img_path, cover_path)
        log(f"  ✓ Card image set as cover")
    elif has_video and video_thumbnail_url:
        # Priority 2: Use video thumbnail URL (no download needed)
        log(f"  Downloading video thumbnail...")
        if download_image(video_thumbnail_url, cover_path):
            log(f"  ✓ Video thumbnail downloaded")
            # If we also have a downloaded video, create a better cover from it
            if video_path and os.path.exists(video_path):
                log(f"  Extracting better cover from video...")
                if not create_video_cover(video_path, cover_path):
                    # If extraction fails, keep the thumbnail
                    pass
        else:
            log(f"  ✗ Thumbnail download failed, trying alternatives...")
            if video_path and os.path.exists(video_path):
                if not create_video_cover(video_path, cover_path):
                    url = get_cover_for_category(category)
                    download_image(url, cover_path)
            else:
                url = get_cover_for_category(category)
                download_image(url, cover_path)
    elif has_video and video_path and os.path.exists(video_path):
        # Fallback: Extract from downloaded video
        log(f"  Extracting video cover...")
        if not create_video_cover(video_path, cover_path):
            url = get_cover_for_category(category)
            download_image(url, cover_path)
    elif downloaded_images:
        log(f"  Creating cover ({len(downloaded_images)} images)...")
        if not create_1x1_cover(downloaded_images, cover_path):
            url = get_cover_for_category(category)
            download_image(url, cover_path)
    else:
        url = get_cover_for_category(category)
        download_image(url, cover_path)
    
    # Extract comments
    comments = extract_top_comments(tweet_id, api)
    
    stats = {
        'likes': tweet.get('favorites', 0),
        'retweets': tweet.get('retweets', 0),
        'replies': tweet.get('replies', 0),
        'views': str(tweet.get('views', '0')).replace(',', '')
    }
    
    author_data = tweet.get('author', {})
    author_name = author_data.get('name', author) if isinstance(author_data, dict) else author
    
    is_rt = text.strip().upper().startswith('RT ')
    original_content = extract_original_from_rt(text)
    
    # Determine if we should skip deep video analysis
    # (already determined during media collection based on duration from API)
    skip_video_analysis = is_long_video_flag
    
    # Kimi analysis
    # For long videos without downloaded video, use the thumbnail for analysis
    media_files = downloaded_images[:]
    if video_path and os.path.exists(video_path):
        media_files.append(video_path)
    elif video_thumbnail_url and skip_video_analysis:
        # For long videos, download thumbnail temporarily for analysis
        temp_thumbnail = os.path.join(folder_path, 'video_thumbnail.jpg')
        if download_image(video_thumbnail_url, temp_thumbnail):
            media_files.append(temp_thumbnail)
    
    kimi_result = analyze_with_kimi(media_files, original_content, folder_path, language, analyze_audio, skip_video_analysis)
    
    kimi_analysis_text = kimi_result.get('full_analysis', '')
    media_analysis = kimi_result.get('media_analysis', '')
    audio_analysis = kimi_result.get('audio_analysis', '')
    extracted_title = kimi_result.get('title')
    suggested_title = extracted_title or ('[Pending Title]' if language == 'en' else '[待优化标题]')
    
    # Get video duration for post.json (already obtained from API or re-measure if needed)
    if has_video and video_path and os.path.exists(video_path) and video_duration == 0:
        video_duration = get_video_duration(video_path)
    
    # Build content
    if language == 'en':
        content_parts = [
            f"[Tweet Content]\n{original_content[:500]}\n",
        ]
        if media_analysis:
            content_parts.append(f"\n[Media Analysis]\n{media_analysis}\n")
        if audio_analysis:
            content_parts.append(f"\n[Audio Analysis]\n{audio_analysis}\n")
        content_parts.append(f"\n[Deep Analysis]\n{kimi_analysis_text}\n" if kimi_analysis_text else "")
        content_parts.append(f"\n[Statistics]\nLikes: {stats['likes']} | Retweets: {stats['retweets']} | Replies: {stats['replies']}\n")
        if comments:
            content_parts.append(f"\n[Top {len(comments)} Comments]\n")
            for i, c in enumerate(comments, 1):
                content_parts.append(f"{i}. @{c['author_screen']}: {c['text'][:60]}{'...' if len(c['text']) > 60 else ''} (👍{c['likes']})\n")
        full_content = ''.join(content_parts)
        
        data = {
            'platform': 'X (Twitter)',
            'title': suggested_title,
            'topic': suggested_title,
            'category': category,
            'author': {'username': f"@{author}", 'name': author_name},
            'description': original_content[:300],
            'content': full_content,
            'is_retweet': is_rt,
            'stats': stats,
            'comments': comments,
            'comments_count': len(comments),
            'url': f"https://x.com/{author}/status/{tweet_id}",
            'original_url': f"https://x.com/{author}/status/{tweet_id}",
            'created_at': tweet.get('created_at', datetime.now().isoformat()),
            'fetched_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'has_media': len(media) > 0 or used_card_image,
            'has_video': has_video,
            'media_count': len(media) + (1 if used_card_image else 0),
            'video_duration': video_duration,
            'status': 'COMPLETED' if extracted_title else 'PENDING_TITLE',
            'kimi_analysis': kimi_analysis_text,
            'media_analysis': media_analysis,
            'audio_analysis': audio_analysis
        }
    else:
        content_parts = [
            f"【推文内容】\n{original_content[:500]}\n",
        ]
        if media_analysis:
            content_parts.append(f"\n【媒体分析】\n{media_analysis}\n")
        if audio_analysis:
            content_parts.append(f"\n【音频分析】\n{audio_analysis}\n")
        content_parts.append(f"\n【深度分析】\n{kimi_analysis_text}\n" if kimi_analysis_text else "")
        content_parts.append(f"\n【统计数据】\n赞: {stats['likes']} | 转发: {stats['retweets']} | 评论: {stats['replies']}\n")
        if comments:
            content_parts.append(f"\n【热门评论 Top {len(comments)}】\n")
            for i, c in enumerate(comments, 1):
                content_parts.append(f"{i}. @{c['author_screen']}: {c['text'][:60]}{'...' if len(c['text']) > 60 else ''} (👍{c['likes']})\n")
        full_content = ''.join(content_parts)
        
        data = {
            'platform': 'X (Twitter)',
            'title': suggested_title,
            'topic': suggested_title,
            'category': category,
            'author': {'username': f"@{author}", 'name': author_name},
            'description': original_content[:300],
            'content': full_content,
            'is_retweet': is_rt,
            'stats': stats,
            'comments': comments,
            'comments_count': len(comments),
            'url': f"https://x.com/{author}/status/{tweet_id}",
            'original_url': f"https://x.com/{author}/status/{tweet_id}",
            'created_at': tweet.get('created_at', datetime.now().isoformat()),
            'fetched_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'has_media': len(media) > 0 or used_card_image,
            'has_video': has_video,
            'media_count': len(media) + (1 if used_card_image else 0),
            'video_duration': video_duration,
            'status': 'COMPLETED' if extracted_title else 'PENDING_TITLE',
            'kimi_analysis': kimi_analysis_text,
            'media_analysis': media_analysis,
            'audio_analysis': audio_analysis
        }
    
    # Save post.json
    json_path = os.path.join(folder_path, 'post.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    # Rename folder if title extracted
    new_folder_path = folder_path
    if extracted_title:
        new_folder_name = sanitize_folder_name(extracted_title)
        new_folder_path = os.path.join(HOT_TOPICS, category, new_folder_name)
        
        counter = 1
        original_new_path = new_folder_path
        while os.path.exists(new_folder_path) and new_folder_path != folder_path:
            new_folder_path = f"{original_new_path}_{counter}"
            counter += 1
        
        try:
            if new_folder_path != folder_path:
                os.rename(folder_path, new_folder_path)
                log(f"  ✓ Renamed folder: {os.path.basename(folder_path)} -> {os.path.basename(new_folder_path)}")
        except Exception as e:
            log(f"  ⚠ Failed to rename folder: {e}")
            new_folder_path = folder_path
    
    return {
        'folder': new_folder_path,
        'category': category,
        'temp_topic': temp_name,
        'comments_count': len(comments),
        'has_video': has_video,
        'image_count': len(downloaded_images),
        'status': 'COMPLETED' if extracted_title else 'PENDING_TITLE',
        'language': language,
        'suggested_title': suggested_title
    }


def extract_tweet_meta_from_url(url):
    """Extract tweet ID + screen_name from URL"""
    patterns = [
        r'twitter\.com/([A-Za-z0-9_]+)/status/(\d+)',
        r'x\.com/([A-Za-z0-9_]+)/status/(\d+)',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(2), match.group(1)
    return None, None


def fetch_by_url(url, api, language=None, analyze_audio=False):
    """Fetch single tweet by URL"""
    tweet_id, screen_name = extract_tweet_meta_from_url(url)
    if not tweet_id:
        log(f"  ✗ Cannot extract tweet ID from URL: {url}")
        return None
    
    log(f"  Fetching tweet ID: {tweet_id}")
    if screen_name:
        log(f"  Resolving via timeline: @{screen_name}")
    result = api.twitter_get_tweet_from_user_posts(screen_name, tweet_id) if screen_name else {'code': 404}
    if result.get('code') != 200:
        log(f"  ⚠ Timeline resolve failed ({result.get('code')}), fallback to fetch_tweet_detail")
        result = api.twitter_get_tweet_detail(tweet_id)
    
    if result.get('code') != 200:
        log(f"  ✗ API error: {result.get('code')}")
        return None
    
    tweet = result.get('data', {})
    author = tweet.get('author', {}).get('screen_name', 'unknown')
    
    # Auto-detect language
    if not language:
        text = tweet.get('text', '')
        language = 'zh' if any('\u4e00' <= c <= '\u9fff' for c in text) else 'en'
        log(f"  Auto-detected language: {language}")
    
    return process_tweet(tweet, author, api, language=language, analyze_audio=analyze_audio)


def fetch_by_user(username, api, count=1, language=None, analyze_audio=False):
    """Fetch user's latest N tweets"""
    log(f"\nFetching @{username}'s latest {count} tweet(s)...")
    
    result = api.twitter_get_user_posts(username, limit=max(count * 2, 5))
    
    if result.get('code') != 200:
        log(f"  ✗ API error: {result.get('code')}")
        return []
    
    timeline = result.get('data', {}).get('timeline', [])
    if not timeline:
        log(f"  ✗ No tweets found")
        return []
    
    results = []
    for tweet in timeline[:count]:
        try:
            lang = language
            if not lang:
                text = tweet.get('text', '')
                lang = 'zh' if any('\u4e00' <= c <= '\u9fff' for c in text) else 'en'
            
            info = process_tweet(tweet, username, api, language=lang, analyze_audio=analyze_audio)
            results.append(info)
            log(f"  ✓ Saved: {info['suggested_title'][:50]}...")
        except Exception as e:
            log(f"  ✗ Error processing tweet: {e}")
    
    return results


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Hot Topics Fetcher - Smart tweet collection')
    parser.add_argument('--url', help='Fetch specific tweet by URL')
    parser.add_argument('--user', help='Fetch tweets from specific user')
    parser.add_argument('--count', type=int, default=1, help='Number of tweets to fetch (for --user)')
    parser.add_argument('--lang', choices=['zh', 'en'], help='Force language (zh/en)')
    parser.add_argument('--random', action='store_true', help='Random selection mode (legacy)')
    parser.add_argument('--analyze-audio', action='store_true', help='Analyze audio content (requires whisper)')
    
    args = parser.parse_args()
    
    log("=" * 60)
    log("Hot Topics Fetcher v3.0 - Smart Mode")
    log("=" * 60)
    
    api = TikHubAPI()
    results = []
    
    if args.url:
        log(f"\n📎 Fetching specific tweet:")
        log(f"   URL: {args.url}")
        info = fetch_by_url(args.url, api, args.lang, args.analyze_audio)
        if info:
            results.append(info)
    
    elif args.user:
        log(f"\n👤 Fetching from user: @{args.user}")
        user_results = fetch_by_user(args.user, api, args.count, args.lang, args.analyze_audio)
        results.extend(user_results)
    
    else:
        # Default: random mode
        log("Loading knowledge base...")
        categories = load_categories()
        
        if not categories:
            log("No knowledge base found, using default user")
            categories = {'Trending': {'users': ['dotey'], 'files': []}}
        
        all_users = []
        for cat, data in categories.items():
            all_users.extend(data['users'])
            log(f"Category [{cat}]: {len(data['users'])} users")
        
        all_users = list(set(all_users))
        
        if not all_users:
            log("No users found")
            return
        
        num_to_check = random.randint(1, min(5, len(all_users)))
        selected_users = random.sample(all_users, num_to_check)
        
        log(f"\n🎲 Random mode: Checking {num_to_check} users")
        
        for username in selected_users:
            user_results = fetch_by_user(username, api, count=1, analyze_audio=args.analyze_audio)
            results.extend(user_results)
    
    log("\n" + "=" * 60)
    log(f"✅ Complete! Processed {len(results)} tweet(s)")
    log("=" * 60)
    
    for r in results:
        folder_name = os.path.basename(r['folder'])
        log(f"  • [{r['category']}] {folder_name}")
    
    return results


if __name__ == '__main__':
    main()
