#!/usr/bin/env python3
"""
X.com Grok Query Skill - Fully Automated

Complete automation:
1. Opens X.com Grok
2. Types question
3. Submits
4. Waits for answer
5. Copies answer
6. Saves and organizes
7. Closes browser

Usage:
    python3 xgrok_auto.py "your question"
    python3 xgrok_auto.py --clipboard
"""

import subprocess
import json
import re
import os
import sys
import time
from datetime import datetime
from pathlib import Path

# Configuration
HOME_DIR = os.path.expanduser("~")
OUTPUT_BASE = os.path.join(HOME_DIR, "Documents", "知识库")
AGENT_NAME = os.environ.get("X_GROK_AGENT", "我的助手")
GROK_URL = "https://x.com/i/grok"
BROWSER_PROFILE = "openclaw"


def run_command(args, timeout=60):
    """Run openclaw browser command"""
    cmd = ["openclaw", "browser"] + args
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        return result.stdout, result.stderr, result.returncode
    except Exception as e:
        return "", str(e), 1


def wait(seconds=3):
    """Wait for specified seconds"""
    print(f"⏳ Waiting {seconds}s...")
    time.sleep(seconds)


def find_element(snapshot_data, role=None, name_keyword=None):
    """Find element ref by role and/or name keyword"""
    try:
        data = json.loads(snapshot_data)
        elements = data.get("elements", {})
        
        for ref, el in elements.items():
            name = el.get("name", "")
            
            if role and el.get("role") != role:
                continue
                
            if name_keyword and name_keyword not in name:
                continue
                
            return ref, el
    except:
        pass
    return None, None


def get_answer_from_snapshot(snapshot_data):
    """Extract answer text from snapshot"""
    try:
        data = json.loads(snapshot_data)
        elements = data.get("elements", {})
        
        # Look for generic elements with long text (likely the answer)
        for ref, el in elements.items():
            if el.get("role") == "generic":
                name = el.get("name", "")
                # Look for answer-like content
                if any(keyword in name for keyword in ["@", "http", "以下是", "推荐", "分析"]):
                    if len(name) > 50:  # Likely the answer
                        return name
        
        # Look for list items (answer often contains lists)
        lists = []
        for ref, el in elements.items():
            if el.get("role") == "list":
                lists.append(el)
        
        if lists:
            # Get the largest list (likely the answer)
            lists.sort(key=lambda x: len(x.get("name", "")), reverse=True)
            return lists[0].get("name", "")
        
    except:
        pass
    return None


def copy_and_get_answer():
    """Click copy button and get answer from clipboard"""
    # Find and click copy button
    stdout, stderr, code = run_command([
        "--browser-profile", BROWSER_PROFILE,
        "snapshot", "--format", "ai", "--json"
    ])
    
    copy_ref, _ = find_element(stdout, name_keyword="複製文字")
    if copy_ref:
        print(f"   ✅ Found copy button: {copy_ref}")
        run_command(["--browser-profile", BROWSER_PROFILE, "click", copy_ref])
        print(f"   ✅ Clicked copy button")
        time.sleep(2)
        
        # Get from clipboard
        result = subprocess.run(["pbpaste"], capture_output=True, text=True)
        return result.stdout.strip()
    
    return None


def extract_usernames(text):
    """Extract X usernames from text"""
    return list(set(re.findall(r'@[a-zA-Z0-9_]+', text)))


def extract_links(text):
    """Extract URLs from text"""
    return list(set(re.findall(r'https?://[^\s]+', text)))


def save_answer(answer, question):
    """Save and organize answer"""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    timestamp_file = datetime.now().strftime("%Y%m%d-%H-%M-%S")
    
    output_dir = os.path.join(OUTPUT_BASE, AGENT_NAME)
    os.makedirs(output_dir, exist_ok=True)
    
    # Clean filename
    clean_name = re.sub(r'[<>:"/\\|?*]', '', question)
    clean_name = re.sub(r'\s+', '_', clean_name)[:40]
    
    # Extract data
    usernames = extract_usernames(answer)
    links = extract_links(answer)
    
    # Generate organized content
    content = f"""X.com Grok 查询结果
========================
时间: {datetime.now().strftime("%Y/%m/%d %H:%M:%S")}
问题: {question}
智能体: {AGENT_NAME}
========================

{answer}
"""

    if usernames:
        content += f"\n📱 账号列表 ({len(usernames)} 个):\n"
        for i, user in enumerate(usernames, 1):
            content += f"{i}. {user}\n"
    
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
🛠️ OpenClaw {AGENT_NAME} 自动整理
"""

    # Save main file
    filename = f"{timestamp_file}_{clean_name}.txt"
    filepath = os.path.join(output_dir, filename)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print(f"💾 已保存: {filepath}")
    
    # Save list file
    list_filepath = None
    if usernames:
        list_filename = f"{timestamp}_账号列表.txt"
        list_filepath = os.path.join(output_dir, list_filename)
        
        list_content = f"""X.com 账号列表
========================
时间: {datetime.now().strftime("%Y/%m/%d %H:%M:%S")}
问题: {question}
智能体: {AGENT_NAME}
========================

