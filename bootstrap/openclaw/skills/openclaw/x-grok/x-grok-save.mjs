#!/usr/bin/env node
/**
 * X-Grok Save Answer
 * 
 * Saves and organizes Grok's answers intelligently.
 * Uses agent name as folder name.
 * 
 * Usage:
 *   x-grok-save "<answer>" "<question>"
 *   x-grok-save --file <answer.txt> "<question>"
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OUTPUT_BASE = path.join(process.env.HOME || "", "Documents", "知识库");

// Get agent name from environment or use default
const AGENT_NAME = process.env.AGENT_NAME || 
                   process.env.OPENCLAW_AGENT || 
                   "我的助手";

function makeFilename(text, maxLen = 50) {
  return text
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, maxLen);
}

// Parse content into structured format
function parseContent(answer) {
  const result = {
    raw: answer,
    lines: [],
    items: [],
    links: [],
    usernames: [],
  };
  
  // Split into lines
  result.lines = answer.split(/\n+/).filter(l => l.trim());
  
  // Find links
  const linkPattern = /https?:\/\/[^\s]+/g;
  const allText = answer.replace(/\n/g, ' ');
  result.links = allText.match(linkPattern) || [];
  
  // Find X usernames
  const userPattern = /@[\w\d_]+/g;
  result.usernames = answer.match(userPattern) || [];
  
  // Parse numbered/bullet list items
  const singleLinePattern = /(?:^|\s)[\d•\-\*]\s*(.+?)(?=\s*(?:[\d•\-\*]|$))/g;
  const linesWithNumbers = answer.replace(/\n/g, ' ').match(singleLinePattern) || [];
  
  if (linesWithNumbers.length > 0) {
    result.items = linesWithNumbers
      .map(l => l.replace(/^[\s\d•\-\*]+/, '').trim())
      .filter(l => l.length > 0);
  }
  
  return result;
}

function generateOutput(answer, question, agentName) {
  const timestamp = new Date().toLocaleString("zh-CN");
  
  let output = `X.com Grok 查询结果
========================
时间: ${timestamp}
问题: ${question}
智能体: ${agentName}
========================

${answer}

---
🛠️ OpenClaw ${agentName} 技能自动整理
生成时间: ${new Date().toISOString()}
`;
  
  return output;
}

function generateListFile(usernames, question, agentName) {
  const timestamp = new Date().toLocaleString("zh-CN");
  
  let content = `X.com 账号列表
生成时间: ${timestamp}
问题: ${question}
智能体: ${agentName}
========================

`;
  
  usernames.forEach((user, i) => {
    content += `${i + 1}. ${user}
`;
  });
  
  content += `
---
总计: ${usernames.length} 个账号
由 OpenClaw ${agentName} 技能生成
`;
  
  return content;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    showHelp(AGENT_NAME);
    return;
  }
  
  let answer = args[0];
  let question = args[1] || "Grok 回答";
  
  // Parse options
  if (args.includes("--file") || args.includes("-f")) {
    const fileIdx = args.indexOf("--file") > -1 ? args.indexOf("--file") : args.indexOf("-f");
    if (fileIdx + 1 < args.length) {
      try {
        answer = fs.readFileSync(args[fileIdx + 1], 'utf-8');
      } catch (e) {
        console.error(`❌ 无法读取文件: ${args[fileIdx + 1]}`);
        process.exit(1);
      }
    }
  }
  
  if (!answer.trim()) {
    // Read from stdin
    console.log("📋 请粘贴答案 (按 Ctrl+D 完成):");
    const chunks = [];
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => {
      const stdinAnswer = Buffer.concat(chunks).toString();
      if (stdinAnswer.trim()) {
        saveAndOrganize(stdinAnswer, question, AGENT_NAME);
      }
    });
    return;
  }
  
  await saveAndOrganize(answer, question, AGENT_NAME);
}

async function saveAndOrganize(answer, question, agentName) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputDir = path.join(OUTPUT_BASE, agentName);
  const filename = `${timestamp}_${makeFilename(question)}.txt`;
  const outputPath = path.join(outputDir, filename);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Parse content
  const parsed = parseContent(answer);
  
  // Generate output
  const output = generateOutput(answer, question, agentName);
  
  // Save main file
  fs.writeFileSync(outputPath, output);
  
  console.log("=".repeat(60));
  console.log("✅ 答案已保存并整理！");
  console.log("=".repeat(60));
  console.log("");
  console.log(`📁 文件位置: ${outputPath}`);
  console.log(`🤖 智能体: ${agentName}`);
  console.log("");
  
  console.log("📊 统计:");
  console.log(`   - 问题: ${question}`);
  console.log(`   - 账号: ${parsed.usernames.length} 个`);
  console.log(`   - 链接: ${parsed.links.length} 个`);
  console.log("");
  
  if (parsed.usernames.length > 0) {
    console.log("📱 账号预览:");
    parsed.usernames.slice(0, 5).forEach(u => console.log(`   ${u}`));
    if (parsed.usernames.length > 5) {
      console.log(`   ... 还有 ${parsed.usernames.length - 5} 个`);
    }
    console.log("");
  }
  
  // Create account list file
  if (parsed.usernames.length > 0) {
    const listFilename = `${timestamp.replace('T', '_')}_账号列表.txt`;
    const listPath = path.join(outputDir, listFilename);
    const listContent = generateListFile(parsed.usernames, question, agentName);
    fs.writeFileSync(listPath, listContent);
    console.log(`📋 账号列表: ${listPath}`);
  }
}

function showHelp(agentName) {
  console.log("=".repeat(60));
  console.log(`${agentName} - X-Grok 保存答案`);
  console.log("=".repeat(60));
  console.log("");
  console.log("用法:");
  console.log("  x-grok-save \"<答案>\" \"<问题>\"");
  console.log("  x-grok-save --file <答案文件.txt> \"<问题>\"");
  console.log("");
  console.log("示例:");
  console.log(`  x-grok-save "以下是x上知名的博主..." "帮我找一些x上知名的财经博主"`);
  console.log("");
  console.log("交互模式:");
  console.log("  x-grok-save");
  console.log("  (粘贴答案，按 Ctrl+D)");
  console.log("");
  console.log("输出位置:");
  console.log(`  ${OUTPUT_BASE}/${agentName}/`);
}

main().catch(console.error);
