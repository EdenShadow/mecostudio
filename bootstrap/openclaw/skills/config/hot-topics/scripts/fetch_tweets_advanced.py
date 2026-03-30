#!/usr/bin/env python3
"""
Hot Topics Fetcher v5.0 - ADVANCED EDITION
Features: Deduplication + Contextual Titles + Fast Concurrent Processing
"""

import sys
import os
import re
import json
import random
import asyncio
import aiohttp
import hashlib
import difflib
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional, Tuple

# Import fast components
from fetch_tweets_fast import (
    AsyncTikHubAPI, AsyncMediaDownloader, Timer, MAX_CONCURRENT_DOWNLOADS,
    MAX_CONCURRENT_ANALYSIS, REQUEST_TIMEOUT, process_media_fast,
    create_cover_async, rename_folder_async, build_post_data,
    load_categories_fast, smart_categorize_fast, generate_fallback_title
)

# Import contextual components
from fetch_tweets_contextual import (
    analyze_with_kimi_contextual, generate_contextual_fallback_title
)

# Import dedup components  
from fetch_tweets_dedup import DedupManager

# Configuration
KNOWLEDGE_BASE = os.environ.get("HOT_TOPICS_KB_PATH", os.path.expanduser("~/Documents/知识库"))
HOT_TOPICS = os.path.join(KNOWLEDGE_BASE, '热门话题')


def log(msg):
    """Print timestamped log"""
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ============== Advanced Tweet Processor ==============

