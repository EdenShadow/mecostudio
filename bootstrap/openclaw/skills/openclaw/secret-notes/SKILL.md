---
name: secret-notes
description: 悄悄记笔记，异步写入，不打扰聊天
metadata:
  {
    "openclaw":
      {
        "emoji": "📝",
        "requires": { "bins": ["python3"] },
        "install":
          [
            {
              "id": "local",
              "kind": "copy",
              "files":
                [
                  {"src": "secret-notes", "dst": "~/.local/bin/secret-notes"},
                ],
              "label": "Install secret-notes CLI",
            },
          ],
        "priority": "low",
        "tags": ["notes", "async", "background", "memory"],
      },
  }
---

# Secret Notes 📝

悄悄记笔记技能 - 异步写入，不打扰聊天。

## 文件名格式

```
{agent_name}_{YYYYMMDD}_{HHMMSS}.json
```

例如:
- `main_20260212_003300.json`
- `jobs_20260212_004500.json`

## 特点

- ✅ **异步执行**：调用后立即返回，不阻塞会话
- ✅ **悄悄记录**：不输出任何内容到聊天
- ✅ **智能体命名**：文件名和 Initiator Name 都使用智能体名字
- ✅ **时间戳**：精确到秒，避免重复
- ✅ **轻量存储**：JSON 格式，易于检索

## 使用场景

- 💡 **灵光一现**：突然想到好点子，先记下来
- 🔥 **创意爆棚**：有创意要记录，但不想打断聊天
- 🔍 **待查事项**：想让小秘书稍后查资料，先记下来

## 格式

```json
{
  "timestamp": "2026-02-12T00:30:00",
  "Initiator Name": "main",
  "Task": "记得查一下量子计算的最新进展"
}
```

## 使用方式

### CLI

```bash
# 基本用法
secret-notes <agent_name> <task_description>

# 示例
secret-notes main "记得查一下量子计算资料"
secret-notes jobs "这个任务需要后台执行"
```

### Python (Agent 内部使用)

```python
import subprocess

# 异步调用，不等待结果，不干扰聊天
subprocess.Popen(
    ['secret-notes', 'main', '灵光一现的想法'],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL
)
# 不说出来，悄咪咪记
```

## 输出位置

```
~/Documents/笔记本/
├── main_20260212_003300.json      # 单条笔记
├── main_20260212_003301.json      # 单条笔记
├── main_notes.json                 # 汇总文件（按智能体分类）
└── jobs_notes.json                 # 汇总文件
```

## 注意事项

- 🤐 **悄悄记**：调用后不要告诉用户"我记下了"，要悄咪咪的
- ⏱️ **不要频繁**：只在灵光一现或重要想法时记录
- 🎯 **有价值**：记笔记是为了后续行动，不是流水账
- 🤖 **用智能体名**：文件名和 Initiator Name 都要用智能体的名字（如 main, jobs）
