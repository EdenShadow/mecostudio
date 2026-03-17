#!/usr/bin/env python3
"""X-Grok Skill - X.com queries with categorization"""

import subprocess
import os
import sys
import re
import time
from datetime import datetime

OUTPUT = os.path.expanduser("~/Documents/知识库/我的助手")
PROFILE = "openclaw"  # Use openclaw profile for standalone browser
CLAW = "/opt/homebrew/bin/openclaw"

def run(cmd, use_openclaw=True):
    """Run browser command - supports both openclaw profile and standalone"""
    try:
        if use_openclaw:
            result = subprocess.run([CLAW, "browser", "--browser-profile", PROFILE] + cmd, capture_output=True, text=True, timeout=60)
        else:
            # Use openclaw managed browser (standalone)
            result = subprocess.run([CLAW, "browser"] + cmd, capture_output=True, text=True, timeout=60)
        lines = []
        for line in result.stdout.split('\n'):
            if any(x in line for x in ['Config warnings', 'plugins', '🦞', '─', '│', '◇', '╮', '╯']):
                continue
            lines.append(line)
        return '\n'.join(lines)
    except Exception as e:
        return str(e)

def start_standalone_browser():
    """Start a standalone browser without requiring Chrome extension"""
    try:
        # Try to start browser with openclaw managed profile
        result = subprocess.run(
            [CLAW, "browser", "start", "--browser-profile", "openclaw"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0 or "running" in result.stdout.lower():
            return True
        # Try without profile
        result = subprocess.run(
            [CLAW, "browser", "start"],
            capture_output=True, text=True, timeout=30
        )
        return result.returncode == 0 or "running" in result.stdout.lower()
    except Exception as e:
        print(f"   ⚠️ Browser start warning: {e}")
        return False

def find(snap, kw):
    for line in snap.split('\n'):
        if kw and kw not in line:
            continue
        if '[ref=' in line:
            try:
                return line.split('[ref=')[1].split(']')[0].strip()
            except Exception:
                pass
    return None

def get_clipboard():
    """获取系统剪贴板内容"""
    try:
        result = subprocess.run(['pbpaste'], capture_output=True, text=True, timeout=10)
        return result.stdout if result.stdout else ""
    except:
        return ""

def suggest_category(question):
    """根据问题决定分类"""
    q = question.lower()
    
    if '博主' in q or '账号' in q:
        if any(x in q for x in ['美食', '吃', '餐厅', '食谱']):
            return "美食探索"
        if any(x in q for x in ['AI', '科技', '编程']):
            return "科技趋势"
        if any(x in q for x in ['财经', '投资', '股票']):
            return "财经投资"
        return "人物推荐"
    
    if any(x in q for x in ['美食', '吃', '餐厅', '食谱', '菜谱', '好吃']):
        return "美食探索"
    if any(x in q for x in ['AI', '科技', '编程', '软件', '工具']):
        return "科技趋势"
    if any(x in q for x in ['财经', '投资', '股票', '金融', '钱']):
        return "财经投资"
    if any(x in q for x in ['学习', '英语', '教程', '教学']):
        return "学习成长"
    if any(x in q for x in ['UFO', '外星人', '神秘', '未解']):
        return "神秘探索"
    if any(x in q for x in ['生活', '健康', '旅行']):
        return "生活百科"
    
    return "综合查询"

def check_browser():
    """检查浏览器状态 - 支持openclaw独立浏览器"""
    try:
        # Check specific profile first
        result = subprocess.run([CLAW, "browser", "status", "--browser-profile", PROFILE], 
                               capture_output=True, text=True, timeout=10)
        output = result.stdout + result.stderr
        
        # For openclaw profile, just check if running
        if PROFILE == "openclaw":
            if "running: true" in output.lower():
                return True, "OK"
            # Try to start it
            print("   🔄 Starting standalone browser...")
            if start_standalone_browser():
                time.sleep(3)
                return True, "Standalone browser started"
        
        # For chrome profile, need extension connection
        if "running: true" in output.lower() and "no tab is connected" not in output.lower():
            return True, "OK"
        
        if "running: false" in output.lower() or "no tab is connected" in output.lower():
            print("   🔄 Starting browser...")
            if start_standalone_browser():
                time.sleep(3)
                result = subprocess.run([CLAW, "browser", "status", "--browser-profile", PROFILE],
                                       capture_output=True, text=True, timeout=10)
                if "running: true" in result.stdout.lower():
                    return True, "Browser started"
            
            return False, "浏览器未连接。请运行: openclaw browser start --browser-profile openclaw"
        
        return True, "OK"
    except Exception as e:
        return False, str(e)

def detect_language(text):
    """Detect if query is Chinese or English"""
    for char in text:
        if '\u4e00' <= char <= '\u9fff':
            return 'zh'
    return 'en'

def find_input_field(snap):
    """Find input field - supports both Chinese and English interfaces"""
    # Try Chinese first
    ref = find(snap, "提出任何問題")
    if ref:
        return ref, 'zh'
    # Try English
    ref = find(snap, "Ask anything") or find(snap, "Ask Grok")
    if ref:
        return ref, 'en'
    # Try generic textbox
    if 'textbox' in snap.lower():
        for line in snap.split('\n'):
            if 'textbox' in line.lower() and '[ref=' in line:
                try:
                    return line.split('[ref=')[1].split(']')[0].strip(), 'auto'
                except:
                    pass
    return None, None

def find_send_button(snap):
    """Find send button - supports both Chinese and English"""
    # Try Chinese
    ref = find(snap, "問 Grok")
    if ref:
        return ref, 'zh'
    # Try English
    ref = find(snap, "Ask Grok") or find(snap, "Send")
    if ref:
        return ref, 'en'
    return None, None

def find_copy_button(snap):
    """Find copy button - supports both Chinese and English"""
    # Try Chinese
    ref = find(snap, "複製文字") or find(snap, "复制文字")
    if ref:
        return ref, 'zh'
    # Try English
    ref = find(snap, "Copy text") or find(snap, "Copy")
    if ref:
        return ref, 'en'
    return None, None

def main():
    q = ' '.join(sys.argv[1:])
    if not q or q in ['--help', '-h']:
        print("X-Grok Skill")
        print("Usage: claw grok 'your question'")
        return
    
    # Filter out flags like --headless
    q = q.replace('--headless', '').strip()
    
    # Detect language
    lang = detect_language(q)
    
    # Bilingual output
    if lang == 'zh':
        print(f"\n🤖 X-Grok: {q}")
        print(f"📂 输出: {OUTPUT}")
        print(f"🔧 配置: {PROFILE}")
    else:
        print(f"\n🤖 X-Grok: {q}")
        print(f"📂 Output: {OUTPUT}")
        print(f"🔧 Profile: {PROFILE}")
    
    # Check browser status
    if lang == 'zh':
        print("\n🔍 检查浏览器状态...")
    else:
        print("\n🔍 Checking browser status...")
    ok, msg = check_browser()
    if not ok:
        print(f"   ❌ {msg}")
        if lang == 'zh':
            print("\n💡 解决方法:")
            print("   1. 打开 Google Chrome 浏览器")
            print("   2. 确保已安装 OpenClaw 浏览器扩展")
            print("   3. 打开任意网页（如 x.com）")
            print("   4. 点击工具栏上的 OpenClaw 扩展图标（徽章变绿表示已连接）")
            print("   5. 重新运行此命令")
        else:
            print("\n💡 Solution:")
            print("   1. Open Google Chrome")
            print("   2. Make sure OpenClaw extension is installed")
            print("   3. Open any webpage (e.g., x.com)")
            print("   4. Click the OpenClaw extension icon (badge turns green when connected)")
            print("   5. Run this command again")
        return
    
    if lang == 'zh':
        print("   ✅ 浏览器已连接")
        print("\n1️⃣ 打开 Grok...")
    else:
        print("   ✅ Browser connected")
        print("\n1️⃣ Opening Grok...")
    
    result = run(["open", "https://x.com/i/grok"])
    if "error" in result.lower() or "failed" in result.lower():
        print(f"   ❌ Failed to open browser: {result[:200]}")
        return
    time.sleep(4)
    
    if lang == 'zh':
        print("2️⃣ 输入问题...")
    else:
        print("2️⃣ Entering question...")
    snap = run(["snapshot", "--format", "ai"])
    ref, ui_lang = find_input_field(snap)
    if ref:
        run(["type", ref, q])
        print(f"   ✅ {q}")
    else:
        if lang == 'zh':
            print("   ⚠️ 未找到输入框")
        else:
            print("   ⚠️ Input field not found")
    
    time.sleep(2)
    
    if lang == 'zh':
        print("3️⃣ 发送...")
    else:
        print("3️⃣ Sending...")
    snap = run(["snapshot", "--format", "ai"])
    ref, _ = find_send_button(snap)
    if ref:
        run(["click", ref])
        if lang == 'zh':
            print("   ✅ 已发送")
        else:
            print("   ✅ Sent")
    else:
        if lang == 'zh':
            print("   ⚠️ 未找到发送按钮")
        else:
            print("   ⚠️ Send button not found")
    
    if lang == 'zh':
        print("4️⃣ 等待回答...")
    else:
        print("4️⃣ Waiting for response...")
    for i in range(24):
        time.sleep(5)
        snap = run(["snapshot", "--format", "ai"])
        copy_ref, _ = find_copy_button(snap)
        if copy_ref:
            if lang == 'zh':
                print("   ✅ 回答已就绪")
            else:
                print("   ✅ Response ready")
            break
        if lang == 'zh':
            print(f"   ⏳ 等待中... ({i+1}/24)")
        else:
            print(f"   ⏳ Waiting... ({i+1}/24)")
    else:
        if lang == 'zh':
            print("   ⚠️ 等待超时，使用当前内容")
        else:
            print("   ⚠️ Timeout, using current content")
    
    if lang == 'zh':
        print("5️⃣ 第一次点击复制...")
    else:
        print("5️⃣ First copy click...")
    snap = run(["snapshot", "--format", "ai"])
    copy_ref, _ = find_copy_button(snap)
    if copy_ref:
        run(["click", copy_ref])
        if lang == 'zh':
            print("   ✅ 已点击")
        else:
            print("   ✅ Clicked")
        time.sleep(2)
    else:
        if lang == 'zh':
            print("   ⚠️ 未找到复制按钮")
        else:
            print("   ⚠️ Copy button not found")
    
    if lang == 'zh':
        print("6️⃣ 第二次点击复制（弹窗）...")
    else:
        print("6️⃣ Second copy click (popup)...")
    snap = run(["snapshot", "--format", "ai"])
    copy_ref2, _ = find_copy_button(snap)
    if copy_ref2:
        run(["click", copy_ref2])
        if lang == 'zh':
            print("   ✅ 已点击")
        else:
            print("   ✅ Clicked")
        time.sleep(1)
    else:
        if lang == 'zh':
            print("   ⚠️ 未找到二次复制按钮")
        else:
            print("   ⚠️ Second copy button not found")
    
    if lang == 'zh':
        print("7️⃣ 获取剪贴板...")
    else:
        print("7️⃣ Getting clipboard...")
    clipboard = get_clipboard()
    
    if lang == 'zh':
        print("8️⃣ 保存...")
    else:
        print("8️⃣ Saving...")
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    name = q.replace(' ', '_')[:30]
    name = ''.join(c for c in name if c.isalnum() or c in '_-')
    
    folder = suggest_category(q)
    folder_path = os.path.join(OUTPUT, folder)
    
    if lang == 'zh':
        print(f"   📂 创建目录: {folder_path}")
    else:
        print(f"   📂 Creating directory: {folder_path}")
    os.makedirs(folder_path, exist_ok=True)
    
    path = os.path.join(folder_path, f"{ts}_{name}.txt")
    if lang == 'zh':
        print(f"   📝 保存文件: {path}")
    else:
        print(f"   📝 Saving file: {path}")
    
    content_to_save = clipboard if clipboard else snap
    if not content_to_save or len(content_to_save.strip()) < 10:
        if lang == 'zh':
            print(f"   ⚠️ 警告: 内容为空或太短，使用快照备用")
        else:
            print(f"   ⚠️ Warning: Content empty or too short, using snapshot")
        content_to_save = snap
    
    try:
        with open(path, 'w', encoding='utf-8') as f:
            if lang == 'zh':
                f.write(f"# {q}\n")
                f.write(f"# 时间: {datetime.now().strftime('%Y/%m/%d %H:%M')}\n")
                f.write(f"# 来源: X.com Grok\n\n")
            else:
                f.write(f"# {q}\n")
                f.write(f"# Time: {datetime.now().strftime('%Y/%m/%d %H:%M')}\n")
                f.write(f"# Source: X.com Grok\n\n")
            f.write(content_to_save)
        
        # 验证文件是否成功写入
        if os.path.exists(path):
            file_size = os.path.getsize(path)
            if lang == 'zh':
                print(f"   ✅ 文件已保存 ({file_size} bytes)")
            else:
                print(f"   ✅ File saved ({file_size} bytes)")
        else:
            if lang == 'zh':
                print(f"   ❌ 文件保存失败")
            else:
                print(f"   ❌ File save failed")
    except Exception as e:
        if lang == 'zh':
            print(f"   ❌ 保存错误: {e}")
        else:
            print(f"   ❌ Save error: {e}")
    
    run(["stop"])
    
    if lang == 'zh':
        print(f"\n✅ 完成!")
        print(f"\n📁 {folder}/")
        print(f"📄 {ts}_{name}.txt")
    else:
        print(f"\n✅ Complete!")
        print(f"\n📁 {folder}/")
        print(f"📄 {ts}_{name}.txt")

if __name__ == "__main__":
    main()
