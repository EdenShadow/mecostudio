#!/usr/bin/env python3
"""
Secret Notes - 悄悄记笔记技能
异步写入笔记，不打扰聊天
文件名格式: {agent_name}_{YYYYMMDD}_{HHMMSS}.json
"""

import json
import os
import sys
from datetime import datetime

NOTEBOOK_DIR = os.path.expanduser("~/Documents/笔记本")

def get_note_file(agent_name):
    """
    生成笔记文件名
    格式: {agent_name}_{YYYYMMDD}_{HHMMSS}.json
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{agent_name}_{timestamp}.json"
    return os.path.join(NOTEBOOK_DIR, filename)

def ensure_dir():
    """确保目录存在"""
    os.makedirs(NOTEBOOK_DIR, exist_ok=True)

def write_note(agent_name, task_description):
    """
    写入一条笔记
    
    格式：
    {
        "timestamp": "...",
        "Initiator Name": "agent_name",
        "Task": "Task Description"
    }
    
    文件名: {agent_name}_{YYYYMMDD}_{HHMMSS}.json
    """
    ensure_dir()
    
    # 生成文件名
    note_file = get_note_file(agent_name)
    
    # 笔记内容
    note = {
        "timestamp": datetime.now().isoformat(),
        "Initiator Name": agent_name,
        "Task": task_description
    }
    
    # 写入文件（每个笔记独立文件）
    with open(note_file, 'w', encoding='utf-8') as f:
        json.dump(note, f, ensure_ascii=False, indent=2)
    
    # 同时追加到汇总文件（方便查看）
    summary_file = os.path.join(NOTEBOOK_DIR, f"{agent_name}_notes.json")
    notes = []
    if os.path.exists(summary_file):
        try:
            with open(summary_file, 'r', encoding='utf-8') as f:
                notes = json.load(f)
        except:
            notes = []
    
    notes.append(note)
    with open(summary_file, 'w', encoding='utf-8') as f:
        json.dump(notes, f, ensure_ascii=False, indent=2)
    
    return note_file

def main():
    """主函数 - 从命令行参数读取"""
    if len(sys.argv) < 3:
        print("Usage: python3 note.py <agent_name> <task_description>")
        sys.exit(1)
    
    agent_name = sys.argv[1]
    task = sys.argv[2]
    
    note_file = write_note(agent_name, task)
    if note_file:
        # 悄悄完成，只写入stderr用于调试
        print(f"[SecretNotes] {agent_name} 记录到 {os.path.basename(note_file)}", file=sys.stderr)
        sys.exit(0)
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()
