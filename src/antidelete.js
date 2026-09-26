/**
 * Anti-Delete Module
 * Saves deleted messages and forwards them to the admin.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { normalizeJidWithLid } = require('@whiskeysockets/baileys');

const ANTIDELETE_DB = path.join(__dirname, '../database/antidelete.json');
const MESSAGE_CACHE = new Map();
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours
const MAX_CACHE = 500;

function initDB() {
    if (!fs.existsSync(ANTIDELETE_DB)) {
        fs.writeFileSync(ANTIDELETE_DB, JSON.stringify({ enabled: true, savedMessages: [] }, null, 2));
    }
}

function readDB() {
    try {
        return JSON.parse(fs.readFileSync(ANTIDELETE_DB, 'utf-8'));
    } catch (error) {
        return { enabled: true, savedMessages: [] };
    }
}

function writeDB(data) {
    fs.writeFileSync(ANTIDELETE_DB, JSON.stringify(data, null, 2));
}

function isEnabled() {
    const data = readDB();
    return data.enabled !== false;
}

function setEnabled(enabled) {
    const data = readDB();
    data.enabled = enabled;
    writeDB(data);
}

function getSenderJid(msg) {
    return msg?.key?.participant || msg?.key?.remoteJid;
}

function getSenderNumber(senderJid) {
    if (!senderJid) return 'inconnu';
    const normalized = normalizeJidWithLid(senderJid);
    const num = normalized.split('@')[0];
    if (/^237\d{9}$/.test(num)) {
        return `+${num.slice(0,3)} ${num.slice(3,6)} ${num.slice(6,9)} ${num.slice(9)}`;
    }
    return num;
}

function extractMessageContent(msg) {
    if (!msg || !msg.message) return null;
    const m = msg.message;
    if (m.ephemeralMessage) m = m.ephemeralMessage.message;
    if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
    if (m.viewOnceMessage) m = m.viewOnceMessage.message;
    if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
    return m;
}

function cacheMessage(msg) {
    if (!msg?.key?.id || !msg.message) return;
    if (msg.message.protocolMessage && msg.message.protocolMessage.type === 0) return;

    const senderJid = getSenderJid(msg);
    if (!senderJid) return;

    const cacheKey = `${senderJid}:${msg.key.id}`;
    
    // Cleanup old entries
    cleanupCache();
    
    const content = extractMessageContent(msg);
    if (!content) return;

    const entry = {
        key: { ...msg.key },
        senderJid,
        content,
        timestamp: Date.now()
    };

    MESSAGE_CACHE.set(cacheKey, entry);
}

function cleanupCache() {
    const now = Date.now();
    for (const [key, entry] of MESSAGE_CACHE) {
        if (now - entry.timestamp > CACHE_TTL) {
            MESSAGE_CACHE.delete(key);
        }
    }
    
    while (MESSAGE_CACHE.size > MAX_CACHE) {
        const oldest = [...MESSAGE_CACHE.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
        if (oldest) MESSAGE_CACHE.delete(oldest[0]);
    }
}

function isDeletionEvent(msg) {
    if (!msg?.message?.protocolMessage) return false;
    return msg.message.protocolMessage.type === 0;
}

function handleDelete(sock, msg) {
    if (!isEnabled()) return false;
    if (!isDeletionEvent(msg)) return false;

    const proto = msg.message.protocolMessage;
    const deletedKey = proto.key || msg.key;
    const senderJid = getSenderJid(msg);
    
    if (!senderJid) return false;

    const cacheKey = `${senderJid}:${deletedKey.id}`;
    const cached = MESSAGE_CACHE.get(cacheKey);

    if (!cached) {
        console.log('[AntiDelete] No cached message found for deletion');
        return false;
    }

    MESSAGE_CACHE.delete(cacheKey);
    
    // Save to database
    const data = readDB();
    data.savedMessages.push({
        senderJid: cached.senderJid,
        content: cached.content,
        timestamp: cached.timestamp,
        savedAt: Date.now()
    });
    
    // Keep only last 1000 saved messages
    if (data.savedMessages.length > 1000) {
        data.savedMessages = data.savedMessages.slice(-1000);
    }
    
    writeDB(data);

    // Forward to admin
    forwardToAdmin(sock, cached);
    return true;
}

async function forwardToAdmin(sock, cachedMsg) {
    try {
        const ownerNumber = config.ownerNumber?.[0];
        if (!ownerNumber) return;

        const ownerJid = `${ownerNumber}@s.whatsapp.net`;
        const senderJid = cachedMsg.senderJid;
        const senderNum = getSenderNumber(senderJid);
        const isPrivate = !senderJid.endsWith('@g.us');
        
        if (!isPrivate) return; // Only forward private messages to admin

        const content = cachedMsg.content;
        if (!content) return;

        const timeStr = new Date(cachedMsg.timestamp).toLocaleString('fr-FR', {
            timeZone: config.timezone || 'Africa/Douala'
        });

        const notification = `🗑️ *Message supprimé détecté*\n\n` +
            `👤 *Expéditeur:* ${senderNum}\n` +
            `⏰ *À:* ${timeStr}\n`;

        if (content.conversation) {
            await sock.sendMessage(ownerJid, {
                text: `${notification}\n📝 *Message:*\n${content.conversation}`
            });
        } else if (content.extendedTextMessage?.text) {
            await sock.sendMessage(ownerJid, {
                text: `${notification}\n📝 *Message:*\n${content.extendedTextMessage.text}`
            });
        } else if (content.imageMessage) {
            await sock.sendMessage(ownerJid, {
                text: `${notification}\n🖼️ *Image supprimée*`
            });
        } else if (content.videoMessage) {
            await sock.sendMessage(ownerJid, {
                text: `${notification}\n🎥 *Vidéo supprimée*`
            });
        } else if (content.audioMessage) {
            await sock.sendMessage(ownerJid, {
                text: `${notification}\n🎵 *Audio supprimé*`
            });
        } else if (content.documentMessage) {
            await sock.sendMessage(ownerJid, {
                text: `${notification}\n📄 *Document supprimé:* ${content.documentMessage.fileName || 'fichier'}`
            });
        } else if (content.stickerMessage) {
            await sock.sendMessage(ownerJid, {
                text: `${notification}\n🖼️ *Sticker supprimé*`
            });
        } else {
            await sock.sendMessage(ownerJid, {
                text: `${notification}\n⚠️ *Type de message non supporté*`
            });
        }
    } catch (error) {
        console.error('[AntiDelete] Error forwarding to admin:', error.message);
    }
}

// Initialize on load
initDB();

module.exports = {
    isEnabled,
    setEnabled,
    cacheMessage,
    handleDelete,
    isDeletionEvent,
    getSavedMessages: () => readDB().savedMessages || [],
    clearSavedMessages: () => {
        const data = readDB();
        data.savedMessages = [];
        writeDB(data);
    }
};
