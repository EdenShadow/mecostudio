---
name: notebooklm
aliases: [nlm, notebook]
description: |
  Google NotebookLM CLI 技能 - 通过命令行操作 NotebookLM。
  可以创建笔记本、添加来源（网页/YouTube/Google Drive）、生成 AI 播客、查询笔记内容等。
  
  常用功能：
  - 创建和管理研究笔记本
  - 添加网页、视频、文档作为来源
  - 生成音频播客（Audio Overview）
  - 查询笔记内容，获取 AI 摘要
  - 批量操作和自动化
---

# NotebookLM CLI Skill

通过 `nlm` 命令行工具与 Google NotebookLM 交互。

## 前提条件

1. 已安装 `notebooklm-mcp-cli`：
   ```bash
   uv tool install notebooklm-mcp-cli
   # 或 pip install notebooklm-mcp-cli
   ```

2. 已登录 Google 账号：
   ```bash
   nlm login
   ```
   这会打开浏览器让你登录 Google，认证信息会保存在本地。

## 核心功能

### 1. 笔记本管理

```bash
# 列出所有笔记本
nlm notebook list

# 创建新笔记本
nlm notebook create "研究主题"
nlm notebook create "AI 市场趋势分析" --description "收集 AI 行业最新动态"

# 删除笔记本
nlm notebook delete <notebook-id>
```

### 2. 添加来源

```bash
# 添加网页
nlm source add <notebook-id> --url "https://example.com/article"

# 添加 YouTube 视频
nlm source add <notebook-id> --youtube "https://youtube.com/watch?v=xxx"

# 添加 Google Drive 文档
nlm source add <notebook-id> --drive "document-id"

# 添加文本内容
nlm source add <notebook-id> --text "这里输入文本内容..."

# 添加文件
nlm source add <notebook-id> --file "/path/to/document.pdf"
```

### 3. 生成 Studio 内容（播客/视频）

```bash
# 生成音频播客
nlm studio create <notebook-id> --type audio --confirm

# 生成视频
nlm studio create <notebook-id> --type video --confirm

# 生成简报文档
nlm studio create <notebook-id> --type briefing --confirm

# 生成思维导图
nlm studio create <notebook-id> --type mindmap --confirm
```

### 4. 查询和聊天

```bash
# 查询笔记本内容
nlm notebook query <notebook-id> "总结主要观点"
nlm notebook query <notebook-id> "这篇文章的核心论点是什么？"

# 跨笔记本查询
nlm cross query "对比笔记本 A 和 B 的观点差异"
```

### 5. 下载生成的内容

```bash
# 查看可下载的内容
nlm studio list <notebook-id>

# 下载音频
nlm download audio <notebook-id> <artifact-id>

# 下载视频
nlm download video <notebook-id> <artifact-id>

# 下载到指定目录
nlm download audio <notebook-id> <artifact-id> --output ~/Downloads/
```

### 6. 分享设置

```bash
# 开启公开分享
nlm share public <notebook-id>

# 获取分享链接
nlm share link <notebook-id>

# 邀请协作者
nlm share invite <notebook-id> --email user@example.com --role editor
```

### 7. 研究和自动发现

```bash
# 启动网页研究
nlm research start <notebook-id> "量子计算最新进展"

# 从 Drive 搜索并添加文档
nlm source add <notebook-id> --drive-search "产品路线图"
```

## 使用技巧

### 获取 Notebook ID

由于 `nlm` 需要 notebook ID，你可以：

1. **先列出所有笔记本获取 ID**：
   ```bash
   nlm notebook list
   ```
   输出示例：
   ```
   id: 123456789
   title: AI 研究
   updated: 2024-01-15
   ```

2. **使用别名（推荐）**：
   ```bash
   # 为常用笔记本创建别名
   nlm alias set ai-research 123456789
   nlm alias set market-report 987654321
   
   # 之后使用别名
   nlm source add ai-research --url "https://..."
   ```

### 批量操作

```bash
# 批量查询多个笔记本
nlm batch query "总结这些笔记本的共同点" --notebooks id1,id2,id3

# 批量创建
nlm batch create --from-file notebooks.txt
```

## 完整工作流示例

### 场景：研究一个新主题并生成播客

```bash
# 1. 创建笔记本
nlm notebook create "新能源汽车行业分析" --description "2024年市场趋势"
# 记录返回的 notebook-id，假设是 12345

# 2. 添加多个来源
nlm source add 12345 --url "https://www.example.com/ev-market-2024"
nlm source add 12345 --url "https://www.example.com/battery-tech"
nlm source add 12345 --youtube "https://youtube.com/watch?v=xxx"

# 3. 等待处理完成，然后查询内容
nlm notebook query 12345 "新能源汽车的主要技术路线有哪些？"

# 4. 生成播客
nlm studio create 12345 --type audio --confirm

# 5. 查看生成状态并下载
nlm studio list 12345
nlm download audio 12345 <artifact-id> --output ~/Downloads/

# 6. 分享给团队
nlm share public 12345
nlm share invite 12345 --email team@company.com --role viewer
```

## 故障排除

### 认证问题

```bash
# 检查登录状态
nlm login --check

# 重新登录
nlm login

# 切换账号
nlm login switch <profile-name>
```

### 限制提醒

- **免费版限制**：每天约 50 次查询
- **Cookie 有效期**：约 2-4 周，过期需重新登录
- **来源数量**：每个笔记本有上限（通常几百个）

### 诊断问题

```bash
# 运行诊断
nlm doctor

# 查看调试信息
nlm --debug notebook list
```

## 相关链接

- **NotebookLM 网页版**: https://notebooklm.google.com
- **项目文档**: https://github.com/jacob-bd/notebooklm-mcp-cli
- **CLI 完整指南**: 运行 `nlm --ai` 查看 AI 友好的文档
