#!/usr/bin/env python3
"""
Hot Topics Fetcher v4.1 - Contextual Title Generation
Titles consider user's question/intent when provided
"""

import sys
import os
import re
import json
import random
import subprocess
from datetime import datetime
from pathlib import Path

# Import original functions
from fetch_tweets import (
    TikHubAPI, log, smart_categorize, contains_chinese,
    sanitize_folder_name, download_image, download_video, create_1x1_cover,
    create_video_cover, get_cover_for_category, get_video_duration,
    extract_top_comments, extract_original_from_rt, extract_kimi_text_content,
    extract_title_from_kimi_output, generate_fallback_title, extract_tweet_meta_from_url,
    run_with_retry, HOT_TOPICS, COVER_POOL
)


def analyze_with_kimi_contextual(media_files, text_content, folder_path, 
                                  language='zh', analyze_audio=False, 
                                  skip_video_analysis=False, user_query=None):
    """
    Analyze media with Kimi CLI - considers user's question when generating title
    
    Args:
        user_query: User's question/intent (e.g., "你对这里说的伊朗局势怎么看")
    """
    try:
        image_files = [f for f in media_files if f and os.path.exists(f) and f.endswith(('.jpg', '.png', '.jpeg'))]
        video_files = [f for f in media_files if f and os.path.exists(f) and f.endswith('.mp4')]
        
        files_to_analyze = []
        media_analysis = "No media to analyze"
        audio_analysis_text = ""
        
        # Process video
        if video_files:
            video_path = video_files[0]
            
            if skip_video_analysis:
                log(f"  🎬 Video detected (long video >3min, skipping deep analysis)")
                try:
                    single_frame = os.path.join(folder_path, 'video_preview.jpg')
                    import subprocess
                    subprocess.run([
                        'ffmpeg', '-y', '-ss', '00:00:01', '-i', video_path,
                        '-vframes', '1', '-q:v', '2', single_frame
                    ], capture_output=True, timeout=15)
                    
                    if os.path.exists(single_frame):
                        files_to_analyze.append('video_preview.jpg')
                        media_analysis = "Video content (duration >3min, only single frame analyzed)"
                        log(f"  ✓ Extracted preview frame from long video")
                except:
                    media_analysis = "Video content (long video, frame extraction skipped)"
            else:
                log(f"  🎬 Processing video...")
                from fetch_tweets import extract_video_frames, extract_audio
                
                frames_folder = os.path.join(folder_path, 'frames')
                frame_paths = extract_video_frames(video_path, frames_folder, num_frames=5)
                
                if frame_paths:
                    log(f"  ✓ Extracted {len(frame_paths)} frames")
                    for fp in frame_paths:
                        rel_path = os.path.relpath(fp, folder_path)
                        files_to_analyze.append(rel_path)
                
                audio_path = os.path.join(folder_path, 'audio.mp3')
                if extract_audio(video_path, audio_path):
                    log(f"  ✓ Extracted audio")
                    if analyze_audio:
                        try:
                            from audio_utils import analyze_audio_content
                            log(f"  🎙️ Analyzing audio content...")
                            audio_result = analyze_audio_content(audio_path)
                            if audio_result:
                                audio_analysis_text = audio_result.get('analysis', '')
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
            
            log(f"  🤖 Analyzing media with Kimi... (timeout: 60s)")
            cmd = ['kimi', '--print', '--yolo', '--prompt', media_prompt]
            
            try:
                result = run_with_retry(cmd, timeout=60, cwd=folder_path, max_retries=1, retry_delay=2)
                
                if result.returncode == 0:
                    media_analysis = extract_kimi_text_content(result.stdout)
                    log(f"  ✓ Media analysis complete")
                else:
                    media_analysis = f"Media analysis failed: {result.stderr[:200]}"
                    log(f"  ⚠ Media analysis failed, using fallback")
            except subprocess.TimeoutExpired:
                log(f"  ⏱️ Media analysis timeout, using fallback")
                media_analysis = "Media analysis timeout"
            except Exception as e:
                log(f"  ✗ Media analysis error: {e}")
                media_analysis = f"Media analysis error: {e}"
        
        # Prepare audio section
        audio_section = ""
        if audio_analysis_text:
            if language == 'en':
                audio_section = f"\n\nAudio Content Analysis:\n{audio_analysis_text[:500]}"
            else:
                audio_section = f"\n\n音频内容分析：\n{audio_analysis_text[:500]}"
        
        # Generate title with CONTEXTUAL awareness
        # This is the key improvement - incorporate user's query
        query_section = ""
        if user_query:
            if language == 'en':
                query_section = f"""

USER'S QUESTION/INTENT:
"{user_query}"

IMPORTANT: The title should RESPOND to the user's question above.
The user wants to know about the aspect mentioned in their question.
Make the title RELEVANT to both the tweet content AND the user's specific interest."""
            else:
                query_section = f"""

用户的问题/意图：
"{user_query}"

重要：标题应该回应用户上面的问题。
用户想了解他们问题中提到的方面。
让标题既反映推文内容，又针对用户的具体关注点。"""
        
        if language == 'en':
            title_prompt = f"""Based on the following information, generate an engaging title:

Tweet Text:
{text_content[:500]}

Media Analysis:
{media_analysis[:1000]}{audio_section}{query_section}

CRITICAL REQUIREMENTS:
1. The tweet is in ENGLISH - generate an ENGLISH title only
2. Title must be in English (with emoji, 10-15 words) - must start with **Title:**
3. Capture the essence of text, visual AND audio content
4. Make it catchy and shareable
{f"5. MOST IMPORTANT: The title should address the user's question: '{user_query[:50]}...'" if user_query else ""}

Format:
**Title:** [your English emoji title here]
**Why:** Brief explanation of why this title fits"""
        else:
            title_prompt = f"""基于以下信息，生成一个有吸引力的标题：

推文内容：
{text_content[:500]}

媒体分析：
{media_analysis[:1000]}{audio_section}{query_section}

关键要求：
1. 推文内容是中文 - 必须生成中文标题
2. 标题必须使用中文（带emoji，15-20字）- 必须以 **标题：** 开头
3. 准确概括文字、视觉和音频内容
4. 有吸引力、适合社交媒体传播
{f"5. 最重要：标题应该回应用户的问题：'{user_query[:50]}...'" if user_query else ""}

格式：
**标题：** [中文emoji标题]
**理由：** 简要说明为什么这个标题合适"""
        
        log(f"  🤖 Generating contextual title... (timeout: 45s)")
        if user_query:
            log(f"     💭 Considering user question: {user_query[:40]}...")
        
        import subprocess
        cmd = ['kimi', '--print', '--yolo', '--prompt', title_prompt]
        
        try:
            result = run_with_retry(cmd, timeout=45, cwd=folder_path, max_retries=1, retry_delay=2)
            
            if result.returncode == 0:
                output = result.stdout
                extracted_title = extract_title_from_kimi_output(output, language)
                
                if extracted_title:
                    log(f"  ✓ Contextual Title: {extracted_title[:50]}...")
                else:
                    log(f"  ⚠ No title extracted, using fallback")
                    extracted_title = generate_contextual_fallback_title(text_content, user_query, language)
                
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
                    'audio_analysis': audio_analysis_text,
                    'user_query': user_query
                }
            else:
                log(f"  ⚠ Title generation failed: {result.stderr[:200]}")
                raise Exception(f"Title generation failed: {result.stderr[:200]}")
                
        except subprocess.TimeoutExpired:
            log(f"  ⏱️ Title generation timeout, using fallback")
            fallback = generate_contextual_fallback_title(text_content, user_query, language)
            return {
                'full_analysis': "Title generation timeout",
                'media_analysis': media_analysis,
                'title': fallback,
                'audio_analysis': audio_analysis_text,
                'user_query': user_query
            }
        except Exception as e:
            log(f"  ✗ Title generation error: {e}")
            fallback = generate_contextual_fallback_title(text_content, user_query, language)
            return {
                'full_analysis': f"Error: {e}",
                'media_analysis': media_analysis,
                'title': fallback,
                'audio_analysis': audio_analysis_text,
                'user_query': user_query
            }
    
    except Exception as e:
        log(f"  ✗ Analysis error: {e}")
        import traceback
        traceback.print_exc()
        fallback = generate_contextual_fallback_title(text_content, user_query, language)
        return {
            'full_analysis': f"Error: {e}",
            'media_analysis': "",
            'title': fallback,
            'audio_analysis': "",
            'user_query': user_query
        }


