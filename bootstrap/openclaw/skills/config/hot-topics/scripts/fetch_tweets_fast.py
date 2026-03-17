#!/usr/bin/env python3
"""
Hot Topics Fetcher v4.0 - HIGH PERFORMANCE VERSION
Features: Async I/O, Concurrent Processing, Connection Pooling, Caching
"""

import sys
import os
import re
import json
import random
import subprocess
import shutil
import urllib.parse
import asyncio
import aiohttp
import aiofiles
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
from functools import lru_cache, partial
import hashlib
import time
from typing import List, Dict, Optional, Tuple
import multiprocessing as mp

def resolve_kb_paths():
    raw = os.environ.get("HOT_TOPICS_KB_PATH", "~/Documents/知识库/热门话题")
    expanded = os.path.expanduser(raw)
    normalized = os.path.normpath(expanded)
    if os.path.basename(normalized) == '热门话题':
        hot_topics_root = normalized
        knowledge_base_root = os.path.dirname(normalized)
    else:
        knowledge_base_root = normalized
        hot_topics_root = os.path.join(knowledge_base_root, '热门话题')
    return knowledge_base_root, hot_topics_root

# Configuration
TIKHUB_API_KEY = os.environ.get("TIKHUB_API_KEY", "")
TIKHUB_BASE_URL = "https://api.tikhub.io"

KNOWLEDGE_BASE, HOT_TOPICS = resolve_kb_paths()
MY_ASSISTANT = os.path.join(KNOWLEDGE_BASE, '我的助手')
CACHE_DIR = os.path.join(KNOWLEDGE_BASE, '.hot_topics_cache')
os.makedirs(CACHE_DIR, exist_ok=True)

# Performance settings
MAX_CONCURRENT_DOWNLOADS = 8
MAX_CONCURRENT_ANALYSIS = 4
MAX_WORKERS = min(8, mp.cpu_count())
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=30, connect=10)

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
        'https://images.unsplash.com/photo-1461896836934-voices-0041080a?w=800&h=800&fit=crop'
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


# ============== Logging ==============

def log(msg):
    """Print timestamped log"""
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


class Timer:
    """Context manager for timing operations"""
    def __init__(self, name):
        self.name = name
        self.start = None
    
    def __enter__(self):
        self.start = time.time()
        return self
    
    def __exit__(self, *args):
        elapsed = time.time() - self.start
        log(f"⏱️ {self.name}: {elapsed:.2f}s")


# ============== Cache System ==============

class SimpleCache:
    """File-based cache for analysis results"""
    
    def __init__(self, cache_dir=CACHE_DIR):
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)
    
    def _get_key(self, *args) -> str:
        """Generate cache key from arguments"""
        content = '|'.join(str(a) for a in args)
        return hashlib.md5(content.encode()).hexdigest()
    
    def get(self, *args) -> Optional[Dict]:
        """Get cached result"""
        key = self._get_key(*args)
        cache_file = os.path.join(self.cache_dir, f"{key}.json")
        
        if os.path.exists(cache_file):
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    # Check if cache is still fresh (7 days)
                    if time.time() - data.get('timestamp', 0) < 7 * 86400:
                        return data.get('result')
            except:
                pass
        return None
    
    def set(self, result, *args):
        """Cache result"""
        key = self._get_key(*args)
        cache_file = os.path.join(self.cache_dir, f"{key}.json")
        
        try:
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump({
                    'timestamp': time.time(),
                    'result': result
                }, f, ensure_ascii=False)
        except:
            pass


cache = SimpleCache()


# ============== Async TikHub API Client ==============

