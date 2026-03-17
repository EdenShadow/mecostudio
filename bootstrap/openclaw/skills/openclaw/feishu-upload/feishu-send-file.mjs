#!/usr/bin/env node
/**
 * Feishu Send File using OpenClaw Plugin SDK
 */

import fs from "fs";
import path from "path";

// Load OpenClaw config
const configPath = path.join(process.env.HOME || "", ".openclaw", "openclaw.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const appId = config.channels.feishu.appId;
const appSecret = config.channels.feishu.appSecret;

// Import feishu plugin SDK
import Lark from "@larksuiteoapi/node-sdk";

// Create client
const client = new Lark.Client({
  appId,
  appSecret,
  appType: Lark.AppType.SelfBuild,
  domain: Lark.Domain.Feishu,
});

async function main() {
  const filePath = process.argv[2];
  const receiveId = process.argv[3] || "ou_8aabc219e4883cf1204157d904d54021"; // Default to user
  
  if (!filePath) {
    console.log("Usage: feishu-send-file <file_path> [receive_id]");
    process.exit(1);
  }
  
  console.log(`Sending file: ${filePath}`);
  console.log(`To: ${receiveId}`);
  
  // Read file
  const fileContent = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  
  // Detect file type
  const ext = path.extname(fileName).toLowerCase();
  let fileType;
  if (ext === ".mp4" || ext === ".mov") fileType = "mp4";
  else if (ext === ".pdf") fileType = "pdf";
  else fileType = "stream";
  
  try {
    // Upload file
    const uploadResponse = await client.im.file.create({
      data: {
        file_type: fileType,
        file_name: fileName,
        file: fs.createReadStream(filePath),
      },
    });
    
    console.log("Upload response:", uploadResponse);
    
    if (uploadResponse.code !== 0) {
      console.error("Upload failed:", uploadResponse.msg);
      process.exit(1);
    }
    
    const fileKey = uploadResponse.data?.file_key;
    console.log("File key:", fileKey);
    
    // Send file message
    const sendResponse = await client.im.message.create({
      params: { receive_id_type: "open_id" },
      data: {
        receive_id: receiveId,
        msg_type: "file",
        content: JSON.stringify({ file_key: fileKey }),
      },
    });
    
    console.log("Send response:", sendResponse);
    
    if (sendResponse.code !== 0) {
      console.error("Send failed:", sendResponse.msg);
      process.exit(1);
    }
    
    console.log("✅ File sent successfully!");
    console.log("Message ID:", sendResponse.data?.message_id);
    
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
