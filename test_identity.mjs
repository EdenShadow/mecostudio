import WebSocket from 'ws';

const WS_URL = 'ws://localhost:3456/ws/jobs';

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('已连接');
  setTimeout(() => {
    ws.send(JSON.stringify({ content: '你是谁？用你最标志性的风格介绍自己。' }));
  }, 1000);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'chunk') {
    process.stdout.write(msg.content);
  } else if (msg.type !== 'system') {
    console.log(`\n[${msg.type}]`);
  }
});

ws.on('close', () => process.exit(0));
setTimeout(() => ws.close(), 30000);
