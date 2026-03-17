const WebSocket = require('ws');

const agentId = process.argv[2] || 'jobs';
const text = process.argv[3] || 'Hello, this is a test.';

const ws = new WebSocket(`ws://localhost:3456/tts/${agentId}`);
let audioReceived = false;

ws.on('open', () => {
  console.log(`[${agentId}] TTS WebSocket 已连接`);
  console.log(`[${agentId}] 发送文本: ${text}`);
  
  // 发送文本
  ws.send(JSON.stringify({ type: 'text', content: text }));
  
  // 2秒后发送结束信号
  setTimeout(() => {
    console.log(`[${agentId}] 发送结束信号`);
    ws.send(JSON.stringify({ type: 'end' }));
  }, 500);
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    console.log(`[${agentId}] 收到:`, msg.event || 'audio_data');
    
    if (msg.data && msg.data.audio) {
      audioReceived = true;
      console.log(`[${agentId}] 收到音频数据，长度:`, msg.data.audio.length);
    }
    
    if (msg.event === 'task_started') {
      console.log(`[${agentId}] MiniMax 已就绪`);
    }
  } catch (e) {
    console.log(`[${agentId}] 收到原始数据:`, data.toString().slice(0, 100));
  }
});

ws.on('error', (err) => {
  console.error(`[${agentId}] 错误:`, err.message);
});

ws.on('close', () => {
  console.log(`[${agentId}] WebSocket 已关闭`);
  console.log(`[${agentId}] 音频接收状态:`, audioReceived ? '成功' : '失败');
  process.exit(audioReceived ? 0 : 1);
});

// 10秒超时
setTimeout(() => {
  console.log(`[${agentId}] 超时，关闭连接`);
  ws.close();
}, 10000);
