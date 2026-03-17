#!/usr/bin/env node
/**
 * X-Grok Skill CLI - 自动化 X.com Grok 查询
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function showHelp() {
  console.log(`
🤖 X-Grok Skill - X.com Grok Query Tool | X.com Grok 查询工具

Usage:
  x-grok "your question"      Ask Grok a question | 向 Grok 提问
  x-grok --help               Show help | 显示帮助

Description:
  Automatically opens X.com Grok, enters your question, gets the answer 
  and saves to knowledge base.
  自动打开 X.com Grok，输入问题，获取回答并保存到知识库。

Features:
  ✓ Bilingual support (English/Chinese) | 双语支持（英文/中文）
  ✓ Auto language detection | 自动语言检测
  ✓ Works with both English and Chinese X.com interfaces
    支持英文和中文界面的 X.com
  ✓ Auto-categorization | 自动分类保存

Examples:
  # English queries | 英文查询
  x-grok "Who are the top AI influencers on X?"
  x-grok "Latest tech trends 2026"
  
  # Chinese queries | 中文查询
  x-grok "找一些AI博主"
  x-grok "推荐几个美食账号"
  x-grok "科技趋势分析"

Categories | 分类:
  - Finance | 财经投资
  - Tech | 科技趋势
  - People | 人物推荐
  - Tools | 工具资源
  - Learning | 学习成长
  - Mystery | 神秘探索
  - Life | 生活百科
  - General | 综合查询

Output | 输出:
  ~/Documents/知识库/我的助手/[category]/

Dependencies | 依赖:
  - openclaw browser: Browser automation | 浏览器自动化
  - python3: Script execution | 脚本执行
`);
}

// 解析命令行参数
const args = process.argv.slice(2);

// 显示帮助
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  showHelp();
  if (args.length === 0) {
    process.exit(1);
  }
  process.exit(0);
}

// 运行 Python 脚本
const python = spawn('python3', [
  path.join(__dirname, 'skill.py'),
  ...args
], {
  stdio: ['pipe', 'pipe', 'pipe']
});

python.stdout.on('data', (data) => {
  process.stdout.write(data.toString());
});

python.stderr.on('data', (data) => {
  process.stderr.write(data.toString());
});

python.on('close', (code) => {
  process.exit(code);
});
