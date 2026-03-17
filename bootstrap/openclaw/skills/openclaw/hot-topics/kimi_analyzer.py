#!/usr/bin/env python3
"""
视频内容 AI 分析器
调用 kimi CLI 分析视频帧和音频
"""

import os
import sys
import json
import subprocess
import re
from pathlib import Path

def log(msg):
    print(f"[Analyzer] {msg}")

def analyze_with_kimi(frames_folder, audio_file, output_json):
    """使用 kimi CLI 分析视频内容"""
    
    # 收集所有帧图片
    frames = sorted([f for f in os.listdir(frames_folder) if f.endswith('.jpg')])
    frame_paths = [os.path.join(frames_folder, f) for f in frames]
    
    log(f"发现 {len(frames)} 张帧图")
    log(f"音频文件: {audio_file}")
    
    # 构建提示词 - 简化版
    prompt = f"""分析这个视频。视频有{len(frames)}帧图片在: {frames_folder}
音频在: {audio_file}

描述画面内容、音频内容、风格，并生成3个带emoji的中文标题（15字内）。
必须按此JSON格式回复：
{{"visual_description": "...", "audio_description": "...", "style_analysis": "...", "title_suggestions": ["...", "...", "..."]}}"""

    log("启动 kimi CLI 分析...")
    
    # 调用 kimi CLI
    cmd = [
        'kimi',
        '--print',
        '--yolo',
        '--prompt', prompt
    ]
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
            cwd=os.path.dirname(frames_folder)
        )
        
        log(f"kimi 返回码: {result.returncode}")
        
        if result.returncode != 0:
            log(f"kimi 错误: {result.stderr}")
            return None
        
        output = result.stdout
        log(f"kimi 输出长度: {len(output)} 字符")
        
        # 保存原始输出
        raw_file = os.path.join(os.path.dirname(output_json), '_kimi_output.txt')
        with open(raw_file, 'w', encoding='utf-8') as f:
            f.write(output)
        log(f"输出已保存: {raw_file}")
        
        # 解析 JSON - 多种方法
        # 方法1: 找 ```json 代码块
        if '```json' in output:
            import re
            match = re.search(r'```json\s*(.*?)\s*```', output, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group(1))
                except:
                    pass
        
        # 方法2: 找大括号包裹的内容
        start = output.find('{')
        end = output.rfind('}') + 1
        if start >= 0 and end > start:
            try:
                return json.loads(output[start:end])
            except:
                pass
        
        # 方法3: 返回原始文本
        return {
            'visual_description': output,
            'audio_description': '请查看 _kimi_output.txt',
            'style_analysis': '',
            'title_suggestions': ['请手动从输出中提取']
        }
            
    except Exception as e:
        log(f"✗ 错误: {e}")
        return None

