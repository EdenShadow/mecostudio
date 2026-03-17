#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const API_KEY = 'new1_5849159db0de4d5aba328655a5bfacf5';
const BASE_URL = 'https://api.twitterapi.io/twitter';

// Helper function to make API requests
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

// Create the server
const server = new Server(
  {
    name: 'twitter-scraper',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_tweet_details',
        description: '获取单条推文的详细信息（包括统计数据、作者信息等）',
        inputSchema: {
          type: 'object',
          properties: {
            tweet_id: {
              type: 'string',
              description: '推文 ID（可以从推文 URL 中提取，如 https://x.com/elonmusk/status/2018784828129243614 中的 2018784828129243614）'
            }
          },
          required: ['tweet_id']
        }
      },
      {
        name: 'get_user_info',
        description: '获取指定用户的基本信息，包括粉丝数、关注数、推文数、简介等',
        inputSchema: {
          type: 'object',
          properties: {
            username: {
              type: 'string',
              description: 'X/Twitter 用户名（不带 @）'
            }
          },
          required: ['username']
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case 'get_tweet_details': {
        const { tweet_id } = args;
        result = await fetchTwitterAPI('/tweets', {
          tweet_ids: tweet_id
        });
        
        const tweet = result.tweets?.[0] || result.data?.[0];
        if (!tweet || !tweet.id) {
          throw new Error('Tweet not found');
        }
        
        const author = tweet.author || {};
        
        return {
          content: [
            {
              type: 'text',
              text: `推文详情:\n\n` +
                    `作者: @${author.userName || 'Unknown'} (${author.name || 'Unknown'})\n` +
                    `时间: ${tweet.createdAt}\n` +
                    `内容: ${tweet.text}\n\n` +
                    `统计:\n` +
                    `  👍 点赞: ${tweet.likeCount || 0}\n` +
                    `  🔄 转发: ${tweet.retweetCount || 0}\n` +
                    `  💬 回复: ${tweet.replyCount || 0}\n` +
                    `  🔁 引用: ${tweet.quoteCount || 0}\n` +
                    `  🔖 收藏: ${tweet.bookmarkCount || 0}\n` +
                    `  👀 查看: ${tweet.viewCount || 'N/A'}\n\n` +
                    `ID: ${tweet.id}\n` +
                    `URL: https://x.com/${author.userName || 'i'}/status/${tweet.id}`
            }
          ]
        };
      }

      case 'get_user_info': {
        const { username } = args;
        result = await fetchTwitterAPI('/user/info', {
          userName: username.replace(/^@/, '')
        });
        
        if (result.status === 'error') {
          throw new Error(result.msg || '获取用户信息失败');
        }
        
        const user = result.data || result;
        
        return {
          content: [
            {
              type: 'text',
              text: `用户信息:\n\n` +
                    `用户名: @${user.userName}\n` +
                    `显示名: ${user.name}\n` +
                    `简介: ${user.description || '无'}\n\n` +
                    `统计:\n` +
                    `  粉丝: ${user.followers || 0}\n` +
                    `  关注: ${user.following || 0}\n` +
                    `  推文: ${user.statusesCount || 0}\n` +
                    `  收藏: ${user.favouritesCount || 0}\n` +
                    `  媒体: ${user.mediaCount || 0}\n\n` +
                    `位置: ${user.location || '未设置'}\n` +
                    `网站: ${user.url || '无'}\n` +
                    `创建时间: ${user.createdAt}\n` +
                    `蓝V认证: ${user.isBlueVerified ? '是' : '否'}\n` +
                    `受保护: ${user.protected ? '是' : '否'}` +
                    (user.pinnedTweetIds?.length ? `\n置顶推文: ${user.pinnedTweetIds.join(', ')}` : '')
            }
          ]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`
        }
      ],
      isError: true
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