class AsyncTikHubAPI:
    """Async TikHub API Client with connection pooling"""
    
    def __init__(self, api_key=None, base_url=None):
        self.api_key = api_key or TIKHUB_API_KEY
        self.base_url = base_url or TIKHUB_BASE_URL
        self.session = None
    
    async def __aenter__(self):
        connector = aiohttp.TCPConnector(
            limit=20,
            limit_per_host=10,
            ttl_dns_cache=300,
            use_dns_cache=True,
        )
        self.session = aiohttp.ClientSession(
            connector=connector,
            timeout=REQUEST_TIMEOUT,
            headers={
                'Authorization': f'Bearer {self.api_key}',
                'Content-Type': 'application/json'
            }
        )
        return self
    
    async def __aexit__(self, *args):
        if self.session:
            await self.session.close()
    
    async def _request(self, endpoint, params=None) -> Dict:
        """Make async HTTP request"""
        try:
            url = f"{self.base_url}{endpoint}"
            async with self.session.get(url, params=params) as response:
                return await response.json()
        except Exception as e:
            return {'code': 500, 'message': str(e)}
    
    async def twitter_get_tweet_detail(self, tweet_id: str) -> Dict:
        """Get tweet detail by ID"""
        return await self._request('/api/v1/twitter/web/fetch_tweet_detail', {'tweet_id': tweet_id})
    
    async def twitter_get_user_posts(self, screen_name: str, limit: int = 5) -> Dict:
        """Get user's posts"""
        return await self._request('/api/v1/twitter/web/fetch_user_post_tweet', {
            'screen_name': screen_name,
            'limit': limit
        })
    
    async def twitter_get_comments(self, tweet_id: str) -> Dict:
        """Get tweet comments"""
        return await self._request('/api/v1/twitter/web/fetch_post_comments', {'tweet_id': tweet_id})


# ============== Async Media Downloader ==============

class AsyncMediaDownloader:
    """Async media downloader with concurrent limits"""
    
    def __init__(self, session: aiohttp.ClientSession, max_concurrent=MAX_CONCURRENT_DOWNLOADS):
        self.session = session
        self.semaphore = asyncio.Semaphore(max_concurrent)
    
    async def download_image(self, url: str, output_path: str) -> bool:
        """Download image with semaphore control"""
        async with self.semaphore:
            try:
                async with self.session.get(url, timeout=15) as response:
                    if response.status == 200:
                        async with aiofiles.open(output_path, 'wb') as f:
                            await f.write(await response.read())
                        return os.path.exists(output_path) and os.path.getsize(output_path) > 1000
            except Exception as e:
                pass
            return False
    
    async def download_video(self, url: str, output_path: str) -> bool:
        """Download video with streaming"""
        async with self.semaphore:
            try:
                async with self.session.get(url, timeout=60) as response:
                    if response.status == 200:
                        async with aiofiles.open(output_path, 'wb') as f:
                            async for chunk in response.content.iter_chunked(8192):
                                await f.write(chunk)
                        return os.path.exists(output_path) and os.path.getsize(output_path) > 10000
            except Exception as e:
                pass
            return False
    
    async def download_multiple(self, urls_paths: List[Tuple[str, str]]) -> List[bool]:
        """Download multiple files concurrently"""
        tasks = [self.download_image(url, path) for url, path in urls_paths]
        return await asyncio.gather(*tasks, return_exceptions=True)


# ============== Concurrent Tweet Processor ==============

class ConcurrentTweetProcessor:
    """Process tweets concurrently with resource management"""
    
    def __init__(self, api: AsyncTikHubAPI, max_concurrent=MAX_CONCURRENT_ANALYSIS):
        self.api = api
        self.max_concurrent = max_concurrent
        self.analysis_semaphore = asyncio.Semaphore(max_concurrent)
    
    async def process_user_tweets(self, username: str, count: int = 1, 
                                   language: str = None, analyze_audio: bool = False) -> List[Dict]:
        """Fetch and process user's tweets concurrently"""
        log(f"\n👤 Fetching @{username}'s tweets...")
        
        # Fetch user posts
        result = await self.api.twitter_get_user_posts(username, limit=max(count * 2, 5))
        
        if result.get('code') != 200:
            log(f"  ✗ API error: {result.get('code')}")
            return []
        
        timeline = result.get('data', {}).get('timeline', [])
        if not timeline:
            log(f"  ✗ No tweets found")
            return []
        
        # Process tweets concurrently
        tweets_to_process = timeline[:count]
        tasks = []
        
        for tweet in tweets_to_process:
            lang = language
            if not lang:
                text = tweet.get('text', '')
                lang = 'zh' if any('\u4e00' <= c <= '\u9fff' for c in text) else 'en'
            
            task = self._process_tweet_with_semaphore(
                tweet, username, lang, analyze_audio
            )
            tasks.append(task)
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Filter out exceptions
        valid_results = []
        for r in results:
            if isinstance(r, Exception):
                log(f"  ✗ Error: {r}")
            elif r:
                valid_results.append(r)
        
        return valid_results
    
    async def _process_tweet_with_semaphore(self, tweet: Dict, author: str, 
                                            language: str, analyze_audio: bool) -> Optional[Dict]:
        """Process single tweet with concurrency control"""
        async with self.analysis_semaphore:
            return await process_tweet_async(
                tweet, author, self.api, language, analyze_audio
            )


