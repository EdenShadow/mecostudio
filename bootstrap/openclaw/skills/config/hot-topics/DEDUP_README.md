# Hot Topics v4.0 - 智能去重功能

## 🎯 功能说明

新增**本地知识库去重**功能，每次抓取前自动检查是否已有相同话题，避免重复抓取和处理。

## 🔍 去重机制

### 1. 精确匹配 (Tweet ID)
```
检查推文 URL 中的 ID
https://x.com/elonmusk/status/1234567890
                      └─> ID: 1234567890
```

### 2. 内容相似度匹配 (Text Similarity)
```
比对推文内容相似度 (默认 85% 阈值)
- 忽略 URL、@提及、#标签
- 忽略 RT 前缀
- 归一化大小写和空白
```

### 3. 本地索引数据库
```
~/Documents/知识库/.hot_topics_dedup.json
├── 自动扫描现有文件夹构建索引
├── 实时更新新抓取的内容
└── 持久化存储，重启后依然有效
```

## 🚀 使用方法

### 基础用法 (自动去重)
```bash
# 抓取单个用户 (自动跳过已存在的推文)
python scripts/fetch_tweets_dedup.py --user elonmusk --count 5

# 输出示例:
# 👤 Fetching @elonmusk's latest 5 tweet(s)...
#    (Knowledge base has 128 existing entries)
#   ⏭️ SKIPPING - Already exists in knowledge base:
#      📁 ~/Documents/知识库/热门话题/Technology/特斯拉发布新款车型🔥
#      📝 特斯拉发布新款车型，引发市场热议...
#   ⏭️ SKIPPING - Already exists in knowledge base:
#      📁 ~/Documents/知识库/热门话题/AI_Tech/SpaceX星舰发射成功🚀
#   ✓ Saved: 马斯克谈火星殖民计划...
#  ⏭️ Skipped 2 duplicate(s)
# ✅ Complete!
#    🆕 New: 1 tweet(s)
#    ⏭️ Skipped (duplicates): 2 tweet(s)
```

### 强制重新抓取
```bash
# 即使已存在也重新处理
python scripts/fetch_tweets_dedup.py --user elonmusk --force
```

### 查看去重统计
```bash
python scripts/fetch_tweets_dedup.py --stats

# 输出:
# ============================================================
# Deduplication Statistics
# ============================================================
# Total indexed entries: 256
# Index file: ~/Documents/知识库/.hot_topics_dedup.json
```

### 重置索引
```bash
# 如果索引损坏或想重新扫描
python scripts/fetch_tweets_dedup.py --reset-index
```

## 📊 与原版对比

| 场景 | 原版 (v3.0) | 去重版 (v4.0) | 效果 |
|-----|------------|--------------|------|
| 重复抓取同一推文 | ❌ 重复处理 | ✅ 自动跳过 | 节省 API 调用 |
| 相似内容不同链接 | ❌ 重复处理 | ✅ 相似度检测 | 节省 AI 分析 |
| 批量抓取多个用户 | ❌ 可能重复 | ✅ 全局去重 | 提升效率 |
| 定时任务执行 | ❌ 重复累积 | ✅ 只抓新内容 | 保持最新 |

## 💡 最佳实践

### 场景 1: 首次运行
```bash
# 首次运行会扫描现有知识库构建索引
python scripts/fetch_tweets_dedup.py --stats
# 显示: Total indexed entries: 0

# 运行一次后
python scripts/fetch_tweets_dedup.py --user dotey --count 10
# 索引自动更新

python scripts/fetch_tweets_dedup.py --stats
# 显示: Total indexed entries: 10
```

### 场景 2: 定时任务
```bash
# 每小时运行，只抓取新内容
crontab -e
0 * * * * cd ~/.config/agents/skills/hot-topics && python scripts/fetch_tweets_dedup.py --batch --max-users 20
```

### 场景 3: 批量更新
```bash
# 处理所有关注用户，自动跳过已存在的
python scripts/fetch_tweets_dedup.py --batch --max-users 50

# 显示进度:
# 🚀 Batch processing 50 users...
#    (Knowledge base has 256 existing entries)
# ...
# ✅ Batch complete: 12 new, 38 skipped in 45.3s
```

## ⚙️ 配置选项

### 修改相似度阈值
编辑 `fetch_tweets_dedup.py`:
```python
# 默认 85% 相似度认为是重复
is_dup, existing = dm.check_duplicate(
    tweet_id, text, author, 
    similarity_threshold=0.90  # 提高阈值到 90%
)
```

### 自定义索引路径
```bash
export HOT_TOPICS_KB_PATH="/path/to/your/knowledge-base"
python scripts/fetch_tweets_dedup.py --user elonmusk
```

## 🔧 故障排除

### 问题: 误报重复（不是重复但被认为是）
**解决**: 降低相似度阈值或添加 `--force` 参数
```bash
python scripts/fetch_tweets_dedup.py --url "..." --force
```

### 问题: 重复内容未被检测到
**解决**: 检查索引是否正常，可重置后重新扫描
```bash
python scripts/fetch_tweets_dedup.py --reset-index
python scripts/fetch_tweets_dedup.py --user xxx  # 重新索引
```

### 问题: 索引文件太大
**解决**: 索引文件只存储元数据，通常 < 1MB。如果太大可以清理旧条目。

## 📈 性能影响

| 指标 | 影响 |
|-----|------|
| 首次启动 | 扫描现有文件夹，约 1-3 秒 |
| 内存占用 | 索引约占用 10-50MB (取决于条目数) |
| 查询速度 | < 1ms (内存索引) |
| 磁盘 I/O | 仅启动和保存时写入 |

## 🔄 与 fast 版本结合

可以将去重功能集成到快速版:
```python
# 在 fetch_tweets_fast.py 中导入
from fetch_tweets_dedup import get_dedup_manager, process_tweet_dedup

# 在 process_tweet_async 开头添加检查
```

## 📝 总结

- ✅ **自动去重**: 无需手动管理，自动检测重复
- ✅ **智能匹配**: 基于 ID + 内容相似度双重检测
- ✅ **节省时间**: 避免重复 API 调用和 AI 分析
- ✅ **节省成本**: 减少 Kimi API 调用次数
- ✅ **保持最新**: 定时任务只处理新内容
