#!/usr/bin/env python3
"""
Hot Topics Fetcher v2.3 - Optimized media analysis
"""

import sys
import os
import re
import json
import random
import subprocess
import shutil
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.expanduser('~/.openclaw/skills/tikhub-api'))
from tikhub_common import TikHubAPI

KNOWLEDGE_BASE = os.path.expanduser('~/Documents/知识库')
MY_ASSISTANT = os.path.join(KNOWLEDGE_BASE, '我的助手')
HOT_TOPICS = os.path.join(KNOWLEDGE_BASE, '热门话题')

COVER_POOL = {
    'AI_Tech': [
        'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&h=800&fit=crop',
        'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=800&h=800&fit=crop'
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
    'Default': [
        'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&h=800&fit=crop'
    ]
}

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def load_categories():
    """Load categories and influencers"""
    categories = {}
    if not os.path.exists(MY_ASSISTANT):
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

def extract_original_from_rt(text):
    """Extract original content from RT"""
    clean = re.sub(r'^RT\s+@\w+:\s*', '', text, flags=re.IGNORECASE)
    return clean.strip()

def smart_categorize(text, author):
    """Smart categorization - with standardized English categories"""
    text_lower = (text + ' ' + author).lower()
    
    # Priority 1: Check author (most reliable)
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
        'Technology': ['ai', 'gpt', 'claude', 'coding', 'tech', 'technology', 'algorithm', 'deepseek', 'opus', 'seedance', 'software', 'app', 'digital'],
        'Entertainment': ['movie', 'film', 'cinema', 'actor', 'actress', 'celebrity', 'hollywood', 'music', 'song', 'album', 'concert', 'tv', 'show', 'netflix', 'disney', 'marvel', 'avengers'],
        'Sports': ['sports', 'game', 'match', 'team', 'player', 'basketball', 'football', 'soccer', 'baseball', 'tennis', 'olympics', 'championship'],
        'Culture': ['culture', 'art', 'museum', 'gallery', 'book', 'literature', 'fashion', 'lifestyle', 'travel'],
        'Society': ['society', 'social', 'community', 'education', 'school', 'university', 'student', 'teacher'],
        'Science': ['science', 'scientific', 'research', 'study', 'discovery', 'space', 'nasa', 'physics', 'chemistry', 'biology'],
        'History': ['history', 'historical', 'museum', 'heritage', 'ancient', 'archive'],
        'Medical': ['medical', 'health', 'healthcare', 'hospital', 'doctor', 'medicine', 'disease', 'treatment', 'vaccine'],
        'Food': ['food', 'restaurant', 'recipe', 'cooking', 'delicious', 'cuisine', 'chef'],
    }
    
    for cat, keywords in categories.items():
        if any(kw in text_lower for kw in keywords):
            return cat
    
    return 'Society'  # Default category

def download_image(url, output_path):
    """Download image"""
    try:
        subprocess.run(['curl', '-sL', '-o', output_path, url], timeout=30)
        return os.path.exists(output_path) and os.path.getsize(output_path) > 1000
    except:
        return False

def download_video(video_url, output_path):
    """Download video"""
    try:
        result = subprocess.run(
            ['curl', '-sL', '-o', output_path, video_url],
            capture_output=True,
            timeout=120
        )
        return os.path.exists(output_path) and os.path.getsize(output_path) > 10000
    except:
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

def extract_top_comments(tweet_id, api, limit=10):
    """Extract top comments"""
    comments = []
    try:
        result = api.twitter_get_latest_comments(tweet_id)
        if result.get('code') == 200:
            data = result.get('data', {})
            timeline = data.get('timeline', [])
            
            sorted_comments = sorted(
                timeline,
                key=lambda x: x.get('favorites', 0),
                reverse=True
            )
            
            for item in sorted_comments[:limit]:
                author_info = item.get('user_info', {})
                comment = {
                    'author': author_info.get('name', 'Unknown'),
                    'author_screen': author_info.get('screen_name', ''),
                    'text': item.get('text', ''),
                    'likes': item.get('favorites', 0),
                    'replies': item.get('replies', 0)
                }
                comments.append(comment)
    except Exception as e:
        log(f"  Failed to get comments: {e}")
    
    return comments

