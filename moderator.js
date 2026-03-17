/**
 * Kimi 主持人模块 - 自动圆桌讨论系统
 * 
 * 职责：
 * 1. 监听每个智能体的发言
 * 2. 总结讨论内容
 * 3. 决定下一个发言人
 * 4. 组织过渡语言
 */

const { spawn } = require('child_process');
const path = require('path');

// 智能体信息
const AGENT_INFO = {
  main: { name: '通用助手', persona: '通用AI助手', style: '理性、客观' },
  jobs: { name: 'Steve Jobs', persona: '苹果公司创始人', style: '激情、完美主义、洞察力强' },
  kobe: { name: 'Kobe Bryant', persona: 'NBA传奇球星', style: '勤奋、好胜、曼巴精神' },
  munger: { name: 'Charlie Munger', persona: '投资大师', style: '睿智、幽默、跨学科思维' },
  hawking: { name: 'Stephen Hawking', persona: '物理学家', style: '深邃、幽默、宇宙视角' },
  gates: { name: 'Bill Gates', persona: '微软创始人', style: '务实、远见、人道主义' }
};

// 讨论状态
class RoundTableDiscussion {
  constructor() {
    this.history = []; // 讨论历史
    this.currentSpeaker = null;
    this.isActive = false;
    this.waitingForCallback = false;
  }

  // 添加发言到历史
  addSpeech(agentId, content) {
    this.history.push({
      agentId,
      name: AGENT_INFO[agentId]?.name || agentId,
      content,
      timestamp: Date.now()
    });
    this.currentSpeaker = agentId;
  }

  // 获取最近的讨论上下文
  getRecentContext(count = 5) {
    return this.history.slice(-count).map(h => 
      `${h.name}: ${h.content.substring(0, 200)}${h.content.length > 200 ? '...' : ''}`
    ).join('\n\n');
  }
}

// Kimi 主持人
class KimiModerator {
  constructor() {
    this.discussion = new RoundTableDiscussion();
    this.kimiPath = path.join(require('os').homedir(), '.local/bin/kimi');
  }

  // 调用 Kimi CLI
  async askKimi(prompt) {
    return new Promise((resolve, reject) => {
      const workDir = path.join(require('os').homedir(), 'openclaw-web');
      const args = [
        '--yolo', // 自动批准
        '--prompt', prompt,
        '--work-dir', workDir
      ];

      console.log('[Moderator] 询问 Kimi...');
      const kimi = spawn(this.kimiPath, args, {
        cwd: workDir,
        env: { ...process.env, PATH: path.join(require('os').homedir(), '.local/bin') + ':' + process.env.PATH }
      });

      let output = '';
      let error = '';

      kimi.stdout.on('data', (data) => {
        output += data.toString();
      });

      kimi.stderr.on('data', (data) => {
        error += data.toString();
      });

      kimi.on('close', (code) => {
        if (code !== 0 && code !== null) {
          console.error('[Moderator] Kimi 退出码:', code);
          console.error('[Moderator] 错误:', error.slice(0, 500));
        }
        resolve(output.trim());
      });

      // 30秒超时
      setTimeout(() => {
        kimi.kill();
        resolve(output.trim() || '超时，使用默认逻辑');
      }, 30000);
    });
  }

  // 主持人分析并决定下一个发言人
  async moderate(lastSpeakerId, lastContent) {
    // 添加到历史
    this.discussion.addSpeech(lastSpeakerId, lastContent);

    const context = this.discussion.getRecentContext(3);
    
    const prompt = `你是一场高端圆桌讨论的主持人。最近的发言如下：

${context}

刚刚 ${AGENT_INFO[lastSpeakerId]?.name || lastSpeakerId} 发表了上述观点。

作为主持人，请你：
1. 简要总结 ${AGENT_INFO[lastSpeakerId]?.name || lastSpeakerId} 的核心观点（1-2句话）
2. 从以下嘉宾中选择一位最适合接话的人：Main(通用助手)、Jobs(乔布斯)、Kobe(科比)、Munger(芒格)、Hawking(霍金)、Gates(比尔·盖茨)
3. 组织一个自然的过渡语，引导这位嘉宾回应上述观点

请严格按照以下格式回复：

总结：[总结内容]

下一位：[嘉宾ID，只能是 main/jobs/kobe/munger/hawking/gates 之一]

过渡语：[对下一位嘉宾说的话，引导他们回应，2-3句话，要自然]

注意：过渡语要口语化，像主持人一样自然引导讨论。`;

    try {
      const response = await this.askKimi(prompt);
      console.log('[Moderator] Kimi 回复:\n', response);
      return this.parseResponse(response);
    } catch (err) {
      console.error('[Moderator] Kimi 调用失败:', err.message);
      return this.getDefaultResponse(lastSpeakerId);
    }
  }