# ============== Optimized Analysis Functions ==============

async def analyze_with_kimi_async(media_files: List[str], text_content: str, 
                                   folder_path: str, language: str = 'zh',
                                   analyze_audio: bool = False, 
                                   skip_video_analysis: bool = False) -> Dict:
    """Async version of Kimi analysis with caching"""
    
    # Check cache first
    cache_key = (text_content[:200], ','.join(sorted(media_files)), language, skip_video_analysis)
    cached = cache.get(*cache_key)
    if cached:
        log(f"  💾 Using cached analysis")
        return cached
    
    # Run Kimi analysis in thread pool to not block
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: _analyze_with_kimi_sync(
            media_files, text_content, folder_path, 
            language, analyze_audio, skip_video_analysis
        )
    )
    
    # Cache result
    cache.set(result, *cache_key)
    return result


def _analyze_with_kimi_sync(media_files: List[str], text_content: str,
                            folder_path: str, language: str,
                            analyze_audio: bool, skip_video_analysis: bool) -> Dict:
    """Synchronous Kimi analysis (runs in thread pool)"""
    # This is the original analyze_with_kimi function, kept for compatibility
    # Import the original function to avoid code duplication
    try:
        from fetch_tweets import analyze_with_kimi
        return analyze_with_kimi(media_files, text_content, folder_path, 
                                  language, analyze_audio, skip_video_analysis)
    except ImportError:
        # Fallback if import fails
        return {
            'full_analysis': "Analysis unavailable",
            'media_analysis': "",
            'title': generate_fallback_title(text_content, language),
            'audio_analysis': ""
        }


def generate_fallback_title(text: str, language: str = 'zh') -> str:
    """Generate fallback title when Kimi fails"""
    clean_text = re.sub(r'https?://\S+', '', text)
    clean_text = re.sub(r'RT\s+@\w+:\s*', '', clean_text)
    clean_text = clean_text.strip()
    
    base = clean_text[:30] if len(clean_text) > 30 else clean_text
    
    if language == 'en':
        emojis = ['🔥', '💡', '📌', '✨', '🎯']
        title = f"{random.choice(emojis)} {base[:40]}..." if len(base) > 40 else f"{random.choice(emojis)} {base}"
    else:
        emojis = ['🔥', '💡', '📌', '✨', '🎯', '🤔', '👀']
        title = f"{random.choice(emojis)}{base[:25]}..." if len(base) > 25 else f"{random.choice(emojis)}{base}"
    
    return title.strip()


# ============== Fast Media Processing ==============

async def process_media_fast(tweet: Dict, folder_path: str, 
                              downloader: AsyncMediaDownloader) -> Dict:
    """Process media files concurrently"""
    
    # Extract media info
    card = tweet.get('card')
    media = tweet.get('media', [])
    
    # Handle retweets
    retweeted = tweet.get('retweeted_tweet', {})
    if retweeted:
        if not media:
            media = retweeted.get('media', [])
        if not card:
            card = retweeted.get('card')
    
    downloaded_images = []
    download_tasks = []
    has_video = False
    video_info = None
    
    # Process card image
    if card and isinstance(card, dict):
        card_img = card.get('media', {}).get('image_url') if card.get('media') else card.get('image_url')
        if card_img:
            img_path = os.path.join(folder_path, 'image_0.jpg')
            download_tasks.append((card_img, img_path, 'card'))
    
    # Process media
    if isinstance(media, dict):
        media = media.get('photo', []) or media.get('video', []) or []
    
    for i, m in enumerate(list(media)[:4]):
        if isinstance(m, dict):
            if m.get('type') == 'video' or 'variants' in m:
                has_video = True
                video_info = {
                    'thumbnail': m.get('media_url_https'),
                    'duration': m.get('video_info', {}).get('duration_millis', 0) / 1000,
                    'variants': m.get('variants', [])
                }
            else:
                url = m.get('media_url_https') or m.get('url')
                if url:
                    img_path = os.path.join(folder_path, f'image_{len(download_tasks)}.jpg')
                    download_tasks.append((url, img_path, 'image'))
    
    # Execute all downloads concurrently
    if download_tasks:
        urls_paths = [(t[0], t[1]) for t in download_tasks]
        results = await downloader.download_multiple(urls_paths)
        
        for i, success in enumerate(results):
            if success:
                downloaded_images.append(download_tasks[i][1])
    
    return {
        'images': downloaded_images,
        'has_video': has_video,
        'video_info': video_info
    }


