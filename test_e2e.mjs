/**
 * 端到端测试 - 模拟浏览器连接到 web 服务器
 */
import WebSocket from 'ws';

const WS_URL = 'ws://localhost:3456/ws/jobs';

console.log('🔗 连接到 Web 服务器...');
const ws = new WebSocket(WS_URL);

let messageCount = 0;

ws.on('open', () => {
  console.log('✅ 已连接到 Web 服务器');
  
  // 发送测试消息
  setTimeout(() => {
    console.log('\n📤 发送: "查询北京天气"');
    ws.send(JSON.stringify({ content: '查询北京天气' }));
  }, 1000);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  messageCount++;
  
  switch(msg.type) {
    case 'system':
      console.log(`[系统] ${msg.content}`);
      break;
    case 'start':
      console.log('[开始] Agent 运行开始');
      break;
    case 'chunk':
      process.stdout.write(msg.content);
      break;
    case 'tool':
      console.log(`\n[工具] ${msg.content}`);
      break;
    case 'tool-result':
      console.log(`\n[工具结果] ${msg.content}`);
      break;
    case 'end':
      console.log('\n[结束] Agent 运行完成');
      setTimeout(() => ws.close(), 1000);
      break;
    case 'error':
      console.log(`\n[错误] ${msg.content}`);
      ws.close();
      break;
  }
});

ws.on('close', () => {
  console.log(`\n🔌 连接关闭，共收到 ${messageCount} 条消息`);
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('\n⏱️ 测试超时');
  ws.close();
}, 60000);
