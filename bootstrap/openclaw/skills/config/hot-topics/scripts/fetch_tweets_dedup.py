#!/usr/bin/env python3
"""
Hot Topics Fetcher v4.0 - WITH LOCAL DEDUPLICATION
Features: Checks local knowledge base before fetching to avoid duplicates
"""

import sys
import os
import re
import json
import hashlib
import difflib
from datetime import datetime, timedelta
from pathlib import Path

# Import original functions
from fetch_tweets import (
    TikHubAPI, log, load_categories, smart_categorize, contains_chinese,
    sanitize_folder_name, download_image, download_video, create_1x1_cover,
    create_video_cover, get_cover_for_category, get_video_duration,
    is_long_video, extract_video_frames, extract_audio, extract_top_comments,
    extract_original_from_rt, extract_kimi_text_content, 
    extract_title_from_kimi_output, generate_fallback_title,
    analyze_with_kimi, process_tweet as original_process_tweet,
    fetch_by_url, fetch_by_user
)

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
KNOWLEDGE_BASE, HOT_TOPICS = resolve_kb_paths()
DEDUP_DB_PATH = os.path.join(KNOWLEDGE_BASE, '.hot_topics_dedup.json')


# ============== Deduplication System ==============

class DedupManager:
    """Manage local knowledge base deduplication"""
    
    def __init__(self, db_path=DEDUP_DB_PATH):
        self.db_path = db_path
        self.index = self._load_index()
        self._scan_existing_folders()
    
    def _load_index(self):
        """Load deduplication index"""
        if os.path.exists(self.db_path):
            try:
                with open(self.db_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                pass
        return {
            'version': '1.0',
            'created_at': datetime.now().isoformat(),
            'entries': {}  # tweet_id -> entry
        }
    
    def _save_index(self):
        """Save deduplication index"""
        try:
            with open(self.db_path, 'w', encoding='utf-8') as f:
                json.dump(self.index, f, ensure_ascii=False, indent=2)
        except Exception as e:
            log(f"⚠ Failed to save dedup index: {e}")
    
    def _scan_existing_folders(self):
        """Scan existing folders to build initial index"""
        if not os.path.exists(HOT_TOPICS):
            return
        
        log("🔍 Scanning existing knowledge base for duplicates...")
        count = 0
        
        for category in os.listdir(HOT_TOPICS):
            cat_path = os.path.join(HOT_TOPICS, category)
            if not os.path.isdir(cat_path):
                continue
            
            for folder in os.listdir(cat_path):
                folder_path = os.path.join(cat_path, folder)
                if not os.path.isdir(folder_path):
                    continue
                
                # Check for post.json
                post_json = os.path.join(folder_path, 'post.json')
                if os.path.exists(post_json):
                    try:
                        with open(post_json, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                        
                        tweet_id = self._extract_tweet_id(data.get('url', ''))
                        if tweet_id and tweet_id not in self.index['entries']:
                            self.index['entries'][tweet_id] = {
                                'folder': folder_path,
                                'category': category,
                                'title': data.get('title', ''),
                                'author': data.get('author', {}).get('username', ''),
                                'created_at': data.get('created_at', ''),
                                'indexed_at': datetime.now().isoformat()
                            }
                            count += 1
                    except:
                        pass
        
        if count > 0:
            log(f"  ✓ Indexed {count} existing entries")
            self._save_index()
    
    def _extract_tweet_id(self, url):
        """Extract tweet ID from URL"""
        if not url:
            return None
        match = re.search(r'(?:twitter|x)\.com/\w+/status/(\d+)', url)
        return match.group(1) if match else None
    
    def _normalize_text(self, text):
        """Normalize text for comparison"""
        if not text:
            return ""
        # Remove URLs, mentions, hashtags for comparison
        text = re.sub(r'https?://\S+', '', text)
        text = re.sub(r'@\w+', '', text)
        text = re.sub(r'#\w+', '', text)
        text = re.sub(r'RT\s+', '', text)
        text = re.sub(r'\s+', ' ', text).strip().lower()
        return text
    
    def _text_similarity(self, text1, text2):
        """Calculate text similarity ratio"""
        t1 = self._normalize_text(text1)
        t2 = self._normalize_text(text2)
        
        if not t1 or not t2:
            return 0.0
        
        # Use difflib for similarity
        return difflib.SequenceMatcher(None, t1, t2).ratio()
    
    def check_duplicate(self, tweet_id, text, author, similarity_threshold=0.85):
        """
        Check if tweet is duplicate
        Returns: (is_duplicate, existing_entry_info)
        """
        # 1. Check exact tweet ID match
        if tweet_id and tweet_id in self.index['entries']:
            entry = self.index['entries'][tweet_id]
            log(f"  💾 Found exact duplicate (ID: {tweet_id})")
            return True, entry
        
        # 2. Check text similarity
        normalized_new = self._normalize_text(text)
        if not normalized_new or len(normalized_new) < 20:
            return False, None
        
        for tid, entry in self.index['entries'].items():
            existing_text = entry.get('title', '')
            similarity = self._text_similarity(text, existing_text)
            
            if similarity >= similarity_threshold:
                log(f"  📝 Found similar content ({similarity:.0%} match)")
                return True, entry
        
        return False, None
    
    def add_entry(self, tweet_id, folder_path, category, title, author, url):
        """Add new entry to index"""
        if tweet_id:
            self.index['entries'][tweet_id] = {
                'folder': folder_path,
                'category': category,
                'title': title,
                'author': author,
                'url': url,
                'indexed_at': datetime.now().isoformat()
            }
            self._save_index()
    
    def get_stats(self):
        """Get deduplication stats"""
        return {
            'total_indexed': len(self.index['entries']),
            'db_path': self.db_path
        }


# Global dedup manager
dedup_manager = None


def get_dedup_manager():
    """Get or create dedup manager singleton"""
    global dedup_manager
    if dedup_manager is None:
        dedup_manager = DedupManager()
    return dedup_manager


# ============== Enhanced Process Function ==============

def process_tweet_dedup(tweet, author, api, language='zh', analyze_audio=False, force=False):
    """
    Process tweet with deduplication check
    
    Args:
        force: If True, reprocess even if duplicate exists
    """
    text = tweet.get('text', '')
    tweet_id = tweet.get('tweet_id') or tweet.get('id', '')
    
    # Initialize dedup manager
    dm = get_dedup_manager()
    
    # Check for duplicates (unless force=True)
    if not force:
        is_dup, existing = dm.check_duplicate(tweet_id, text, author)
        
        if is_dup:
            log(f"  ⏭️ SKIPPING - Already exists in knowledge base:")
            log(f"     📁 {existing.get('folder', 'N/A')}")
            log(f"     📝 {existing.get('title', 'N/A')[:60]}...")
            
            return {
                'skipped': True,
                'reason': 'duplicate',
                'existing_folder': existing.get('folder'),
                'existing_title': existing.get('title'),
                'tweet_id': tweet_id,
                'author': author
            }
    
    # Not a duplicate, process normally
    result = original_process_tweet(tweet, author, api, language, analyze_audio)
    
    # Add to dedup index if successful
    if result and not result.get('skipped') and tweet_id:
        dm.add_entry(
            tweet_id=tweet_id,
            folder_path=result.get('folder', ''),
            category=result.get('category', ''),
            title=result.get('suggested_title', ''),
            author=author,
            url=f"https://x.com/{author}/status/{tweet_id}"
        )
    
    return result


# ============== Enhanced Fetch Functions ==============

def fetch_by_user_dedup(username, api, count=1, language=None, analyze_audio=False, force=False):
    """Fetch user's tweets with deduplication"""
    log(f"\n👤 Fetching @{username}'s latest {count} tweet(s)...")
    
    # Show dedup stats
    dm = get_dedup_manager()
    stats = dm.get_stats()
    log(f"   (Knowledge base has {stats['total_indexed']} existing entries)")
    
    result = api.twitter_get_user_posts(username, limit=max(count * 2, 5))
    
    if result.get('code') != 200:
        log(f"  ✗ API error: {result.get('code')}")
        return []
    
    timeline = result.get('data', {}).get('timeline', [])
    if not timeline:
        log(f"  ✗ No tweets found")
        return []
    
    results = []
    skipped_count = 0
    
    for tweet in timeline[:count]:
        try:
            lang = language
            if not lang:
                text = tweet.get('text', '')
                lang = 'zh' if any('\u4e00' <= c <= '\u9fff' for c in text) else 'en'
            
            info = process_tweet_dedup(tweet, username, api, language=lang, 
                                        analyze_audio=analyze_audio, force=force)
            
            if info.get('skipped'):
                skipped_count += 1
            else:
                results.append(info)
                log(f"  ✓ Saved: {info['suggested_title'][:50]}...")
                
        except Exception as e:
            log(f"  ✗ Error processing tweet: {e}")
    
    if skipped_count > 0:
        log(f"  ⏭️ Skipped {skipped_count} duplicate(s)")
    
    return results


def fetch_by_url_dedup(url, api, language=None, analyze_audio=False, force=False):
    """Fetch single tweet by URL with deduplication"""
    tweet_id = None
    for pattern in [r'twitter\.com/\w+/status/(\d+)', r'x\.com/\w+/status/(\d+)']:
        match = re.search(pattern, url)
        if match:
            tweet_id = match.group(1)
            break
    
    if not tweet_id:
        log(f"  ✗ Cannot extract tweet ID from URL: {url}")
        return None
    
    # Check dedup first
    if not force:
        dm = get_dedup_manager()
        is_dup, existing = dm.check_duplicate(tweet_id, '', '')
        if is_dup:
            log(f"  ⏭️ SKIPPING - Already exists:")
            log(f"     📁 {existing.get('folder', 'N/A')}")
            return {
                'skipped': True,
                'reason': 'duplicate',
                'existing_folder': existing.get('folder'),
                'tweet_id': tweet_id
            }
    
    log(f"  Fetching tweet ID: {tweet_id}")
    result = api.twitter_get_tweet_detail(tweet_id)
    
    if result.get('code') != 200:
        log(f"  ✗ API error: {result.get('code')}")
        return None
    
    tweet = result.get('data', {})
    author = tweet.get('author', {}).get('screen_name', 'unknown')
    
    if not language:
        text = tweet.get('text', '')
        language = 'zh' if any('\u4e00' <= c <= '\u9fff' for c in text) else 'en'
        log(f"  Auto-detected language: {language}")
    
    return process_tweet_dedup(tweet, author, api, language=language, 
                                analyze_audio=analyze_audio, force=force)


# ============== Main Entry ==============

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Hot Topics Fetcher v4.0 - With Deduplication')
    parser.add_argument('--url', help='Fetch specific tweet by URL')
    parser.add_argument('--user', help='Fetch tweets from specific user')
    parser.add_argument('--count', type=int, default=1, help='Number of tweets to fetch')
    parser.add_argument('--lang', choices=['zh', 'en'], help='Force language')
    parser.add_argument('--random', action='store_true', help='Random selection mode')
    parser.add_argument('--analyze-audio', action='store_true', help='Analyze audio content')
    parser.add_argument('--force', action='store_true', help='Force reprocess even if duplicate exists')
    parser.add_argument('--stats', action='store_true', help='Show deduplication stats')
    parser.add_argument('--reset-index', action='store_true', help='Reset deduplication index')
    
    args = parser.parse_args()
    
    # Handle stats
    if args.stats:
        dm = get_dedup_manager()
        stats = dm.get_stats()
        log("=" * 60)
        log("Deduplication Statistics")
        log("=" * 60)
        log(f"Total indexed entries: {stats['total_indexed']}")
        log(f"Index file: {stats['db_path']}")
        return
    
    # Handle reset
    if args.reset_index:
        if os.path.exists(DEDUP_DB_PATH):
            os.remove(DEDUP_DB_PATH)
            log("✅ Deduplication index reset")
        return
    
    log("=" * 60)
    log("Hot Topics Fetcher v4.0 - Smart Deduplication Mode")
    log("=" * 60)
    
    api = TikHubAPI()
    results = []
    skipped = []
    
    if args.url:
        log(f"\n📎 Fetching specific tweet:")
        log(f"   URL: {args.url}")
        info = fetch_by_url_dedup(args.url, api, args.lang, args.analyze_audio, args.force)
        if info:
            if info.get('skipped'):
                skipped.append(info)
            else:
                results.append(info)
    
    elif args.user:
        log(f"\n👤 Fetching from user: @{args.user}")
        user_results = fetch_by_user_dedup(args.user, api, args.count, args.lang, 
                                            args.analyze_audio, args.force)
        for r in user_results:
            if r.get('skipped'):
                skipped.append(r)
            else:
                results.append(r)
    
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
        
        num_to_check = min(3, len(all_users))
        selected_users = random.sample(all_users, num_to_check)
        
        log(f"\n🎲 Random mode: Checking {num_to_check} users")
        
        for username in selected_users:
            user_results = fetch_by_user_dedup(username, api, count=1, 
                                                analyze_audio=args.analyze_audio,
                                                force=args.force)
            for r in user_results:
                if r.get('skipped'):
                    skipped.append(r)
                else:
                    results.append(r)
    
    # Summary
    log("\n" + "=" * 60)
    log(f"✅ Complete!")
    log(f"   🆕 New: {len(results)} tweet(s)")
    log(f"   ⏭️ Skipped (duplicates): {len(skipped)} tweet(s)")
    log("=" * 60)
    
    if results:
        log("\nNew entries:")
        for r in results:
            folder_name = os.path.basename(r['folder'])
            log(f"  • [{r['category']}] {folder_name}")
    
    if skipped:
        log("\nSkipped duplicates:")
        for s in skipped[:5]:  # Show first 5
            log(f"  • [{s.get('author', 'N/A')}] {s.get('existing_title', 'N/A')[:50]}...")
        if len(skipped) > 5:
            log(f"  ... and {len(skipped) - 5} more")
    
    return results


if __name__ == '__main__':
    main()
