const fetch = require('node-fetch');

const MINIMAX_API_KEY = String(process.env.MECO_MINIMAX_API_KEY || process.env.MINIMAX_API_KEY || '').trim();

async function test() {
  if (!MINIMAX_API_KEY) {
    throw new Error('Missing MiniMax API key. Set MECO_MINIMAX_API_KEY or MINIMAX_API_KEY.');
  }

  const response = await fetch('https://api.minimaxi.com/v1/t2a_v2', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MINIMAX_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'speech-2.6-hd',
      text: '你好，我是乔布斯。',
      stream: true,
      voice_setting: {
        voice_id: 'jobs_voice_20260115_v3',
        speed: 1, vol: 1, pitch: 0
      },
      audio_setting: {
        sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1
      }
    })
  });
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let count = 0;
  let seen = new Set();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    
    for (const line of lines) {
      if (line.trim().startsWith('data:')) {
        const dataStr = line.trim().slice(5).trim();
        if (dataStr && dataStr !== '[DONE]') {
          try {
            const data = JSON.parse(dataStr);
            if (data.data && data.data.audio) {
              count++;
              const hash = data.data.audio.slice(0, 50);
              if (seen.has(hash)) {
                console.log('DUPLICATE detected!');
              }
              seen.add(hash);
              console.log(`Chunk ${count}, hash: ${hash.substring(0, 20)}...`);
            }
          } catch (e) {}
        }
      }
    }
  }
  
  console.log(`Total chunks: ${count}, Unique: ${seen.size}`);
}

test().catch(console.error);