class AdvancedTweetProcessor:
    """
    Combines:
    - Deduplication (check before processing)
    - Contextual titles (consider user query)
    - Fast async processing
    """
    
    def __init__(self, api: AsyncTikHubAPI, dedup_manager: DedupManager,
                 max_concurrent=MAX_CONCURRENT_ANALYSIS):
        self.api = api
        self.dedup = dedup_manager
        self.max_concurrent = max_concurrent
        self.analysis_semaphore = asyncio.Semaphore(max_concurrent)
    
    async def process_tweet_advanced(self, tweet: Dict, author: str, 
                                      language: str = 'zh', 
                                      analyze_audio: bool = False,
                                      user_query: str = None,
                                      force: bool = False) -> Optional[Dict]:
        """
        Process tweet with all advanced features
        
        Args:
            user_query: User's question/intent for contextual title
            force: Skip dedup check if True
        """
        text = tweet.get('text', '')
        tweet_id = tweet.get('tweet_id') or tweet.get('id', '')
        
        # Step 1: Deduplication check
        if not force:
            is_dup, existing = self.dedup.check_duplicate(tweet_id, text, author)
            if is_dup:
                log(f"  ⏭️ SKIPPING (duplicate) - Already exists: {existing.get('title', 'N/A')[:40]}...")
                return {
                    'skipped': True,
                    'reason': 'duplicate',
                    'existing_folder': existing.get('folder'),
                    'tweet_id': tweet_id,
                    'author': author
                }
        
        # Step 2: Quick categorization
        category = smart_categorize_fast(text, author)
        
        # Step 3: Create folder
        temp_id = datetime.now().strftime('%H%M%S')
        temp_name = f"_pending_{author}_{temp_id}"
        folder_path = os.path.join(HOT_TOPICS, category, temp_name)
        os.makedirs(folder_path, exist_ok=True)
        
        try:
            # Step 4: Async media processing
            async with aiohttp.ClientSession() as download_session:
                downloader = AsyncMediaDownloader(download_session)
                media_result = await process_media_fast(tweet, folder_path, downloader)
                
                # Download video if short
                video_path = None
                if media_result['has_video'] and media_result['video_info']:
                    vi = media_result['video_info']
                    if vi['duration'] <= 180:  # Short video
                        mp4_variants = [v for v in vi['variants'] 
                                        if v.get('content_type') == 'video/mp4']
                        if mp4_variants:
                            best = max(mp4_variants, key=lambda x: x.get('bitrate', 0))
                            video_url = best.get('url')
                            if video_url:
                                video_path = os.path.join(folder_path, 'video.mp4')
                                if not await downloader.download_video(video_url, video_path):
                                    video_path = None
                
                # Get comments concurrently
                comments_task = self.api.twitter_get_comments(tweet_id)
                comments_result = await comments_task
                
                comments = []
                if comments_result.get('code') == 200:
                    thread = comments_result.get('data', {}).get('thread', [])
                    sorted_comments = sorted(thread, 
                        key=lambda x: x.get('likes') or 0, reverse=True)
                    comments = [{
                        'author': c.get('author', {}).get('name', 'Unknown'),
                        'author_screen': c.get('author', {}).get('screen_name', ''),
                        'text': c.get('text', ''),
                        'likes': c.get('likes', 0),
                        'replies': c.get('replies', 0)
                    } for c in sorted_comments[:10]]
            
            # Step 5: Contextual Kimi analysis
            media_files = media_result['images'][:]
            if video_path and os.path.exists(video_path):
                media_files.append(video_path)
            
            original_content = re.sub(r'^RT\s+@\w+:\s*', '', text, 
                                       flags=re.IGNORECASE).strip()
            skip_video = (media_result['has_video'] and media_result['video_info'] 
                         and media_result['video_info']['duration'] > 180)
            
            # Use contextual analysis with user_query
            async with self.analysis_semaphore:
                loop = asyncio.get_event_loop()
                kimi_result = await loop.run_in_executor(
                    None,
                    lambda: analyze_with_kimi_contextual(
                        media_files, original_content, folder_path,
                        language, analyze_audio, skip_video, user_query
                    )
                )
            
            # Step 6: Create cover
            cover_path = os.path.join(folder_path, 'cover.jpg')
            await create_cover_async(media_result['images'], media_result['video_info'],
                                      video_path, cover_path, category)
            
            # Step 7: Build and save data
            result = build_post_data(tweet, author, category, comments, 
                                      kimi_result, media_result, video_path,
                                      folder_path, language)
            
            # Add contextual info
            result['user_query'] = user_query
            result['contextual_title'] = user_query is not None
            
            # Step 8: Rename folder
            new_folder_path = await rename_folder_async(
                folder_path, result['title'], category
            )
            result['folder'] = new_folder_path
            
            # Step 9: Add to dedup index
            if tweet_id:
                self.dedup.add_entry(
                    tweet_id=tweet_id,
                    folder_path=new_folder_path,
                    category=category,
                    title=result['title'],
                    author=author,
                    url=f"https://x.com/{author}/status/{tweet_id}"
                )
            
            return result
            
        except Exception as e:
            log(f"  ✗ Error: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    async def process_user_advanced(self, username: str, count: int = 1,
                                     language: str = None, 
                                     analyze_audio: bool = False,
                                     user_query: str = None,
                                     force: bool = False) -> List[Dict]:
        """Process user's tweets with all features"""
        log(f"\n👤 @{username} | Query: {user_query[:30] + '...' if user_query else 'None'}")
        
        # Fetch tweets
        result = await self.api.twitter_get_user_posts(username, limit=max(count * 2, 5))
        
        if result.get('code') != 200:
            log(f"  ✗ API error: {result.get('code')}")
            return []
        
        timeline = result.get('data', {}).get('timeline', [])
        if not timeline:
            log(f"  ✗ No tweets")
            return []
        
        # Process concurrently
        tasks = []
        for tweet in timeline[:count]:
            lang = language
            if not lang:
                text = tweet.get('text', '')
                lang = 'zh' if any('\u4e00' <= c <= '\u9fff' for c in text) else 'en'
            
            task = self.process_tweet_advanced(
                tweet, username, lang, analyze_audio, user_query, force
            )
            tasks.append(task)
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Filter results
        valid = []
        skipped = 0
        for r in results:
            if isinstance(r, Exception):
                log(f"  ✗ Error: {r}")
            elif r:
                if r.get('skipped'):
                    skipped += 1
                else:
                    valid.append(r)
        
        if skipped > 0:
            log(f"  ⏭️ Skipped {skipped} duplicates")
        
        return valid


# ============== Main Entry ==============

