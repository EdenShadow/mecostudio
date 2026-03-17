#!/usr/bin/env node
/**
 * Hot Topics Fetcher CLI
 * 抓取热门话题并生成统一格式
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function showHelp() {
  console.log(`
🔥 Hot Topics Fetcher v2.6 - 智能推文抓取工具

Usage:
  hot-topics                              随机模式（抓取关注列表中的博主）
  hot-topics --url <tweet_url>            抓取指定推文
  hot-topics --user <username>            抓取指定博主的最新推文
  hot-topics --user <username> --count 3  抓取指定博主的最新3条推文
  hot-topics --help                       显示帮助

Options:
  --url <url>          抓取指定推文 URL (e.g., https://x.com/user/status/123456)
  --user <username>    抓取指定博主（不带@）
  --count <n>          抓取该博主的最新 N 条（默认 1）
  --lang <zh|en>       强制指定输出语言（中文/英文）
  --random             随机选择模式（默认）

Examples:
  # 抓取指定推文
  hot-topics --url "https://x.com/levelsio/status/1234567890"
  
  # 抓取指定博主的最新推文
  hot-topics --user levelsio
  
  # 抓取指定博主的最新 3 条推文
  hot-topics --user elonmusk --count 3
  
  # 随机抓取（传统模式）
  hot-topics

Description:
  使用 TikHub API 获取真实推文数据，智能生成话题名并保存到知识库。
  支持视频帧提取、音频分析、AI 生成标题、评论抓取等功能。

Output:
  ~/Documents/知识库/热门话题/
  ├── AI_Tech/
  │   └── topic_name/
  │       ├── cover.jpg       # 封面图（视频抽帧或多图拼接）
  │       ├── video.mp4       # 视频（如果有）
  │       ├── audio.mp3       # 音频（如果有）
  │       └── post.json       # 完整数据
  └── ...

Dependencies:
  - tikhub-api: 获取推文数据
  - Python 3 with Pillow: 图片处理
  - Kimi CLI: AI 标题生成和内容分析
`);
}

// 解析命令行参数
const args = process.argv.slice(2);

// 显示帮助
if (args.includes('--help') || args.includes('-h')) {
  showHelp();
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
