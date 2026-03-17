import WebSocket from 'ws';

function testAgent(agentId, message) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:3456/ws/${agentId}`);
    let response = '';
    
    ws.on('open', () => {
      setTimeout(() => {
        ws.send(JSON.stringify({ content: message }));
      }, 500);
    });
    
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'chunk') response += msg.content;
      if (msg.type === 'end') {
        console.log(`\n[${agentId}] 回复:\n${response}`);
        ws.close();
        resolve(response);
      }
    });
    
    ws.on('error', () => resolve());
    setTimeout(() => { ws.close(); resolve(); }, 20000);
  });
}

async function test() {
  console.log('=== 测试技能调用 ===');
  
  // 测试天气技能
  console.log('\n1. 测试天气查询...');
  await testAgent('kobe', '查询洛杉矶今天的天气');
  
  await new Promise(r => setTimeout(r, 2000));
  
  // 测试笔记技能
  console.log('\n2. 测试笔记技能...');
  await testAgent('munger', '帮我记录一条笔记：今天学习了逆向思维');
  
  console.log('\n测试完成！');
  process.exit(0);
}

test();
