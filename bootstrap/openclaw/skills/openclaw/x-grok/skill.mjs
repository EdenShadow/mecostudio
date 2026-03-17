#!/usr/bin/env node
/**
 * X.com Grok Query Skill - Full Automation
 * 
 * Opens X.com Grok → Asks Question → Gets Answer → Saves Organized Results
 * 
 * Usage:
 *   xgrok "your question"
 * 
 * Examples:
 *   xgrok 帮我找一些x上知名的财经博主
 *   xgrok What are the latest AI trends
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OUTPUT_BASE = path.join(process.env.HOME || "", "Documents", "知识库");
const AGENT_NAME = process.env.X_GROK_AGENT || "我的助手";
const GROK_URL = "https://x.com/i/grok";

const query = process.argv.slice(2).join(" ");

function makeFilename(text, maxLen = 50) {
  return text.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, "_").slice(0, maxLen);
}

function runCommand(args) {
  try {
    return execSync(`openclaw browser ${args.join(" ")}`, {
      encoding: "utf-8",
      timeout: 30000,
    });
  } catch (error) {
    return null;
  }
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function findElement(role, name) {
  const snapshot = runCommand([
    "--browser-profile", "openclaw",
    "snapshot", "--format", "ai", "--json"
  ]);
  
  if (!snapshot) return null;
  
  try {
    const data = JSON.parse(snapshot);
    const elements = data.elements || {};
    
    for (const ref in elements) {
      const el = elements[ref];
      if (el.role === role && el.name?.includes(name)) {
        return ref;
      }
    }
  } catch (e) {}
  
  return null;
}

async function findRefByRoleAndName(snapshot, role, name) {
  try {
    const data = JSON.parse(snapshot);
    const elements = data.elements || {};
    
    for (const ref in elements) {
      const el = elements[ref];
      if (el.role === role && el.name?.includes(name)) {
        return ref;
      }
    }
  } catch (e) {}
  return null;
}

async function extractAnswer() {
  console.log("📥 正在提取答案...");
  
  // Click copy button
  const copyRef = await findElement("button", "複製文字");
  if (copyRef) {
    runCommand(["--browser-profile", "openclaw", "click", copyRef]);
    console.log("✅ 已点击复制按钮");
    await wait(1000);
  }
  
  // Get snapshot to extract text
  const snapshot = runCommand([
    "--browser-profile", "openclaw",
    "snapshot", "--format", "ai", "--json"
  ]);
  
  if (!snapshot) return null;
  
  // Try to get answer text from snapshot
  try {
    const data = JSON.parse(snapshot);
    const elements = data.elements || {};
    
    // Find the answer content
    for (const ref in elements) {
      const el = elements[ref];
      if (el.name?.includes("財經") || el.role === "list") {
        return JSON.stringify(el, null, 2);
      }
    }
  } catch (e) {}
  
  return "答案已复制到剪贴板，请手动保存";
}

async function saveAnswer(answer, question) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputDir = path.join(OUTPUT_BASE, AGENT_NAME);
  const filename = `${timestamp}_${makeFilename(question)}.txt`;
  const outputPath = path.join(outputDir, filename);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Extract usernames from answer
  const userPattern = /@[a-zA-Z0-9_]+/g;
  const usernames = answer.match(userPattern) || [];
  
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
  
  // Create list file if has usernames
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
  }
  
  return outputPath;
}

async function main() {
  if (!query) {
    showHelp(AGENT_NAME);
    return;
  }

  console.log("=".repeat(60));
  console.log(`${AGENT_NAME} - X.com Grok 查询`);
  console.log("=".repeat(60));
  console.log("");
  console.log(`📝 问题: ${query}`);
  console.log(`📁 智能体: ${AGENT_NAME}`);
  console.log("");

  // Step 1: Open Grok
  console.log("🌐 正在打开 X.com Grok...");
  runCommand(["--browser-profile", "openclaw", "open", GROK_URL]);
  await wait(3000);
  console.log("✅ Grok 页面已打开");

  // Step 2: Find and type question
  console.log("🔍 查找输入框...");
  const inputRef = await findElement("textbox", "提出任何問題");
  
  if (inputRef) {
    console.log("✅ 找到输入框");
    runCommand(["--browser-profile", "openclaw", "type", inputRef, query]);
    console.log("✅ 问题已输入");
  } else {
    console.log("⚠️  未找到输入框，请手动输入");
  }

  // Step 3: Find and click send button
  console.log("🔍 查找发送按钮...");
  const sendRef = await findElement("button", "問 Grok");
  
  if (sendRef) {
    console.log("✅ 找到发送按钮");
    runCommand(["--browser-profile", "openclaw", "click", sendRef]);
    console.log("✅ 问题已发送");
  } else {
    console.log("⚠️  未找到发送按钮");
  }

  console.log("");
  console.log("⏳ 等待 Grok 回答...");
  console.log("📋 完成后运行:");
  console.log(`   ~/.openclaw/skills/x-grok/xget "<问题>"`);
  console.log("");
  console.log("💡 复制答案后保存到:");
  console.log(`   ${OUTPUT_BASE}/${AGENT_NAME}/`);
}

function showHelp(agentName) {
  console.log("=".repeat(60));
  console.log(`${agentName} - X.com Grok 查询技能`);
  console.log("=".repeat(60));
  console.log("");
  console.log("用法: xgrok <问题>");
  console.log("");
  console.log("示例:");
  console.log(`  xgrok 帮我找一些x上知名的财经博主`);
  console.log(`  xgrok What are the latest AI trends`);
}

main().catch(console.error);
