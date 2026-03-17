---
name: x-grok
description: X.com Grok 查询工具，自动打开浏览器提问并保存回答到知识库
metadata:
  {
    "openclaw":
      {
        "emoji": "🤖",
        "requires": { "bins": ["python3", "openclaw"] },
        "install": [],
        "priority": "medium",
        "tags": ["grok", "x", "twitter", "browser", "automation"]
      }
  }
---

# X-Grok Skill

X.com Grok 查询工具，自动保存到知识库。

## 使用

```bash
claw grok "找一些AI博主"
claw grok "找美食博主"
```

## 功能

- ✅ 自动打开 X.com Grok
- ✅ 输入问题
- ✅ 点击发送
- ✅ 等待回答
- ✅ 两次点击复制按钮
- ✅ 自动分类保存
- ✅ 从剪贴板保存内容

## 输出

保存到 `~/Documents/知识库/[Agent]/[分类]/`

分类：财经投资 | 科技趋势 | 人物推荐 | 工具资源 | 学习成长 | 神秘探索 | 生活百科 | 综合查询
