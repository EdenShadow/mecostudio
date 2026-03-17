# Hot Topics v4.1 - 情境感知标题生成

## 🎯 功能说明

优化了标题生成逻辑，能够**结合用户的问题/意图**来生成更相关的标题。

## 📝 使用场景对比

### 场景 1: 只抓取 URL（原有逻辑）
```bash
python scripts/fetch_tweets_contextual.py \
  --url "https://x.com/someuser/status/123456"

# 生成的标题基于推文内容本身：
# "中东局势持续紧张，多方呼吁和平谈判🕊️"
```

### 场景 2: 抓取 URL + 用户问题（新功能）✨
```bash
python scripts/fetch_tweets_contextual.py \
  --url "https://x.com/someuser/status/123456" \
  --query "你对这里说的伊朗局势怎么看"

# 生成的标题结合用户关注的问题：
# "伊朗局势升级影响中东格局，专家分析后续走向🔥"
# 标题体现了"伊朗局势"这个用户关注的重点
```

## 💡 实际案例

### 案例 1: 关注特定话题
```bash
# 用户想看关于经济影响的讨论
python scripts/fetch_tweets_contextual.py \
  --url "https://x.com/elonmusk/status/xxx" \
  --query "这对股市有什么影响"

# 标题可能生成：
# "马斯克言论引发股市波动，投资者需关注风险📉"
```

### 案例 2: 关注技术细节
```bash
# 用户想了解技术实现
python scripts/fetch_tweets_contextual.py \
  --url "https://x.com/OpenAI/status/xxx" \
  --query "GPT-5的技术突破在哪里"

# 标题可能生成：
# "GPT-5技术架构解析：多模态融合成关键突破🤖"
```

### 案例 3: 关注人物观点
```bash
# 用户想关注某个人的观点
python scripts/fetch_tweets_contextual.py \
  --url "https://x.com/naval/status/xxx" \
  --query "Naval对创业的看法"

# 标题可能生成：
# "Naval谈创业本质：长期思维决定成功💡"
```

## 🔧 使用方法

### 命令行使用
```bash
cd ~/.config/agents/skills/hot-topics

# 基础用法（和普通版一样）
python scripts/fetch_tweets_contextual.py --url "https://x.com/..."

# 带用户问题的用法
python scripts/fetch_tweets_contextual.py \
  --url "https://x.com/..." \
  --query "你对这里说的XX怎么看"

# 可选参数
python scripts/fetch_tweets_contextual.py \
  --url "https://x.com/..." \
  --query "用户问题" \
  --lang zh \
  --analyze-audio
```

### 在 SKILL.md 中集成

修改 `SKILL.md` 中的示例命令：

```markdown
## 使用示例

### 基础抓取
```bash
kimi hot-topics fetch --url "https://x.com/..."
```

### 带问题/意图的抓取 ⭐
```bash
# 格式: kimi hot-topics fetch <URL> --query "你的问题"
kimi hot-topics fetch "https://x.com/..." --query "你对伊朗局势怎么看"
```

### 批量处理
```bash
kimi hot-topics batch --users "user1,user2" --query "关注AI发展"
```
```

## 🧠 技术实现

### 1. Prompt 增强
当提供 `user_query` 时，Kimi 的 prompt 会额外包含：

```
用户的问题/意图：
"你对这里说的伊朗局势怎么看"

重要：标题应该回应用户上面的问题。
用户想了解他们问题中提到的方面。
让标题既反映推文内容，又针对用户的具体关注点。
```

### 2. 回退策略
如果 Kimi 分析失败，回退标题也会考虑用户问题：
- 提取问题关键词
- 结合推文内容生成标题

### 3. 数据存储
生成的 `post.json` 会额外包含：
```json
{
  "user_query": "你对伊朗局势怎么看",
  "contextual_title": true
}
```

## 📊 效果对比

| 输入 | 旧版标题 | 新版情境标题 |
|-----|---------|-------------|
| URL + "伊朗局势怎么看" | 中东地区发生冲突多方关注 | **伊朗局势升级**影响中东格局🔥 |
| URL + "对经济的影响" | 美联储宣布加息决定 | 美联储加息**冲击全球市场**📉 |
| URL + "技术原理" | GPT-5模型发布引发热议 | GPT-5**技术架构解析**🤖 |

## 🚀 进阶用法

### 结合去重版本
可以将情境感知与去重功能结合：

```python
# 在 fetch_tweets_dedup.py 中导入
from fetch_tweets_contextual import process_tweet_contextual

# 修改 process_tweet_dedup 函数，添加 user_query 参数
def process_tweet_dedup(tweet, author, api, language='zh', 
                        analyze_audio=False, force=False, user_query=None):
    # ... 去重检查 ...
    
    # 调用情境感知处理
    result = process_tweet_contextual(
        tweet, author, api, language, analyze_audio, user_query
    )
```

### 批量处理带问题
```python
# 批量抓取同一主题
queries = {
    "user1": "关注技术细节",
    "user2": "关注市场影响", 
    "user3": "关注政策解读"
}

for user, query in queries.items():
    fetch_by_user_contextual(user, api, query=query)
```

## ⚠️ 注意事项

1. **query 长度**: 建议控制在 50 字以内，太长可能影响效果
2. **相关性**: query 应该和推文内容相关，否则标题可能不协调
3. **语言**: query 的语言最好和推文一致（中文推文用中文 query）

## 🎉 总结

- ✅ **情境感知**: 标题反映用户的真实关注点
- ✅ **灵活使用**: 有问题时用情境版，无问题时用普通版
- ✅ **向后兼容**: 不提供 query 时行为和原版一致
- ✅ **易于集成**: 可作为 SKILL.md 的高级功能
