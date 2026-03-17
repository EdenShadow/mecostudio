#!/usr/bin/env python3
"""
Execute 10 x-grok questions one by one with progress tracking
"""
import subprocess
import sys
import os
import time
from datetime import datetime

QUESTIONS = [
    "What are the most underrated AI tools launched in 2026 that actually solve real problems? Not hype, just utility.",
    "Which tech founders on X.com have the most contrarian views about AI development that turned out to be right?",
    "What political trends on X.com in 2026 indicate a major shift in how democracies use social media for governance?",
    "Who are the most credible independent journalists on X covering underreported geopolitical conflicts?",
    "How are drone warfare and AI changing military strategy in 2026? What do defense experts on X say about autonomous weapons?",
    "What underground entertainment trends started on X.com and crossed over to mainstream culture in 2026?",
    "Which food creators on X are revolutionizing how we think about sustainable eating without being preachy?",
    "What alternative learning platforms are actually replacing traditional degrees, according to educators on X?",
    "What productivity tools are solo founders using in 2026 to compete with big tech? The real stack, not the marketed one.",
    "What are the boldest but most credible predictions for 2027 from thinkers on X who have a track record of being right?"
]

print("="*70)
print("🤖 X-GROK: 10 INTERESTING QUESTIONS")
print("="*70)
print(f"Start time: {datetime.now().strftime('%H:%M:%S')}")
print()

for i, q in enumerate(QUESTIONS, 1):
    print(f"\n{'='*70}")
    print(f"Q{i}/10")
    print(f"Question: {q}")
    print(f"{'='*70}")
    
    try:
        # Use unbuffered output
        script_dir = os.path.dirname(os.path.abspath(__file__))
        result = subprocess.run(
            [sys.executable, '-u', 'skill.py', q],
            cwd=script_dir,
            capture_output=True,
            text=True,
            timeout=180
        )
        
        # Show last part of output
        output = result.stdout
        if output:
            lines = output.strip().split('\n')
            print(f"✅ Completed: {lines[-1] if lines else 'Done'}")
        
        if result.stderr and 'error' in result.stderr.lower():
            print(f"⚠️  Warning: {result.stderr[:200]}")
            
    except subprocess.TimeoutExpired:
        print(f"⏱️  Q{i} timeout (3 min), continuing...")
    except Exception as e:
        print(f"❌ Q{i} error: {e}")
    
    if i < 10:
        print(f"\n⏳ Waiting 5s before next question...")
        time.sleep(5)

print("\n" + "="*70)
print("✅ ALL 10 QUESTIONS COMPLETED!")
print(f"End time: {datetime.now().strftime('%H:%M:%S')}")
print("="*70)

# List all new files
print("\n📁 New files created:")
output_dir = os.path.expanduser('~/Documents/知识库/我的助手/综合查询')
grok_files = sorted([
    f for f in os.listdir(output_dir)
    if f.endswith('.txt') and '20260211_20' in f
])
for f in grok_files:
    print(f"  - {f}")
