#!/usr/bin/env node
/**
 * Secret Notes - OpenClaw CLI Adapter
 * 文件名格式: {agent_name}_{YYYYMMDD}_{HHMMSS}.json
 */

const { exec } = require('child_process');
const path = require('path');

const skillDir = __dirname;
const scriptPath = path.join(skillDir, 'secret-notes');

// Parse arguments
const args = process.argv.slice(2);

if (args.length < 2) {
    console.log('Usage: secret-notes <agent_name> <task_description>');
    console.log('Example: secret-notes main "记得查量子计算资料"');
    process.exit(1);
}

const agentName = args[0];
const task = args.slice(1).join(' ');

// Async execution - don't wait for result
const cmd = `"${scriptPath}" "${agentName}" "${task}"`;

exec(cmd, {
    detached: true,
    windowsHide: true
}, (error) => {
    if (error) {
        console.error('Note failed:', error);
        process.exit(1);
    }
    // Silent success - no output
    process.exit(0);
});

// Exit immediately (async)
setTimeout(() => process.exit(0), 100);