def contains_chinese(text):
    """检查文本是否包含中文字符"""
    for char in text:
        if '\u4e00' <= char <= '\u9fff':
            return True
    return False

def extract_title_from_kimi_output(output, language='zh'):
    """从 Kimi 输出中提取标题 - 修复版（带语言验证）"""
    try:
        # 找到最后一个有效的 TextPart（包含实际分析内容）
        textpart_pattern = r"TextPart\(\s*type='text',\s*text='([^']*?)'\s*\)"
        all_textparts = re.findall(textpart_pattern, output, re.DOTALL)
        
        actual_response = None
        if all_textparts:
            # 从后往前找，使用最后一个非简短且不是图片标签的 TextPart
            for text_content in reversed(all_textparts):
                if len(text_content) > 100 and '</image>' not in text_content:
                    actual_response = text_content.replace('\\n', '\n')
                    break
        
        if not actual_response:
            return None
        
        lines = actual_response.split('\n')
        
        # 从后向前查找 **标题：** 或 **Title：** 行
        for i in range(len(lines) - 1, -1, -1):
            line = lines[i].rstrip()
            line_stripped = line.strip()
            
            # 检查是否是标题行
            is_title_line = False
            title_match = None
            
            if language == 'zh':
                # 中文推文：只接受中文标题格式
                if '**标题：**' in line or (line_stripped.startswith('**') and '标题' in line_stripped):
                    is_title_line = True
                    title_match = re.search(r'\*\*\s*标题\s*[:：]\*\*\s*(.+)', line)
            
            elif language == 'en':
                # 英文推文：只接受英文标题格式
                if '**Title:**' in line or '** TITLE:**' in line.upper():
                    is_title_line = True
                    title_match = re.search(r'\*\*\s*Title\s*[:：]\*\*\s*(.+)', line, re.IGNORECASE)
            
            else:
                # 自动检测模式：尝试两种格式
                if '**标题：**' in line or (line_stripped.startswith('**') and '标题' in line_stripped):
                    is_title_line = True
                    title_match = re.search(r'\*\*\s*标题\s*[:：]\*\*\s*(.+)', line)
                elif '**Title:**' in line or '** TITLE:**' in line.upper():
                    is_title_line = True
                    title_match = re.search(r'\*\*\s*Title\s*[:：]\*\*\s*(.+)', line, re.IGNORECASE)
            
            if is_title_line:
                # 提取标题内容
                title = None
                next_line_idx = i + 1
                
                if title_match:
                    title = title_match.group(1).strip()
                    # 关键修复：如果标题只有emoji或很短（<5字符），内容可能在下一行
                    if len(title) < 5 and i + 1 < len(lines):
                        next_line = lines[i + 1].strip()
                        if next_line and not next_line.startswith('**'):
                            title += next_line
                            next_line_idx = i + 2
                elif line.rstrip().endswith(('**', '：', ':')):
                    # 标题内容在下一行
                    if i + 1 < len(lines):
                        title = lines[i + 1].strip()
                        next_line_idx = i + 2
                
                if title:
                    # 合并可能的续行（如果标题跨行了）
                    j = next_line_idx
                    while j < len(lines):
                        next_line = lines[j].strip()
                        if not next_line or next_line.startswith('**'):
                            break
                        title += next_line
                        j += 1
                    
                    # 清理标题
                    title = title.strip()
                    title = re.sub(r'^[\*\s\-\'"]+|[\*\s\'"]+$', '', title)
                    
                    # 语言验证
                    has_chinese = contains_chinese(title)
                    
                    if language == 'en' and has_chinese:
                        # 英文推文但标题是中文 - 拒绝
                        log(f"  ⚠️ 英文推文但Kimi返回中文标题，跳过: {title[:30]}...")
                        continue
                    
                    if language == 'zh' and not has_chinese and len(title) > 10:
                        # 中文推文但标题是纯英文（且较长）- 可能是翻译错误，拒绝
                        # 允许短英文标题（如品牌名）
                        log(f"  ⚠️ 中文推文但Kimi返回纯英文标题，跳过: {title[:30]}...")
                        continue
                    
                    # 验证标题有效性
                    if (len(title) >= 5 and 
                        len(title) <= 100 and
                        not title.startswith('http') and 
                        '[你的' not in title and 
                        'emoji' not in title.lower() and
                        '...' not in title and
                        title != '[你的emoji标题]' and
                        '风格描述' not in title and
                        '核心要点' not in title):
                        return title
        
        return None
    except Exception as e:
        log(f"  提取标题失败: {e}")
        return None

