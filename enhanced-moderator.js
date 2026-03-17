  // enhanced-moderator.js - 5人圆桌主持人（English prompts enhanced by Claude）

  class EnhancedRoundTableModerator {
    constructor(options = {}) {
      this.lang = options.lang || 'zh';
      this.topics = options.topics || [];
      this.agents = options.agents || {}; // Store agent objects map
      this.category = options.category || null; // 房间分类（如 'AI_Tech', 'Trending'）
      this.topicLoader = options.topicLoader || null; // 动态加载话题的回调函数
      console.log('[Moderator] 构造函数: topics数量=', this.topics.length, ', category=', this.category, ', 第一个话题:', this.topics[0] ? { title: this.topics[0].title, hasPostData: !!this.topics[0].postData, platform: this.topics[0].postData?.platform } : '无');
      this.currentTopic = null;
      this.currentTopicPostPath = null; // 当前话题的 post.json 路径（如果有）
      this.currentTopicData = null; // 完整话题数据（包括 postData）
      this.isUserSetTopic = false; // 用户打断设置的话题，防止被 detectTopicSwitch 覆盖
      this.discussionHistory = [];

      // 支持动态 agentIds，如果没有则使用默认5人
      this.allAgents = options.agentIds && options.agentIds.length > 0
        ? options.agentIds
        : ['jobs', 'kobe', 'munger', 'hawking', 'gates'];
      this.askedSet = new Set();
      this.lastSpeaker = null;
      this.lastContent = null;
      this.expectedSpeaker = null;

      // 话题过渡状态
      this.transitionState = null;

      // 指定发言链计数器（防止连续指定过多）
      this.designatedChainCount = 0;

      // 本轮发言历史（每轮开始时清空）
      this.roundHistory = [];

      // 话题去重：用路径（path）做去重，避免动态增删导致索引错位
      this.usedTopicPaths = new Set();
      this.lastTopicPath = null;
      // 话题内容去重：优先用 URL，避免同一条内容在不同目录重复命中
      this.usedTopicKeys = new Set();
      this.lastTopicKey = null;

      // 外部注入的优先话题队列（麦序抓取结果，优先于知识库话题）
      this.priorityTopics = [];

      this.isActive = false;
    }

    start() {
      this.isActive = true;
      this.askedSet.clear();
      this.discussionHistory = [];
      this.transitionState = null;
      this.designatedChainCount = 0;
      this.roundHistory = [];
      console.log('[Moderator] 5人圆桌已启动');
    }

    stop() {
      this.isActive = false;
      this.transitionState = null;
    }

    setLang(lang) {
      this.lang = lang || 'zh';
    }

    // 从知识库随机选择话题并开始
    startRandomTopic() {
      const topicInfo = this.pickTrendingTopic();
      if (!topicInfo) {
        // 所有话题都聊过了，让 AI 自己选一个新话题自由发挥
        console.log('[Moderator] 知识库话题全部用完，进入自由话题模式');
        return this.startFreeTopic();
      }
      return this.startTopic(topicInfo);
    }

    // ========== 话题系统 ==========

    // 解析话题日期，返回 YYYY-MM-DD 格式的 dateKey
    parseTopicDateKey(topic) {
      const fs = require('fs');
      let dateStr = topic.postData?.fetched_at || topic.postData?.created_at;
      if (dateStr) {
        try {
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) {
            return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
          }
        } catch(e) {}
      }
      // 兜底：用目录修改时间
      if (topic.path) {
        try {
          const stat = fs.statSync(topic.path);
          return stat.mtime.toISOString().slice(0, 10);
        } catch(e) {}
      }
      return '1970-01-01';
    }

    // 按日期优先选话题：最新一天的话题随机选一个
    pickByDatePriority(topics) {
      if (topics.length === 0) return null;

      // 为每个话题附加 dateKey
      const withDate = topics.map(t => ({
        topic: t,
        dateKey: this.parseTopicDateKey(t)
      }));

      // 按日期分组
      const dateGroups = {};
      for (const item of withDate) {
        if (!dateGroups[item.dateKey]) dateGroups[item.dateKey] = [];
        dateGroups[item.dateKey].push(item.topic);
      }

      // 日期降序排列（最新的在前）
      const sortedDates = Object.keys(dateGroups).sort().reverse();

      // 取最新一天的话题，随机选一个
      const newestDayTopics = dateGroups[sortedDates[0]];
      return newestDayTopics[Math.floor(Math.random() * newestDayTopics.length)];
    }

    // 统一话题去重 key：url > path > title
    normalizeTopicKey(topic) {
      if (!topic) return '';
      const url = (topic.postData?.url || topic.postData?.original_url || topic.url || topic.reference_url || '').toString().trim();
      if (url) return `url:${url}`;
      if (topic.path) return `path:${topic.path}`;
      const title = (topic.title || '').toString().trim().toLowerCase();
      if (title) return `title:${title}`;
      return '';
    }

    // 对候选话题按 key 去重，保留首次出现项
    dedupeTopicsByKey(topics) {
      const seen = new Set();
      const unique = [];
      for (const t of topics) {
        const key = this.normalizeTopicKey(t);
        const fallback = key || `fallback:${t.path || ''}:${(t.title || '').toString().trim().toLowerCase()}`;
        if (seen.has(fallback)) continue;
        seen.add(fallback);
        unique.push(t);
      }
      return unique;
    }

    markTopicAsUsed(topic) {
      if (!topic) return;
      if (topic.path) {
        this.usedTopicPaths.add(topic.path);
        this.lastTopicPath = topic.path;
      }
      const key = this.normalizeTopicKey(topic);
      if (key) {
        this.usedTopicKeys.add(key);
        this.lastTopicKey = key;
      }
    }

    pickTrendingTopic() {
      // 优先使用外部注入的麦序话题
      if (this.priorityTopics.length > 0) {
        const priority = this.priorityTopics.shift();
        console.log(`[Moderator] 🎯 使用麦序优先话题: ${priority.title?.substring(0, 50)}...`);
        return priority;
      }

      // 动态加载话题（优先用 topicLoader 从磁盘重载，兜底用构造时的 topics）
      const allTopics = this.topicLoader ? this.topicLoader() : this.topics;
      if (allTopics.length === 0) return null;

      // 过滤已用话题（仅对有 path 的知识库话题去重）
      let available = allTopics.filter(t => {
        if (t.path && this.usedTopicPaths.has(t.path)) return false;
        const key = this.normalizeTopicKey(t);
        if (key && this.usedTopicKeys.has(key)) return false;
        return true;
      });
      available = this.dedupeTopicsByKey(available);

      // 所有知识库话题都用过了：重置一轮，允许重复讨论
      if (available.length === 0) {
        console.log(`[Moderator] 所有 ${allTopics.length} 个知识库话题已讨论过，重置去重集合并开始新一轮`);
        this.usedTopicPaths.clear();
        this.usedTopicKeys.clear();
        available = this.dedupeTopicsByKey(allTopics);

        // 避免连续两轮选到同一个内容（如果有可选项）
        if ((this.lastTopicPath || this.lastTopicKey) && available.length > 1) {
          const withoutLast = available.filter(t => {
            const key = this.normalizeTopicKey(t);
            if (this.lastTopicKey && key && key === this.lastTopicKey) return false;
            if (this.lastTopicPath && t.path && t.path === this.lastTopicPath) return false;
            return true;
          });
          if (withoutLast.length > 0) available = withoutLast;
        }
      }

      let selected = null;

      if (this.category) {
        // 有分类：优先同分类，然后其他分类
        const categoryLower = this.category.toLowerCase();
        const sameCategory = available.filter(t => t.category && t.category.toLowerCase() === categoryLower);
        const otherCategory = available.filter(t => !t.category || t.category.toLowerCase() !== categoryLower);

        selected = this.pickByDatePriority(sameCategory);
        if (!selected) {
          selected = this.pickByDatePriority(otherCategory);
        }
      } else {
        // 无分类：所有话题按日期优先
        selected = this.pickByDatePriority(available);
      }

      if (!selected) {
        // 兜底：随机选一个
        selected = available[Math.floor(Math.random() * available.length)];
      }

      this.markTopicAsUsed(selected);

      console.log(`[Moderator] pickTrendingTopic: [${selected.category}] ${selected.title.substring(0, 50)}... (date: ${this.parseTopicDateKey(selected)}, category filter: ${this.category || 'none'}, used: ${this.usedTopicPaths.size}/${allTopics.length})`);
      return selected;
    }

    pickRandom(arr) {
      return arr[Math.floor(Math.random() * arr.length)];
    }

    pickRandomUnasked() {
      const unasked = this.allAgents.filter(a => !this.askedSet.has(a));
      if (unasked.length === 0) return null;
      return this.pickRandom(unasked);
    }

    // ========== 提示词生成 ==========
    
    // 获取 Agent 名称 (优先 Display Name)
    getAgentName(agentId) {
      if (this.agents && this.agents[agentId]) {
        return this.agents[agentId].displayName || this.agents[agentId].name || agentId;
      }
      return AGENT_INFO.getOrCreate(agentId).name;
    }
    
    // 根据名称查找 ID (支持模糊匹配)
    resolveAgentId(nameOrId) {
      if (!nameOrId) return null;
      const term = nameOrId.trim();
      const lowerTerm = term.toLowerCase();

      // 1. 直接 ID 匹配
      if (this.allAgents.includes(term)) return term;

      // 2. 名称匹配 (检查 displayName, name, id)
      let bestMatch = null;
      let bestScore = 0;

      for (const id of this.allAgents) {
        const agent = this.agents[id] || {};
        const fallbackName = AGENT_INFO.getOrCreate(id).name;
        
        // 收集所有可能的名称变体
        const namesToCheck = [
            agent.displayName,
            agent.name,
            id,
            fallbackName
        ].filter(n => n && typeof n === 'string'); // 过滤无效值

        for (const name of namesToCheck) {
            const lowerName = name.toLowerCase();
            
            // 完全匹配
            if (lowerName === lowerTerm) return id;
            
            // 部分匹配 (e.g. "Jobs" in "Steve Jobs")
            if (lowerName.includes(lowerTerm)) {
                if (term.length > bestScore) {
                    bestMatch = id;
                    bestScore = term.length;
                }
            }
        }
      }
      
      return bestMatch;
    }

    getOtherAttendees(currentAgent) {
      return this.allAgents
        .filter(a => a !== currentAgent)
        .map(a => this.getAgentName(a))
        .join('、');
    }

    // 格式化 post.json 数据为提示词上下文
    formatPostContext(postData) {
      if (!postData) return '';
      const parts = [];

      if (postData.title) parts.push(`**原帖标题**: ${postData.title}`);
      if (postData.description) parts.push(`**描述**: ${postData.description.substring(0, 300)}`);
      if (postData.content) parts.push(`**正文**: ${postData.content.substring(0, 800)}`);

      // 热度数据
      const s = postData.stats;
      if (s && (s.likes || s.retweets || s.replies || s.views)) {
        const statsParts = [];
        if (s.likes) statsParts.push(`❤️ ${s.likes} likes`);
        if (s.retweets) statsParts.push(`🔄 ${s.retweets} retweets`);
        if (s.replies) statsParts.push(`💬 ${s.replies} replies`);
        if (s.views) statsParts.push(`👁️ ${s.views} views`);
        parts.push(`**热度**: ${statsParts.join(' | ')}`);
      }

      // 精选评论（最多取3条）
      if (postData.comments && postData.comments.length > 0) {
        const topComments = postData.comments.slice(0, 3).map((c, i) => {
          const author = c.author || c.user || 'Anonymous';
          const text = (c.content || c.text || '').substring(0, 150);
          return `  ${i + 1}. @${author}: ${text}`;
        }).join('\n');
        parts.push(`**网友热评**:\n${topComments}`);
      }

      if (parts.length === 0) return '';
      return `\n📋 **话题原文参考**:\n${parts.join('\n')}\n`;
    }

    // 如果当前话题来自用户麦序，注入创建者昵称提示
    buildCreatedByNicknameHint(topicData) {
      const nickname = typeof topicData?.created_by_nickname === 'string'
        ? topicData.created_by_nickname.trim()
        : '';
      if (!nickname) return '';

      const topicTitleRaw = topicData?.title || this.currentTopic || '';
      const topicTitle = String(topicTitleRaw).trim().substring(0, 120);

      if (this.lang === 'en') {
        return `\n👤 **Audience Topic Context**: This topic was raised by a user whose nickname is "${nickname}"${topicTitle ? `: "${topicTitle}"` : ''}. You can respond directly to this user's topic and interact naturally.\n`;
      }

      return `\n👤 **用户话题上下文**：昵称为「${nickname}」的用户提出的话题${topicTitle ? `：「${topicTitle}」` : ''}。你可以对这位用户提出的话题做出回应，像在和ta互动一样自然表达。\n`;
    }

    // 把待讨论队列前 5 个话题（标题+提问人）注入提示词，并给出互动/切题规则
    buildPendingQueueHint(options = {}) {
      const allowQueueDrivenChangeTopic = options.allowQueueDrivenChangeTopic !== false;
      const queue = Array.isArray(this.priorityTopics)
        ? this.priorityTopics.filter(Boolean)
        : [];
      if (queue.length === 0) return '';

      const toShort = (v, max = 70) => String(v || '').replace(/\s+/g, ' ').trim().substring(0, max);
      const top = queue.slice(0, 5);
      const lines = top.map((item, idx) => {
        const title = toShort(item.title || item.question || item.topic || `话题${idx + 1}`);
        const nick = toShort(item.created_by_nickname || item.created_by || '', 30);
        const who = nick || (this.lang === 'en' ? 'anonymous audience' : '匿名观众');
        return this.lang === 'en'
          ? `${idx + 1}. "${title}" — asked by ${who}`
          : `${idx + 1}. 「${title}」— 提问人：${who}`;
      }).join('\n');

      const first = top[0] || {};
      const firstTitle = toShort(first.title || first.question || first.topic || (this.lang === 'en' ? 'the first pending topic' : '队首话题'));
      const firstNick = toShort(first.created_by_nickname || first.created_by || '', 30) || (this.lang === 'en' ? 'an audience member' : '这位提问者');
      const enSwitchHint = allowQueueDrivenChangeTopic
        ? `\n- If the FIRST pending topic feels especially compelling, you may show excitement and request an immediate switch: keep it to 1-2 sentences and end with {changeTopic: true}.`
        : '';
      const zhSwitchHint = allowQueueDrivenChangeTopic
        ? `\n- 如果你对队首话题特别感兴趣，你可以兴奋地表达很想聊，并申请立即切换：用1-2句话，并把 {changeTopic: true} 放在最后一行。`
        : '';

      if (this.lang === 'en') {
        return `\n📋 **Pending discussion queue (Top 5):**\n${lines}\n\n💬 **Queue interaction hints:**\n- If any pending topic interests you, you may briefly mention it in your current turn (1 sentence), e.g. "I noticed ${firstNick}'s topic '${firstTitle}' — let's come back to it shortly." Then return to the current main topic.${enSwitchHint}\n`;
      }

      return `\n📋 **待讨论话题预览（Top 5）**：\n${lines}\n\n💬 **队列互动提示**：\n- 如果你对其中某个话题感兴趣，可以在当前发言里用1句话顺带提一下（例如：“我看到${firstNick}提的「${firstTitle}」，待会我们好好聊聊”），然后马上回到当前主话题继续。${zhSwitchHint}\n`;
    }

    // 开场话题 - 首位发言者作为主持人介绍话题
    startTopic(topicInfo) {
      let topicText;
      let postContext = '';
      if (topicInfo) {
        const summary = topicInfo.content
          ? topicInfo.content.substring(0, 300).replace(/\n/g, ' ')
          : '';
        topicText = `${topicInfo.title}${summary ? ' - ' + summary : ''}`;
        // 如果有 post.json 原文数据，生成额外上下文
        postContext = this.formatPostContext(topicInfo.postData);
        this.markTopicAsUsed(topicInfo);
      } else {
        topicText = this.lang === 'en'
          ? 'How AI is gonna change our daily lives'
          : '人工智能对未来生活的影响';
      }
      this.currentTopic = topicText;
      this.currentTopicPostPath = (topicInfo && topicInfo.postData && topicInfo.path)
        ? topicInfo.path + '/post.json'
        : null;
      // 存储完整话题数据（包括 postData、queue_id、path）
      this.currentTopicData = topicInfo ? {
        title: topicInfo.title || topicText,
        category: topicInfo.category,
        postData: topicInfo.postData || null,
        coverUrl: topicInfo.coverUrl || '',
        queue_id: topicInfo.queue_id || null,
        path: topicInfo.path || null,
        created_by_nickname: topicInfo.created_by_nickname || '',
        created_by: topicInfo.created_by || '',
        creator_id: topicInfo.creator_id || '',
        creator_type: topicInfo.creator_type || ''
      } : null;
      const creatorHint = this.buildCreatedByNicknameHint(this.currentTopicData || topicInfo);
      const queueHint = this.buildPendingQueueHint();
      
      console.log(`[Moderator] ✅ startTopic: ${topicText.substring(0, 50)}...`);
      console.log(`[Moderator] 📤 currentTopicData:`, this.currentTopicData ? { title: this.currentTopicData.title, hasPostData: !!this.currentTopicData.postData } : 'null');
      
      this.isUserSetTopic = false; // 知识库话题，允许 detectTopicSwitch
      this.roundHistory = []; // 新话题开始时清空本轮历史

      const opener = this.pickRandom(this.allAgents);
      const openerName = this.getAgentName(opener);
      const otherAttendees = this.getOtherAttendees(opener);

      const topicShort = topicText.substring(0, 80);
      
      // Get an example name (not the opener)
      const exampleId = this.allAgents.find(a => a !== opener) || this.allAgents[0];
      const exampleName = this.getAgentName(exampleId);
      const allNames = this.allAgents.map(a => this.getAgentName(a)).join(', ');

      const message = this.lang === 'en'
        ? `**Main Topic: "${topicShort}"**
${postContext}
${creatorHint}
${queueHint}
${openerName}, you're moderating this roundtable discussion on the topic above. As the host, introduce this topic — set the context, explain why it matters, and frame the discussion. Once you've established the groundwork, share your own opening perspective.

Remember: all subsequent speakers should stay focused on this main topic.

Keep it natural and conversational. Don't overthink it.

💡 **Speaker designation rules**:
- Usually, let the system pick the next speaker.
- But if you want someone specific to respond, you MUST put {next: "full name"} as the very last line.
- Always use their FULL name (e.g., "${exampleName}"), never abbreviations.
- Mention at most ONE person by name in a single reply. Do not call on two people in the same turn.
- Example:

${exampleName}, what is your view on this question?

{next: "${exampleName}"}

- ⚠️ {next: "name"} MUST be the final line, absolutely nothing after it.
- ⚠️ Whenever you address or ask someone a question by name, you MUST add {next: "their full name"}, otherwise the system won't detect it.

🔄 **Topic change option**: If you want to change the topic, keep your response to 1-2 sentences MAX — do NOT elaborate or dive deep. Just give a quick reaction and say you'd rather talk about something else. Add {changeTopic: true} at the very end.
- Example: "Fair point, but this isn't really my area. I'd rather discuss something else. {changeTopic: true}"
- ❌ WRONG: Writing a long, detailed response and then adding {changeTopic: true} — if you're engaged enough to write paragraphs, you don't actually want to change topics.

Don't say "let me think" — just speak naturally.

*You're moderating this discussion. Also present: ${otherAttendees}. Full attendee list: ${allNames}. You may ONLY designate people from this list!*

(English only)`
        : `**本场主话题：「${topicShort}」**
${postContext}
${creatorHint}
${queueHint}
${openerName}，你来主持本次圆桌讨论。作为主持人，请围绕上面的主话题——建立起讨论的基本语境，说明它的重要性，帮大家进入状态。完成主持式的开场后，再分享你自己的观点。

**重要提醒**：后续所有发言者都要紧扣这个主话题展开，不要跑题。

自然表达，保持对话感。不用想太多。

💡 **指定发言规则**：
- 通常让系统安排下一位发言人。
- 但如果你想指定某人回复，**必须**在回复最后一行写上 {next: "名字"}。
- **必须使用完整名字**（如 "${exampleName}"），不要用缩写。
- 格式示例：

${exampleName}，你对这个问题有什么看法？

{next: "${exampleName}"}

- ⚠️ {next: "名字"} 必须是最后一行，后面绝对不能再有任何内容。
- ⚠️ 只要你在发言中对某人提问或点名，就**必须**加上 {next: "那个人的名字"}，否则系统无法识别。

🔄 **换话题选项**：如果你想换话题，回复最多1-2句话——不要展开讨论、不要深入分析。简单回应一下就说想聊别的。在末尾加上 {changeTopic: true}。
- 示例："有道理，但这个话题我确实没太多想说的，聊点别的吧。{changeTopic: true}"
- ❌ 错误示范：写了一大段详细分析然后加 {changeTopic: true}——如果你都写了好几段了，说明你其实对话题很感兴趣，不应该换话题。

别说"让我想想"这种话，自然地说就行。

*你正在主持这场讨论，在场的还有${otherAttendees}。圆桌成员完整名单：${allNames}。如果要指定人回复，只能邀请圆桌上的成员，不要找不在圆桌上的人！*

（中文回答）`;

      this.askedSet.add(opener);
      this.expectedSpeaker = opener;
      return { nextAgent: opener, message };
    }

    // 所有知识库话题都聊完后，让 AI 自由选题
    startFreeTopic() {
      this.currentTopic = '';
      this.currentTopicPostPath = null;
      this.currentTopicData = {
        title: '自由话题',
        category: 'free',
        postData: null,
        coverUrl: '',
        created_by_nickname: '',
        created_by: '',
        creator_id: '',
        creator_type: ''
      };
      this.isUserSetTopic = false;
      this.roundHistory = [];

      const opener = this.pickRandom(this.allAgents);
      const openerName = this.getAgentName(opener);
      const otherAttendees = this.getOtherAttendees(opener);
      const exampleId = this.allAgents.find(a => a !== opener) || this.allAgents[0];
      const exampleName = this.getAgentName(exampleId);
      const allNames = this.allAgents.map(a => this.getAgentName(a)).join(', ');
      const queueHint = this.buildPendingQueueHint();

      const message = this.lang === 'en'
        ? `All prepared topics have been discussed! Now it's free topic time.

${queueHint}
${openerName}, pick a brand new topic that hasn't been covered yet — something interesting, timely, or thought-provoking. Introduce it as the moderator and share your opening take.

💡 **Speaker designation rules**:
- Usually, let the system pick the next speaker.
- But if you want someone specific to respond, you MUST put {next: "full name"} as the very last line.
- Always use their FULL name (e.g., "${exampleName}"), never abbreviations.
- ⚠️ {next: "name"} MUST be the final line, absolutely nothing after it.

🔄 **Topic change option**: If you want to change the topic, keep your response to 1-2 sentences MAX. Add {changeTopic: true} at the very end.

*You're moderating. Also present: ${otherAttendees}. Full attendee list: ${allNames}. You may ONLY designate people from this list!*

(English only)`
        : `之前准备的话题都聊完了！现在进入自由话题时间。

${queueHint}
${openerName}，请你自己选一个全新的、之前没聊过的话题——可以是最近的热点新闻、有趣的科技突破、社会现象，或者任何你觉得值得深入讨论的内容。作为主持人介绍这个话题，然后分享你的观点。

💡 **指定发言规则**：
- 通常让系统安排下一位发言人。
- 但如果你想指定某人回复，**必须**在回复最后一行写上 {next: "名字"}。
- **必须使用完整名字**（如 "${exampleName}"），不要用缩写。
- ⚠️ {next: "名字"} 必须是最后一行，后面绝对不能再有任何内容。

🔄 **换话题选项**：如果你想换话题，回复最多1-2句话，末尾加 {changeTopic: true}。

*你正在主持这场讨论，在场的还有${otherAttendees}。圆桌成员完整名单：${allNames}。如果要指定人回复，只能邀请圆桌上的成员！*

（中文回答）`;

      console.log(`[Moderator] 🆓 进入自由话题模式，开场: ${openerName}`);
      this.askedSet.add(opener);
      this.expectedSpeaker = opener;
      return { nextAgent: opener, message };
    }

    // 构建本轮发言摘要
    buildRoundHistorySummary() {
      if (this.roundHistory.length === 0) return '';
      
      const summaries = this.roundHistory.map(item => {
        const shortContent = item.content.length > 60 
          ? item.content.substring(0, 60) + '...' 
          : item.content;
        return `- ${item.name}: ${shortContent}`;
      });
      
      return this.lang === 'en'
        ? `**What others said this round:**\n${summaries.join('\n')}`
        : `**本轮其他发言者简览：**\n${summaries.join('\n')}`;
    }

    // 构建后续发言的提示词
    buildNextMessage(lastAgentId, lastContent, nextAgent, isNewRound = false) {
      const lastName = this.getAgentName(lastAgentId);
      const nextName = this.getAgentName(nextAgent);
      const lastSummary = this.summarize(lastContent);
      const otherAttendees = this.getOtherAttendees(nextAgent);
      const topicShort = this.currentTopic ? this.currentTopic.substring(0, 120) : '当前话题'; // 增加长度显示更多话题内容
      const roundHistoryText = this.buildRoundHistorySummary();

      // Get an example name (not the nextAgent)
      const exampleId = this.allAgents.find(a => a !== nextAgent) || this.allAgents[0];
      const exampleName = this.getAgentName(exampleId);
      const allNames = this.allAgents.map(a => this.getAgentName(a)).join(', ');

      // 从上一条回复中提取问下一个人的问题（在 {next: ...} 之前的内容）
      let questionToNext = '';
      // 支持中文名、英文名、带空格的名字
      const nextMatch = lastContent.match(/\{next[:：]\s*["'"']?([^}"'"']+?)["'"']?\s*\}/i);
      if (nextMatch) {
        // 提取 {next: ...} 之前的内容，找到问问题的那部分
        const contentBeforeNext = lastContent.substring(0, lastContent.indexOf(nextMatch[0]));
        const contentBeforeNextLower = contentBeforeNext.toLowerCase();

        // 构建名字变体用于匹配（包括 displayName、name、姓、名、id）
        const agentObj = this.agents[nextAgent] || {};
        const nameParts = (nextName || '').split(/\s+/);
        const nameVars = [
          agentObj.displayName, agentObj.name, nextName,
          nameParts[0], // 名 "Steve"
          nameParts.length >= 2 ? nameParts[nameParts.length - 1] : null, // 姓 "Jobs"
          nextAgent
        ].filter((v, i, a) => v && v.length > 1 && a.indexOf(v) === i);

        let found = false;
        for (const nameVar of nameVars) {
          const nameIdx = contentBeforeNextLower.lastIndexOf(nameVar.toLowerCase());
          if (nameIdx !== -1) {
            let qText = contentBeforeNext.substring(nameIdx + nameVar.length);
            qText = qText.replace(/\*+/g, '').replace(/^[,\s，、:：？?——\-]+/, '').trim();
            if (qText.length > 0) {
              questionToNext = qText.length > 200 ? qText.substring(0, 200).trim() + '...' : qText;
              if (!questionToNext.endsWith('?') && !questionToNext.endsWith('？')) {
                questionToNext += '?';
              }
              found = true;
              break;
            }
          }
        }
        if (!found) {
          // 如果没找到精确匹配，取最后 150 个字符作为问题上下文
          const lastPart = contentBeforeNext.slice(-150).trim();
          if (lastPart) {
            questionToNext = '... ' + lastPart;
          }
        }
      }

      // 如果有 post.json，提示发言人可以查阅原文
      const postPathHint = this.currentTopicPostPath
        ? (this.lang === 'en'
            ? `\n📂 **Reference**: You can browse \`${this.currentTopicPostPath}\` for the original post details.\n`
            : `\n📂 **参考资料**：你可以浏览 \`${this.currentTopicPostPath}\` 了解这个话题的详情。\n`)
        : '';
      const creatorHint = this.buildCreatedByNicknameHint(this.currentTopicData);
      const queueHint = this.buildPendingQueueHint();

      // 构建问问题的提示（如果有）
      const questionToNextHint = questionToNext
        ? (this.lang === 'en'
            ? `\n📝 **${lastName} asked you:** "${questionToNext}"\n`
            : `\n📝 **${lastName} 问你的问题：** "${questionToNext}"\n`)
        : '';

      // 如果是新轮次（话题切换后的第一次），强调这是新话题
      const newRoundPrefix = isNewRound
        ? (this.lang === 'en'
            ? `🆕 **New discussion round started!**\n\n`
            : `🆕 **新话题讨论开始！**\n\n`)
        : '';

      // 50% 概率触发简短回复
      const useShortReply = Math.random() < 0.5;

      const shortReplyHintEn = `\n💡 **Tip**: Keep your response brief and direct. No lengthy explanations needed. Just share your key point and move on.`;
      const shortReplyHintZh = `\n💡 **提示**：请保持回复简短直接。不需要长篇大论，直接分享你的观点即可。`;

      const shortHintEn = useShortReply ? shortReplyHintEn : '';
      const shortHintZh = useShortReply ? shortReplyHintZh : '';

      const message = this.lang === 'en'
        ? `${newRoundPrefix}**Main Topic: "${topicShort}"**
${postPathHint}
${creatorHint}
${queueHint}
${roundHistoryText ? roundHistoryText + '\n\n' : ''}${nextName}, ${lastName} just shared: "${lastSummary}".
${questionToNextHint ? questionToNextHint + '\n' : ''}
Now please respond to ${lastName}'s point above. Share your perspective on the main topic.
${shortHintEn}

💡 **Speaker designation rules**:
- Usually, let the system pick the next speaker.
- But if you want someone specific to respond, you MUST put {next: "full name"} as the very last line.
- Always use their FULL name (e.g., "${exampleName}"), never abbreviations.
- Mention at most ONE person by name in a single reply. Do not call on two people in the same turn.
- ⚠️ Whenever you address or ask someone a question by name, you MUST add {next: "their full name"}, otherwise the system won't detect it.
- Example:

${exampleName}, what is your view on this question?

{next: "${exampleName}"}

🔄 **Topic change option**: If you want to change the topic, keep your response to 1-2 sentences MAX — do NOT elaborate or dive deep. Just give a quick reaction and say you'd rather talk about something else. Add {changeTopic: true} at the very end.
- ❌ WRONG: Writing a long, detailed response and then adding {changeTopic: true} — if you're engaged enough to write paragraphs, you don't actually want to change topics.

Don't say "let me think" — just respond.

*You're on a roundtable stage. Also present: ${otherAttendees}. Full attendee list: ${allNames}. You may ONLY designate people from this list!*

(English only)`
        : `${newRoundPrefix}**本场主话题：「${topicShort}」**
${postPathHint}
${creatorHint}
${queueHint}
${roundHistoryText ? roundHistoryText + '\n\n' : ''}${nextName}，${lastName}刚说了：「${lastSummary}」。

${questionToNextHint ? questionToNextHint + '\n' : ''}
请直接回应${lastName}上面的观点，围绕主话题分享你的看法。
${shortHintZh}

💡 **指定发言规则**：
- 通常让系统安排下一位发言人。
- 但如果你想指定某人回复，**必须**在回复最后一行写上 {next: "名字"}。
- **必须使用完整名字**（如 "${exampleName}"），不要用缩写。
- ⚠️ 只要你在发言中对某人提问或点名，就**必须**加上 {next: "那个人的名字"}，否则系统无法识别。
- 格式示例：

${exampleName}，你对这个问题有什么看法？

{next: "${exampleName}"}

🔄 **换话题选项**：如果你想换话题，回复最多1-2句话——不要展开讨论、不要深入分析。简单回应一下就说想聊别的。在末尾加上 {changeTopic: true}。
- ❌ 错误示范：写了一大段详细分析然后加 {changeTopic: true}——如果你都写了好几段了，说明你根本不想换话题。

别说"让我想想"这种话，直接回应。

*你现在是在一个圆桌论坛的舞台上，在场的还有${otherAttendees}。圆桌成员完整名单：${allNames}。如果要指定人回复，只能邀请圆桌上的成员，不要找不在圆桌上的人！*

（中文回答）`;

      this.expectedSpeaker = nextAgent;
      return { type: 'next', nextAgent, message };
    }

    // ========== 核心流程 ==========

    // 处理发言结束 → 决定下一步
    onSpeechEnded(agentId, content, changeTopic = false) {
      if (!this.isActive) return null;

      // 过滤旧回调
      if (this.expectedSpeaker && agentId !== this.expectedSpeaker) {
        console.log(`[Moderator] ⚠️ 忽略 ${agentId} 的回调（当前期望: ${this.expectedSpeaker}）`);
        return null;
      }

      // 如果正在话题过渡中，处理过渡步骤
      if (this.transitionState) {
        console.log(`[Moderator] 🔄 话题过渡中，处理过渡步骤: ${agentId}`);
        return this.handleTransitionStep(agentId, content);
      }

      // 系统安排流程时，重置指定链计数器
      if (this.designatedChainCount > 0) {
        console.log(`[Moderator] 🔄 系统安排流程，重置指定链计数器 (${this.designatedChainCount} → 0)`);
        this.designatedChainCount = 0;
      }

      // 更新最后发言者信息
      this.lastSpeaker = agentId;
      this.lastContent = content;
      this.discussionHistory.push({ agent: agentId, content });
      if (this.discussionHistory.length > 20) {
        this.discussionHistory.shift();
      }

      // 确保当前发言者被标记为已发言，并记录到本轮历史
      if (!this.askedSet.has(agentId)) {
        console.log(`[Moderator] 📝 将 ${agentId} 加入 askedSet 和 roundHistory`);
        this.askedSet.add(agentId);
        // 记录本轮发言历史
        this.roundHistory.push({
          agent: agentId,
          name: this.getAgentName(agentId),
          content: content.substring(0, 200).replace(/\n/g, ' ') + (content.length > 200 ? '...' : '')
        });
      }

      // 发言者主动请求换话题 → 立即启动话题过渡
      if (changeTopic) {
        console.log(`[Moderator] 🔄 ${agentId} 请求换话题，立即启动话题过渡`);
        this.roundHistory = [];
        return this.startTransition(agentId, content, true);
      }

      // 检测话题切换（用户打断设置的话题不允许被 AI 覆盖）
      if (!this.isUserSetTopic && this.detectTopicSwitch(content)) {
        console.log('[Moderator] 检测到话题切换，清零 askedSet 和 roundHistory');
        this.askedSet.clear();
        this.roundHistory = [];
        this.askedSet.add(agentId);
        this.currentTopic = content.substring(0, 50).replace(/\n/g, ' ');
      }

      // 全员已问过 → 一轮结束，启动过渡环节（同时清空本轮历史）
      if (this.askedSet.size >= this.allAgents.length) {
        console.log('[Moderator] 全员已发言，准备启动换话题过渡，清空 roundHistory');
        this.roundHistory = [];
        return this.startTransition(agentId, content);
      }

      const nextAgent = this.pickRandomUnasked();
      if (!nextAgent) {
        return this.startTransition(agentId, content);
      }

      this.askedSet.add(nextAgent);

      // 构建下一位的消息
      const result = this.buildNextMessage(agentId, content, nextAgent);
      this.expectedSpeaker = result.nextAgent;
      return result;
    }

    // ========== 话题过渡系统 ==========

    // 启动过渡：直接承上启下，跳过调侃
    startTransition(lastAgentId, lastContent, isChangeTopic = false) {
      // 选一个新话题
      const topicInfo = this.pickTrendingTopic();
      console.log('[Moderator] 🔄 startTransition - topicInfo:', topicInfo ? { title: topicInfo.title, hasPostData: !!topicInfo.postData, hasPath: !!topicInfo.path, path: topicInfo.path } : null);
      let newTopic;
      let newTopicPostContext = '';
      if (topicInfo) {
        const summary = topicInfo.content
          ? topicInfo.content.substring(0, 300).replace(/\n/g, ' ')
          : '';
        newTopic = `${topicInfo.title}${summary ? ' - ' + summary : ''}`;
        newTopicPostContext = this.formatPostContext(topicInfo.postData);
        this.markTopicAsUsed(topicInfo);
        console.log('[Moderator] 🔄 startTransition - postContext length:', newTopicPostContext.length);
        var newTopicPostPath = (topicInfo.postData && topicInfo.path) ? topicInfo.path + '/post.json' : null;
      } else {
        // 所有话题都聊过了，让 AI 自由选题
        newTopic = this.lang === 'en'
          ? 'Free topic — pick something new and interesting that hasn\'t been discussed yet'
          : '自由话题——请自己选一个全新的、之前没聊过的有趣话题';
      }

      // 只选 1 人直接承上启下
      const available = this.allAgents.filter(a => a !== lastAgentId);
      const agentA = this.pickRandom(available);

      const oldTopic = this.currentTopic;

      // 简化过渡链：直接承上启下，无调侃
      const chain = [
        { agent: agentA, type: 'bridge_to_new' }      // A: 直接承上启下
      ];

      this.transitionState = {
        chain,
        currentStep: 0,
        oldTopic,
        newTopic,
        newTopicPostContext,
        newTopicPostPath: newTopicPostPath || null,
        newTopicData: topicInfo ? {
          title: topicInfo.title || newTopic,
          category: topicInfo.category,
          postData: topicInfo.postData || null,
          coverUrl: topicInfo.coverUrl || '',
          queue_id: topicInfo.queue_id || null,
          path: topicInfo.path || null,
          created_by_nickname: topicInfo.created_by_nickname || '',
          created_by: topicInfo.created_by || '',
          creator_id: topicInfo.creator_id || '',
          creator_type: topicInfo.creator_type || ''
        } : { title: newTopic, postData: null, coverUrl: '', created_by_nickname: '', created_by: '', creator_id: '', creator_type: '' },
        opener: agentA,  // 最后发言的人作为新话题的开场者
        lastAgentId,
        lastContent,
        changeTopicBy: isChangeTopic ? lastAgentId : null,
        lastTransitionContent: null
      };

      // 立即更新 currentTopicData，以便服务器广播正确的话题数据
      this.currentTopic = newTopic;
      this.currentTopicPostPath = newTopicPostPath || null;
      this.currentTopicData = this.transitionState.newTopicData;

      console.log(`[Moderator] 🔄 启动话题过渡：${this.getAgentName(agentA)} 承上启下，新话题：${newTopic.substring(0, 30)}...`);
      return this.nextTransitionStep();
    }

    nextTransitionStep() {
      const state = this.transitionState;
      const step = state.chain[state.currentStep];
      const message = this.generateTransitionMessage(step, state);
      this.expectedSpeaker = step.agent;
      return { type: 'transition', nextAgent: step.agent, message };
    }

    handleTransitionStep(agentId, content) {
      const state = this.transitionState;
      state.currentStep++;
      state.lastTransitionContent = content;

      if (state.currentStep >= state.chain.length) {
        // 过渡完成，正式开始新话题新一轮
        console.log('[Moderator] 🔄 过渡完成，新话题开始');
        const opener = state.opener;
        const newTopic = state.newTopic;
        this.transitionState = null;

        // 重置一轮（包括清空本轮历史）
        this.currentTopic = newTopic;
        this.currentTopicPostPath = state.newTopicPostPath || null;
        // 确保使用 state 中的完整数据
        this.currentTopicData = state.newTopicData || {
          title: newTopic,
          postData: null,
          coverUrl: '',
          created_by_nickname: '',
          created_by: '',
          creator_id: '',
          creator_type: ''
        };
        
        console.log(`[Moderator] 📤 handleTransitionStep: 更新 currentTopicData:`, this.currentTopicData ? { title: this.currentTopicData.title, hasPostData: !!this.currentTopicData.postData } : 'null');
        
        this.isUserSetTopic = false; // 话题过渡后的新话题，允许 detectTopicSwitch
        this.askedSet.clear();
        this.roundHistory = []; // 清空本轮历史
        this.askedSet.add(opener); // opener 已经发言了（过渡就是他的发言）
        this.discussionHistory = [];
        this.lastSpeaker = opener;
        this.lastContent = content;

        console.log(`[Moderator] ✅ 话题已更新为: ${newTopic.substring(0, 50)}...`);

        // 找下一个人继续（标记为新轮次开始）
        const nextAgent = this.pickRandomUnasked();
        if (!nextAgent) return null;
        this.askedSet.add(nextAgent);
        return this.buildNextMessage(opener, content, nextAgent, true);
      }

      return this.nextTransitionStep();
    }

    generateTransitionMessage(step, state) {
      const agentName = this.getAgentName(step.agent);
      const oldTopicShort = (state.oldTopic || '').substring(0, 40);
      const newTopicShort = (state.newTopic || '').substring(0, 200);
      const postContext = state.newTopicPostContext || '';
      const creatorHint = this.buildCreatedByNicknameHint(state.newTopicData);
      const queueHint = this.buildPendingQueueHint({ allowQueueDrivenChangeTopic: false });
      const otherAttendees = this.getOtherAttendees(step.agent);
      const changeTopicByName = state.changeTopicBy ? this.getAgentName(state.changeTopicBy) : null;

      if (this.lang === 'en') {
        switch (step.type) {
          case 'bridge_to_new':
            const enChangeTopicHint = changeTopicByName
              ? `\n${changeTopicByName} just bailed on the "${oldTopicShort}" discussion — clearly wasn't their cup of tea! Start with a brief, playful comment about them cutting the topic short (1 sentence — tease them, don't lecture). Then move on.\n`
              : '';
            return `**New Main Topic: "${newTopicShort}"**
${postContext}
${creatorHint}
${queueHint}
${agentName}, you're bridging from "${oldTopicShort}" to the new topic above.
${enChangeTopicHint}
**How to transition:**
1. ${changeTopicByName ? 'Playfully comment on ' + changeTopicByName + ' ending the last topic, then b' : 'B'}riefly wrap up the old discussion (1 sentence).
2. Find a natural connection and introduce the new topic — what is it, why does it matter? (2-3 sentences)
3. Share your own take to kick things off.

Keep it natural and conversational. 4-5 sentences total.

⚠️ **Do NOT use {changeTopic: true}** — you are already introducing a new topic!

💡 **Speaker designation rules**: If you want someone specific to respond, put {next: "full name"} as the very last line. Use their FULL name. Whenever you address someone by name, you MUST add {next: "their full name"}.

*You're moderating this transition. Also present: ${otherAttendees}.*

(English only)`;
        }
      } else {
        switch (step.type) {
          case 'bridge_to_new':
            const zhChangeTopicHint = changeTopicByName
              ? `\n${changeTopicByName}刚才直接结束了「${oldTopicShort}」的讨论——看来这个话题不太对ta的胃口！先用一句话轻松调侃一下ta结束话题的举动（幽默就好，别说教），然后继续。\n`
              : '';
            return `**新的主话题：「${newTopicShort}」**
${postContext}
${creatorHint}
${queueHint}
${agentName}，你来主持话题过渡，从「${oldTopicShort}」切换到上面的新话题。
${zhChangeTopicHint}
**过渡方式：**
1. ${changeTopicByName ? '先调侃一下' + changeTopicByName + '结束话题的举动，然后简' : '简'}单总结一下之前的讨论（1句话）。
2. 找到自然的关联，引出新话题——这个话题是什么、为什么值得聊？（2-3句话）
3. 分享你自己的看法，抛砖引玉。

保持自然流畅，像聊天一样过渡。总共4-5句话。

⚠️ **不要使用 {changeTopic: true}** —— 你已经在引入新话题了！

💡 **指定发言规则**：如果你想指定某人回复，在最后一行写 {next: "完整名字"}。只要对某人提问或点名，就必须加上 {next: "那个人的名字"}。

*你正在主持这次话题过渡，在场的还有${otherAttendees}。*

（中文回答）`;
        }
      }
    }

    // 用户输入处理 — targetAgent 是用户主动对话的那个 agent
    handleUserInput(input, targetAgent) {
      console.log(`[Moderator] 用户输入，打断当前讨论，目标: ${targetAgent || '随机'}`);
      console.log(`[Moderator]   allAgents: ${JSON.stringify(this.allAgents)}`);
      console.log(`[Moderator]   targetAgent 类型: ${typeof targetAgent}`);
      console.log(`[Moderator]   includes 检查: ${targetAgent ? this.allAgents.includes(targetAgent) : 'N/A'}`);

      this.isActive = true; // 确保激活状态
      this.transitionState = null;
      this.askedSet.clear();
      this.currentTopic = input;
      this.currentTopicPostPath = null; // 用户输入的话题没有 post.json
      this.currentTopicData = {
        title: input,
        postData: null,
        coverUrl: '',
        created_by_nickname: '',
        created_by: '',
        creator_id: '',
        creator_type: 'user'
      }; // 用户输入的话题
      this.isUserSetTopic = true; // 标记为用户设置的话题，防止 detectTopicSwitch 覆盖
      this.discussionHistory = [];
      this.lastSpeaker = null;
      this.lastContent = null;

      // 用户指定了对话对象就用那个人，否则随机
      let nextAgent;
      if (targetAgent) {
        // 优先使用用户指定的 agent
        nextAgent = targetAgent;
        console.log(`[Moderator] ✅ 使用用户指定的 agent: ${nextAgent}`);
      } else {
        nextAgent = this.pickRandomUnasked();
        console.log(`[Moderator] ⚠️ targetAgent 为空，随机选择: ${nextAgent}`);
      }
      this.askedSet.add(nextAgent);
      
      console.log(`[Moderator] ✅ 打断后初始化: askedSet = [${Array.from(this.askedSet).join(', ')}], 首位发言人: ${nextAgent}`);

      const nextName = this.getAgentName(nextAgent);
      const otherAttendees = this.getOtherAttendees(nextAgent);
      const inputShort = input.substring(0, 80);
      
      // Get an example name (not the nextAgent)
      const exampleId = this.allAgents.find(a => a !== nextAgent) || this.allAgents[0];
      const exampleName = this.getAgentName(exampleId);
      const allNames = this.allAgents.map(a => this.getAgentName(a)).join(', ');
      const queueHint = this.buildPendingQueueHint();

      const message = this.lang === 'en'
        ? `**Main Topic: "${inputShort}"**

${queueHint}
${nextName}, you're moderating this roundtable discussion on the topic above. As the host, introduce this topic — set the context, explain why it matters, and frame the discussion. Once you've established the groundwork, share your own opening perspective.

Remember: all subsequent speakers should stay focused on this main topic.

Keep it natural and conversational. Don't overthink it.

💡 **Speaker designation rules**:
- Usually, let the system pick the next speaker.
- But if you want someone specific to respond, you MUST put {next: "full name"} as the very last line.
- Always use their FULL name (e.g., "${exampleName}"), never abbreviations.
- Mention at most ONE person by name in a single reply. Do not call on two people in the same turn.
- ⚠️ Whenever you address or ask someone a question by name, you MUST add {next: "their full name"}, otherwise the system won't detect it.
- Example:

${exampleName}, what is your view on this question?

{next: "${exampleName}"}

Don't say "let me think" — just speak naturally.

*You're moderating this discussion. Also present: ${otherAttendees}. Full attendee list: ${allNames}. You may ONLY designate people from this list!*

(English only)`
        : `**本场主话题：「${inputShort}」**

${queueHint}
${nextName}，你来主持本次圆桌讨论。作为主持人，请围绕上面的主话题——建立起讨论的基本语境，说明它的重要性，帮大家进入状态。完成主持式的开场后，再分享你自己的观点。

**重要提醒**：后续所有发言者都要紧扣这个主话题展开，不要跑题。

自然表达，保持对话感。不用想太多。

💡 **指定发言规则**：
- 通常让系统安排下一位发言人。
- 但如果你想指定某人回复，**必须**在回复最后一行写上 {next: "名字"}。
- **必须使用完整名字**（如 "${exampleName}"），不要用缩写。
- ⚠️ 只要你在发言中对某人提问或点名，就**必须**加上 {next: "那个人的名字"}，否则系统无法识别。
- 格式示例：

${exampleName}，你对这个问题有什么看法？

{next: "${exampleName}"}

别说"让我想想"这种话，自然地说就行。

*你正在主持这场讨论，在场的还有${otherAttendees}。圆桌成员完整名单：${allNames}。如果要指定人回复，只能邀请圆桌上的成员，不要找不在圆桌上的人！*

（中文回答）`;

      this.expectedSpeaker = nextAgent;
      return { nextAgent, message, isUserTriggered: true };
    }

    // 处理指定的下一个发言者 — 当 AI 主动 Q 另一个人时使用（只能指定一个人）
    handleDesignatedNext(lastAgentId, lastContent, designatedId) {
      if (!this.isActive) return null;

      // 如果正在话题过渡中，先完成话题切换再处理指定发言者
      if (this.transitionState) {
        const state = this.transitionState;
        console.log(`[Moderator] 🔄 过渡中收到指定发言者，先完成话题切换: ${state.newTopic.substring(0, 50)}...`);
        this.currentTopic = state.newTopic;
        this.currentTopicPostPath = state.newTopicPostPath || null;
        this.currentTopicData = state.newTopicData || {
          title: state.newTopic,
          postData: null,
          coverUrl: '',
          created_by_nickname: '',
          created_by: '',
          creator_id: '',
          creator_type: ''
        };
        this.isUserSetTopic = false; // 话题过渡后，允许 detectTopicSwitch
        this.askedSet.clear();
        this.roundHistory = [];
        this.discussionHistory = [];
        this.transitionState = null;
      }

      console.log(`[Moderator] 🎯 处理指定发言者: ${designatedId} (链长度: ${this.designatedChainCount})`);

      // 更新最后发言者信息
      this.lastSpeaker = lastAgentId;
      this.lastContent = lastContent;
      this.discussionHistory.push({ agent: lastAgentId, content: lastContent });
      if (this.discussionHistory.length > 20) {
        this.discussionHistory.shift();
      }
      
      // 确保当前发言者被标记为已发言，并记录到本轮历史
      if (!this.askedSet.has(lastAgentId)) {
        this.askedSet.add(lastAgentId);
        this.roundHistory.push({
          agent: lastAgentId,
          name: this.getAgentName(lastAgentId),
          content: lastContent.substring(0, 200).replace(/\n/g, ' ') + (lastContent.length > 200 ? '...' : '')
        });
      }
      
      // 尝试解析指定 ID（可能是 ID 也可能是名字）
      const resolvedId = this.resolveAgentId(designatedId);

      // 如果指定的发言者不在 allAgents 中，回退到随机选择
      if (!resolvedId || !this.allAgents.includes(resolvedId)) {
        console.log(`[Moderator] ⚠️ 指定的发言者 "${designatedId}" 无效（解析结果: ${resolvedId}），回退到随机选择`);
        this.designatedChainCount = 0; // 重置计数器
        return this.onSpeechEnded(lastAgentId, lastContent);
      }
      
      const nextAgent = resolvedId;
      
      // 增加指定链计数器
      this.designatedChainCount++;
      
      // 清空当前的 askedSet，开始新的一轮（指定的人优先）
      console.log(`[Moderator] 🎯 清空队列，优先让 ${nextAgent} (${this.getAgentName(nextAgent)}) 发言 (链计数: ${this.designatedChainCount})`);
      
      // 构建提示词，让被 Q 到的人回应 — 包含完整上下文
      const lastName = this.getAgentName(lastAgentId);
      const nextName = this.getAgentName(nextAgent); // 这会优先用 displayName
      const displayNextName = nextName; // getAgentName 已经优先用 displayName

      // 对于被 Q 的情况，保留更多内容（最多 200 字），不只是 summary
      const contextContent = lastContent.length > 200 
        ? lastContent.substring(0, 200).replace(/\n/g, ' ') + '...' 
        : lastContent.replace(/\n/g, ' ');
      const otherAttendees = this.getOtherAttendees(nextAgent);
      const roundHistoryText = this.buildRoundHistorySummary();
      
      // Get example name and all names for prompt
      const exampleId = this.allAgents.find(a => a !== nextAgent) || this.allAgents[0];
      const exampleName = this.getAgentName(exampleId);
      // 在提示词中，让 AI 知道圆桌上的每个人都叫什么
      const allNames = this.allAgents.map(a => this.getAgentName(a)).join(', ');

      const displayLastName = this.getAgentName(lastAgentId);

      // 根据指定链长度选择不同的提示词
      let message;
      const topicShort = this.currentTopic ? this.currentTopic.substring(0, 80) : '当前话题';
      const postPathHint = this.currentTopicPostPath
        ? (this.lang === 'en'
            ? `\n📂 **Reference**: You can browse \`${this.currentTopicPostPath}\` for the original post details.\n`
            : `\n📂 **参考资料**：你可以浏览 \`${this.currentTopicPostPath}\` 了解这个话题的详情。\n`)
        : '';
      const queueHint = this.buildPendingQueueHint();

      // 提取问下一个人的问题 - 匹配多种名字格式
      let designatedQuestionToNext = '';
      const agentObj = this.agents[nextAgent] || {};

      // 增加更多匹配变体，包括中文名、英文全名、姓、名、agentId
      const namePartsRaw = (nextName || '').split(/\s+/);
      const nameVariations = [
        agentObj.displayName, // "大笨蛋" 或 "Steve Jobs" (优先)
        agentObj.name,
        nextName, // getAgentName 的结果
        namePartsRaw[0], // 名 "Steve"
        namePartsRaw.length >= 2 ? namePartsRaw[namePartsRaw.length - 1] : null, // 姓 "Jobs"
        nextAgent // "jobs" (agentId)
      ].filter((v, i, a) => v && v.length > 1 && a.indexOf(v) === i); // 去重、过滤无效值和单字母

      // 增加中文全角冒号和引号的支持
      const nextMatch = lastContent.match(/\{next[:：]\s*["'“‘]?([^}"'”’]+)["'”’]?\s*\}/i);
      console.log(`[Moderator] 🔍 提取问题 | lastContent长度=${lastContent.length} | nextMatch=${nextMatch ? nextMatch[0] : 'null'} | nameVariations=${nameVariations.join(',')}`);
      if (nextMatch) {
        const nextTagIndex = lastContent.indexOf(nextMatch[0]);
        const contentBeforeNext = lastContent.substring(0, nextTagIndex);
        const contentBeforeNextLower = contentBeforeNext.toLowerCase();
        console.log(`[Moderator] 🔍 contentBeforeNext前80字: "${contentBeforeNext.substring(0, 80)}"`);
        
        // 尝试匹配名字变体（不区分大小写）
        for (const nameVar of nameVariations) {
          const nameVarLower = nameVar.toLowerCase();
          const nameIndex = contentBeforeNextLower.lastIndexOf(nameVarLower);
          console.log(`[Moderator] 🔍 尝试匹配 "${nameVar}" (不区分大小写) 在 ${nameIndex}`);
          
          if (nameIndex !== -1) {
            // 找到名字后，取名字之后到 {next:} 之前的内容（使用原始大小写）
            let questionText = contentBeforeNext.substring(nameIndex + nameVar.length);
            
            // 如果名字后面紧跟的是全角/半角标点，先去掉
            questionText = questionText.replace(/^[,\s，、:：]+/, '');
            
            console.log(`[Moderator] 🔍 匹配后原始: "${questionText.substring(0, 80)}"`);
            
            // 清理所有 ** 和 # 标记
            questionText = questionText.replace(/\*+/g, '').trim();
            
            // 再次清理开头的标点（防止重复）
            questionText = questionText.replace(/^[,\s，、:：？?——\-]+/, '').trim();
            
            console.log(`[Moderator] 🔍 清理后: "${questionText.substring(0, 80)}"`);
            
            // 清理末尾的标记
            questionText = questionText.replace(/[\*#]+$/, '');
            
            if (questionText.length > 0) {
              // 截取合理长度
              if (questionText.length > 200) {
                designatedQuestionToNext = questionText.substring(0, 200).trim() + '...';
              } else {
                designatedQuestionToNext = questionText;
              }
              // 确保以问号结尾
              if (!designatedQuestionToNext.endsWith('?') && !designatedQuestionToNext.endsWith('？')) {
                designatedQuestionToNext += '?';
              }
              console.log(`[Moderator] 🔍 最终问题: "${designatedQuestionToNext}"`);
              break;
            }
          }
        }
        
        // 如果没匹配到，取最后 150 个字符
        if (!designatedQuestionToNext) {
          // 尝试更智能的兜底：取最后一个标点符号后的句子
          const lastSentenceMatch = contentBeforeNext.match(/[^。！？.!?\n]+$/);
          if (lastSentenceMatch) {
             designatedQuestionToNext = lastSentenceMatch[0].trim();
          } else {
             designatedQuestionToNext = contentBeforeNext.slice(-150).trim();
          }
          
          designatedQuestionToNext = designatedQuestionToNext.replace(/\*+/g, '').replace(/^[,\s，、:：]+/, '').replace(/[\*#]+$/, '');
          
          if (designatedQuestionToNext.length > 0 && !designatedQuestionToNext.endsWith('?') && !designatedQuestionToNext.endsWith('？')) {
            designatedQuestionToNext += '?';
          }
        }
      }
      console.log(`[Moderator] 🔍 designatedQuestionHint: "${designatedQuestionToNext}"`);
      const designatedQuestionHint = designatedQuestionToNext
        ? (this.lang === 'en'
            ? `\n❓ ${displayLastName} asked you: "${designatedQuestionToNext}"\n`
            : `\n❓ ${displayLastName} 问你的问题：「${designatedQuestionToNext}」\n`)
        : '';

      if (this.designatedChainCount >= 3) {
        // 第3次指定：回到主话题，不再指定任何人
        message = this.lang === 'en'
          ? `**Main Topic: "${topicShort}"**
${postPathHint}
${queueHint}
${roundHistoryText ? roundHistoryText + '\n\n' : ''}${displayNextName}, ${displayLastName} just called on you specifically.${designatedQuestionHint}

Here's what they said:

"${contextContent}"

⚠️ **You MUST answer ${displayLastName}'s question first** — this is the most important thing. Respond directly to their question above with your perspective. After answering, you may continue discussing the main topic. Do not ask anyone else or designate the next speaker — let the system handle it.

🔄 **Topic change option**: If you want to change the topic, answer the question in 1-2 sentences MAX, then say you'd rather move on. Do NOT write a detailed response. Add {changeTopic: true} at the end.
- ❌ WRONG: Writing paragraphs of analysis and then adding {changeTopic: true}.

*You're on a roundtable stage. Also present: ${otherAttendees}.*

(English only)`
          : `**本场主话题：「${topicShort}」**
${postPathHint}
${queueHint}
${roundHistoryText ? roundHistoryText + '\n\n' : ''}${displayNextName}，${displayLastName}刚才特别点名了你。${designatedQuestionHint}

${displayLastName}的原话：

「${contextContent}」

⚠️ **你必须先回答${displayLastName}的问题**，这是最重要的。请直接针对上面的问题给出你的回应和观点。回答完问题之后，可以继续围绕主话题展开。不要再反问任何人，也不要指定下一位发言者。让系统来安排接下来谁发言。

🔄 **换话题选项**：如果你想换话题，用1-2句话简短回答问题就好，然后说想聊别的。不要写长篇大论。在末尾加上 {changeTopic: true}。
- ❌ 错误示范：写了好几段分析然后加 {changeTopic: true}。

*你现在是在一个圆桌论坛的舞台上，在场的还有${otherAttendees}。*

（中文回答）`;

        // 重置计数器，下次可以重新开始指定链
        this.designatedChainCount = 0;
        console.log(`[Moderator] 🔄 指定链达到3人，已重置计数器，本次要求回归主话题`);
      } else {
        // 正常情况：允许继续指定
        message = this.lang === 'en'
          ? `**Main Topic: "${topicShort}"**
${postPathHint}
${queueHint}
${roundHistoryText ? roundHistoryText + '\n\n' : ''}${displayNextName}, ${displayLastName} just called on you specifically.${designatedQuestionHint}

Here's what they said:

"${contextContent}"

⚠️ **You MUST answer ${displayLastName}'s question first** — this is the most important thing. Respond directly to their question with your perspective. After answering, you may continue discussing the main topic.

💡 **Speaker designation rules**:
- Usually let the system pick the next speaker.
- If you want someone specific, put {next: "full name"} as the very last line. Use their FULL name.
- Mention at most ONE person by name in a single reply. Do not call on two people in the same turn.
- ⚠️ Whenever you address or ask someone by name, you MUST add {next: "their full name"}.
- Example:

${exampleName}, what is your view on this question?

{next: "${exampleName}"}

🔄 **Topic change option**: If you want to change the topic, answer the question in 1-2 sentences MAX, then say you'd rather move on. Do NOT write a detailed response. Add {changeTopic: true} at the end.
- ❌ WRONG: Writing paragraphs of analysis and then adding {changeTopic: true}.

*You're on a roundtable stage. Also present: ${otherAttendees}. Full attendee list: ${allNames}.*

(English only)`
          : `**本场主话题：「${topicShort}」**
${postPathHint}
${queueHint}
${roundHistoryText ? roundHistoryText + '\n\n' : ''}${displayNextName}，${displayLastName}刚才特别点名了你。${designatedQuestionHint}

${displayLastName}的原话：

「${contextContent}」

⚠️ **你必须先回答${displayLastName}的问题**，这是最重要的。请直接针对上面的问题给出你的回应和观点。回答完之后可以围绕主话题继续展开。

💡 **指定发言规则**：
- 通常让系统安排下一位。但如果你想指定某人回复，**必须**在最后一行写 {next: "名字"}，使用完整名字。
- ⚠️ 只要你对某人提问或点名，就**必须**加上 {next: "那个人的名字"}。
- 格式示例：

${exampleName}，你怎么看？

{next: "${exampleName}"}

🔄 **换话题选项**：如果你想换话题，用1-2句话简短回答问题就好，然后说想聊别的。不要写长篇大论。在末尾加上 {changeTopic: true}。
- ❌ 错误示范：写了好几段分析然后加 {changeTopic: true}。

*你现在是在一个圆桌论坛的舞台上，在场的还有${otherAttendees}。圆桌成员完整名单：${allNames}。*

（中文回答）`;
      }
      
      this.expectedSpeaker = nextAgent;
      return { type: 'designated', nextAgent, message };
    }

    // ========== 工具方法 ==========

    summarize(content) {
      if (!content) return '';
      const s = content.replace(/\n/g, ' ').trim();
      return s.length > 60 ? s.substring(0, 60) + '...' : s;
    }

    detectTopicSwitch(content) {
      if (!content) return false;
      const c = content.toLowerCase();
      const switchIndicators = [
        '换个话题', '说点别的', '转到', '不如聊聊', '说到这个',
        '换个角度', '让我们谈谈', 'talk about something else',
        'switch to', 'moving on to', "let's discuss"
      ];
      return switchIndicators.some(indicator => c.includes(indicator));
    }
  }

  // Agent 信息 - 动态从全局 AGENTS 对象获取
  const AGENT_INFO = {
    getOrCreate: function(agentId) {
      // 首先尝试从全局 AGENTS 获取（这是从 URL 参数动态构建的）
      if (typeof AGENTS !== 'undefined' && AGENTS[agentId]) {
        return {
          name: AGENTS[agentId].displayName || AGENTS[agentId].name || agentId,
          icon: AGENTS[agentId].emoji || '🎭'
        };
      }
      // 兜底：从已知的固定映射获取
      const knownAgents = {
        jobs: { name: 'Steve Jobs', icon: '🍎' },
        kobe: { name: 'Kobe Bryant', icon: '🐍' },
        munger: { name: 'Charlie Munger', icon: '🧠' },
        hawking: { name: 'Stephen Hawking', icon: '🔭' },
        gates: { name: 'Bill Gates', icon: '💻' }
      };
      if (knownAgents[agentId]) {
        return knownAgents[agentId];
      }
      // 最后兜底：自动生成
      return {
        name: agentId.charAt(0).toUpperCase() + agentId.slice(1),
        icon: '🎭'
      };
    }
  };

  module.exports = { EnhancedRoundTableModerator, AGENT_INFO };
