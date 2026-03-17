#!/usr/bin/env python3
"""X.com Grok Query - Categorized + Summary"""

import subprocess
import os
import sys
import re
import time
from datetime import datetime

HOME_DIR = os.path.expanduser("~")
OUTPUT_BASE = os.path.join(HOME_DIR, "Documents", "知识库", "我的助手")
GROK_URL = "https://x.com/i/grok"
BROWSER_PROFILE = "openclaw"


def run_command(args, timeout=60):
    cmd = ["openclaw", "browser"] + args
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return result.stdout, result.stderr, result.returncode
    except:
        return "", "", 1


def find_element(snapshot, role=None, name_keyword=None):
    try:
        for line in snapshot.split('\n'):
            if role and role not in line:
                continue
            if name_keyword and name_keyword not in line:
                continue
            if '[ref=' in line:
                return line.split('[ref=')[1].split(']')[0].strip()
    except:
        pass
    return None


def detect_category(question):
    q = question.lower()
    
    if any(k in q for k in ['财经', '投资', '股票', '金融', 'crypto', 'finance', 'invest']):
        category = "财经投资"
    elif any(k in q for k in ['科技', 'AI', '编程', '软件', 'tech', 'software', 'coding', '人工智能']):
        category = "科技趋势"
    elif any(k in q for k in ['博主', '账号', '搞笑', '幽默']):
        category = "人物推荐"
    elif any(k in q for k in ['工具', 'APP', '网站', '资源']):
        category = "工具资源"
    elif any(k in q for k in ['学习', '英语', '教学', '教程', '课程', 'learn', 'teach']):
        category = "学习成长"
    elif any(k in q for k in ['UFO', '外星人', '神秘', '未解', 'conspiracy']):
        category = "神秘探索"
    elif any(k in q for k in ['生活', '健康', '美食', '旅行']):
        category = "生活百科"
    else:
        category = "综合查询"
    
    # Auto create folder if not exists
    folder = os.path.join(OUTPUT_BASE, category)
    os.makedirs(folder, exist_ok=True)
    
    return category


def extract_content(snapshot):
    lines = snapshot.split('\n')
    content = []
    started = False
    
    for line in lines:
        if '以下是' in line or '推荐' in line:
            started = True
        
        if started:
            if 'button' in line and ('複製' in line or 'Copy' in line):
                break
            clean = re.sub(r'\[ref=[^\]]+\]', '', line)
            clean = re.sub(r'/url:[^\s]+', '', clean)
            clean = re.sub(r'cursor=[^\s]+', '', clean)
            clean = clean.strip()
            if len(clean) > 3:
                content.append(clean)
    
    return '\n'.join(content)


def extract_accounts(content):
    accounts = []
    lines = content.split('\n')
    
    for line in lines:
        # Find @username
        usernames = re.findall(r'@[a-zA-Z0-9_]+', line)
        for username in usernames:
            # Find description (text after username)
            desc = line.replace(username, '').strip()
            desc = re.sub(r'^[\s:：\-]+', '', desc)
            if len(desc) > 5:
                accounts.append((username, desc[:150]))
            else:
                accounts.append((username, ""))
    
    return accounts


def create_summary(question, category, accounts):
    lines = []
    lines.append("=" * 60)
    lines.append(f"📚 {category}")
    lines.append("=" * 60)
    lines.append(f"问题: {question}")
    lines.append(f"时间: {datetime.now().strftime('%Y/%m/%d %H:%M')}")
    lines.append(f"来源: X.com Grok")
    lines.append("=" * 60)
    lines.append("")
    
    for i, (account, desc) in enumerate(accounts, 1):
        lines.append(f"{i}. {account}")
        if desc:
            lines.append(f"   {desc}")
        lines.append("")
    
    lines.append("=" * 60)
    lines.append(f"总计: {len(accounts)} 个")
    
    return '\n'.join(lines)


def main():
    question = ' '.join(sys.argv[1:])
    
    if not question or question in ['--help', '-h']:
        print("Usage: python3 xgrok.py \"your question\"")
        print("Categories: 财经投资 | 科技趋势 | 人物推荐 | 工具资源 | 学习成长 | 神秘探索 | 生活百科 | 综合查询")
        print("\n会自动创建分类文件夹")
        return
    
    category = detect_category(question)
    
    print("=" * 60)
    print("🔍 X.com Grok Query")
    print("=" * 60)
    print(f"📝 问题: {question}")
    print(f"🏷️ 分类: {category} (已创建/确认)")
    print()
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # 1. Open
    print("1️⃣ 打开...")
    run_command(["--browser-profile", BROWSER_PROFILE, "open", GROK_URL])
    time.sleep(4)
    
    # 2. Type
    print("2️⃣ 输入...")
    snapshot, _, _ = run_command(["--browser-profile", BROWSER_PROFILE, "snapshot", "--format", "ai"])
    ref = find_element(snapshot, "textbox", "提出任何問題")
    if ref:
        run_command(["--browser-profile", BROWSER_PROFILE, "type", ref, question])
        print("   ✅")
    
    time.sleep(2)
    
    # 3. Submit
    print("3️⃣ 发送...")
    snapshot, _, _ = run_command(["--browser-profile", BROWSER_PROFILE, "snapshot", "--format", "ai"])
    ref = find_element(snapshot, "button", "問 Grok")
    if ref:
        run_command(["--browser-profile", BROWSER_PROFILE, "click", ref])
        print("   ✅")
    
    # 4. Wait
    print("4️⃣ 等待...")
    for i in range(24):
        time.sleep(5)
        snapshot, _, _ = run_command(["--browser-profile", BROWSER_PROFILE, "snapshot", "--format", "ai"])
        if '複製文字' in snapshot:
            print("   ✅ 答案已生成！")
            break
    
    # 5. Extract
    print("5️⃣ 提取...")
    snapshot, _, _ = run_command(["--browser-profile", BROWSER_PROFILE, "snapshot", "--format", "ai"])
    content = extract_content(snapshot)
    accounts = extract_accounts(content)
    
    # 6. Save to category folder
    print("6️⃣ 保存...")
    
    clean_name = question.replace(' ', '_')[:30]
    clean_name = ''.join(c for c in clean_name if c.isalnum() or c in '_-')
    
    # Create category folder
    folder = os.path.join(OUTPUT_BASE, category)
    os.makedirs(folder, exist_ok=True)
    
    # Save raw
    raw_filename = f"{timestamp}_{clean_name}_原始.txt"
    raw_filepath = os.path.join(folder, raw_filename)
    with open(raw_filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    # Save summary
    summary = create_summary(question, category, accounts)
    summary_filename = f"{timestamp}_{clean_name}_简洁版.txt"
    summary_filepath = os.path.join(folder, summary_filename)
    with open(summary_filepath, 'w', encoding='utf-8') as f:
        f.write(summary)
    
    print(f"   📄 原始: {raw_filepath}")
    print(f"   📋 简洁: {summary_filepath}")
    
    # 7. Close
    print("7️⃣ 关闭...")
    run_command(["--browser-profile", BROWSER_PROFILE, "stop"])
    print("   ✅")
    
    print()
    print("=" * 60)
    print("✅ 完成！")
    print("=" * 60)
    print()
    print(f"📁 文件夹: {folder}")
    print(f"📄 原始: {raw_filename}")
    print(f"📋 简洁: {summary_filename}")
    print(f"🏷️ 分类: {category}")
    if accounts:
        print(f"👥 {len(accounts)} 个: {', '.join([a[0] for a in accounts[:5]])}")


if __name__ == "__main__":
    main()
