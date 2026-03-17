# Kimi Search 使用示例

本文档展示如何在不同场景下使用 kimi-search skill。

## 示例1: 创建游戏NPC角色

### 需求
为一个中世纪奇幻RPG游戏创建一个商人NPC。

### 命令
```bash
kimi-search "中世纪奇幻商人NPC性格特点、说话方式、背景故事元素" \
  --category agents \
  --context "用于RPG游戏，需要详细的角色设定" \
  --depth deep
```

### 生成的资料可用于
- 角色性格特征描述
- 对话脚本编写
- 背景故事创作
- 角色外观设计参考

---

## 示例2: 学习新技术

### 需求
了解 MCP (Model Context Protocol) 协议。

### 命令
```bash
kimi-search "MCP Model Context Protocol 协议规范、实现方法、最佳实践" \
  --category tech \
  --depth deep
```

### 生成的资料包含
- 协议规范说明
- 代码示例
- 实现步骤
- 相关工具推荐

---

## 示例3: 快速事实查证

### 需求
快速了解 Python 3.12 的新特性。

### 命令
```bash
kimi-search "Python 3.12 新特性改进" --depth quick
```

### 适用场景
- 快速了解新技术
- 验证某个知识点
- 获取简要概述

---

## 示例4: 市场研究

### 需求
研究2024年AI行业发展趋势。

### 命令
```bash
kimi-search "2024年AI人工智能行业发展趋势、市场规模、主要公司、投资情况" \
  --category research \
  --depth deep
```

### 生成的资料可用于
- 商业计划书
- 市场分析报告
- 投资决策参考

---

## 示例5: 构建个人知识库

### 需求
系统学习某个领域的知识。

### 步骤1: 获取基础概念
```bash
kimi-search "区块链技术基础概念、工作原理、应用场景" \
  --category reference \
  --depth standard
```

### 步骤2: 深入研究
```bash
kimi-search "智能合约开发、Solidity编程、DApp开发" \
  --category tech \
  --depth deep
```

### 步骤3: 了解行业动态
```bash
kimi-search "2024年区块链行业发展趋势、DeFi、NFT市场" \
  --category research \
  --depth standard
```

### 步骤4: 更新索引
```bash
kimi-search index
```

---

## 示例6: 为OpenClaw Agent准备人设

### 需求
创建一个专业的代码审查助手Agent。

### 命令
```bash
kimi-search "专业代码审查助手的性格特点、沟通方式、专业技能、工作流程" \
  --category agents \
  --context "用于OpenClaw Agent，需要专业、友好、严谨的代码审查专家形象" \
  --depth deep
```

### 生成的资料包括
- 专业性格特征
- 沟通语气建议
- 技能描述
- 工作方法论

---

## 示例7: 快速搜索多个相关主题

### 需求
为一个项目收集多个相关技术的信息。

```bash
# 搜索主题1
kimi-search "Docker容器化部署最佳实践" --category tech

# 等待几秒（API速率限制）
sleep 6

# 搜索主题2
kimi-search "Kubernetes编排入门教程" --category tech

# 等待几秒
sleep 6

# 搜索主题3
kimi-search "微服务架构设计模式" --category tech

# 更新索引
kimi-search index
```

---

## 示例8: 对比研究

### 需求
对比不同的前端框架。

```bash
# React
kimi-search "React 18 新特性、Hooks最佳实践、性能优化" --category tech

sleep 6

# Vue
kimi-search "Vue 3 Composition API、性能优化、生态系统" --category tech

sleep 6

# Angular
kimi-search "Angular 17 新特性、依赖注入、RxJS集成" --category tech

# 生成对比索引
kimi-search index
```

---

## 知识库管理技巧

### 定期维护
```bash
# 每周更新索引
kimi-search index

# 查看知识库状态
kimi-search list

# 重新生成指南
kimi-search guide
```

### 备份知识库
```bash
# 压缩备份
zip -r ~/Desktop/kimi-knowledge-backup.zip ~/Desktop/kimi-knowledge-base/

# 或者使用git
cd ~/Desktop/kimi-knowledge-base/
git init
git add .
git commit -m "Initial knowledge base"
```

### 迁移知识库
```bash
# 导出到新位置
cp -r ~/Desktop/kimi-knowledge-base/ /path/to/new/location/

# 设置环境变量使用新位置
export KIMI_SEARCH_DIR=/path/to/new/location
```

---

## 常见问题解决

### 搜索太慢？
使用 `--depth quick` 进行快速搜索：
```bash
kimi-search "快速查询内容" --depth quick
```

### 需要更详细的信息？
使用 `--depth deep` 进行深度搜索：
```bash
kimi-search "深入研究主题" --depth deep
```

### 搜索结果不够准确？
添加更多上下文：
```bash
kimi-search "搜索词" --context "具体应用场景和背景"
```

### 如何组织大量搜索？
使用分类管理：
```bash
kimi-search "内容1" --category tech
kimi-search "内容2" --category agents
kimi-search "内容3" --category research
kimi-search index  # 更新索引
```

---

*更多示例将持续更新*
