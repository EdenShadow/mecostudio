#!/usr/bin/env python3
"""
X-Grok Get Answer - Save and organize Grok's answer from clipboard

Usage:
    python3 xget.py "original question"
    python3 xget.py --clipboard

Features:
    - Gets answer from clipboard
    - Extracts usernames (@user)
    - Extracts links
    - Saves organized files
"""

import subprocess
import json
import re
import os
import sys
from datetime import datetime
from pathlib import Path

# Configuration
HOME_DIR = os.path.expanduser("~")
OUTPUT_BASE = os.path.join(HOME_DIR, "Documents", "知识库")
AGENT_NAME = os.environ.get("X_GROK_AGENT", "我的助手")


def run_command(args, timeout=30):
    """Run shell command"""
    cmd = args if isinstance(args, list) else args.split()
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return result.stdout
    except:
        return None


def get_clipboard():
    """Get content from clipboard"""
    result = subprocess.run(["pbpaste"], capture_output=True, text=True)
    return result.stdout.strip()


def extract_usernames(text):
    """Extract X usernames from text"""
    return list(set(re.findall(r'@[a-zA-Z0-9_]+', text)))


def extract_links(text):
    """Extract URLs from text"""
    return list(set(re.findall(r'https?://[^\s]+', text)))


def save_files(answer, question, agent_name):
    """Save and organize answer"""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    timestamp_file = datetime.now().strftime("%Y%m%d-%H-%M-%S")
    
    output_dir = os.path.join(OUTPUT_BASE, agent_name)
    os.makedirs(output_dir, exist_ok=True)
    
    # Clean filename
    clean_name = re.sub(r'[<>:"/\\|?*]', '', question)
    clean_name = re.sub(r'\s+', '_', clean_name)[:40]
    
    # Extract data
    usernames = extract_usernames(answer)
    links = extract_links(answer)
    
    # Create main file content
    content = f"""X.com Grok 查询结果
========================
时间: {datetime.now().strftime("%Y/%m/%d %H:%M:%S")}
问题: {question}
智能体: {agent_name}
========================

{answer}
"""

    # Add usernames
    if usernames:
        content += f"\n📱 账号列表 ({len(usernames)} 个):\n"
        for i, user in enumerate(usernames, 1):
            content += f"{i}. {user}\n"
    
    # Add links
    if links:
        content += f"\n🔗 相关链接 ({len(links)} 个):\n"
        for link in links[:10]:
            content += f"- {link}\n"
        if len(links) > 10:
            content += f"- ... 还有 {len(links) - 10} 个链接\n"
    
    content += f"""
---
💡 统计:
- 问题: {question}
- 账号: {len(usernames)} 个
- 链接: {len(links)} 个

---
🛠️ OpenClaw {agent_name} 自动整理
生成时间: {datetime.now().isoformat()}
"""
    
    # Save main file
    filename = f"{timestamp_file}_{clean_name}.txt"
    filepath = os.path.join(output_dir, filename)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    # Save list file if has usernames
    list_filepath = None
    if usernames:
        list_filename = f"{timestamp}_账号列表.txt"
        list_filepath = os.path.join(output_dir, list_filename)
        
        list_content = f"""X.com 账号列表
========================
时间: {datetime.now().strftime("%Y/%m/%d %H:%M:%S")}
问题: {question}
智能体: {agent_name}
========================

"""
        for i, user in enumerate(usernames, 1):
            list_content += f"{i}. {user}\n"
        
        list_content += f"""
---
总计: {len(usernames)} 个账号
由 OpenClaw {agent_name} 技能生成
"""
        
        with open(list_filepath, 'w', encoding='utf-8') as f:
            f.write(list_content)
    
    return filepath, usernames, links


def main():
    args = sys.argv[1:]
    
    if not args:
        print("""
X-Grok Get Answer
=================

Usage:
    python3 xget.py "original question"
    python3 xget.py --clipboard

Workflow:
    1. Copy Grok's answer (already done)
    2. Run: xget.py "your original question"
    3. Files are saved automatically

Output:
    ~/Documents/知识库/[Agent Name]/[Timestamp]_[question].txt
    ~/Documents/知识库/[Agent Name]/[date]_账号列表.txt

Set custom agent name:
    export X_GROK_AGENT="你的助手名"
""")
        return
    
    # Get question
    question = ' '.join(args)
    
    # Get answer from clipboard
    answer = get_clipboard()
    
    if not answer:
        print("❌ 无法获取剪贴板内容")
        print("📋 请先复制 Grok 的答案")
        return
    
    print("=" * 60)
    print("✅ 获取答案成功！")
    print("=" * 60)
    print()
    print(f"📝 问题: {question}")
    print(f"📄 答案: {len(answer)} 字符")
    print()
    
    # Save and organize
    filepath, usernames, links = save_files(answer, question, AGENT_NAME)
    
    print("📁 文件位置:")
    print(f"   {filepath}")
    if usernames:
        print(f"   {filepath.replace('.txt', '_账号列表.txt')}")
    print()
    print("📊 统计:")
    print(f"   - 账号: {len(usernames)} 个")
    print(f"   - 链接: {len(links)} 个")
    print()
    
    if usernames:
        print("👥 账号预览:")
        for user in usernames[:5]:
            print(f"   {user}")
        if len(usernames) > 5:
            print(f"   ... 还有 {len(usernames) - 5} 个")
        print()


if __name__ == "__main__":
    main()