def extract_kimi_text_content(output):
    """Extract clean text content from Kimi CLI output (removing internal processing data)"""
    try:
        # Find all TextPart text content
        text_parts = []
        
        # Pattern 1: Find content in TextPart(type='text', text='...')
        # Handle both escaped and non-escaped quotes
        pattern1 = r"TextPart\(\s*type=['\"]text['\"],\s*text=['\"](.+?)['\"]\s*\)"
        matches = re.findall(pattern1, output, re.DOTALL)
        for match in matches:
            # Clean escape characters
            text = match.replace('\\n', '\n').replace("\\'", "'").replace('\\"', '"').replace('\\\\', '\\')
            # Remove image tags
            text = re.sub(r'<image[^>]*>', '[Image analyzed]', text)
            text = re.sub(r'</image>', '', text)
            text_parts.append(text.strip())
        
        if text_parts:
            result = '\n\n'.join(text_parts)
            # Additional cleanup
            result = re.sub(r'TurnBegin\([^)]*\)', '', result)
            result = re.sub(r'StepBegin\([^)]*\)', '', result)
            result = re.sub(r'TurnEnd\([^)]*\)', '', result)
            return result.strip()
        
        # Pattern 2: Remove internal processing data
        lines = output.split('\n')
        result_lines = []
        skip_patterns = [
            'ToolCall(', 'ToolResult(', 'ThinkPart(', 'StatusUpdate(',
            'StepBegin(', 'TurnBegin(', 'TurnEnd(', 'FunctionBody(',
            'ToolCallPart(', 'FunctionReturnValue('
        ]
        
        for line in lines:
            skip = False
            for pattern in skip_patterns:
                if pattern in line:
                    skip = True
                    break
            # Also skip image tags and base64 data
            if '<image' in line or 'base64' in line or 'url=ImageURL' in line:
                skip = True
            if not skip and line.strip():
                result_lines.append(line)
        
        result = '\n'.join(result_lines) if result_lines else output
        # Remove image tags
        result = re.sub(r'<image[^>]*>', '[Image analyzed]', result)
        result = re.sub(r'</image>', '', result)
        return result.strip()
        
    except Exception as e:
        return output

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
            duration = 30  # Default 30 seconds
        
        # Calculate extraction points
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
    except Exception as e:
        log(f"  ⚠ Frame extraction failed: {e}")
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
    except Exception as e:
        log(f"  ⚠ Audio extraction failed: {e}")
    return None

