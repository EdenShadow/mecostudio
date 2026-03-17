import WebSocket from 'ws';

function testAgent(agentId, message) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:3456/ws/${agentId}`);
    let response = '';
    let started = false;
    
    ws.on('open', () => {
      setTimeout(() => {
        ws.send(JSON.stringify({ content: message }));
      }, 500);
    });
    
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'start') started = true;
      if (msg.type === 'chunk') response += msg.content;
      if (msg.type === 'end') {
        console.log(`\n[${agentId}] 回复:\n${response.substring(0, 150)}...`);
        ws.close();
        resolve();
      }
    });
    
    ws.on('error', () => resolve());
    setTimeout(() => { ws.close(); resolve(); }, 15000);
  });
}

async function test() {
  console.log('=== 六人议会测试 ===');
  
  await testAgent('kobe', '什么是曼巴精神？');
  await new Promise(r => setTimeout(r, 1000));
  
  await testAgent('munger', '逆向思维是什么意思？');
  await new Promise(r => setTimeout(r, 1000));
  
  await testAgent('hawking', '黑洞里面有什么？');
  await new Promise(r => setTimeout(r, 1000));
  
  await testAgent('gates', '为什么要做慈善？');
  
  console.log('\n测试完成！');
  process.exit(0);
}

test();