def update_post_json(folder_path, analysis, new_title=None):
    """更新 post.json 并可选重命名文件夹"""
    post_json_path = os.path.join(folder_path, 'post.json')
    
    if not os.path.exists(post_json_path):
        log(f"✗ 未找到 {post_json_path}")
        return False, None
    
    with open(post_json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 获取或生成新标题
    if not new_title:
        titles = analysis.get('title_suggestions', [])
        if titles and len(titles) > 0:
            new_title = titles[0]
        else:
            new_title = data.get('title', '热门话题')
    
    old_title = data.get('title', '')
    
    # 更新标题
    data['title'] = new_title
    data['topic'] = new_title
    data['status'] = 'COMPLETED'
    
    # 更新内容
    original_content = data.get('content', '')
    ai_analysis = f"""

【AI深度分析 - Kimi CLI】
【画面描述】
{analysis.get('visual_description', '分析中...')}

【音频描述】
{analysis.get('audio_description', '分析中...')}

【风格解读】
{analysis.get('style_analysis', '分析中...')}

【Kimi生成标题选项】
"""
    titles = analysis.get('title_suggestions', [])
    for i, title in enumerate(titles, 1):
        marker = " ✓已应用" if title == new_title else ""
        ai_analysis += f"{i}. {title}{marker}\n"
    
    # 插入到原始内容之前或替换标记
    if '【AI深度分析】' in original_content:
        # 替换已有分析
        parts = original_content.split('【AI深度分析】')
        data['content'] = parts[0] + ai_analysis
    else:
        # 追加新分析
        data['content'] = original_content + ai_analysis
    
    # 保存 JSON
    with open(post_json_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    log(f"✓ 已更新 post.json，标题: {new_title}")
    
    # 如果需要重命名文件夹
    if old_title != new_title and old_title in ['[待优化标题]', '[待优化标题-视频推文]', '']:
        parent_dir = os.path.dirname(folder_path)
        new_folder_name = sanitize_folder_name(new_title)
        new_folder_path = os.path.join(parent_dir, new_folder_name)
        
        # 确保不覆盖已有文件夹
        counter = 1
        original_new_path = new_folder_path
        while os.path.exists(new_folder_path):
            new_folder_path = f"{original_new_path}_{counter}"
            counter += 1
        
        try:
            os.rename(folder_path, new_folder_path)
            log(f"✓ 文件夹重命名: {os.path.basename(folder_path)} → {os.path.basename(new_folder_path)}")
            return True, new_folder_path
        except Exception as e:
            log(f"✗ 重命名失败: {e}")
            return True, folder_path
    
    return True, folder_path

def sanitize_folder_name(name):
    """清理文件夹名"""
    # 移除非法字符
    name = re.sub(r'[\\/:*?"<>|]', '', name).strip()
    # 限制长度
    if len(name) > 50:
        name = name[:50]
    return name
    
    # 构建新的内容
    new_content_parts = [
        original_content.split('【AI分析】')[0] if '【AI分析】' in original_content else original_content,
        "\n\n【AI深度分析 - Kimi】\n",
        f"\n【画面描述】\n{analysis.get('visual_description', '分析中...')}\n",
        f"\n【音频描述】\n{analysis.get('audio_description', '分析中...')}\n",
        f"\n【风格解读】\n{analysis.get('style_analysis', '分析中...')}\n",
        f"\n【建议标题】\n"
    ]
    
    titles = analysis.get('title_suggestions', [])
    for i, title in enumerate(titles, 1):
        new_content_parts.append(f"  {i}. {title}\n")
    
    data['content'] = ''.join(new_content_parts)
    
    # 如果有标题建议，更新 title 和 topic
    if titles and len(titles) > 0:
        best_title = titles[0]
        log(f"更新标题为: {best_title}")
        data['title'] = best_title
        data['topic'] = best_title
    
    # 保存
    with open(post_json_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    log(f"✓ 已更新 {post_json_path}")
    return True

def main():
    if len(sys.argv) < 2:
        print("用法: python3 kimi_analyzer.py <视频文件夹路径>")
        print("示例: python3 kimi_analyzer.py '~/Documents/知识库/热门分享/🦅古代巨猫觉醒现场'")
        sys.exit(1)
    
    folder_path = os.path.expanduser(sys.argv[1])
    
    if not os.path.exists(folder_path):
        log(f"✗ 文件夹不存在: {folder_path}")
        sys.exit(1)
    
    log(f"分析文件夹: {folder_path}")
    
    # 查找资源
    frames_folder = os.path.join(folder_path, 'frames')
    audio_file = os.path.join(folder_path, 'audio.mp3')
    
    if not os.path.exists(frames_folder):
        log(f"✗ 未找到帧图文件夹: {frames_folder}")
        sys.exit(1)
    
    if not os.path.exists(audio_file):
        # 尝试其他音频格式
        for ext in ['.mp3', '.wav', '.aac']:
            alt_audio = os.path.join(folder_path, f'audio{ext}')
            if os.path.exists(alt_audio):
                audio_file = alt_audio
                break
        else:
            log(f"⚠ 未找到音频文件，将只分析画面")
            audio_file = None
    
    # 调用 kimi 分析
    analysis = analyze_with_kimi(frames_folder, audio_file, os.path.join(folder_path, 'post.json'))
    
    if analysis:
        # 更新 post.json 和重命名文件夹
        success, new_folder_path = update_post_json(folder_path, analysis)
        
        if success:
            log("✓ 分析完成并保存")
            
            # 如果文件夹被重命名，显示新路径
            if new_folder_path and new_folder_path != folder_path:
                print("\n" + "="*60)
                print(f"✅ 文件夹已重命名:")
                print(f"  旧: {folder_path}")
                print(f"  新: {new_folder_path}")
                print("="*60)
            
            # 输出建议标题
            print("\n" + "="*60)
            print("Kimi 生成的标题建议:")
            print("="*60)
            for i, title in enumerate(analysis.get('title_suggestions', []), 1):
                marker = " ✓已应用" if i == 1 else ""
                print(f"  {i}. {title}{marker}")
            print("="*60)
            print("\n✅ 已完成:")
            print(f"  • post.json 已更新")
            print(f"  • 标题已设置为: {analysis.get('title_suggestions', [''])[0]}")
            if new_folder_path and new_folder_path != folder_path:
                print(f"  • 文件夹已重命名")
        else:
            log("✗ 更新失败")
    else:
        log("✗ 分析失败")

if __name__ == '__main__':
    main()
