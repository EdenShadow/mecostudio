#!/usr/bin/env node
/**
 * X-Grok Get Answer
 * 
 * Get Grok's answer from clipboard and save organized results
 * 
 * Usage:
 *   xget "<question>"
 *   xget --clipboard "<question>"
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OUTPUT_BASE = path.join(process.env.HOME || "", "Documents", "知识库");
const AGENT_NAME = process.env.X_GROK_AGENT || "我的助手";

const args = process.argv.slice(2);
const question = args.find(a => !a.startsWith("--")) || "";

function makeFilename(text, maxLen = 50) {
  return text.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, "_").slice(0, maxLen);
}

function getClipboard() {
  try {
    return execSync("pbpaste", { encoding: "utf-8" }).trim();
  } catch (e) {
    return null;
  }
}

async function main() {
  if (!question) {
    console.log("=".repeat(60));
    console.log(`${AGENT_NAME} - X-Grok 获取答案`);
    console.log("=".repeat(60));
    console.log("");
    console.log("用法:");
    console.log("  xget \"<问题>\"");
    console.log("");
    console.log("流程:");
    console.log("1. 在 Grok 中复制答案");
    console.log("2. 运行: xget \"<原始问题>\"");
    console.log("");
    console.log("输出位置:");
    console.log(`  ${OUTPUT_BASE}/${AGENT_NAME}/`);
    return;
  }

  // Get answer from clipboard
  const answer = getClipboard();
  
  if (!answer) {
    console.log("❌ 无法获取剪贴板内容");
    console.log("📋 请先复制 Grok 的答案");
    return;
  }

  console.log("=".repeat(60));
  console.log("✅ 获取答案成功！");
  console.log("=".repeat(60));
  console.log("");
  console.log(`📝 问题: ${question}`);
  console.log(`📄 答案长度: ${answer.length} 字符`);
  console.log("");

  // Extract usernames
  const usernames = answer.match(/@[a-zA-Z0-9_]+/g) || [];
  console.log(`👥 发现 ${usernames.length} 个账号`);

  // Save files
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputDir = path.join(OUTPUT_BASE, AGENT_NAME);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Main file
  const filename = `${timestamp}_${makeFilename(question)}.txt`;
  const outputPath = path.join(outputDir, filename);

  let content = `X.com Grok 查询结果
========================
时间: ${new Date().toLocaleString("zh-CN")}
问题: ${question}
智能体: ${AGENT_NAME}
========================

${answer}

---
账号列表:
${usernames.map((u, i) => `${i + 1}. ${u}`).join("\n")}

---
🛠️ OpenClaw ${AGENT_NAME} 自动整理
`;

  fs.writeFileSync(outputPath, content);
  console.log(`💾 已保存: ${outputPath}`);

  // List file
  if (usernames.length > 0) {
    const listFilename = `${timestamp.replace('T', '_')}_账号列表.txt`;
    const listPath = path.join(outputDir, listFilename);
    
    let listContent = `X.com 账号列表
========================
时间: ${new Date().toLocaleString("zh-CN")}
问题: ${question}
智能体: ${AGENT_NAME}
========================

${usernames.map((u, i) => `${i + 1}. ${u}`).join("\n")}

---
总计: ${usernames.length} 个账号
`;
    fs.writeFileSync(listPath, listContent);
    console.log(`📋 账号列表: ${listPath}`);
  }

  console.log("");
  console.log("📂 文件列表:");
  console.log(`   ${outputPath}`);
  if (usernames.length > 0) {
    console.log(`   ${path.join(outputDir, listFilename)}`);
  }
}

main().catch(console.error);
