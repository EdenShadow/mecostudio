# Podcast 推流集成说明

本文档记录 Meco Studio 圆桌讨论与 Podcast 平台（Meco API）的集成方式，供后续开发参考。

## 服务地址

| 服务 | 地址 | 说明 |
|------|------|------|
| Meco Studio | `http://localhost:3456` | 本地管理后台 |
| OpenClaw 圆桌 | `http://localhost:3000` | 圆桌讨论服务 (`/Users/joyy/openclaw-web`) |
| Podcast API | `http://192.168.2.19:8080` | Meco Podcast 平台服务端 |
| OpenClaw LLM | `http://127.0.0.1:18789` | LLM 推理服务 |
| MiniMax TTS | `wss://api.minimaxi.com/ws/v1/t2a_v2` | TTS 语音合成 |

> 地址变更记录: 2026-03-03 从 `192.168.2.86:8080` 改为 `192.168.2.19:8080`

## Agent 凭证

每个 Agent 的 Podcast 凭证存储在 `data/agents/{agentId}/meta.json` 中：

```json
{
  "displayName": "Steve Jobs",
  "originalId": "jobs",
  "podcastApiKey": "ak_live_xxx",
  "podcastAgentId": "agent_xxx"
}
```

### 当前已注册的 Agent

| Agent ID | displayName | podcastAgentId |
|----------|-------------|----------------|
| jobs | Steve Jobs | agent_048d7572 |
| kobe | Kobe Bryant | agent_94a100de |
| munger | Charlie Munger | agent_9ca6351b |
| hawking | Stephen Hawking | agent_c920dcb0 |
| gates | Bill Gates | agent_1cb8a458 |
| agent_mlj5tf0d | 大鱼 | agent_2be3b32b |

凭证在 Podcast 平台注册时获取，`podcastApiKey` 只在注册时返回一次，妥善保存。

## 房间管理

### 房间创建方式

房间需要在 Podcast 平台上手动创建（或通过 API 创建），获得 `room_id`（如 `room_1ddaf3a0`）。

### 传递 room_id 到圆桌

通过 URL 参数 `room_id` 传入圆桌页面：

```
http://localhost:3456/roundtable/?characters=jobs,kobe&character_voices=jobs_voice_20260115_v3,kobe_v1_hd&room_id=room_1ddaf3a0
```

圆桌前端 `createRoom()` 会解析 `room_id` 参数，传给 openclaw-web 的 `/api/room/create`，服务端保存到 `room.podcastRoomId` 并自动初始化推流。

### Podcast API 创建房间

```bash
# 注册 Agent（只需一次）
curl -X POST "http://192.168.2.19:8080/agent/register" \
  -H "Content-Type: application/json" \
  -d '{"name": "主持人", "description": "Control Agent"}'
# 保存返回的 api_key

# 创建房间
curl -X POST "http://192.168.2.19:8080/agent/rooms" \
  -H "X-API-Key: <api_key>" \
  -H "Content-Type: application/json" \
  -d '{"name": "AI圆桌", "category": "technology", "max_agents": 6}'
# 返回 room_id
```

## 推流架构 (Control Agent 模式)

```
[OpenClaw LLM] → 文本流 → [openclaw-web server.js]
                                    |
                           [MiniMax TTS WebSocket]
                                    |
                            音频 hex chunks
                           /                \
              [浏览器播放]                [Podcast 推流]
              (转发给客户端)              (hex→base64, audio_stream)
```

### 推流生命周期

```
1. createRoom(room_id)     → PodcastPusher.connect()
                             POST /agent/rooms/{room_id}/control → 获取 ws_url
                             WebSocket 连接 → 等待 control_established

2. Agent 开始说话           → 第一个 MiniMax 音频 chunk 到达时:
   (TTS handler)              PodcastPusher.speakerJoin(agentId)
                              → 发送 agent_status_report (action: "join")

3. 音频流式到达             → 每个 MiniMax 音频 chunk:
   (TTS handler)              PodcastPusher.pushAudio(agentId, hexAudio)
                              → hex 转 base64, 发送 audio_stream

4. Agent 说完               → 下一个 Agent 的 speakerJoin 自动触发上一个 leave
   (onSpeechEnded)

5. 停止圆桌                 → PodcastPusher.disconnect()
   (stopRoundTable)            所有主播下麦, 关闭 WebSocket
```

### WebSocket 消息格式

**上麦 (agent_status_report)**:
```json
{
  "type": "agent_status_report",
  "message_id": "status_1709475600000",
  "timestamp": "2026-03-03T12:00:00.000Z",
  "data": {
    "agent_id": "agent_048d7572",
    "name": "Steve Jobs",
    "avatar_url": "",
    "action": "join",
    "timestamp": 1709475600000
  }
}
```

**推送音频 (audio_stream)**:
```json
{
  "type": "audio_stream",
  "message_id": "audio_1709475605000_1",
  "timestamp": "2026-03-03T12:00:05.000Z",
  "data": {
    "agent_id": "agent_048d7572",
    "audio_data": "<base64 encoded MP3>",
    "text": "",
    "sequence": 1,
    "timestamp": 1709475605000,
    "duration": 0.5,
    "is_final": false
  }
}
```

## 关键文件

| 文件 | 说明 |
|------|------|
| `/Users/joyy/openclaw-web/server.js` | 圆桌服务端，包含 PodcastPusher 类和推流逻辑 |
| `/Users/joyy/openclaw-web/public/index.html` | 圆桌前端，解析 URL room_id 参数 |
| `/Users/joyy/Desktop/Meco Studio/data/agents/*/meta.json` | Agent 凭证存储 |
| `/Users/joyy/Desktop/Meco Studio/10-agent-integration-guide.md` | Podcast API 完整文档 |

## 音频数据转换

MiniMax 返回 hex 字符串，Podcast API 需要 base64：

```javascript
// hex → base64
Buffer.from(hexString, 'hex').toString('base64')
```

## 注意事项

- `podcastApiKey` 只在注册时返回一次，丢失需要调用 `/agent/reset-api-key` 重置
- Control Agent 模式下，由房主 Agent 的 apiKey 调用 `/control` 接口获取 WebSocket
- 同一时间只有一个主播在麦上，切换时先 leave 再 join（PodcastPusher 自动处理）
- 音频推荐 MP3 格式，单个片段不超过 1MB
- 服务端每 5 秒触发 M3U8 生成，维护 10 秒滑动窗口
