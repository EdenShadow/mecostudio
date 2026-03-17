#!/usr/bin/env node

const API_KEY = 'new1_5849159db0de4d5aba328655a5bfacf5';
const BASE_URL = 'https://api.twitterapi.io/twitter';

async function fetchTwitterAPI(endpoint, params = {}) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  Object.keys(params).forEach(key => {
    if (params[key] !== undefined && params[key] !== null) {
      url.searchParams.append(key, params[key]);
    }
  });

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'x-api-key': API_KEY,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  
  // Check for API errors
  if (data.status === 'error') {
    throw new Error(data.msg || 'API error');
  }
  
  return data;
}

function formatTweet(tweet, index) {
  const author = tweet.author?.userName ? `@${tweet.author.userName}` : 'Unknown';
  const text = tweet.text?.replace(/\n/g, ' ') || '';
  return `[${index}] ${author} - ${tweet.createdAt || 'N/A'}\n` +
         `    ${text}\n` +
         `    👍 ${tweet.likeCount || 0} | 🔄 ${tweet.retweetCount || 0} | 💬 ${tweet.replyCount || 0} | 🔁 ${tweet.quoteCount || 0}\n` +
         `    ID: ${tweet.id}\n`;
}

async function getTweetDetails(tweetId) {
  const result = await fetchTwitterAPI('/tweets', {
    tweet_ids: tweetId
  });
  
  const tweet = result.tweets?.[0] || result.data?.[0] || result;
  if (!tweet || !tweet.id) {
    throw new Error('Tweet not found');
  }
  
  const author = tweet.author || {};
  
  console.log(`推文详情:\n`);
  console.log(`作者: @${author.userName || 'Unknown'} (${author.name || 'Unknown'})`);
  console.log(`时间: ${tweet.createdAt || 'N/A'}`);
  console.log(`内容: ${tweet.text || 'N/A'}\n`);
  console.log(`统计:`);
  console.log(`  👍 点赞: ${tweet.likeCount || 0}`);
  console.log(`  🔄 转发: ${tweet.retweetCount || 0}`);
  console.log(`  💬 回复: ${tweet.replyCount || 0}`);
  console.log(`  🔁 引用: ${tweet.quoteCount || 0}`);
  console.log(`  🔖 收藏: ${tweet.bookmarkCount || 0}`);
  console.log(`  👀 查看: ${tweet.viewCount || 'N/A'}\n`);
  console.log(`ID: ${tweet.id}`);
  console.log(`URL: https://x.com/${author.userName || 'i'}/status/${tweet.id}`);
  
  if (tweet.isReply && tweet.inReplyToUsername) {
    console.log(`\n这是一条回复给 @${tweet.inReplyToUsername} 的推文`);
  }
  
  if (tweet.isPinned) {
    console.log(`\n📌 这是一条置顶推文`);
  }
}

async function getUserInfo(username) {
  const result = await fetchTwitterAPI('/user/info', {
    userName: username.replace(/^@/, '')
  });
  
  if (result.status === 'error') {
    throw new Error(result.msg || '获取用户信息失败');
  }
  
  const user = result.data || result;
  
  console.log(`用户信息:\n`);
  console.log(`用户名: @${user.userName}`);
  console.log(`显示名: ${user.name}`);
  console.log(`简介: ${user.description || '无'}\n`);
  console.log(`统计:`);
  console.log(`  粉丝: ${user.followers || 0}`);
  console.log(`  关注: ${user.following || 0}`);
  console.log(`  推文: ${user.statusesCount || 0}`);
  console.log(`  收藏: ${user.favouritesCount || 0}`);
  console.log(`  媒体: ${user.mediaCount || 0}\n`);
  console.log(`位置: ${user.location || '未设置'}`);
  console.log(`网站: ${user.url || '无'}`);
  console.log(`创建时间: ${user.createdAt || 'N/A'}`);
  console.log(`蓝V认证: ${user.isBlueVerified ? '是' : '否'}`);
  console.log(`受保护: ${user.protected ? '是' : '否'}`);
  
  if (user.pinnedTweetIds && user.pinnedTweetIds.length > 0) {
    console.log(`置顶推文: ${user.pinnedTweetIds.join(', ')}`);
  }
}

async function getUserTweets(username, count = 10) {
  const result = await fetchTwitterAPI('/user/last_tweets', {
    userName: username.replace(/^@/, ''),
    count: Math.min(count, 100)
  });
  
  if (result.status === 'error') {
    throw new Error(result.msg || '获取用户推文失败');
  }
  
  // API returns { data: { tweets: [...] }, has_next_page, next_cursor, status }
  const tweets = result.data?.tweets || [];
  
  if (tweets.length === 0) {
    console.log(`@${username} 暂无推文`);
    return;
  }
  
  console.log(`\n@${username.replace(/^@/, '')} 的最新推文:\n`);
  
  tweets.forEach((tweet, index) => {
    console.log(formatTweet(tweet, index + 1));
  });
  
  if (result.has_next_page) {
    console.log(`\n还有更多推文，使用 cursor: ${result.next_cursor} 获取下一页`);
  }
}

function showHelp() {
  console.log(`
Usage: twitter-scraper <command> [options]

Commands:
  user <username>              获取用户信息
  tweet <tweet_id>             获取推文详情
  user-tweets <username> [n]   获取用户最新推文 (默认10条，最大100)

Options:
  --help                       显示帮助

Examples:
  twitter-scraper user elonmusk
  twitter-scraper user @kimi
  twitter-scraper tweet 2018784828129243614
  twitter-scraper user-tweets elonmusk 5

Note:
  免费版 API 有速率限制：每 5 秒最多 1 个请求
  某些功能可能需要付费订阅才能使用
`);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    process.exit(0);
  }
  
  const command = args[0];
  
  try {
    switch (command) {
      case 'user':
        if (!args[1]) {
          console.error('Error: 请提供用户名');
          process.exit(1);
        }
        await getUserInfo(args[1]);
        break;
        
      case 'tweet':
        if (!args[1]) {
          console.error('Error: 请提供推文 ID');
          process.exit(1);
        }
        await getTweetDetails(args[1]);
        break;
        
      case 'user-tweets':
        if (!args[1]) {
          console.error('Error: 请提供用户名');
          process.exit(1);
        }
        const count = args[2] ? parseInt(args[2], 10) : 10;
        await getUserTweets(args[1], count);
        break;
        
      default:
        console.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
