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
  console.log('收到:', data.toString());
});

ws.on('close', (code) => {
  console.log('关闭:', code);
});

ws.on('error', (err) => {
  console.log('错误:', err.message);
});