def generate_contextual_fallback_title(text, user_query=None, language='zh'):
    """Generate fallback title that considers user query"""
    clean_text = re.sub(r'https?://\S+', '', text)
    clean_text = re.sub(r'RT\s+@\w+:\s*', '', clean_text)
    clean_text = clean_text.strip()
    
    # If user has a specific question, try to include keywords from it
    if user_query:
        query_keywords = re.sub(r'[怎么看待怎么看如何评价你觉得你对此有什么想法]', '', user_query)
        query_keywords = re.sub(r'[\?？。，,\.\s]+', ' ', query_keywords).strip()
        
        if language == 'zh':
            emojis = ['🔥', '💡', '📌', '✨', '🎯', '🤔']
            # Combine query focus with content
            if len(query_keywords) > 5:
                title = f"{random.choice(emojis)}{query_keywords[:15]}..."
            else:
                base = clean_text[:25] if len(clean_text) > 25 else clean_text
                title = f"{random.choice(emojis)}{base[:20]}..."
        else:
            emojis = ['🔥', '💡', '📌', '✨', '🎯']
            if len(query_keywords) > 10:
                title = f"{random.choice(emojis)} {query_keywords[:30]}..."
            else:
                base = clean_text[:35] if len(clean_text) > 35 else clean_text
                title = f"{random.choice(emojis)} {base[:30]}..."
    else:
        # No user query, use original fallback
        base = clean_text[:30] if len(clean_text) > 30 else clean_text
        
        if language == 'en':
            emojis = ['🔥', '💡', '📌', '✨', '🎯']
            title = f"{random.choice(emojis)} {base[:40]}..." if len(base) > 40 else f"{random.choice(emojis)} {base}"
        else:
            emojis = ['🔥', '💡', '📌', '✨', '🎯', '🤔', '👀']
            title = f"{random.choice(emojis)}{base[:25]}..." if len(base) > 25 else f"{random.choice(emojis)}{base}"
    
    return title.strip()