# ============== Main Async Processing Function ==============

async def process_tweet_async(tweet: Dict, author: str, api: AsyncTikHubAPI,
                               language: str = 'zh', analyze_audio: bool = False) -> Optional[Dict]:
    """Async version of process_tweet"""
    
    text = tweet.get('text', '')
    tweet_id = tweet.get('tweet_id') or tweet.get('id', '')
    
    # Quick categorization
    category = smart_categorize_fast(text, author)
    
    # Create folder
    temp_id = datetime.now().strftime('%H%M%S')
    temp_name = f"_pending_{author}_{temp_id}"
    folder_path = os.path.join(HOT_TOPICS, category, temp_name)
    os.makedirs(folder_path, exist_ok=True)
    
    try:
        # Create downloader
        async with aiohttp.ClientSession() as download_session:
            downloader = AsyncMediaDownloader(download_session)
            
            # Process media concurrently
            media_result = await process_media_fast(tweet, folder_path, downloader)
            
            # Download video if needed (short videos only)
            video_path = None
            if media_result['has_video'] and media_result['video_info']:
                vi = media_result['video_info']
                if vi['duration'] <= 180:  # Short video
                    mp4_variants = [v for v in vi['variants'] if v.get('content_type') == 'video/mp4']
                    if mp4_variants:
                        best = max(mp4_variants, key=lambda x: x.get('bitrate', 0))
                        video_url = best.get('url')
                        if video_url:
                            video_path = os.path.join(folder_path, 'video.mp4')
                            if not await downloader.download_video(video_url, video_path):
                                video_path = None
            
            # Get comments concurrently with other operations
            comments_task = api.twitter_get_comments(tweet_id)
            comments_result = await comments_task
            
            comments = []
            if comments_result.get('code') == 200:
                thread = comments_result.get('data', {}).get('thread', [])
                sorted_comments = sorted(thread, key=lambda x: x.get('likes') or 0, reverse=True)
                comments = [{
                    'author': c.get('author', {}).get('name', 'Unknown'),
                    'author_screen': c.get('author', {}).get('screen_name', ''),
                    'text': c.get('text', ''),
                    'likes': c.get('likes', 0),
                    'replies': c.get('replies', 0)
                } for c in sorted_comments[:10]]
        
        # Prepare media for analysis
        media_files = media_result['images'][:]
        if video_path and os.path.exists(video_path):
            media_files.append(video_path)
        
        # Kimi analysis
        original_content = re.sub(r'^RT\s+@\w+:\s*', '', text, flags=re.IGNORECASE).strip()
        skip_video = media_result['has_video'] and media_result['video_info'] and media_result['video_info']['duration'] > 180
        
        kimi_result = await analyze_with_kimi_async(
            media_files, original_content, folder_path, 
            language, analyze_audio, skip_video
        )
        
        # Create cover
        cover_path = os.path.join(folder_path, 'cover.jpg')
        await create_cover_async(media_result['images'], media_result['video_info'], 
                                  video_path, cover_path, category)
        
        # Build and save data
        result = build_post_data(tweet, author, category, comments, kimi_result, 
                                  media_result, video_path, folder_path, language)
        
        # Rename folder
        new_folder_path = await rename_folder_async(folder_path, result['title'], category)
        result['folder'] = new_folder_path
        
        return result
        
    except Exception as e:
        log(f"  ✗ Error processing tweet: {e}")
        import traceback
        traceback.print_exc()
        return None


def smart_categorize_fast(text: str, author: str) -> str:
    """Fast categorization without heavy processing"""
    text_lower = (text + ' ' + author).lower()
    
    # Quick keyword checks
    if any(k in text_lower for k in ['military', 'defense', 'army', 'navy', 'war', 'weapon']):
        return 'Military'
    if any(k in text_lower for k in ['ai', 'gpt', 'claude', 'coding', 'software', 'tech']):
        return 'AI_Tech'
    if any(k in text_lower for k in ['economy', 'finance', 'stock', 'market', 'crypto']):
        return 'Finance'
    if any(k in text_lower for k in ['sports', 'nba', 'football', 'game', 'match']):
        return 'Sports'
    if any(k in text_lower for k in ['movie', 'film', 'music', 'celebrity', 'hollywood']):
        return 'Entertainment'
    
    return 'Trending'


