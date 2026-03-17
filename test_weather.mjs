import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3456/ws/kobe');
let response = '';

ws.on('open', () => {
  console.log('已连接 Kobe');
  setTimeout(() => {
    ws.send(JSON.stringify({ content: '查询北京今天的天气，告诉我温度和穿衣建议' }));
  }, 500);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'chunk') {
    process.stdout.write(msg.content);
    response += msg.content;
  }
  if (msg.type === 'end') {
    console.log('\n\n=== 完整回复 ===');
    console.log(response);
    
    // 检查是否包含具体天气数据
    if (response.includes('°C') || response.includes('度') || response.includes('温度')) {
      console.log('\n✅ 看起来获取到了天气数据！');
    } else {
      console.log('\n❌ 可能是模型知识，非实时天气');
    }
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (e) => console.log('错误:', e.message));
setTimeout(() => { ws.close(); process.exit(0); }, 30000);
