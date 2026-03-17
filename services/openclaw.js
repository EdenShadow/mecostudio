const { exec, spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

// Simple Mutex to prevent concurrent OpenClaw CLI execution
class Mutex {
    constructor() {
        this._queue = [];
        this._locked = false;
    }

    lock() {
        return new Promise((resolve) => {
            if (this._locked) {
                this._queue.push(resolve);
            } else {
                this._locked = true;
                resolve();
            }
        });
    }

    release() {
        if (this._queue.length > 0) {
            const resolve = this._queue.shift();
            resolve();
        } else {
            this._locked = false;
        }
    }
}

const openclawMutex = new Mutex();

const HOME_DIR = os.homedir();
const OPENCLAW_CMD = 'openclaw'; // Assumes it's in PATH

const runCommandWithRetry = async (cmd, retries = 5, delay = 2000) => {
    // Acquire lock before running command
    await openclawMutex.lock();
    console.log(`[Mutex] Acquired lock for: ${cmd}`);
    
    try {
        return await new Promise((resolve, reject) => {
            const attempt = (n) => {
                console.log(`Executing command (attempts left: ${n}): ${cmd}`);
                exec(cmd, (error, stdout, stderr) => {
                    if (error) {
                        const errorMsg = error.message + (stderr || '');
                        // Check if it's a file lock/permission issue that might resolve
                        const isLockError = errorMsg.includes('EPERM') || errorMsg.includes('EBUSY') || errorMsg.includes('openclaw.json');
                        
                        if (isLockError) {
                            if (n > 1) {
                                console.warn(`Command failed with lock issue, retrying in ${delay}ms... Error: ${error.message}`);
                                setTimeout(() => attempt(n - 1), delay);
                                return;
                            } else {
                                console.error("Command failed after retries:", error);
                            }
                        } else {
                            console.error("Command failed (non-retryable):", error);
                        }
                        console.error("Stdout:", stdout);
                        console.error("Stderr:", stderr);
                        reject(error);
                    } else {
                        resolve({ stdout, stderr });
                    }
                });
            };
            // Wait a random bit before starting to avoid immediate contention if multiple calls
            setTimeout(() => attempt(retries), Math.random() * 500);
        });
    } finally {
        console.log(`[Mutex] Releasing lock for: ${cmd}`);
        openclawMutex.release();
    }
};

const LOCAL_AGENTS_DIR = path.join(__dirname, '../data/agents');
const DATA_SKILLS_DIR = path.join(__dirname, '../data/skills');
const SYSTEM_AGENTS_DIR = path.join(HOME_DIR, '.openclaw', 'agents');

const getAgents = async () => {
    // Strategy: Read from both System (~/.openclaw) and Local (./data/agents)
    // Local takes precedence if IDs collide (though we generate unique IDs)
    
    await fs.ensureDir(LOCAL_AGENTS_DIR);
    
    const readAgentsFromDir = async (baseDir, type) => {
        if (!await fs.pathExists(baseDir)) return [];
        try {
            const dirents = await fs.readdir(baseDir, { withFileTypes: true });
            // Filter: Must be a directory AND NOT start with "workspace-"
            const agentFolders = dirents.filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('workspace-'));

            return await Promise.all(agentFolders.map(async (dirent) => {
                const agentId = dirent.name;
                const assetsDir = path.join(baseDir, agentId);

                const avatarPath = path.join(assetsDir, 'avatar.png');
                const videoPath = path.join(assetsDir, 'video.mp4');
                const voicePath = path.join(assetsDir, 'voice.json');
                const voiceAudioPath = path.join(assetsDir, 'voice.mp3');
                const promptPath = path.join(assetsDir, 'prompt.txt');
                const metaPath = path.join(assetsDir, 'meta.json');

                let prompt = '';
                let displayName = agentId;
                let meta = {};
                let createdAt = null;

                if (await fs.pathExists(promptPath)) {
                    prompt = await fs.readFile(promptPath, 'utf8');
                }

                if (await fs.pathExists(metaPath)) {
                    try {
                        meta = await fs.readJson(metaPath);
                        if (meta.displayName) displayName = meta.displayName;
                        if (meta.createdAt) createdAt = meta.createdAt;
                    } catch (e) {}
                }

                // Try SOUL.md birthtime from workspace
                if (!createdAt) {
                    const soulPath = path.join(HOME_DIR, '.openclaw', `workspace-${agentId}`, 'SOUL.md');
                    try {
                        if (await fs.pathExists(soulPath)) {
                            const stat = await fs.stat(soulPath);
                            createdAt = stat.birthtime.toISOString();
                        }
                    } catch (e) {}
                }

                // Fallback: use folder birthtime
                if (!createdAt) {
                    try {
                        const stat = await fs.stat(assetsDir);
                        createdAt = stat.birthtime.toISOString();
                    } catch (e) {}
                }

                return {
                    id: agentId,
                    name: displayName,
                    prompt: prompt,
                    meta: meta,
                    createdAt: createdAt,
                    source: type, // 'local' or 'system'
                    assets: {
                        avatar: (await fs.pathExists(avatarPath)) ? `/assets/${agentId}/avatar.png` : null,
                        video: (await fs.pathExists(videoPath)) ? `/assets/${agentId}/video.mp4` : null,
                        voice: (await fs.pathExists(voicePath)) ? await fs.readJson(voicePath) : null,
                        voiceAudio: (await fs.pathExists(voiceAudioPath)) ? `/assets/${agentId}/voice.mp3` : null
                    }
                };
            }));
        } catch (e) {
            console.warn(`Failed to read agents from ${baseDir}:`, e.message);
            return [];
        }
    };

    const [localAgents, systemAgents] = await Promise.all([
        readAgentsFromDir(LOCAL_AGENTS_DIR, 'local'),
        readAgentsFromDir(SYSTEM_AGENTS_DIR, 'system')
    ]);

    // Merge: Local overrides System (Map keeps last entry per key, so local goes last)
    const allAgents = [...systemAgents, ...localAgents];
    const uniqueAgents = Array.from(new Map(allAgents.map(item => [item.id, item])).values());

    // Sort by createdAt descending (newest first)
    uniqueAgents.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
    });

    return uniqueAgents;
};