async def create_cover_async(images: List[str], video_info: Dict, video_path: str,
                              cover_path: str, category: str):
    """Async cover creation"""
    loop = asyncio.get_event_loop()
    
    # Try images first
    if images:
        result = await loop.run_in_executor(
            None, lambda: create_1x1_cover_sync(images, cover_path)
        )
        if result:
            return
    
    # Try video thumbnail
    if video_info and video_info.get('thumbnail'):
        async with aiohttp.ClientSession() as session:
            downloader = AsyncMediaDownloader(session)
            if await downloader.download_image(video_info['thumbnail'], cover_path):
                return
    
    # Fallback to category default
    default_url = random.choice(COVER_POOL.get(category, COVER_POOL['Default']))
    async with aiohttp.ClientSession() as session:
        downloader = AsyncMediaDownloader(session)
        await downloader.download_image(default_url, cover_path)


def create_1x1_cover_sync(image_paths: List[str], output_path: str) -> bool:
    """Synchronous cover creation (runs in executor)"""
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


def build_post_data(tweet: Dict, author: str, category: str, comments: List[Dict],
                    kimi_result: Dict, media_result: Dict, video_path: str,
                    folder_path: str, language: str) -> Dict:
    """Build post data structure"""
    
    text = tweet.get('text', '')
    tweet_id = tweet.get('tweet_id') or tweet.get('id', '')
    original_content = re.sub(r'^RT\s+@\w+:\s*', '', text, flags=re.IGNORECASE).strip()
    is_rt = text.strip().upper().startswith('RT ')
    
    title = kimi_result.get('title') or generate_fallback_title(text, language)
    
    stats = {
        'likes': tweet.get('favorites', 0),
        'retweets': tweet.get('retweets', 0),
        'replies': tweet.get('replies', 0),
        'views': str(tweet.get('views', '0')).replace(',', '')
    }
    
    author_data = tweet.get('author', {})
    author_name = author_data.get('name', author) if isinstance(author_data, dict) else author
    
    data = {
        'platform': 'X (Twitter)',
        'title': title,
        'topic': title,
        'category': category,
        'author': {'username': f"@{author}", 'name': author_name},
        'description': original_content[:300],
        'content': original_content,
        'is_retweet': is_rt,
        'stats': stats,
        'comments': comments,
        'comments_count': len(comments),
        'url': f"https://x.com/{author}/status/{tweet_id}",
        'created_at': tweet.get('created_at', datetime.now().isoformat()),
        'fetched_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'has_media': len(media_result['images']) > 0,
        'has_video': media_result['has_video'],
        'media_count': len(media_result['images']),
        'status': 'COMPLETED',
        'kimi_analysis': kimi_result.get('full_analysis', ''),
        'media_analysis': kimi_result.get('media_analysis', ''),
        'audio_analysis': kimi_result.get('audio_analysis', '')
    }
    
    # Save JSON
    json_path = os.path.join(folder_path, 'post.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    return {
        'folder': folder_path,
        'category': category,
        'title': title,
        'comments_count': len(comments),
        'has_video': media_result['has_video'],
        'image_count': len(media_result['images']),
        'status': 'COMPLETED',
        'language': language
    }


async def rename_folder_async(folder_path: str, title: str, category: str) -> str:
    """Async folder renaming"""
    from fetch_tweets import sanitize_folder_name
    
    new_name = sanitize_folder_name(title)
    new_path = os.path.join(HOT_TOPICS, category, new_name)
    
    counter = 1
    original_path = new_path
    while os.path.exists(new_path) and new_path != folder_path:
        new_path = f"{original_path}_{counter}"
        counter += 1
    
    if new_path != folder_path:
        try:
            os.rename(folder_path, new_path)
            return new_path
        except:
            pass
    
    return folder_path


# ============== Batch Processing ==============

async def process_multiple_users(usernames: List[str], tweets_per_user: int = 1,
                                  language: str = None, analyze_audio: bool = False) -> List[Dict]:
    """Process multiple users concurrently"""
    
    log(f"\n🚀 Batch processing {len(usernames)} users...")
    start_time = time.time()
    
    async with AsyncTikHubAPI() as api:
        processor = ConcurrentTweetProcessor(api)
        
        # Create tasks for all users
        tasks = [
            processor.process_user_tweets(
                username, tweets_per_user, language, analyze_audio
            )
            for username in usernames
        ]
        
        # Execute all concurrently
        results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Flatten results
    all_results = []
    for r in results:
        if isinstance(r, list):
            all_results.extend(r)
        elif isinstance(r, Exception):
            log(f"  ✗ User processing error: {r}")
    
    elapsed = time.time() - start_time
    log(f"\n✅ Batch complete: {len(all_results)} tweets in {elapsed:.1f}s ({len(all_results)/elapsed:.1f} tweets/s)")
    
    return all_results


