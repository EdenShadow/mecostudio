import WebSocket from 'ws';

const WS_URL = 'ws://localhost:3456/ws/jobs';

function connectAndSend(message, delay = 0) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const ws = new WebSocket(WS_URL);
      let response = '';
      
      ws.on('open', () => {
        ws.send(JSON.stringify({ content: message }));
      });
      
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'chunk') response += msg.content;
        if (msg.type === 'end') {
          console.log('\n回复:', response.substring(0, 200));
          ws.close();
          resolve(response);
        }
      });
    }, delay);
  });
}

async function test() {
  console.log('=== 记忆测试 ===\n');
  
  console.log('1. 告诉 Agent 我的名字');
  await connectAndSend('记住，我叫小明。');
  
  console.log('\n2. 等待回答完成...\n');
  await new Promise(r => setTimeout(r, 5000));
  
  console.log('3. 询问它是否记得我的名字');
  await connectAndSend('我叫什么名字？', 1000);
  
  console.log('\n测试完成！');
  process.exit(0);
}

test();
