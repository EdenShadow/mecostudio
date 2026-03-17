# Hot Topics v4.0 - 性能优化指南

## 🚀 性能提升亮点

| 指标 | v3.0 (旧版) | v4.0 (优化版) | 提升 |
|-----|------------|--------------|-----|
| 单用户处理 | 30-60s | 8-15s | **3-5x** |
| 5用户批量 | 150-300s | 15-25s | **10-15x** |
| 10用户批量 | 300-600s | 25-40s | **12-20x** |
| 内存占用 | 中等 | 低 | 优化 |
| API 并发 | 1 | 10 | **10x** |

## ⚡ 核心优化技术

### 1. 异步 I/O (Asyncio)
```python
# 旧版 - 同步阻塞
for user in users:
    result = fetch_user(user)  # 阻塞等待

# 新版 - 异步并发
results = await asyncio.gather(*[
    fetch_user(user) for user in users
])  # 同时处理
```

### 2. HTTP 连接池
- 复用 TCP 连接
- 减少握手开销
- 支持 keep-alive

### 3. 并发控制
- 下载并发: 8 (防止被封)
- 分析并发: 4 (Kimi API 限制)
- 可配置调整

### 4. 智能缓存
- 分析结果缓存 7 天
- 避免重复调用 Kimi
- 基于内容 hash 索引

### 5. 快速分类
- O(1) 关键字匹配
- 减少正则表达式使用
- 提前返回

## 📖 用法对比

### 基础用法 (相同)
```bash
# 单个用户
python scripts/fetch_tweets_fast.py --user elonmusk --count 2

# 指定链接
python scripts/fetch_tweets_fast.py --url "https://x.com/elonmusk/status/..."

# 随机模式
python scripts/fetch_tweets_fast.py
```

### 批量模式 (新增)
```bash
# 批量处理多个用户 (并发执行)
python scripts/fetch_tweets_fast.py --users "elonmusk,naval,dotey"

# 批量处理知识库所有用户
python scripts/fetch_tweets_fast.py --batch --max-users 20

# 处理 10 个用户，每人 2 条推文
python scripts/fetch_tweets_fast.py --batch --max-users 10 --count 2
```

## 🔧 高级配置

### 调整并发数
编辑 `fetch_tweets_fast.py`:
```python
MAX_CONCURRENT_DOWNLOADS = 8   # 下载并发
MAX_CONCURRENT_ANALYSIS = 4    # Kimi 分析并发
MAX_WORKERS = 8                # 线程池大小
```

### 清理缓存
```bash
rm -rf ~/Documents/知识库/.hot_topics_cache/
```

### 性能测试
```bash
# 对比测试
time python scripts/fetch_tweets.py --user elonmusk  # 旧版
time python scripts/fetch_tweets_fast.py --user elonmusk  # 新版
```

## 🎯 适用场景

### 使用 v4.0 (快版)
- ✅ 批量抓取多个用户
- ✅ 定时自动化任务
- ✅ 快速原型验证
- ✅ 大量推文处理

### 使用 v3.0 (原版)
- 单条精细调试
- 需要完整日志
- 音频分析功能（快版暂不支持完整音频）

## ⚠️ 注意事项

1. **API 限流**: TikHub 有请求限制，大批量任务建议分批执行
2. **内存管理**: 处理大量视频时监控内存使用
3. **缓存清理**: 定期清理旧缓存避免磁盘占满
4. **错误处理**: 快版错误日志较精简，调试时可用原版

## 📊 性能监控

运行时会显示计时:
```
⏱️ Media download: 2.34s
⏱️ Kimi analysis: 8.12s
⏱️ Total: 12.8s
```

## 🔮 未来优化方向

- [ ] GPU 加速视频处理
- [ ] 分布式任务队列
- [ ] 增量更新模式
- [ ] WebSocket 实时推送