"""
        for i, user in enumerate(usernames, 1):
            list_content += f"{i}. {user}\n"
        
        list_content += f"""
---
总计: {len(usernames)} 个账号
由 OpenClaw {AGENT_NAME} 技能生成
"""
        
        with open(list_filepath, 'w', encoding='utf-8') as f:
            f.write(list_content)
        
        print(f"📋 账号列表: {list_filepath}")
    
    return filepath, usernames, links


def wait_for_answer(max_wait=120, check_interval=5):
    """Wait for Grok's answer to appear"""
    print(f"⏳ Waiting for Grok's answer (max {max_wait}s)...")
    
    start_time = time.time()
    last_answer_len = 0
    
    while time.time() - start_time < max_wait:
        # Check snapshot for answer
        stdout, stderr, code = run_command([
            "--browser-profile", BROWSER_PROFILE,
            "snapshot", "--format", "ai", "--json"
        ])
        
        if code == 0:
            # Look for answer
            answer = get_answer_from_snapshot(stdout)
            if answer and len(answer) > 100:
                # Check if answer changed
                if len(answer) != last_answer_len:
                    print(f"   📝 Answer detected ({len(answer)} chars)")
                    last_answer_len = len(answer)
                
                # Try to copy
                copied = copy_and_get_answer()
                if copied and len(copied) > 50:
                    print(f"   ✅ Got answer from clipboard ({len(copied)} chars)")
                    return copied
        
        print(f"   ⏳ Waiting... ({int(time.time() - start_time)}s)")
        time.sleep(check_interval)
    
    print(f"   ⚠️  Timeout waiting for answer")
    return None


def main():
    question = ' '.join(sys.argv[1:])
    
    if not question or question in ['--help', '-h']:
        print("""
X.com Grok Query - Fully Automated
================================

Usage:
    python3 xgrok_auto.py "your question"
    python3 xgrok_auto.py --clipboard

Features:
    🌐 Opens X.com Grok automatically
    💬 Types question automatically
    📤 Submits automatically
    ⏳ Waits for answer automatically
    📋 Copies answer automatically
    🗂️ Saves and organizes automatically
    🔒 Closes browser automatically

Output:
    ~/Documents/知识库/[Agent Name]/[Timestamp]_[question].txt
    ~/Documents/知识库/[Agent Name]/[date]_账号列表.txt

Customize Agent Name:
    export X_GROK_AGENT="你的助手名"
""")
        return
    
    print("=" * 60)
    print("X.com Grok Query - Fully Automated")
    print("=" * 60)
    print()
    print(f"📝 问题: {question}")
    print(f"📁 智能体: {AGENT_NAME}")
    print()
    
    # Step 1: Open Grok
    print("1️⃣  正在打开 X.com Grok...")
    run_command(["--browser-profile", BROWSER_PROFILE, "open", GROK_URL])
    wait(3)
    print("   ✅ 页面已打开")
    
    # Step 2: Type question
    print("2️⃣  正在查找输入框...")
    stdout, stderr, code = run_command([
        "--browser-profile", BROWSER_PROFILE,
        "snapshot", "--format", "ai", "--json"
    ])
    
    input_ref, _ = find_element(stdout, name_keyword="提出任何問題")
    if input_ref:
        print(f"   ✅ 找到输入框: {input_ref}")
        run_command(["--browser-profile", BROWSER_PROFILE, "type", input_ref, question])
        print(f"   ✅ 问题已输入")
    else:
        print("   ⚠️  未找到输入框")
        return
    
    wait(2)
    
    # Step 3: Submit
    print("3️⃣  正在查找发送按钮...")
    stdout, stderr, code = run_command([
        "--browser-profile", BROWSER_PROFILE,
        "snapshot", "--format", "ai", "--json"
    ])
    
    send_ref, _ = find_element(stdout, name_keyword="問 Grok")
    if send_ref:
        print(f"   ✅ 找到发送按钮: {send_ref}")
        run_command(["--browser-profile", BROWSER_PROFILE, "click", send_ref])
        print(f"   ✅ 问题已发送")
    else:
        print("   ⚠️  未找到发送按钮")
        return
    
    # Step 4: Wait for answer
    print("4️⃣  等待 Grok 回答...")
    answer = wait_for_answer(max_wait=180, check_interval=5)
    
    if not answer:
        print("   ⚠️  无法自动获取答案，请手动复制")
        print("   📋 浏览器仍开着，手动复制后运行:")
        print(f"      python3 xgrok_auto.py --clipboard \"{question}\"")
        return
    
    # Step 5: Save
    print("5️⃣  正在保存答案...")
    filepath, usernames, links = save_answer(answer, question)
    
    # Step 6: Close
    print("6️⃣  正在关闭浏览器...")
    run_command(["--browser-profile", BROWSER_PROFILE, "stop"])
    print("   ✅ 浏览器已关闭")
    
    print()
    print("=" * 60)
    print("✅ 完成！")
    print("=" * 60)
    print()
    print(f"📁 文件位置: {filepath}")
    print(f"📊 账号: {len(usernames)} 个")
    print(f"🔗 链接: {len(links)} 个")


if __name__ == "__main__":
    main()
