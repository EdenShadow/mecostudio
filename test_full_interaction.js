const WebSocket = require('ws');

const agentId = 'jobs';

// 连接聊天 WebSocket
const chatWs = new WebSocket(`ws://localhost:3456/${agentId}`);

chatWs.on('open', () => {
  console.log(`[${agentId}] 聊天 WebSocket 已连接`);
  
  // 发送消息
  const msg = {
    type: 'chat',
    message: 'Hello, who are you?'
  };
  chatWs.send(JSON.stringify(msg));
  console.log(`[${agentId}] 发送消息: ${msg.message}`);
});

chatWs.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    console.log(`[${agentId}] 收到 [${msg.type}]:`, msg.content ? msg.content.slice(0, 50) : '');
  } catch (e) {
    console.log(`[${agentId}] 收到原始数据:`, data.toString().slice(0, 100));
  }
});

chatWs.on('error', (err) => {
  console.error(`[${agentId}] 聊天错误:`, err.message);
});

chatWs.on('close', () => {
  console.log(`[${agentId}] 聊天 WebSocket 已关闭`);
});

// 10秒后关闭
setTimeout(() => {
  chatWs.close();
  process.exit(0);
}, 10000);
