const fs = require('fs');

// 读取测试文件
const stdoutData = fs.readFileSync('/tmp/test_output.json', 'utf-8');

console.log('stdout 长度:', stdoutData.length);
console.log('stdout 开头:', stdoutData.substring(0, 100));
console.log('stdout 结尾:', stdoutData.substring(stdoutData.length - 100));

// JSON 提取逻辑
let jsonStr = null;
let startIdx = stdoutData.indexOf('\n{');
console.log('\\n{ 的位置:', startIdx);

if (startIdx === -1) {
  startIdx = stdoutData.indexOf('{');
  console.log('{ 的位置:', startIdx);
}

if (startIdx !== -1) {
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  let endIdx = -1;
  
  // 从 startIdx 开始遍历，而不是 startIdx + 1
  for (let i = startIdx; i < stdoutData.length; i++) {
    const char = stdoutData[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '{') braceCount++;
      if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }
  }
  
  console.log('endIdx:', endIdx);
  
  if (endIdx !== -1) {
    const actualStart = stdoutData.charAt(startIdx) === '\n' ? startIdx + 1 : startIdx;
    jsonStr = stdoutData.substring(actualStart, endIdx);
    console.log('提取的 JSON 长度:', jsonStr.length);
    console.log('提取的 JSON 开头:', jsonStr.substring(0, 100));
    
    try {
      const result = JSON.parse(jsonStr);
      console.log('JSON 解析成功!');
      console.log('状态:', result.status);
      if (result.result?.payloads) {
        console.log('响应内容:', result.result.payloads[0]?.text?.substring(0, 100));
      }
    } catch (e) {
      console.log('JSON 解析失败:', e.message);
    }
  }
}
