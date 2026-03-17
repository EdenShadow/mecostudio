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
      
      // 处理连接挑战
      if (frame.type === 'event' && frame.event === 'connect.challenge') {
        // 使用事件确认格式响应
        const response = {
          type: 'event',
          event: 'connect.challenge.response',
          payload: { 
            nonce: frame.payload.nonce,
            token: TOKEN 
          }
        };
        console.log('发送挑战响应:', JSON.stringify(response));
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
                role: 'operator',
                scopes: ['operator.admin']
              },
              auth: { token: TOKEN },
              protocol: 1
            }
          };
          console.log('发送 connect 请求');
          ws.send(JSON.stringify(connect));
        }, 200);
      }
      
      // 处理 connect 响应
      if (frame.type === 'res' && frame.payload?.hello) {
        console.log('✅ 连接成功! Server:', frame.payload.hello.serverInfo?.name);
        
        // 发送 agent 请求
        setTimeout(() => {
          const agentReq = {
            type: 'req',
            id: 'agent-1',
            method: 'agent',
            params: {
              message: '你好',
              sessionKey: 'agent:main:main',
              agentId: 'main',
              idempotencyKey: `test-${Date.now()}`,
              timeout: 60
            }
          };
          console.log('发送 agent 请求');
          ws.send(JSON.stringify(agentReq));
        }, 500);
      }
      
      // 处理 agent 事件流
      if (frame.type === 'event' && frame.payload?.stream === 'assistant') {
        process.stdout.write(frame.payload.data?.delta || '');
      }
      
      // 处理工具调用
      if (frame.type === 'event' && frame.payload?.stream === 'tool') {
        console.log('\n🔧 工具调用:', frame.payload.data?.name);
      }
      
      // 处理结束
      if (frame.type === 'res' && frame.payload?.status === 'ok') {
        console.log('\n✅ 请求完成');
        ws.close();
      }
      
      if (frame.type === 'res' && frame.payload?.status === 'error') {
        console.log('\n❌ 错误:', frame.payload.summary);
        ws.close();
      }
      
    } catch (e) {
      console.log('解析错误:', e.message);
    }
  }
});

ws.on('close', (code) => {
  console.log('\n关闭:', code);
});

ws.on('error', (err) => {
  console.log('错误:', err.message);
});

setTimeout(() => ws.close(), 15000);