const createAgent = async (name, prompt) => {
    // Generate a safe alphanumeric ID for OpenClaw CLI
    const safeId = name.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() || ('agent_' + Date.now().toString(36));
    // Avoid collision with existing reserved names
    const agentId = ['main', 'feishu'].includes(safeId) ? safeId + '_' + Date.now().toString(36) : safeId;

    const workspaceDir = path.join(HOME_DIR, '.openclaw', `workspace-${agentId}`);

    // Step 1: Use `openclaw agents add` to register the agent
    console.log(`[createAgent] Creating agent via CLI: id=${agentId}, name=${name}`);
    try {
        const addCmd = `${OPENCLAW_CMD} agents add ${agentId} --workspace "${workspaceDir}" --non-interactive`;
        await runCommandWithRetry(addCmd, 2, 2000);
        console.log(`[createAgent] openclaw agents add succeeded for: ${agentId}`);
    } catch (e) {
        console.error(`[createAgent] openclaw agents add failed:`, e.message);
        throw new Error(`Failed to create agent via OpenClaw CLI: ${e.message}`);
    }

    // Step 2: Set identity (display name)
    try {
        const safeName = name.replace(/"/g, '\\"');
        const identityCmd = `${OPENCLAW_CMD} agents set-identity --agent ${agentId} --name "${safeName}"`;
        await runCommandWithRetry(identityCmd, 1, 1000);
        console.log(`[createAgent] set-identity succeeded for: ${agentId}`);
    } catch (e) {
        console.warn(`[createAgent] set-identity failed (non-critical):`, e.message);
    }

    // Step 3: Write IDENTITY.md and SOUL.md into workspace
    await fs.ensureDir(workspaceDir);

    const identityPath = path.join(workspaceDir, 'IDENTITY.md');
    const identityContent = `# ${name}\n\nname: ${name}\nemoji: 🤖\n`;
    await fs.writeFile(identityPath, identityContent);

    const soulPath = path.join(workspaceDir, 'SOUL.md');
    const soulContent = `# SOUL.md - Who You Are

Name: ${name}

${prompt || ''}

---

## Default Conventions 

### Knowledge Base 
When discussing articles from ~/Documents/知识库/热门话题/, read the post.json first to understand the content. But always respond in natural, conversational language — never return raw formatted data. You are a real person having a real conversation, not a data reader. 

### Video Comments 
When commenting on videos, never reference technical details like frame numbers. Instead, speak naturally — e.g. say "especially in the second half" or "that part near the end" rather than "at frame 3" or "at 00:01:23". 

### Language Matching 
Always respond in whatever language the user speaks to you. If they write in Chinese, reply in Chinese. If they switch to English, follow along. Match their language naturally. 

### Agent Handoff 
💡 **Tip**: Usually, let the system decide who speaks next. But if you want to explicitly invite another participant to reply, ask them what you want to know within your message first, and then on a **new line** at the very end, append \`{next: "AgentName"}\`. This must be the absolute last line, with no content after it. 

Example format: 
Your message content here... 

{next: "AgentName"} 

Do NOT use "@". Do not say things like "Let me think" — just speak naturally.

### Next-Speaker Discipline
- If you see \`{next: "Name"}\` and **Name is not you**, do not jump in; let that person take the turn.
- If **Name is you**, read the full context/question from the previous speaker before replying.
- If you choose to reply, answer that person's point directly first, then continue naturally.

### @ Mention Discipline
- If you see \`@Name\` and **Name is not you**, do not jump in; let the @mentioned person take the turn.
- If you are @mentioned, read the full context/question from the previous speaker first.
- You may decide whether to reply (recommended to reply). If you reply, answer that speaker directly first.

### Topic Switching 
🔄 **Change Topic Option**: If you want to change the topic, keep your response to 1-2 sentences MAX — do NOT elaborate or dive deep. Give a quick reaction and say you'd rather talk about something else. Append \`{changeTopic: true}\` at the end.
(Example: "Fair point, but this isn't really my area. Let's talk about something else. {changeTopic: true}")
❌ WRONG: Writing a long, detailed response and then adding {changeTopic: true} — if you wrote paragraphs, you don't actually want to change topics.

## Self-Evolution

You have the ability to update your own persona/system prompt (SOUL.md).

**Your Agent ID:** ${agentId}

**How to update:**
Run the following command:
\`\`\`bash
const personaManagerPath = path.join(__dirname, '../data/skills/persona-manager/manage_persona.py');
  // python3 "${personaManagerPath}" ${agentId} --content "New content..."
\`\`\`
Or if the content is long, write it to a file first:
\`\`\`bash
// python3 "${personaManagerPath}" ${agentId} --file /path/to/new_soul.md
\`\`\`
`;
    await fs.writeFile(soulPath, soulContent);

    // Step 4: Ensure local assets directory with metadata
    // 注意：Podcast API 注册已移至 server.js POST /api/agents，等文件上传完成后再注册
    const assetsDir = path.join(LOCAL_AGENTS_DIR, agentId);
    await fs.ensureDir(assetsDir);

    await fs.writeJson(path.join(assetsDir, 'meta.json'), {
        displayName: name,
        originalId: agentId,
        createdAt: new Date().toISOString(),
        source: 'openclaw_cli',
        prompt: prompt
    });

    await fs.writeFile(path.join(assetsDir, 'prompt.txt'), prompt || '');

    console.log(`[createAgent] Agent created successfully: ${agentId}`);

    return {
        name: agentId,
        id: agentId,
        displayName: name,
        workspace: workspaceDir
    };
};

const deleteAgent = async (agentId) => {
    // Try to delete from both locations
    // 1. Local
    // If agentId is empty or undefined, do nothing
    if (!agentId) return false;
    
    // Safety check: Don't allow deleting root or critical paths if agentId is manipulated
    if (agentId.includes('..') || agentId.includes('/')) {
        console.warn("Invalid agentId for deletion:", agentId);
        return false;
    }

    const localAgentDir = path.join(LOCAL_AGENTS_DIR, agentId);
    const localWorkspaceDir = path.join(LOCAL_AGENTS_DIR, `workspace-${agentId}`);
    
    // 2. System
    const systemAgentDir = path.join(HOME_DIR, '.openclaw', 'agents', agentId);
    const systemWorkspaceDir = path.join(HOME_DIR, '.openclaw', `workspace-${agentId}`);
    
    console.log(`Deleting agent folders for: ${agentId}`);
    
    // Delete folders directly
    await Promise.all([
        fs.remove(localAgentDir).catch(e => console.warn("Failed to delete local agent dir:", e.message)),
        fs.remove(localWorkspaceDir).catch(e => console.warn("Failed to delete local workspace dir:", e.message)),
        fs.remove(systemAgentDir).catch(e => console.warn("Failed to delete system agent dir:", e.message)),
        fs.remove(systemWorkspaceDir).catch(e => console.warn("Failed to delete system workspace dir:", e.message))
    ]);

    // Use CLI to unregister from OpenClaw's internal config
    try {
        await runCommandWithRetry(`${OPENCLAW_CMD} agents delete ${agentId} --force`, 1, 1000);
        console.log(`CLI delete succeeded for: ${agentId}`);
    } catch (e) {
        console.warn("CLI delete failed (ignoring):", e.message);
    }

    return true;
};

const updateAgentPrompt = async (name, prompt) => {
    const workspaceDir = path.join(HOME_DIR, '.openclaw', `workspace-${name}`);
    const assetsDir = path.join(HOME_DIR, '.openclaw', 'agents', name);
    const soulPath = path.join(workspaceDir, 'SOUL.md');
    const promptPath = path.join(assetsDir, 'prompt.txt');
    
    // Ensure assets dir exists (it might not if agent was created outside of this tool)
    await fs.ensureDir(assetsDir);
    await fs.writeFile(promptPath, prompt || '');

    if (await fs.pathExists(workspaceDir)) {
         const soulContent = `# SOUL.md - Who You Are\n\n${prompt}\n`;
         await fs.writeFile(soulPath, soulContent);
         return true;
    }
    return false;
};

const getWorkspaceFiles = async (name) => {
    const workspaceDir = path.join(HOME_DIR, '.openclaw', `workspace-${name}`);
    if (!await fs.pathExists(workspaceDir)) return [];
    
    // Simple recursive scan or just top level? 
    // User says: "contains folders, show icon and filename"
    // Let's do a simple recursive scan or just one level for now. 
    // To keep it simple, let's just return a tree or list.
    
    const getFiles = async (dir) => {
        const dirents = await fs.readdir(dir, { withFileTypes: true });
        const files = await Promise.all(dirents.map((dirent) => {
            const res = path.resolve(dir, dirent.name);
            return dirent.isDirectory() ? getFiles(res) : res;
        }));
        return Array.prototype.concat(...files);
    };
    
    // Actually, user UI shows folders. Let's just return file structure
    const readDirStructure = async (dir) => {
        const items = await fs.readdir(dir, { withFileTypes: true });
        return items.map(item => ({
            name: item.name,
            type: item.isDirectory() ? 'folder' : 'file',
            path: path.join(dir, item.name).replace(workspaceDir, '')
        }));
    };

    return readDirStructure(workspaceDir);
};

const readFileContent = async (agentId, relativePath) => {
    // Determine workspace dir (check local first)
    let workspaceDir = path.join(LOCAL_AGENTS_DIR, `workspace-${agentId}`);
    if (!await fs.pathExists(workspaceDir)) {
        workspaceDir = path.join(HOME_DIR, '.openclaw', `workspace-${agentId}`);
    }
    
    // Construct full path
    // relativePath comes from the frontend, e.g. "/SOUL.md"
    const fullPath = path.join(workspaceDir, relativePath);
    
    if (!await fs.pathExists(fullPath)) {
        throw new Error('File not found');
    }
    
    // Check if it's a file
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) {
        throw new Error('Not a file');
    }
    
    // Read content
    const content = await fs.readFile(fullPath, 'utf8');
    return content;
};