  // 解析 Kimi 回复
  parseResponse(response) {
    // Kimi CLI 输出有很多格式化内容，需要找到实际的回复部分
    // 通常实际回复在 "• " 标记之后
    const bulletMatch = response.match(/\n\u2022\s*([\s\S]+)$/);
    const contentToParse = bulletMatch ? bulletMatch[1] : response;
    
    const lines = contentToParse.split('\n');
    let summary = '';
    let nextAgent = 'jobs'; // 默认
    let transition = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('总结：') || trimmed.startsWith('总结:')) {
        summary = trimmed.replace(/^总结[：:]\s*/, '').trim();
      } else if (trimmed.startsWith('下一位：') || trimmed.startsWith('下一位:')) {
        const id = trimmed.replace(/^下一位[：:]\s*/, '').trim().toLowerCase();
        if (AGENT_INFO[id]) nextAgent = id;
      } else if (trimmed.startsWith('过渡语：') || trimmed.startsWith('过渡语:')) {
        transition = trimmed.replace(/^过渡语[：:]\s*/, '').trim();
      }
    }

    // 如果没解析到过渡语，使用默认
    if (!transition) {
      transition = `那我们来听听${AGENT_INFO[nextAgent]?.name || nextAgent}对这个问题的看法。`;
    }

    return { summary, nextAgent, transition };
  }

  // 默认回复（Kimi 失败时用）
  getDefaultResponse(lastSpeakerId) {
    const agents = Object.keys(AGENT_INFO).filter(id => id !== lastSpeakerId);
    const nextAgent = agents[Math.floor(Math.random() * agents.length)];
    
    return {
      summary: `${AGENT_INFO[lastSpeakerId]?.name || lastSpeakerId}分享了他的观点。`,
      nextAgent,
      transition: `我们来听听${AGENT_INFO[nextAgent]?.name || nextAgent}怎么看这个问题。`
    };
  }

  // 开始新话题
  async startNewTopic(topic) {
    const prompt = `你是一场高端圆桌讨论的主持人。讨论话题是：「${topic}」

请从以下嘉宾中选择一位最适合开场的人：Main(通用助手)、Jobs(乔布斯)、Kobe(科比)、Munger(芒格)、Hawking(霍金)、Gates(比尔·盖茨)

并写一段开场白，引导这位嘉宾开始讨论。

请严格按照以下格式回复：

开场嘉宾：[嘉宾ID，只能是 main/jobs/kobe/munger/hawking/gates 之一]

开场白：[对嘉宾说的话，引导他们开场，2-3句话]

注意：开场白要口语化，像主持人一样自然。`;

    try {
      const response = await this.askKimi(prompt);
      console.log('[Moderator] Kimi 开场回复:\n', response);
      
      // 解析 Kimi CLI 输出
      const bulletMatch = response.match(/\n\u2022\s*([\s\S]+)$/);
      const contentToParse = bulletMatch ? bulletMatch[1] : response;
      
      const lines = contentToParse.split('\n');
      let nextAgent = 'jobs';
      let opening = '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('开场嘉宾：') || trimmed.startsWith('开场嘉宾:')) {
          const id = trimmed.replace(/^开场嘉宾[：:]\s*/, '').trim().toLowerCase();
          if (AGENT_INFO[id]) nextAgent = id;
        } else if (trimmed.startsWith('开场白：') || trimmed.startsWith('开场白:')) {
          opening = trimmed.replace(/^开场白[：:]\s*/, '').trim();
        }
      }

      if (!opening) {
        opening = `今天我们来聊聊${topic}，${AGENT_INFO[nextAgent]?.name || nextAgent}，你先来说说你的看法？`;
      }

      return { nextAgent, opening };
    } catch (err) {
      console.error('[Moderator] Kimi 调用失败:', err.message);
      return {
        nextAgent: 'jobs',
        opening: `今天我们来聊聊${topic}，乔布斯，你先来说说你的看法？`
      };
    }
  }
}

module.exports = { KimiModerator, RoundTableDiscussion, AGENT_INFO };
