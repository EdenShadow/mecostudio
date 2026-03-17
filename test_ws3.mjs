import WebSocket from 'ws';

const TOKEN = process.env.MECO_OPENCLAW_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || '';
if (!TOKEN) {
  throw new Error('Missing gateway token. Set MECO_OPENCLAW_GATEWAY_TOKEN or OPENCLAW_GATEWAY_TOKEN.');
}
const ws = new WebSocket(`ws://127.0.0.1:18789?token=${TOKEN}`);

ws.on('open', () => {
  console.log('WebSocket opened');
});

ws.on('message', (data) => {
  const lines = data.toString().trim().split('\n');
  for (const line of lines) {
    if (!line) continue;
    console.log('收到:', line);
    try {
      const frame = JSON.parse(line);
      if (frame.type === 'event' && frame.event === 'connect.challenge') {
        // 响应挑战 - 使用 res 类型
        const response = {
          type: 'res',
          id: frame.id,
          payload: { token: TOKEN }
        };
        console.log('发送响应:', JSON.stringify(response));
        ws.send(JSON.stringify(response));
        
        // 然后发送 connect 请求
        setTimeout(() => {
          const connect = {
            type: 'req',
            id: 'conn-1',
            method: 'connect',
            params: {
              client: {
                name: 'test-client',
                version: '1.0.0',
                mode: 'operator',
                role: 'operator'
              },
              auth: { token: TOKEN },
              protocol: 1
            }
          };
          console.log('发送 connect:', JSON.stringify(connect));
          ws.send(JSON.stringify(connect));
        }, 100);
      }
    } catch (e) {
      console.log('解析错误:', e.message);
    }
  }
});

ws.on('close', (code) => {
  console.log('关闭:', code);
});

ws.on('error', (err) => {
  console.log('错误:', err.message);
});

setTimeout(() => ws.close(), 5000);
