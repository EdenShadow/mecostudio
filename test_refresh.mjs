import WebSocket from 'ws';

function testConnection(label) {
  return new Promise((resolve) => {
    console.log(`\n[${label}] 连接测试...`);
    const ws = new WebSocket('ws://localhost:3456/ws/jobs');
    let systemMsg = '';
    
    ws.on('open', () => {
      ws.send(JSON.stringify({ content: '说出你的版本标记' }));
    });
    
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'system') {
        systemMsg = msg.content;
      } else if (msg.type === 'chunk') {
        process.stdout.write(msg.content);
      } else if (msg.type === 'end') {
        console.log('\n---');
        ws.close();
        resolve();
      }
    });
    
    setTimeout(() => ws.close(), 15000);
  });
}

async function test() {
  // 第一次连接
  await testConnection('第一次');
  
  // 等待 3 秒，期间修改人设文件
  console.log('\n\n等待 3 秒...（请在此时修改人设文件）');
  await new Promise(r => setTimeout(r, 3000));
  
  // 模拟文件修改
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const soulPath = path.join(os.homedir(), '.openclaw/workspace-Jobs/SOUL.md');
  let content = fs.readFileSync(soulPath, 'utf-8');
  content = content.replace(/版本: Web测试-\d+/, `版本: Web测试-${Date.now()}`);
  fs.writeFileSync(soulPath, content);
  console.log('人设文件已修改');
  
  // 第二次连接（应该自动加载新人设）
  await testConnection('第二次（刷新后）');
  
  process.exit(0);
}

test();