def analyze_with_kimi(media_files, text_content, folder_path, language='zh'):
    """使用 Kimi CLI 分析媒体文件（视频/图片）并生成标题"""
    try:
        # 检查媒体文件
        image_files = [f for f in media_files if f and os.path.exists(f) and f.endswith(('.jpg', '.png', '.jpeg'))]
        video_files = [f for f in media_files if f and os.path.exists(f) and f.endswith('.mp4')]
        
        # 准备分析用的文件列表
        files_to_analyze = []
        analysis_context = []
        
        # 处理视频：抽帧 + 提取音频
        if video_files:
            video_path = video_files[0]
            log(f"  🎬 Processing video...")
            
            # Extract frames
            frames_folder = os.path.join(folder_path, 'frames')
            frame_paths = extract_video_frames(video_path, frames_folder, num_frames=5)
            
            if frame_paths:
                log(f"  ✓ Extracted {len(frame_paths)} frames")
                # Get relative paths
                for fp in frame_paths:
                    rel_path = os.path.relpath(fp, folder_path)
                    files_to_analyze.append(rel_path)
            
            # Extract audio (optional, just for info)
            audio_path = os.path.join(folder_path, 'audio.mp3')
            if extract_audio(video_path, audio_path):
                log(f"  ✓ Extracted audio")
                analysis_context.append("Video has audio track")
        
        # 处理图片
        if image_files:
            log(f"  🖼️  Processing {len(image_files)} images...")
            for img_path in image_files[:4]:  # Max 4 images
                rel_path = os.path.relpath(img_path, folder_path)
                files_to_analyze.append(rel_path)
        
        # Build file list for prompt
        file_list_str = "\n".join([f"  - {f}" for f in files_to_analyze])
        
        # 构建媒体分析提示词
        # Check if audio was extracted
        audio_file = os.path.join(folder_path, 'audio.mp3')
        has_audio = os.path.exists(audio_file)
        
        if language == 'en':
            if files_to_analyze:
                # Check if multiple images
                is_multi_image = len(image_files) > 1
                
                # Build audio section if exists
                audio_section = ""
                if has_audio:
                    audio_section = """
**Audio Analysis:**
Also analyze the audio.mp3 file if possible. Describe:
- Audio type: music, speech, ambient sound, etc.
- Key content: What is being said or heard
- Mood/atmosphere: What feeling the audio conveys"""
                
                if is_multi_image:
                    media_prompt = f"""Please read and analyze these {len(image_files)} images in the current directory:
{file_list_str}{audio_section}

For EACH image, provide a structured analysis following this format:

**Image 1 - [filename]:**
- What it shows: [Brief description of main content]
- Key details: [Important elements, UI components, text content]
- Visual style: [Colors, layout, design style, platform]

**Image 2 - [filename]:**
- What it shows: [Brief description]
- Key details: [Important elements]
- Visual style: [Colors, layout]

(Continue for all images...)

**Summary:** Brief overview of what all images collectively demonstrate or the story they tell together."""
                else:
                    media_prompt = f"""Please read and analyze these media files in the current directory:
{file_list_str}{audio_section}

For each image/video frame, describe:
1. Visual content: What is shown? (people, objects, scenes, actions)
2. Visual style: colors, lighting, composition
3. Text: Any visible text in the images
4. Overall impression

After analyzing the media, also consider the tweet text to understand the full context."""
            else:
                media_prompt = "No media files to analyze."
            
            # First call: Analyze media
            if files_to_analyze:
                log(f"  🤖 Analyzing media with Kimi...")
                cmd = ['kimi', '--print', '--yolo', '--prompt', media_prompt]
                
                result = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=120, cwd=folder_path
                )
                
                if result.returncode == 0:
                    media_analysis = extract_kimi_text_content(result.stdout)
                    log(f"  ✓ Media analysis complete")
                else:
                    media_analysis = f"Media analysis failed: {result.stderr[:200]}"
                    log(f"  ⚠ Media analysis failed")
            else:
                media_analysis = "No media to analyze"
            
            # Second call: Generate title based on media + text
            title_prompt = f"""Based on the following information, generate an engaging title:

Tweet Text:
{text_content[:500]}

Media Analysis:
{media_analysis[:1000]}

CRITICAL REQUIREMENTS:
1. The tweet is in ENGLISH - you MUST generate an ENGLISH title only
2. Title must be in English (with emoji, 10-15 words) - must start with **Title:**
3. DO NOT translate to Chinese - keep the title in English
4. Capture the essence of both text and visual content
5. Make it catchy and shareable

Format:
**Title:** [your English emoji title here]
**Why:** Brief explanation of why this title fits

IMPORTANT: The original tweet is in English. The title MUST be in English, not Chinese."""
            
        else:  # Chinese
            if files_to_analyze:
                # Check if multiple images
                is_multi_image = len(image_files) > 1
                
                # Build audio section if exists
                audio_section = ""
                if has_audio:
                    audio_section = """
**音频分析：**
如果可能，也请分析 audio.mp3 文件。描述：
- 音频类型：音乐、人声对话、环境音等
- 关键内容：说了什么或听到了什么
- 氛围/情绪：音频传达了什么感觉"""
                
                if is_multi_image:
                    media_prompt = f"""请读取并分析当前目录下的 {len(image_files)} 张图片：
{file_list_str}{audio_section}

对**每张图片**按照以下格式提供结构化分析：

**第一张图 - [文件名]：**
- 展示内容：[简要描述图片主要内容]
- 关键细节：[重要元素、人物、物品、文字信息]
- 视觉风格：[色彩、布局、设计风格]

**第二张图 - [文件名]：**
- 展示内容：[简要描述]
- 关键细节：[重要元素]
- 视觉风格：[色彩、布局]

（继续分析所有图片...）

**总结：** 简要概括所有图片共同展示的内容或主题。"""
                else:
                    media_prompt = f"""请读取并分析当前目录下的以下媒体文件：
{file_list_str}{audio_section}

对每张图片/视频帧，描述：
1. 画面内容：展示了什么？（人物、物品、场景、动作）
2. 视觉风格：色彩、光线、构图
3. 文字信息：图片中是否有可见文字
4. 整体印象

分析完媒体后，结合推文文字理解完整内容。"""
            else:
                media_prompt = "无媒体文件需要分析。"
            
            # First call: Analyze media
            if files_to_analyze:
                log(f"  🤖 正在用 Kimi 分析媒体...")
                cmd = ['kimi', '--print', '--yolo', '--prompt', media_prompt]
                
                result = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=120, cwd=folder_path
                )
                
                if result.returncode == 0:
                    media_analysis = extract_kimi_text_content(result.stdout)
                    log(f"  ✓ 媒体分析完成")
                else:
                    media_analysis = f"媒体分析失败: {result.stderr[:200]}"
                    log(f"  ⚠ 媒体分析失败")
            else:
                media_analysis = "无媒体需要分析"
            
            # Second call: Generate title
            title_prompt = f"""基于以下信息，生成一个有吸引力的标题：

推文内容：
{text_content[:500]}

媒体分析：
{media_analysis[:1000]}

关键要求：
1. 推文内容是中文 - 你必须生成中文标题
2. 标题必须使用中文（带emoji，15-20字）- 必须以 **标题：** 开头
3. 不要翻译成英文 - 保持标题为中文
4. 准确概括文字和视觉内容
5. 有吸引力、适合社交媒体传播

格式：
**标题：** [中文emoji标题]
**理由：** 简要说明为什么这个标题合适

重要：推文是中文的，标题必须使用中文，不能用英文。"""
        
        # Generate title
        log(f"  🤖 Generating title...")
        cmd = ['kimi', '--print', '--yolo', '--prompt', title_prompt]
        
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=90, cwd=folder_path
        )
        
        if result.returncode == 0:
            output = result.stdout
            
            # Extract title
            extracted_title = extract_title_from_kimi_output(output, language)
            if extracted_title:
                log(f"  ✓ Title: {extracted_title[:50]}...")
            else:
                log(f"  ⚠ No title extracted, using fallback")
                extracted_title = generate_fallback_title(text_content, language)
            
            # Save full analysis
            full_analysis = f"""=== MEDIA ANALYSIS ===
{media_analysis}

=== TITLE GENERATION ===
{output}"""
            
            with open(os.path.join(folder_path, '_kimi_analysis.txt'), 'w', encoding='utf-8') as f:
                f.write(full_analysis)
            
            return {
                'full_analysis': full_analysis,
                'media_analysis': media_analysis,
                'title': extracted_title
            }
        else:
            log(f"  ⚠ Title generation failed: {result.stderr[:200]}")
            fallback = generate_fallback_title(text_content, language)
            return {
                'full_analysis': f"Failed: {result.stderr}",
                'media_analysis': media_analysis if 'media_analysis' in locals() else "",
                'title': fallback
            }
            
    except subprocess.TimeoutExpired:
        log(f"  ⏱️ Kimi timed out, using fallback")
        fallback_title = generate_fallback_title(text_content, language)
        return {
            'full_analysis': "Kimi timed out",
            'media_analysis': "",
            'title': fallback_title
        }
    except Exception as e:
        log(f"  ✗ Analysis error: {e}")
        import traceback
        traceback.print_exc()
        fallback_title = generate_fallback_title(text_content, language)
        return {
            'full_analysis': f"Error: {e}",
            'media_analysis': "",
            'title': fallback_title
        }