# ============== Main Entry ==============

def load_categories_fast() -> Dict:
    """Fast category loading"""
    categories = {}
    if not os.path.exists(MY_ASSISTANT):
        return categories
    
    for item in os.listdir(MY_ASSISTANT):
        item_path = os.path.join(MY_ASSISTANT, item)
        if os.path.isdir(item_path):
            users = set()
            for root, dirs, files in os.walk(item_path):
                for f in files:
                    if f.endswith('.txt'):
                        try:
                            with open(os.path.join(root, f), 'r', encoding='utf-8') as fp:
                                users.update(re.findall(r'@([a-zA-Z0-9_]+)', fp.read()))
                        except:
                            pass
            if users:
                categories[item] = {'users': list(users)}
    
    return categories


async def main_async():
    """Async main entry"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Hot Topics Fetcher v4.0 - Fast Mode')
    parser.add_argument('--url', help='Fetch specific tweet by URL')
    parser.add_argument('--user', help='Fetch tweets from specific user')
    parser.add_argument('--users', help='Comma-separated list of users')
    parser.add_argument('--count', type=int, default=1, help='Tweets per user')
    parser.add_argument('--lang', choices=['zh', 'en'], help='Force language')
    parser.add_argument('--analyze-audio', action='store_true', help='Analyze audio')
    parser.add_argument('--batch', action='store_true', help='Batch mode (all users)')
    parser.add_argument('--max-users', type=int, default=10, help='Max users in batch')
    
    args = parser.parse_args()
    
    log("=" * 60)
    log("Hot Topics Fetcher v4.0 - HIGH PERFORMANCE MODE")
    log(f"Max concurrent: {MAX_CONCURRENT_DOWNLOADS} downloads, {MAX_CONCURRENT_ANALYSIS} analysis")
    log("=" * 60)
    
    results = []
    
    if args.url:
        # Single URL mode
        log(f"\n📎 Fetching: {args.url}")
        async with AsyncTikHubAPI() as api:
            tweet_id = re.search(r'(?:twitter|x)\.com/\w+/status/(\d+)', args.url)
            if tweet_id:
                result = await api.twitter_get_tweet_detail(tweet_id.group(1))
                if result.get('code') == 200:
                    tweet = result.get('data', {})
                    author = tweet.get('author', {}).get('screen_name', 'unknown')
                    lang = args.lang or ('zh' if any('\u4e00' <= c <= '\u9fff' 
                                                      for c in tweet.get('text', '')) else 'en')
                    info = await process_tweet_async(tweet, author, api, lang, args.analyze_audio)
                    if info:
                        results.append(info)
    
    elif args.user:
        # Single user mode
        async with AsyncTikHubAPI() as api:
            processor = ConcurrentTweetProcessor(api)
            results = await processor.process_user_tweets(
                args.user, args.count, args.lang, args.analyze_audio
            )
    
    elif args.users:
        # Multiple users mode
        users = [u.strip() for u in args.users.split(',')]
        results = await process_multiple_users(
            users, args.count, args.lang, args.analyze_audio
        )
    
    elif args.batch:
        # Batch mode - all users from knowledge base
        log("Loading knowledge base...")
        categories = load_categories_fast()
        
        all_users = set()
        for cat, data in categories.items():
            all_users.update(data['users'])
            log(f"  [{cat}]: {len(data['users'])} users")
        
        users = list(all_users)[:args.max_users]
        log(f"\n🚀 Processing {len(users)} users in batch mode...")
        
        results = await process_multiple_users(
            users, args.count, args.lang, args.analyze_audio
        )
    
    else:
        # Default: random selection
        categories = load_categories_fast()
        all_users = list(set(u for cat in categories.values() for u in cat['users']))
        
        if all_users:
            selected = random.sample(all_users, min(3, len(all_users)))
            log(f"\n🎲 Random mode: {len(selected)} users")
            results = await process_multiple_users(
                selected, 1, args.lang, args.analyze_audio
            )
    
    # Summary
    log("\n" + "=" * 60)
    log(f"✅ Complete! Processed {len(results)} tweet(s)")
    log("=" * 60)
    
    for r in results:
        log(f"  • [{r['category']}] {r.get('title', 'N/A')[:50]}...")
    
    return results


def main():
    """Entry point"""
    asyncio.run(main_async())


if __name__ == '__main__':
    main()