def process_tweet_contextual(tweet, author, api, language='zh', analyze_audio=False, user_query=None):
    """Process tweet with contextual awareness of user's question"""
    import os
    import shutil
    from fetch_tweets import (
        extract_card_image, extract_media_list, download_image, 
        download_video, create_video_cover, get_cover_for_category
    )
    
    text = tweet.get('text', '')
    tweet_id = tweet.get('tweet_id') or tweet.get('id', '')
    
    category = smart_categorize(text, author)
    
    temp_id = datetime.now().strftime('%H%M%S')
    temp_name = f"_pending_{author}_{temp_id}"
    folder_path = os.path.join(HOT_TOPICS, category, temp_name)
    os.makedirs(folder_path, exist_ok=True)
    
    # Media extraction (same as original)
    card = tweet.get('card')
    card_image_url = extract_card_image(card)
    media = extract_media_list(tweet.get('media'))
    
    retweeted_tweet = tweet.get('retweeted_tweet')
    if retweeted_tweet and isinstance(retweeted_tweet, dict):
        if not media:
            media = extract_media_list(retweeted_tweet.get('media'))
            if media:
                log(f"  📎 Using media from retweeted tweet")
        if not card_image_url:
            card_image_url = extract_card_image(retweeted_tweet.get('card'))
            if card_image_url:
                log(f"  📎 Using card image from retweeted tweet")
    
    downloaded_images = []
    video_path = None
    has_video = False
    video_thumbnail_url = None
    video_duration = 0
    is_long_video_flag = False
    used_card_image = False
    
    # Download card image
    if card_image_url:
        log(f"  📎 Card image found, downloading...")
        card_img_path = os.path.join(folder_path, 'image_0.jpg')
        if download_image(card_image_url, card_img_path):
            downloaded_images.append(card_img_path)
            log(f"  ✓ Downloaded card image (priority)")
            used_card_image = True
    
    # Process media
    if media:
        start_idx = 1 if used_card_image else 0
        for i, m in enumerate(list(media)[:4]):
            if isinstance(m, dict):
                if m.get('type') == 'video' or 'video_info' in m or 'variants' in m:
                    has_video = True
                    video_thumbnail_url = m.get('media_url_https')
                    video_info = m.get('video_info', {})
                    duration_millis = video_info.get('duration_millis', 0)
                    video_duration = duration_millis / 1000
                    
                    if video_duration > 180:
                        is_long_video_flag = True
                        log(f"  ⏱️ Long video detected ({int(video_duration//60)}:{int(video_duration%60):02d})")
                else:
                    url = m.get('media_url_https') or m.get('url')
                    if url:
                        img_idx = start_idx + i
                        img_path = os.path.join(folder_path, f'image_{img_idx}.jpg')
                        if download_image(url, img_path):
                            downloaded_images.append(img_path)
                            log(f"  ✓ Downloaded image {img_idx + 1}")
    
    # Handle video download
    if has_video and video_thumbnail_url:
        if not is_long_video_flag:
            log(f"  🎬 Short video detected ({int(video_duration)}s), downloading...")
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
                    video_path = None
        else:
            log(f"  🎬 Using video thumbnail (no download needed)")
    
    # Create cover
    cover_path = os.path.join(folder_path, 'cover.jpg')
    
    if used_card_image and downloaded_images:
        log(f"  Using card image as cover...")
        card_img_path = downloaded_images[0]
        if card_img_path != cover_path:
            shutil.copy2(card_img_path, cover_path)
        log(f"  ✓ Card image set as cover")
    elif has_video and video_thumbnail_url:
        log(f"  Downloading video thumbnail...")
        if download_image(video_thumbnail_url, cover_path):
            log(f"  ✓ Video thumbnail downloaded")
            if video_path and os.path.exists(video_path):
                log(f"  Extracting better cover from video...")
                create_video_cover(video_path, cover_path)
        else:
            if video_path and os.path.exists(video_path):
                if not create_video_cover(video_path, cover_path):
                    url = get_cover_for_category(category)
                    download_image(url, cover_path)
            else:
                url = get_cover_for_category(category)
                download_image(url, cover_path)
    elif has_video and video_path and os.path.exists(video_path):
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
    
    skip_video_analysis = is_long_video_flag
    media_files = downloaded_images[:]
    if video_path and os.path.exists(video_path):
        media_files.append(video_path)
    elif video_thumbnail_url and skip_video_analysis:
        temp_thumbnail = os.path.join(folder_path, 'video_thumbnail.jpg')
        if download_image(video_thumbnail_url, temp_thumbnail):
            media_files.append(temp_thumbnail)
    
    # ===== KEY DIFFERENCE: Pass user_query to Kimi =====
    kimi_result = analyze_with_kimi_contextual(
        media_files, original_content, folder_path, 
        language, analyze_audio, skip_video_analysis, user_query
    )
    
    kimi_analysis_text = kimi_result.get('full_analysis', '')
    media_analysis = kimi_result.get('media_analysis', '')
    audio_analysis = kimi_result.get('audio_analysis', '')
    extracted_title = kimi_result.get('title')
    suggested_title = extracted_title or ('[Pending Title]' if language == 'en' else '[待优化标题]')
    
    if has_video and video_path and os.path.exists(video_path) and video_duration == 0:
        video_duration = get_video_duration(video_path)
    
    # Build content
    if language == 'en':
        content_parts = [
            f"[User Question]\n{user_query}\n" if user_query else "",
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
            'audio_analysis': audio_analysis,
            'user_query': user_query,
            'contextual_title': user_query is not None
        }
    else:
        content_parts = [
            f"【用户问题】\n{user_query}\n" if user_query else "",
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
            'audio_analysis': audio_analysis,
            'user_query': user_query,
            'contextual_title': user_query is not None
        }
    
    # Save post.json
    json_path = os.path.join(folder_path, 'post.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    # Rename folder
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
        'suggested_title': suggested_title,
        'user_query': user_query
    }