async def main_async():
    """Async main with all features"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Hot Topics v5.0 - Advanced (Deduplication + Contextual + Fast)'
    )
    parser.add_argument('--url', help='Fetch specific tweet URL')
    parser.add_argument('--user', help='Fetch tweets from user')
    parser.add_argument('--users', help='Comma-separated users')
    parser.add_argument('--count', type=int, default=1, help='Tweets per user')
    parser.add_argument('--lang', choices=['zh', 'en'], help='Force language')
    parser.add_argument('--query', help='User question/intent for contextual title')
    parser.add_argument('--analyze-audio', action='store_true', help='Analyze audio')
    parser.add_argument('--force', action='store_true', help='Skip dedup check')
    parser.add_argument('--batch', action='store_true', help='Batch mode')
    parser.add_argument('--max-users', type=int, default=10, help='Max users in batch')
    parser.add_argument('--stats', action='store_true', help='Show dedup stats')
    parser.add_argument('--reset-index', action='store_true', help='Reset dedup index')
    
    args = parser.parse_args()
    
    # Handle stats/reset
    if args.stats:
        dm = DedupManager()
        stats = dm.get_stats()
        log("=" * 60)
        log("Deduplication Statistics")
        log("=" * 60)
        log(f"Total indexed: {stats['total_indexed']}")
        return
    
    if args.reset_index:
        from fetch_tweets_dedup import DEDUP_DB_PATH
        if os.path.exists(DEDUP_DB_PATH):
            os.remove(DEDUP_DB_PATH)
            log("✅ Index reset")
        return
    
    log("=" * 60)
    log("Hot Topics v5.0 - ADVANCED MODE")
    log("Features: Deduplication + Contextual Titles + Fast Concurrent")
    log("=" * 60)
    
    if args.query:
        log(f"💭 Contextual mode | User query: {args.query[:50]}...")
    
    # Initialize components
    dedup_manager = DedupManager()
    stats = dedup_manager.get_stats()
    log(f"📊 Knowledge base: {stats['total_indexed']} existing entries")
    
    results = []
    skipped = []
    
    async with AsyncTikHubAPI() as api:
        processor = AdvancedTweetProcessor(api, dedup_manager)
        
        if args.url:
            # Single URL mode
            log(f"\n📎 Fetching: {args.url}")
            
            tweet_id = None
            screen_name = None
            for pattern in [r'twitter\.com/([A-Za-z0-9_]+)/status/(\d+)', r'x\.com/([A-Za-z0-9_]+)/status/(\d+)']:
                match = re.search(pattern, args.url)
                if match:
                    screen_name = match.group(1)
                    tweet_id = match.group(2)
                    break
            
            if tweet_id:
                if screen_name:
                    log(f"  Resolving via timeline: @{screen_name}")
                result = await api.twitter_get_tweet_from_user_posts(screen_name, tweet_id) if screen_name else {'code': 404}
                if result.get('code') != 200:
                    log(f"  ⚠ Timeline resolve failed ({result.get('code')}), fallback to fetch_tweet_detail")
                    result = await api.twitter_get_tweet_detail(tweet_id)
                if result.get('code') == 200:
                    tweet = result.get('data', {})
                    author = tweet.get('author', {}).get('screen_name', 'unknown')
                    lang = args.lang or ('zh' if any('\u4e00' <= c <= '\u9fff' 
                                                       for c in tweet.get('text', '')) else 'en')
                    
                    info = await processor.process_tweet_advanced(
                        tweet, author, lang, args.analyze_audio, args.query, args.force
                    )
                    
                    if info:
                        if info.get('skipped'):
                            skipped.append(info)
                        else:
                            results.append(info)
        
        elif args.user:
            # Single user mode
            user_results = await processor.process_user_advanced(
                args.user, args.count, args.lang, args.analyze_audio, args.query, args.force
            )
            results.extend(user_results)
        
        elif args.users:
            # Multiple users
            users = [u.strip() for u in args.users.split(',')]
            for username in users:
                user_results = await processor.process_user_advanced(
                    username, args.count, args.lang, args.analyze_audio, args.query, args.force
                )
                results.extend([r for r in user_results if not r.get('skipped')])
                skipped.extend([r for r in user_results if r.get('skipped')])
        
        elif args.batch:
            # Batch mode
            categories = load_categories_fast()
            all_users = list(set(u for cat in categories.values() for u in cat['users']))
            users = all_users[:args.max_users]
            
            log(f"\n🚀 Batch: {len(users)} users")
            
            for username in users:
                user_results = await processor.process_user_advanced(
                    username, 1, args.lang, args.analyze_audio, args.query, args.force
                )
                results.extend([r for r in user_results if not r.get('skipped')])
                skipped.extend([r for r in user_results if r.get('skipped')])
    
    # Summary
    log("\n" + "=" * 60)
    log(f"✅ Complete!")
    log(f"   🆕 New: {len(results)}")
    log(f"   ⏭️ Skipped (duplicates): {len(skipped)}")
    log("=" * 60)
    
    if results:
        log("\nNew entries:")
        for r in results:
            prefix = "💭 " if r.get('contextual_title') else "• "
            log(f"{prefix}[{r['category']}] {r['title'][:50]}...")
    
    return results


def main():
    """Entry point"""
    asyncio.run(main_async())


if __name__ == '__main__':
    main()
