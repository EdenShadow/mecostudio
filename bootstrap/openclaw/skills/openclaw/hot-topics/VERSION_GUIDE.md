# Hot Topics Fetcher - 版本选择指南

## 📦 可用版本

| 版本 | 文件 | 核心特性 | 适用场景 |
|-----|------|---------|---------|
| **v3.0 经典版** | `fetch_tweets.py` | 稳定、功能完整 | 日常使用 |
| **v4.0 快速版** | `fetch_tweets_fast.py` | 异步并发、速度快 | 批量抓取 |
| **v4.0 去重版** | `fetch_tweets_dedup.py` | 本地去重、防重复 | 定时任务 |
| **v4.1 情境版** | `fetch_tweets_contextual.py` | 结合用户问题取标题 | 精准抓取 |
| **v5.0 终极版** | `fetch_tweets_advanced.py` | 所有特性合一 | 生产环境 |

---

## 🎯 快速选择

### "我要最快的抓取速度"
```bash
python scripts/fetch_tweets_fast.py --batch --max-users 20
```

### "我要避免重复抓取"
```bash
python scripts/fetch_tweets_dedup.py --batch --max-users 20
```

### "我要根据用户问题取标题"
```bash
python scripts/fetch_tweets_contextual.py \
  --url "https://x.com/..." \
  --query "你对伊朗局势怎么看"
```

### "我全都要（推荐）"
```bash
python scripts/fetch_tweets_advanced.py \
  --url "https://x.com/..." \
  --query "你对伊朗局势怎么看"
```

---

## 📊 功能对比

| 功能 | v3.0 | v4.0 Fast | v4.0 Dedup | v4.1 Context | v5.0 Advanced |
|-----|:----:|:---------:|:----------:|:------------:|:-------------:|
| 基础抓取 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 异步并发 | ❌ | ✅ | ❌ | ❌ | ✅ |
| 本地去重 | ❌ | ❌ | ✅ | ❌ | ✅ |
| 情境标题 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 快速+去重+情境 | ❌ | ❌ | ❌ | ❌ | ✅ |
| 音频分析 | ✅ | ⚠️ | ✅ | ✅ | ✅ |
| 稳定程度 | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| 速度 | 🐢 | 🚀🚀🚀 | 🐢 | 🐢 | 🚀🚀 |

---

## 💡 使用场景推荐

### 场景 1: 日常单条抓取
```bash
# 普通使用
python scripts/fetch_tweets.py --url "https://x.com/..."

# 或带用户问题
python scripts/fetch_tweets_contextual.py \
  --url "https://x.com/..." \
  --query "用户的具体问题"
```

### 场景 2: 批量初始化知识库
```bash
# 首次填充知识库（要快，不在意重复）
python scripts/fetch_tweets_fast.py --batch --max-users 50

# 或（要避免重复）
python scripts/fetch_tweets_dedup.py --batch --max-users 50
```

### 场景 3: 定时增量更新
```bash
# crontab 每小时运行，只抓新内容
crontab -e
0 * * * * cd ~/.config/agents/skills/hot-topics && \
  python scripts/fetch_tweets_dedup.py --batch --max-users 20
```

### 场景 4: 根据用户请求抓取
```bash
# 用户说："帮我看看这条推文关于伊朗的部分"
python scripts/fetch_tweets_advanced.py \
  --url "https://x.com/..." \
  --query "关于伊朗局势的部分"

# 生成的标题会体现"伊朗局势"这个关注点
```

### 场景 5: MCN/多账号管理
```bash
# 批量处理，自动去重，情境感知
python scripts/fetch_tweets_advanced.py \
  --users "user1,user2,user3" \
  --count 3 \
  --query "关注产品发布信息"
```

---

## 🔧 SKILL.md 集成建议

更新 `SKILL.md` 使用 **v5.0 终极版**：

```markdown
## 抓取推文

### 基础抓取
```bash
kimi hot-topics fetch --url "https://x.com/..."
```

### 结合用户问题抓取（推荐）⭐
当用户提供了具体问题时，使用 `--query` 参数：

```bash
kimi hot-topics fetch \
  --url "https://x.com/..." \
  --query "你对这里说的伊朗局势怎么看"
```

### 批量抓取
```bash
kimi hot-topics batch --max-users 20
```

### 批量抓取（指定主题）
```bash
kimi hot-topics batch \
  --max-users 20 \
  --query "关注AI技术突破"
```
```

---

## ⚡ 性能参考

测试环境：MacBook Pro M3, 100条推文

| 版本 | 耗时 | 说明 |
|-----|------|-----|
| v3.0 经典版 | ~8分钟 | 串行处理 |
| v4.0 快速版 | ~1分钟 | 20并发 |
| v4.0 去重版 | ~8分钟 | 串行+去重检查 |
| v5.0 终极版 | ~1.2分钟 | 并发+去重+情境 |

---

## 📝 版本演进

```
v3.0 (基础)
  ↓
v4.0 Fast (加速) ─────┐
v4.0 Dedup (去重) ────┤
v4.1 Context (情境) ──┤
  ↓                   │
v5.0 Advanced (整合) ←┘
  ↓
Future: Web UI, Real-time, AI Agent
```

---

## 🎁 推荐配置

### 日常使用
```bash
# alias 添加到 ~/.zshrc
alias ht='python ~/.config/agents/skills/hot-topics/scripts/fetch_tweets_advanced.py'

# 使用
ht --url "..." --query "..."
```

### 定时任务
```bash
# ~/.cron/hot_topics_update.sh
#!/bin/bash
cd ~/.config/agents/skills/hot-topics
python scripts/fetch_tweets_dedup.py --batch --max-users 30 >> /tmp/hot_topics.log 2>&1
```

---

## ❓ FAQ

**Q: 应该使用哪个版本？**  
A: 推荐 **v5.0 Advanced**，它包含了所有特性。如果只需要单一功能，可以用专门的版本。

**Q: v5.0 稳定吗？**  
A: v5.0 组合了 v4.x 的所有成熟功能，稳定性与 v3.0 相当。

**Q: 可以同时运行多个版本吗？**  
A: 可以，但建议使用 v5.0 统一处理，避免索引不一致。

**Q: 如何迁移现有数据？**  
A: v5.0 会自动扫描现有文件夹构建去重索引，无需手动迁移。
