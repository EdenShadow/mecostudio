const axios = require('axios');
const fs = require('fs-extra');
const FormData = require('form-data');
const appSettings = require('./app-settings');

const UPLOAD_URL = "https://api.minimaxi.com/v1/files/upload";
const CLONE_URL = "https://api.minimaxi.com/v1/voice_clone";

const trainVoice = async (audioFilePath, agentName = '') => {
    const settings = appSettings.getSettings();
    const apiKey = String(settings.minimaxApiKey || '').trim();
    if (!apiKey) {
        throw new Error('MiniMax API Key is not configured');
    }

    // 1. Upload File
    console.log('[Voice] Uploading audio file:', audioFilePath);
    const form = new FormData();
    form.append('file', fs.createReadStream(audioFilePath));
    form.append('purpose', 'voice_clone');

    const uploadResponse = await axios.post(UPLOAD_URL, form, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            ...form.getHeaders()
        },
        timeout: 60000
    });

    console.log('[Voice] Upload response:', JSON.stringify(uploadResponse.data));

    if (!uploadResponse.data || uploadResponse.data.base_resp?.status_code !== 0) {
        const msg = uploadResponse.data?.base_resp?.status_msg || 'Unknown upload error';
        throw new Error(`File upload failed: ${msg}`);
    }

    if (!uploadResponse.data.file?.file_id) {
        throw new Error('File upload succeeded but no file_id returned');
    }

    const fileId = uploadResponse.data.file.file_id;
    console.log(`[Voice] File uploaded, ID: ${fileId}`);

    // 2. Clone Voice
    // voice_id rules: at least 8 chars, letters+numbers, starts with letter
    const safeName = agentName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 20);
    const voiceId = safeName ? `${safeName}_${Date.now()}` : `voice${Date.now()}`;

    console.log(`[Voice] Cloning with voice_id: ${voiceId}`);
    const cloneResponse = await axios.post(CLONE_URL, {
        file_id: fileId,
        voice_id: voiceId,
        text: "today, i visited a company called Meco Studio. they are building amazing AI agents.",
        model: "speech-2.6-hd"
    }, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        timeout: 60000
    });

    console.log('[Voice] Clone response:', JSON.stringify(cloneResponse.data));

    if (!cloneResponse.data || cloneResponse.data.base_resp?.status_code !== 0) {
        const msg = cloneResponse.data?.base_resp?.status_msg || 'Unknown clone error';
        throw new Error(`Voice cloning failed: ${msg}`);
    }

    console.log(`[Voice] Clone succeeded! voice_id: ${voiceId}`);

    return {
        fileId: fileId,
        voiceId: voiceId,
        status: 'success'
    };
};

module.exports = { trainVoice };