def generate_fallback_title(text, language='zh'):
    """生成降级标题（当Kimi失败时使用）"""
    # 清理文本
    clean_text = re.sub(r'https?://\S+', '', text)  # 移除URL
    clean_text = re.sub(r'RT\s+@\w+:\s*', '', clean_text)  # 移除RT前缀
    clean_text = clean_text.strip()
    
    # 提取前20个字符作为标题基础
    base = clean_text[:30] if len(clean_text) > 30 else clean_text
    
    if language == 'en':
        # 添加emoji和格式
        emojis = ['🔥', '💡', '📌', '✨', '🎯']
        emoji = random.choice(emojis)
        title = f"{emoji} {base[:40]}..." if len(base) > 40 else f"{emoji} {base}"
    else:
        # 中文标题
        emojis = ['🔥', '💡', '📌', '✨', '🎯', '🤔', '👀']
        emoji = random.choice(emojis)
        title = f"{emoji}{base[:25]}..." if len(base) > 25 else f"{emoji}{base}"
    
    return title.strip()

def sanitize_folder_name(name):
    """清理文件夹名，移除非法字符"""
    name = re.sub(r'[\\/:*?"<>|]', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    if len(name) > 80:
        name = name[:80]
    return name

def process_tweet(tweet, author, api, language='zh'):
    """Process single tweet"""
    text = tweet.get('text', '')
    tweet_id = tweet.get('tweet_id') or tweet.get('id', '')
    
    category = smart_categorize(text, author)
    
    temp_id = datetime.now().strftime('%H%M%S')
    temp_name = f"_pending_{author}_{temp_id}"
    folder_path = os.path.join(HOT_TOPICS, category, temp_name)
    os.makedirs(folder_path, exist_ok=True)
    
    # Process media - fix for None handling and card media
    media = tweet.get('media') or []
    
    # Check for card media (external links with images)
    card = tweet.get('card')
    if card and isinstance(card, dict):
        if 'media' in card and card['media']:
            card_media = card['media']
            if isinstance(card_media, dict) and 'image_url' in card_media:
                # Add card image as media
                if not media:
                    media = []
                if isinstance(media, list):
                    media.append({'type': 'photo', 'media_url_https': card_media['image_url']})
        elif 'image_url' in card:
            if not media:
                media = []
            if isinstance(media, list):
                media.append({'type': 'photo', 'media_url_https': card['image_url']})
    
    if isinstance(media, dict):
        if 'photo' in media:
            media = media['photo']
        elif 'video' in media:
            media = media['video']
        else:
            media = [media] if media else []
    elif media is None:
        media = []
    
    downloaded_images = []
    video_path = None
    has_video = False
    
    # Download media
    if media:
        for i, m in enumerate(list(media)[:4]):
            if isinstance(m, dict):
                if m.get('type') == 'video' or 'video_info' in m or 'variants' in m:
                    has_video = True
                    video_url = None
                    variants = m.get('variants', [])
                    mp4_variants = [v for v in variants if v.get('content_type') == 'video/mp4']
                    if mp4_variants:
                        best = max(mp4_variants, key=lambda x: x.get('bitrate', 0))
                        video_url = best.get('url')
                    
                    if video_url:
                        video_path = os.path.join(folder_path, 'video.mp4')
                        log(f"  Downloading video from variants...")
                        if download_video(video_url, video_path):
                            log(f"  ✓ Video downloaded: {os.path.getsize(video_path)/1024:.1f}KB")
                        else:
                            log(f"  ✗ Video download failed")
                    else:
                        log(f"  ✗ No MP4 variant found")
                else:
                    url = m.get('media_url_https') or m.get('url')
                    if url:
                        img_path = os.path.join(folder_path, f'image_{i}.jpg')
                        if download_image(url, img_path):
                            downloaded_images.append(img_path)
                            log(f"  ✓ Downloaded image {i+1}")
    
    # Create cover
    cover_path = os.path.join(folder_path, 'cover.jpg')
    
    if has_video and video_path and os.path.exists(video_path):
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
    if isinstance(author_data, dict):
        author_name = author_data.get('name', author)
    else:
        author_name = author
    
    is_rt = text.strip().upper().startswith('RT ')
    original_content = extract_original_from_rt(text)
    
    # Kimi analysis with media
    media_files = downloaded_images + ([video_path] if video_path else [])
    kimi_result = analyze_with_kimi(media_files, original_content, folder_path, language)
    
    kimi_analysis_text = kimi_result.get('full_analysis', '') if isinstance(kimi_result, dict) else str(kimi_result)
    media_analysis = kimi_result.get('media_analysis', '') if isinstance(kimi_result, dict) else ""
    extracted_title = kimi_result.get('title') if isinstance(kimi_result, dict) else None
    suggested_title = extracted_title or ('[Pending Title]' if language == 'en' else '[待优化标题]')
    
    # Build content
    if language == 'en':
        content_parts = [
            f"[Tweet Content]\n{original_content[:500]}\n",
        ]
        
        # Add media analysis if available
        if media_analysis:
            content_parts.append(f"\n[Media Analysis]\n{media_analysis}\n")
        
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
            'has_media': len(media) > 0,
            'has_video': has_video,
            'media_count': len(media),
            'status': 'COMPLETED' if extracted_title else 'PENDING_TITLE',
            'kimi_analysis': kimi_analysis_text,
            'media_analysis': media_analysis
        }
    else:
        content_parts = [
            f"【推文内容】\n{original_content[:500]}\n",
        ]
        
        # Add media analysis if available
        if media_analysis:
            content_parts.append(f"\n【媒体分析】\n{media_analysis}\n")
        
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
            'has_media': len(media) > 0,
            'has_video': has_video,
            'media_count': len(media),
            'status': 'COMPLETED' if extracted_title else 'PENDING_TITLE',
            'kimi_analysis': kimi_analysis_text,
            'media_analysis': media_analysis
        }
        
    json_path = os.path.join(folder_path, 'post.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    # 如果成功提取到标题，重命名文件夹
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

def extract_tweet_id_from_url(url):
    """从推文 URL 中提取 tweet ID"""
    patterns = [
        r'twitter\.com/\w+/status/(\d+)',
        r'x\.com/\w+/status/(\d+)',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None

def fetch_by_url(url, api, language=None):
    """通过 URL 抓取单条推文"""
    tweet_id = extract_tweet_id_from_url(url)
    if not tweet_id:
        log(f"  ✗ Cannot extract tweet ID from URL: {url}")
        return None
    
    log(f"  Fetching tweet ID: {tweet_id}")
    result = api.twitter_get_tweet_detail(tweet_id)
    
    if result.get('code') != 200:
        log(f"  ✗ API error: {result.get('code')}")
        return None
    
    tweet = result.get('data', {})
    author = tweet.get('author', {}).get('screen_name', 'unknown')
    
    # Auto-detect language if not specified
    if not language:
        text = tweet.get('text', '')
        language = 'zh' if any('\u4e00' <= c <= '\u9fff' for c in text) else 'en'
        log(f"  Auto-detected language: {language}")
    
    return process_tweet(tweet, author, api, language=language)

def fetch_by_user(username, api, count=1, language=None):
    """抓取指定博主的最新 N 条推文"""
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
            # Auto-detect language if not specified
            lang = language
            if not lang:
                text = tweet.get('text', '')
                lang = 'zh' if any('\u4e00' <= c <= '\u9fff' for c in text) else 'en'
            
            info = process_tweet(tweet, username, api, language=lang)
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
    
    args = parser.parse_args()
    
    log("=" * 60)
    log("Hot Topics Fetcher v2.6 - Smart Mode")
    log("=" * 60)
    
    api = TikHubAPI()
    results = []
    
    if args.url:
        # Mode 1: Fetch specific tweet by URL
        log(f"\n📎 Fetching specific tweet:")
        log(f"   URL: {args.url}")
        info = fetch_by_url(args.url, api, args.lang)
        if info:
            results.append(info)
    
    elif args.user:
        # Mode 2: Fetch user's latest N tweets
        log(f"\n👤 Fetching from user: @{args.user}")
        user_results = fetch_by_user(args.user, api, args.count, args.lang)
        results.extend(user_results)
    
    elif args.random or True:  # Default to random mode if no args
        # Mode 3: Legacy random mode
        log("Loading knowledge base...")
        categories = load_categories()
        
        if not categories:
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
            user_results = fetch_by_user(username, api, count=1)
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