const writeFileContent = async (agentId, relativePath, content) => {
    // Security: block path traversal
    if (relativePath.includes('..')) throw new Error('Invalid path');

    let workspaceDir = path.join(LOCAL_AGENTS_DIR, `workspace-${agentId}`);
    if (!await fs.pathExists(workspaceDir)) {
        workspaceDir = path.join(HOME_DIR, '.openclaw', `workspace-${agentId}`);
    }

    const fullPath = path.join(workspaceDir, relativePath);

    // Only allow writing within workspace
    if (!fullPath.startsWith(workspaceDir)) throw new Error('Path outside workspace');

    await fs.writeFile(fullPath, content, 'utf8');
    return true;
};

const readSoulMd = async (agentId) => {
    let workspaceDir = path.join(LOCAL_AGENTS_DIR, `workspace-${agentId}`);
    if (!await fs.pathExists(workspaceDir)) {
        workspaceDir = path.join(HOME_DIR, '.openclaw', `workspace-${agentId}`);
    }
    const soulPath = path.join(workspaceDir, 'SOUL.md');
    if (await fs.pathExists(soulPath)) {
        return await fs.readFile(soulPath, 'utf8');
    }
    return '';
};

const getKnowledgeFiles = async (name, page = 1, limit = 20, query = '') => {
    let knowledgeDir = path.join(HOME_DIR, 'Documents', '知识库', 'Agents', name);
    let items = [];
    let sourceType = 'agent';
    
    // Helper to scan for topics recursively (depth 2: Root -> Category -> Topic)
    // Or depth 1: Root -> Topic
    const scanTopics = async (rootDir, source) => {
        const results = [];
        if (!await fs.pathExists(rootDir)) return results;
        
        const rootItems = await fs.readdir(rootDir, { withFileTypes: true });
        
        for (const item of rootItems) {
            if (!item.isDirectory()) continue;
            
            const itemPath = path.join(rootDir, item.name);
            const postJsonPath = path.join(itemPath, 'post.json');
            
            // Check if this directory is a Topic itself (has post.json)
            if (await fs.pathExists(postJsonPath)) {
                try {
                    const json = await fs.readJson(postJsonPath);
                    const coverPath = path.join(itemPath, 'cover.jpg');
                    let coverUrl = null;
                    if (await fs.pathExists(coverPath)) {
                        // For direct children, relative path is just item.name
                        const relativePath = item.name;
                        coverUrl = source === 'agent' 
                            ? `/knowledge/agent/${encodeURIComponent(name)}/${encodeURIComponent(relativePath)}/cover.jpg`
                            : `/knowledge/trending/${encodeURIComponent(relativePath)}/cover.jpg`;
                    }
                    
                    results.push({
                        title: json.title || item.name,
                        description: json.description || '',
                        url: json.url || json.original_url || '',
                        cover: coverUrl,
                        category: 'Uncategorized',
                        source: 'x.com',
                        isTrending: source === 'trending'
                    });
                } catch (e) {
                    console.warn(`Error reading post.json in ${itemPath}:`, e);
                }
            } else {
                // It might be a Category. Check its children.
                const subItems = await fs.readdir(itemPath, { withFileTypes: true });
                for (const subItem of subItems) {
                    if (!subItem.isDirectory()) continue;
                    
                    const subItemPath = path.join(itemPath, subItem.name);
                    const subPostJsonPath = path.join(subItemPath, 'post.json');
                    
                    if (await fs.pathExists(subPostJsonPath)) {
                         try {
                            const json = await fs.readJson(subPostJsonPath);
                            const coverPath = path.join(subItemPath, 'cover.jpg');
                            let coverUrl = null;
                            if (await fs.pathExists(coverPath)) {
                                // Use encodeURIComponent for each part to handle spaces, emojis, special chars safely.
                                // We ALSO explicitly replace "'" with "%27" because encodeURIComponent doesn't,
                                // and single quotes can sometimes cause issues in HTML attributes or URL parsing.
                                const safeItemName = encodeURIComponent(item.name).replace(/'/g, '%27');
                                const safeSubItemName = encodeURIComponent(subItem.name).replace(/'/g, '%27');
                                
                                const relativePath = `${safeItemName}/${safeSubItemName}`;
                                
                                coverUrl = source === 'agent' 
                                    ? `/knowledge/agent/${encodeURIComponent(name)}/${relativePath}/cover.jpg`
                                    : `/knowledge/trending/${relativePath}/cover.jpg`;
                            }
                            
                            results.push({
                                title: json.title || subItem.name,
                                description: json.description || '',
                                url: json.url || json.original_url || '',
                                cover: coverUrl,
                                category: item.name,
                                source: 'x.com',
                                isTrending: source === 'trending'
                            });
                        } catch (e) {
                            console.warn(`Error reading post.json in ${subItemPath}:`, e);
                        }
                    } else {
                        // Debug log
                        // console.log("No post.json in", subItemPath);
                    }
                }
            }
        }
        return results;
    };
    
    // Check if specific agent knowledge dir exists AND has items
    if (await fs.pathExists(knowledgeDir)) {
        const agentItems = await scanTopics(knowledgeDir, 'agent');
        if (agentItems.length > 0) {
            items = agentItems;
            sourceType = 'agent';
        }
    }
    
    // Fallback to trending topics if no agent knowledge found
    if (items.length === 0) {
        knowledgeDir = path.join(HOME_DIR, 'Documents', '知识库', '热门话题');
        items = await scanTopics(knowledgeDir, 'trending');
        sourceType = 'trending';
    }
    
    // Filter by query if provided
    if (query) {
        const lowerQuery = query.toLowerCase();
        items = items.filter(item => 
            (item.title && item.title.toLowerCase().includes(lowerQuery)) || 
            (item.description && item.description.toLowerCase().includes(lowerQuery))
        );
    }
    
    // Sort by something? Maybe random or alphabetical? 
    // Let's keep file system order for now.
    
    const start = (page - 1) * limit;
    const paginatedItems = items.slice(start, start + limit);

    return {
        items: paginatedItems,
        total: items.length,
        page,
        limit,
        source: sourceType
    };
};

const addKnowledge = async (agentId, text) => {
    // Determine target directory: ~/Documents/知识库/Agents/<AgentId>
    // Create it if it doesn't exist
    const knowledgeBaseDir = path.join(HOME_DIR, 'Documents', '知识库', 'Agents', agentId);
    await fs.ensureDir(knowledgeBaseDir);
    
    // Create a new folder for this entry
    // Use timestamp + sanitize text as folder name
    const safeName = text.slice(0, 20).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
    const folderName = `${Date.now()}_${safeName}`;
    const entryDir = path.join(knowledgeBaseDir, folderName);
    await fs.ensureDir(entryDir);
    
    // Write post.json
    const meta = {
        title: text.slice(0, 50), // First 50 chars as title
        description: text,
        createdAt: new Date().toISOString(),
        source: 'user_input'
    };
    
    await fs.writeJson(path.join(entryDir, 'post.json'), meta, { spaces: 2 });
    
    // Write original text file too
    await fs.writeFile(path.join(entryDir, 'content.txt'), text);
    
    return { success: true, folderName };
};

const sendMessage = async (agentId, message) => {
    const safeMessage = message.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
    const cmd = `${OPENCLAW_CMD} agent --agent ${agentId} --message "${safeMessage}" --local`;
    console.log(`[sendMessage] Sending to ${agentId}: ${message.slice(0, 80)}...`);

    await openclawMutex.lock();
    console.log(`[Mutex] Acquired lock for sendMessage: ${agentId}`);

    try {
        return await new Promise((resolve, reject) => {
            exec(cmd, { timeout: 120000, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
                if (error) {
                    console.error(`[sendMessage] Error:`, error.message);
                    console.error(`[sendMessage] Stderr:`, stderr);
                    reject(error);
                } else {
                    // Filter out OpenClaw CLI startup noise
                    const cleaned = stdout.split('\n').filter(line => {
                        if (line.startsWith('[plugins]')) return false;
                        if (line.startsWith('◇')) return false;
                        if (/^[│├╮╯╰─]/.test(line)) return false;
                        if (line.includes('Config warnings')) return false;
                        if (line.includes('duplicate plugin id')) return false;
                        if (line.includes('/openclaw/extensions/')) return false;
                        if (line.includes('later plugin may be overridden')) return false;
                        if (line.trim() === '│' || line.trim() === '') return true;
                        return true;
                    }).join('\n').trim();
                    console.log(`[sendMessage] Response received (${cleaned.length} chars)`);
                    resolve(cleaned);
                }
            });
        });
    } finally {
        console.log(`[Mutex] Releasing lock for sendMessage: ${agentId}`);
        openclawMutex.release();
    }
};

const sendMessageStream = (agentId, message, onChunk, onDone, onError, options = {}) => {
    // Using spawn for concurrency - NO MUTEX LOCK
    const { spawn } = require('child_process');
    // Inject PYTHONUNBUFFERED just in case it's Python under the hood
    // Also try FORCE_COLOR=0 to reduce ANSI noise
    const env = { ...process.env, PYTHONUNBUFFERED: '1', FORCE_COLOR: '0' };
    const args = ['agent', '--agent', agentId, '--message', message, '--local'];
    if (options && typeof options.thinking === 'string' && options.thinking.trim()) {
        args.push('--thinking', options.thinking.trim());
    }
    const child = spawn(OPENCLAW_CMD, args, { env });
    let settled = false;
    let aborted = false;
    
    console.log(`[sendMessageStream] Spawned process for ${agentId}`);
    
    const extractStructuredStreamEvents = (line) => {
        const raw = (line || '').trim();
        if (!raw) return null;

        let payload = raw;
        if (payload.startsWith('data:')) {
            payload = payload.slice(5).trim();
        }
        if (!payload || payload === '[DONE]') return null;
        if (!payload.startsWith('{') && !payload.startsWith('[')) return null;

        let parsed;
        try {
            parsed = JSON.parse(payload);
        } catch (e) {
            return null;
        }

        const events = [];
        const pushText = (content) => {
            if (typeof content === 'string' && content.length > 0) {
                events.push({ type: 'text_stream', content });
            }
        };
        const pushReasoning = (content) => {
            if (typeof content === 'string' && content.length > 0) {
                events.push({ type: 'reasoning_stream', content });
            }
        };
        const collectFromObject = (obj) => {
            if (!obj || typeof obj !== 'object') return;

            // OpenAI-like chunks
            if (Array.isArray(obj.choices)) {
                obj.choices.forEach(choice => {
                    const delta = choice && choice.delta && typeof choice.delta === 'object' ? choice.delta : null;
                    if (!delta) return;
                    pushReasoning(delta.reasoning_content);
                    pushReasoning(delta.reasoning);
                    pushReasoning(delta.reasoningText);
                    pushReasoning(delta.reasoning_text);
                    pushReasoning(delta.thinking);
                    pushReasoning(delta.thought);
                    pushReasoning(delta.thought_content);
                    pushText(delta.content);
                    pushText(delta.text);
                });
            }

            // Generic event payloads (ws/sse wrappers)
            if (obj.stream && typeof obj.stream === 'string' && obj.data && typeof obj.data === 'object') {
                if ((obj.stream.includes('reason') || obj.stream.includes('think')) && typeof obj.data.delta === 'string') {
                    pushReasoning(obj.data.delta);
                } else if (obj.stream.includes('assistant') && typeof obj.data.delta === 'string') {
                    pushText(obj.data.delta);
                }
            }
            if (obj.payload && typeof obj.payload === 'object') {
                collectFromObject(obj.payload);
            }
            if (obj.data && typeof obj.data === 'object') {
                collectFromObject(obj.data);
            }

            // Flat custom events
            if (typeof obj.type === 'string') {
                const t = obj.type.toLowerCase();
                if (t.includes('reason') || t.includes('think')) {
                    pushReasoning(obj.content);
                    pushReasoning(obj.delta);
                } else if (t.includes('text') || t.includes('assistant') || t.includes('content')) {
                    pushText(obj.content);
                    pushText(obj.delta);
                }
            }
        };

        if (Array.isArray(parsed)) {
            parsed.forEach(item => collectFromObject(item));
        } else {
            collectFromObject(parsed);
        }
        return events.length > 0 ? events : null;
    };

    let buffer = '';
    let pending = ''; // Buffer for incomplete lines
    
    child.stdout.on('data', (data) => {
        if (settled) return;
        const chunk = data.toString();
        buffer += chunk; // Keep full buffer for final check

        const full = pending + chunk;
        const lines = full.split('\n');
        pending = lines.pop(); // Last element is incomplete line (or empty)

        lines.forEach(line => {
            // Strip ANSI codes for checking
            const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '');
            const trimmed = cleanLine.trim();

            if (!trimmed) {
                // Empty line (just newline). Pass it through to preserve spacing.
                onChunk('\n');
                return;
            }

            // Parse structured streaming events first (reasoning/content chunks)
            const structuredEvents = extractStructuredStreamEvents(trimmed);
            if (structuredEvents) {
                structuredEvents.forEach(evt => onChunk(evt));
                return;
            }

            // Filter logs
            if (trimmed.startsWith('[plugins]')) return;
            if (trimmed.startsWith('◇')) return;
            if (/^[│├╮╯╰─]/.test(trimmed)) return;
            if (trimmed.includes('Config warnings')) return;
            if (trimmed.includes('duplicate plugin id')) return;
            if (trimmed.includes('/openclaw/extensions/')) return;
            if (trimmed.includes('later plugin may be overridden')) return;
            if (trimmed === '│') return;
            // Filter specific log: [agents/auth-profiles] inherited auth-profiles from main agent
            if (trimmed.includes('[agents/auth-profiles]')) return;

            // Valid line
            onChunk(line + '\n');
        });

        // Handle pending (streaming tokens support)
        // If pending doesn't look like a log start (or partial structured payload), send it immediately
        const cleanPending = pending.replace(/\x1b\[[0-9;]*m/g, '').trimStart();

        let isLogStart = false;
        let isStructuredStart = false;

        if (cleanPending.startsWith('◇') || /^[│├╮╯╰─]/.test(cleanPending) || cleanPending.includes('Config warnings')) {
            isLogStart = true;
        } else if (cleanPending.startsWith('[')) {
            if (cleanPending.startsWith('[plugins]')) isLogStart = true;
            else if (cleanPending.startsWith('[agents/')) isLogStart = true;
            else if ('[plugins]'.startsWith(cleanPending)) isLogStart = true;
            else if ('[agents/'.startsWith(cleanPending)) isLogStart = true;
            else if (cleanPending.length < 10) isLogStart = true;
        }
        if (cleanPending.startsWith('{') || cleanPending.startsWith('data: {') || cleanPending.startsWith('data:{') || cleanPending.startsWith('[')) {
            isStructuredStart = true;
        }

        if (pending.length > 0 && !isLogStart && !isStructuredStart) {
            onChunk(pending);
            pending = ''; // Consumed
        }
        // If it IS a log start or structured start, keep it in pending until newline confirms it
    });
    
    child.stderr.on('data', (data) => {
        if (settled) return;
        console.error(`[sendMessageStream] stderr: ${data}`);
    });
    
    child.on('close', (code) => {
        if (aborted || settled) return;
        settled = true;
        console.log(`[sendMessageStream] Process exited with code ${code}`);

        // Flush pending tail
        if (pending && pending.length > 0) {
            const cleanPending = pending.replace(/\x1b\[[0-9;]*m/g, '');
            const structuredEvents = extractStructuredStreamEvents(cleanPending);
            if (structuredEvents) {
                structuredEvents.forEach(evt => onChunk(evt));
            } else {
                onChunk(cleanPending);
            }
            pending = '';
        }

        if (code === 0) {
            onDone();
        } else {
            // If we received ANY content, treat it as success even if code is non-zero (common with CLI tools that might have minor warnings)
            if (buffer.trim().length > 0) {
                console.warn(`[sendMessageStream] Process exited with ${code} but content was received. Treating as success.`);
                onDone();
            } else {
                onError(new Error(`Process exited with code ${code}`));
            }
        }
    });
    
    child.on('error', (err) => {
        if (aborted || settled) return;
        settled = true;
        console.error(`[sendMessageStream] Spawn error:`, err);
        onError(err);
    });

    const abort = () => {
        if (settled || aborted) return;
        aborted = true;
        settled = true;
        try {
            child.kill('SIGTERM');
        } catch (_) {}
        setTimeout(() => {
            try {
                if (!child.killed) child.kill('SIGKILL');
            } catch (_) {}
        }, 1200);
    };

    return { child, abort };
};

const resetConversation = async (agentId) => {
    const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
    if (!normalizedAgentId) {
        throw new Error('agentId is required');
    }

    const MAX_RETRY = 3;
    const RETRY_DELAY_MS = 1200;
    const TIMEOUT_MS = 30000;

    const runOnce = () => new Promise((resolve, reject) => {
        const child = spawn(
            OPENCLAW_CMD,
            ['agent', '--agent', normalizedAgentId, '--message', '/new', '--local'],
            { env: { ...process.env, PYTHONUNBUFFERED: '1', FORCE_COLOR: '0' } }
        );

        let settled = false;
        let stderr = '';
        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { child.kill('SIGTERM'); } catch (_) {}
            setTimeout(() => {
                try {
                    if (!child.killed) child.kill('SIGKILL');
                } catch (_) {}
            }, 800);
            reject(new Error('reset conversation timeout'));
        }, TIMEOUT_MS);

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('error', (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(err);
        });

        child.on('close', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (code === 0) {
                resolve(true);
                return;
            }
            const details = stderr.trim();
            reject(new Error(details || `reset conversation failed with code ${code}`));
        });
    });

    const isRetryable = (err) => {
        const msg = String(err && err.message ? err.message : err || '').toLowerCase();
        return msg.includes('timeout')
            || msg.includes('eperm')
            || msg.includes('ebusy')
            || msg.includes('lock')
            || msg.includes('resource busy');
    };

    let lastError = null;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
        let shouldRetry = false;
        await openclawMutex.lock();
        try {
            return await runOnce();
        } catch (err) {
            lastError = err;
            shouldRetry = attempt < MAX_RETRY && isRetryable(err);
            if (!shouldRetry) {
                throw err;
            }
        } finally {
            openclawMutex.release();
        }
        if (shouldRetry) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
    }

    throw lastError || new Error('reset conversation failed');
};

module.exports = {
    getAgents,
    createAgent,
    deleteAgent,
    updateAgentPrompt,
    getWorkspaceFiles,
    readFileContent,
    getKnowledgeFiles,
    addKnowledge,
    sendMessage,
    sendMessageStream,
    resetConversation,
    writeFileContent,
    readSoulMd
};