def fetch_by_url_with_context(url, api, language=None, analyze_audio=False, user_query=None):
    """Fetch single tweet by URL with user's question context"""
    tweet_id, screen_name = extract_tweet_meta_from_url(url)
    
    if not tweet_id:
        log(f"  ✗ Cannot extract tweet ID from URL: {url}")
        return None
    
    log(f"  Fetching tweet ID: {tweet_id}")
    if screen_name:
        log(f"  Resolving via timeline: @{screen_name}")
    if user_query:
        log(f"  💭 User question: {user_query[:50]}...")
    
    result = api.twitter_get_tweet_from_user_posts(screen_name, tweet_id) if screen_name else {'code': 404}
    if result.get('code') != 200:
        log(f"  ⚠ Timeline resolve failed ({result.get('code')}), fallback to fetch_tweet_detail")
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
    
    return process_tweet_contextual(tweet, author, api, language, analyze_audio, user_query)


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Hot Topics Fetcher v4.1 - Contextual Title Generation')
    parser.add_argument('--url', required=True, help='Tweet URL to fetch')
    parser.add_argument('--query', help='User\'s question/intent (e.g., "你对伊朗局势怎么看")')
    parser.add_argument('--lang', choices=['zh', 'en'], help='Force language')
    parser.add_argument('--analyze-audio', action='store_true', help='Analyze audio content')
    
    args = parser.parse_args()
    
    log("=" * 60)
    log("Hot Topics Fetcher v4.1 - Contextual Mode")
    log("=" * 60)
    
    api = TikHubAPI()
    
    log(f"\n📎 Fetching: {args.url}")
    if args.query:
        log(f"💭 User question: {args.query}")
    
    result = fetch_by_url_with_context(
        args.url, api, args.lang, args.analyze_audio, args.query
    )
    
    if result:
        log("\n" + "=" * 60)
        log("✅ Complete!")
        log("=" * 60)
        log(f"Title: {result['suggested_title']}")
        log(f"Folder: {os.path.basename(result['folder'])}")
        if result.get('user_query'):
            log(f"Context: Contextual title (based on user question)")
    
    return result


if __name__ == '__main__':
    main()
