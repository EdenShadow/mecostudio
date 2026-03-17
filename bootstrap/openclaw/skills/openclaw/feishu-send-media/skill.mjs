#!/usr/bin/env node
/**
 * Feishu Send Media Skill
 * Usage: feishu-send-media <file_path> [receive_id]
 * 
 * Examples:
 *   feishu-send-media /path/to/video.mp4
 *   feishu-send-media /path/to/image.png ou_123456
 */

import fs from "fs";
import path from "path";
import Lark from "@larksuiteoapi/node-sdk";

const CONFIG_PATH = path.join(process.env.HOME || "", ".openclaw", "openclaw.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

const client = new Lark.Client({
  appId: config.channels.feishu.appId,
  appSecret: config.channels.feishu.appSecret,
  appType: Lark.AppType.SelfBuild,
  domain: Lark.Domain.Feishu,
});

// Default receive ID
const DEFAULT_RECEIVE_ID = "ou_8aabc219e4883cf1204157d904d54021";

// Detect file type and message type
function getFileTypes(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  
  // Image types -> image message
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) {
    return { fileType: "image", msgType: "image" };
  }
  
  // Video types -> media message
  if (["mp4", "mov", "avi"].includes(ext)) {
    return { fileType: "mp4", msgType: "media" };
  }
  
  // Audio types -> audio message
  if (["mp3", "wav", "opus"].includes(ext)) {
    return { fileType: "opus", msgType: "audio" };
  }
  
  // Default -> file message
  return { fileType: "stream", msgType: "file" };
}

async function sendFile(filePath, receiveId = DEFAULT_RECEIVE_ID) {
  const fileName = path.basename(filePath);
  const { fileType, msgType } = getFileTypes(filePath);
  
  console.log(`📤 Sending: ${fileName}`);
  console.log(`   Type: ${fileType} -> ${msgType}`);
  console.log(`   To: ${receiveId}`);
  
  try {
    // 1. Upload file
    console.log("   ⏫ Uploading...");
    const uploadResponse = await client.im.file.create({
      data: {
        file_type: fileType,
        file_name: fileName,
        file: fs.createReadStream(filePath),
      },
    });
    
    if (!uploadResponse.file_key) {
      console.error("   ❌ Upload failed");
      return false;
    }
    
    const fileKey = uploadResponse.file_key;
    console.log(`   ✅ Uploaded: ${fileKey}`);
    
    // 2. Send message
    console.log("   📨 Sending message...");
    const sendResponse = await client.im.message.create({
      params: { receive_id_type: "open_id" },
      data: {
        receive_id: receiveId,
        msg_type: msgType,
        content: JSON.stringify({ file_key: fileKey }),
      },
    });
    
    if (sendResponse.code === 0) {
      console.log(`   ✅ Success! Message ID: ${sendResponse.data?.message_id}`);
      return true;
    } else {
      console.error(`   ❌ Send failed: ${sendResponse.msg}`);
      return false;
    }
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return false;
  }
}

// CLI entry point
async function main() {
  const filePath = process.argv[2];
  const receiveId = process.argv[3];
  
  if (!filePath) {
    console.log("Feishu Send Media Skill");
    console.log("");
    console.log("Usage: feishu-send-media <file_path> [receive_id]");
    console.log("");
    console.log("Examples:");
    console.log("  feishu-send-media /path/to/video.mp4");
    console.log("  feishu-send-media /path/to/image.png");
    console.log("  feishu-send-media /path/to/document.pdf ou_123456");
    process.exit(0);
  }
  
  const success = await sendFile(filePath, receiveId);
  process.exit(success ? 0 : 1);
}

main();
