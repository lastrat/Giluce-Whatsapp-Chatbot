/**
 * Message Handler - Processes incoming messages and executes commands
 * Based on KnightBot-Mini structure
 */

const config = require('../config');
const database = require('./database');
const { loadCommands, getCommand } = require('./utils/commandLoader');
const { addMessage } = require('./utils/groupstats');
const { jidDecode, jidEncode, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

// Group metadata cache
const groupMetadataCache = new Map();
const CACHE_TTL = 60000;

// Load all commands
const commands = loadCommands();

// Unwrap WhatsApp containers
const getMessageContent = (msg) => {
    if (!msg || !msg.message) return null;
    
    let m = msg.message;
    if (m.ephemeralMessage) m = m.ephemeralMessage.message;
    if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
    if (m.viewOnceMessage) m = m.viewOnceMessage.message;
    if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
    
    return m;
};

const hasViewOnce = (msg) => {
    if (!msg || !msg.message) return false;
    const m = msg.message;
    const inner = m.ephemeralMessage?.message || m;
    const quoted =
        m.extendedTextMessage?.contextInfo?.quotedMessage ||
        m.imageMessage?.contextInfo?.quotedMessage ||
        m.videoMessage?.contextInfo?.quotedMessage ||
        m.audioMessage?.contextInfo?.quotedMessage ||
        m.reactionMessage?.contextInfo?.quotedMessage ||
        m.reactionMessage?.quotedMessage ||
        m.messageContextInfo?.quotedMessage ||
        m.documentWithCaptionMessage?.contextInfo?.quotedMessage;

    const viewOnceCandidates = [
        inner.viewOnceMessageV2,
        inner.viewOnceMessageV2Extension,
        inner.viewOnceMessage,
        inner.viewOnce,
        inner.imageMessage?.viewOnce && inner.imageMessage,
        inner.videoMessage?.viewOnce && inner.videoMessage,
        inner.audioMessage?.viewOnce && inner.audioMessage,
        inner.documentMessage?.viewOnce && inner.documentMessage,
        inner.documentWithCaptionMessage?.message?.viewOnceMessageV2,
        inner.documentWithCaptionMessage?.message?.viewOnceMessageV2Extension,
        inner.documentWithCaptionMessage?.message?.viewOnceMessage,
        inner.ptvMessage?.viewOnce,
        inner.albumMessage?.viewOnce,
        quoted?.viewOnceMessageV2,
        quoted?.viewOnceMessageV2Extension,
        quoted?.viewOnceMessage,
        quoted?.viewOnce,
        quoted?.imageMessage?.viewOnce && quoted.imageMessage,
        quoted?.videoMessage?.viewOnce && quoted.videoMessage,
        quoted?.audioMessage?.viewOnce && quoted.audioMessage,
        quoted?.documentMessage?.viewOnce && quoted.documentMessage,
        quoted?.documentWithCaptionMessage?.message?.viewOnceMessageV2,
        quoted?.documentWithCaptionMessage?.message?.viewOnceMessageV2Extension,
        quoted?.documentWithCaptionMessage?.message?.viewOnceMessage,
        quoted?.ptvMessage?.viewOnce,
        quoted?.albumMessage?.viewOnce,
        m.senderKeyDistributionMessage?.viewOnce,
    ];

    if (viewOnceCandidates.some(Boolean)) return true;

    const findDeep = (node, depth = 0) => {
        if (!node || typeof node !== 'object' || depth > 6) return false;
        if (node.viewOnceMessageV2 || node.viewOnceMessageV2Extension || node.viewOnceMessage || node.viewOnce) return true;
        if (node.imageMessage?.viewOnce || node.videoMessage?.viewOnce || node.audioMessage?.viewOnce || node.documentMessage?.viewOnce) return true;
        if (node.documentWithCaptionMessage?.message?.viewOnceMessageV2 ||
            node.documentWithCaptionMessage?.message?.viewOnceMessageV2Extension ||
            node.documentWithCaptionMessage?.message?.viewOnceMessage) return true;
        if (node.reactionMessage?.contextInfo?.quotedMessage && hasViewOnce({ message: node.reactionMessage.contextInfo.quotedMessage })) return true;
        return Object.values(node).some((v) => findDeep(v, depth + 1));
    };

    return findDeep(m);
};


const extractViewOnceMessage = (msg) => {
    const m = msg.message;
    const inner = m.ephemeralMessage?.message || m;
    const quoted =
        m.extendedTextMessage?.contextInfo?.quotedMessage ||
        m.imageMessage?.contextInfo?.quotedMessage ||
        m.videoMessage?.contextInfo?.quotedMessage ||
        m.audioMessage?.contextInfo?.quotedMessage ||
        m.reactionMessage?.contextInfo?.quotedMessage ||
        m.reactionMessage?.quotedMessage ||
        m.messageContextInfo?.quotedMessage ||
        m.documentWithCaptionMessage?.contextInfo?.quotedMessage;

    const source = quoted || inner;

    if (source.viewOnceMessageV2Extension?.message) {
        return { actualMsg: source.viewOnceMessageV2Extension.message, mtype: Object.keys(source.viewOnceMessageV2Extension.message)[0] };
    } else if (source.viewOnceMessageV2?.message) {
        return { actualMsg: source.viewOnceMessageV2.message, mtype: Object.keys(source.viewOnceMessageV2.message)[0] };
    } else if (source.viewOnceMessage?.message) {
        return { actualMsg: source.viewOnceMessage.message, mtype: Object.keys(source.viewOnceMessage.message)[0] };
    } else if (source.imageMessage?.viewOnce) {
        return { actualMsg: { imageMessage: source.imageMessage }, mtype: 'imageMessage' };
    } else if (source.videoMessage?.viewOnce) {
        return { actualMsg: { videoMessage: source.videoMessage }, mtype: 'videoMessage' };
    } else if (source.audioMessage?.viewOnce) {
        return { actualMsg: { audioMessage: source.audioMessage }, mtype: 'audioMessage' };
    } else if (source.documentMessage?.viewOnce) {
        return { actualMsg: { documentMessage: source.documentMessage }, mtype: 'documentMessage' };
    } else if (source.ptvMessage?.viewOnce) {
        return { actualMsg: { ptvMessage: source.ptvMessage }, mtype: 'ptvMessage' };
    } else if (source.albumMessage?.viewOnce) {
        return { actualMsg: { albumMessage: source.albumMessage }, mtype: 'albumMessage' };
    }
    return null;
};

const sendMediaBuffer = async (sock, to, mtype, buffer, caption) => {
    if (mtype === 'imageMessage') {
        return sock.sendMessage(to, { image: buffer, caption, mimetype: 'image/jpeg' });
    } else if (mtype === 'videoMessage') {
        return sock.sendMessage(to, { video: buffer, caption, mimetype: 'video/mp4' });
    } else if (mtype === 'audioMessage') {
        return sock.sendMessage(to, { audio: buffer, ptt: true, mimetype: 'audio/ogg; codecs=opus' });
    } else if (mtype === 'documentMessage') {
        return sock.sendMessage(to, { document: buffer, caption, mimetype: 'application/pdf' });
    } else if (mtype === 'ptvMessage') {
        return sock.sendMessage(to, { video: buffer, caption, mimetype: 'video/mp4' });
    }
};

const dumpObjectKeys = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 3) return '';
    const indent = '  '.repeat(depth);
    let out = '';
    for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object' && !Buffer.isBuffer(v)) {
            out += `${indent}${k}:\n${dumpObjectKeys(v, depth + 1)}`;
        } else {
            out += `${indent}${k}\n`;
        }
    }
    return out;
};

const getSenderNumber = (msg, from) => {
    const senderJid = msg?.key?.participant || from;
    if (!senderJid) return null;
    const normalized = normalizeJidWithLid(senderJid);
    return normalized.split('@')[0];
};

const formatSenderNumber = (num) => {
    if (!num) return 'inconnu';
    if (num.startsWith('237')) {
        return `+${num.slice(0,3)} ${num.slice(3,6)} ${num.slice(6,9)} ${num.slice(9)}`;
    }
    return num;
};

const handleAutoViewOnce = async (sock, msg, from) => {
    try {
        const isGroup = from.endsWith('@g.us');
        const isStatusBroadcast = from === 'status@broadcast';
        const fromLabel = isStatusBroadcast ? 'status broadcast' : isGroup ? `group ${from}` : `private chat ${from}`;
        console.log(`[AutoViewOnce] received message in ${fromLabel}, msg.message keys: ${msg.message ? Object.keys(msg.message).join(',') : 'none'}`);

        delete require.cache[require.resolve('../config')];
        const cfg = require('../config');
        const ownerJid = (cfg.ownerNumber && cfg.ownerNumber[0]) ? `${cfg.ownerNumber[0]}@s.whatsapp.net` : from;

        const groupSettings = isGroup ? database.getGroupSettings(from) : null;
        const enabled = isGroup ? groupSettings?.antiviewonce : cfg.antiviewonce;

        console.log(`[AutoViewOnce] enabled=${enabled} (${isGroup ? 'group' : isStatusBroadcast ? 'status broadcast' : 'private'})`);

        if (!enabled) return;

        const hasView = hasViewOnce(msg);
        console.log(`[AutoViewOnce] hasViewOnce=${hasView}`);

        if (!hasView && isStatusBroadcast) {
            if (msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.audioMessage || msg.message?.documentMessage) {
                const mtype = msg.message.imageMessage ? 'imageMessage' : msg.message.videoMessage ? 'videoMessage' : msg.message.audioMessage ? 'audioMessage' : 'documentMessage';
                const downloadType = mtype === 'imageMessage' ? 'image' : mtype === 'videoMessage' ? 'video' : mtype === 'audioMessage' ? 'audio' : 'document';
                console.log(`[AutoViewOnce] statusBroadcast_mtype=${mtype}`);
                console.log(`[AutoViewOnce] statusBroadcast_downloading ${downloadType}...`);
                const mediaStream = await downloadContentFromMessage(msg.message[mtype], downloadType);
                let buffer = Buffer.from([]);
                for await (const chunk of mediaStream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                console.log(`[AutoViewOnce] statusBroadcast_downloaded ${buffer.length} bytes, sending...`);
                const captionBase = msg.message[mtype]?.caption || '';
                const senderNum = formatSenderNumber(getSenderNumber(msg, from));
                const caption = captionBase ? `${captionBase}\n\n📱 Expéditeur: ${senderNum}` : `📱 Expéditeur: ${senderNum}`;
                await sendMediaBuffer(sock, ownerJid, mtype.replace('Message', ''), buffer, caption);
                console.log(`[AutoViewOnce] statusBroadcast_sent successfully`);
                return;
            }
        }

        if (!hasView) {
            if (msg.message?.reactionMessage) {
                console.log(`[AutoViewOnce] reactionText=${msg.message.reactionMessage.text}`);
                const q = msg.message.reactionMessage.contextInfo?.quotedMessage || msg.message.reactionMessage.quotedMessage;
                if (q) {
                    console.log(`[AutoViewOnce] quotedKeys=${Object.keys(q).join(',')}`);
                    console.log(`[AutoViewOnce] quotedHasViewOnce=${hasViewOnce({ message: q })}`);
                    const reactionExtracted = extractViewOnceMessage({ message: q });
                    if (reactionExtracted) {
                        console.log(`[AutoViewOnce] reaction_extracted=${reactionExtracted.mtype}`);
                        const { actualMsg, mtype } = reactionExtracted;
                        const downloadType = mtype === 'imageMessage' ? 'image' : mtype === 'videoMessage' ? 'video' : mtype === 'audioMessage' ? 'audio' : 'document';
                        console.log(`[AutoViewOnce] reaction_downloading ${downloadType}...`);
                        const mediaStream = await downloadContentFromMessage(actualMsg[mtype], downloadType);
                        let buffer = Buffer.from([]);
                        for await (const chunk of mediaStream) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }
                        console.log(`[AutoViewOnce] reaction_downloaded ${buffer.length} bytes, sending...`);
                        const captionBase = actualMsg[mtype]?.caption || '';
                        const senderNum = formatSenderNumber(getSenderNumber(msg, from));
                        const caption = captionBase ? `${captionBase}\n\n📱 Expéditeur: ${senderNum}` : `📱 Expéditeur: ${senderNum}`;
                        await sendMediaBuffer(sock, ownerJid, mtype, buffer, caption);
                        console.log(`[AutoViewOnce] reaction_sent successfully`);
                        return;
                    }
                } else {
                    const ci = msg.message.reactionMessage.contextInfo;
                    console.log(`[AutoViewOnce] contextInfoKeys=${ci ? Object.keys(ci).join(',') : 'none'}`);
                }
                console.log(`[AutoViewOnce] reactionKeys=${Object.keys(msg.message.reactionMessage).join(',')}`);
                console.log(`[AutoViewOnce] reactionDump:\n${dumpObjectKeys(msg.message.reactionMessage)}`);
            }
            if (msg.message?.messageContextInfo) {
                console.log(`[AutoViewOnce] messageContextInfoKeys=${Object.keys(msg.message.messageContextInfo).join(',')}`);
                const q = msg.message.messageContextInfo.quotedMessage;
                if (q) {
                    console.log(`[AutoViewOnce] mciQuotedKeys=${Object.keys(q).join(',')}`);
                    console.log(`[AutoViewOnce] mciQuotedHasViewOnce=${hasViewOnce({ message: q })}`);
                }
                console.log(`[AutoViewOnce] messageContextInfoDump:\n${dumpObjectKeys(msg.message.messageContextInfo)}`);
            }
            if (msg.message?.senderKeyDistributionMessage) {
                console.log(`[AutoViewOnce] senderKeyDistributionMessage keys=${Object.keys(msg.message.senderKeyDistributionMessage).join(',')}`);
                console.log(`[AutoViewOnce] senderKeyDistributionMessageDump:\n${dumpObjectKeys(msg.message.senderKeyDistributionMessage)}`);
            }
            return;
        }

        const extracted = extractViewOnceMessage(msg);
        console.log(`[AutoViewOnce] extracted=${extracted ? extracted.mtype : 'null'}`);

        if (!extracted) {
            console.log(`[AutoViewOnce] extraction_failed messageKeys=${Object.keys(msg.message).join(',')}`);
            return;
        }

        const { actualMsg, mtype } = extracted;

        const downloadType = mtype === 'imageMessage' ? 'image' : mtype === 'videoMessage' ? 'video' : mtype === 'audioMessage' ? 'audio' : 'document';
        console.log(`[AutoViewOnce] downloading ${downloadType}...`);

        const mediaStream = await downloadContentFromMessage(actualMsg[mtype], downloadType);

        let buffer = Buffer.from([]);
        for await (const chunk of mediaStream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        console.log(`[AutoViewOnce] downloaded ${buffer.length} bytes, sending...`);

        const captionBase = actualMsg[mtype]?.caption || '';
        const senderNum = formatSenderNumber(getSenderNumber(msg, from));
        const caption = captionBase ? `${captionBase}\n\n📱 Expéditeur: ${senderNum}` : `📱 Expéditeur: ${senderNum}`;
        await sendMediaBuffer(sock, ownerJid, mtype, buffer, caption);

        console.log(`[AutoViewOnce] sent successfully`);
    } catch (error) {
        console.error('[AutoViewOnce Error]', error);
    }
};

// Get cached group metadata
const getCachedGroupMetadata = async (sock, groupId) => {
    try {
        if (!groupId || !groupId.endsWith('@g.us')) return null;
        
        const cached = groupMetadataCache.get(groupId);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.data;
        }
        
        const metadata = await sock.groupMetadata(groupId);
        groupMetadataCache.set(groupId, {
            data: metadata,
            timestamp: Date.now()
        });
        
        return metadata;
    } catch (error) {
        if (error.message?.includes('forbidden') || error.status === 403) {
            groupMetadataCache.set(groupId, { data: null, timestamp: Date.now() });
            return null;
        }
        const cached = groupMetadataCache.get(groupId);
        return cached?.data || null;
    }
};

// Live group metadata (always fresh)
const getLiveGroupMetadata = async (sock, groupId) => {
    try {
        const metadata = await sock.groupMetadata(groupId);
        groupMetadataCache.set(groupId, { data: metadata, timestamp: Date.now() });
        return metadata;
    } catch (error) {
        const cached = groupMetadataCache.get(groupId);
        return cached?.data || null;
    }
};

// Helper functions
const isOwner = (sender) => {
    if (!sender) return false;
    
    // Extract phone number from sender JID
    let senderNumber = sender.split('@')[0];
    
    // Handle device IDs (format: number:device)
    if (senderNumber.includes(':')) {
        senderNumber = senderNumber.split(':')[0];
    }
    
    // Check against owner numbers
    return config.ownerNumber.some(owner => {
        // Extract owner number
        let ownerNumber = owner.includes('@') ? owner.split('@')[0] : owner;
       
        // Compare numbers (direct match)
        return senderNumber === ownerNumber;
    });
};

const isMod = (sender) => {
    const number = sender?.split('@')[0];
    return database.isModerator(number);
};

// Normalize JID
const normalizeJid = (jid) => {
    if (!jid || typeof jid !== 'string') return null;
    if (jid.includes(':')) return jid.split(':')[0];
    if (jid.includes('@')) return jid.split('@')[0];
    return jid;
};

// LID mapping
const lidMappingCache = new Map();

const getLidMappingValue = (user, direction) => {
    if (!user) return null;
    
    const cacheKey = `${direction}:${user}`;
    if (lidMappingCache.has(cacheKey)) {
        return lidMappingCache.get(cacheKey);
    }
    
    const sessionPath = path.join(__dirname, '../../sessions');
    const suffix = direction === 'pnToLid' ? '.json' : '_reverse.json';
    const filePath = path.join(sessionPath, `lid-mapping-${user}${suffix}`);
    
    if (!fs.existsSync(filePath)) {
        lidMappingCache.set(cacheKey, null);
        return null;
    }
    
    try {
        const raw = fs.readFileSync(filePath, 'utf8').trim();
        const value = raw ? JSON.parse(raw) : null;
        lidMappingCache.set(cacheKey, value || null);
        return value || null;
    } catch (error) {
        lidMappingCache.set(cacheKey, null);
        return null;
    }
};

const normalizeJidWithLid = (jid) => {
    if (!jid) return jid;
    
    try {
        // Handle undefined or null from jidDecode
        let decoded;
        try {
            decoded = jidDecode(jid);
        } catch (e) {
            // If jidDecode fails, try to parse manually
            const parts = jid.split('@');
            if (parts.length === 2) {
                return jid; // Return as-is if we can't parse
            }
            return `${parts[0]}@s.whatsapp.net`;
        }
        
        // Handle undefined decoded result
        if (!decoded || typeof decoded !== 'object') {
            // Try to extract user from JID manually
            const userPart = jid.split('@')[0];
            return userPart ? `${userPart}@s.whatsapp.net` : jid;
        }
        
        if (!decoded?.user) {
            // Try to get user from JID string
            const userFromJid = jid.split(':')[0].split('@')[0];
            return userFromJid ? `${userFromJid}@s.whatsapp.net` : jid;
        }
        
        let user = decoded.user;
        let server = decoded.server === 'c.us' ? 's.whatsapp.net' : decoded.server;
        
        const mapToPn = () => {
            const pnUser = getLidMappingValue(user, 'lidToPn');
            if (pnUser) {
                user = pnUser;
                server = server === 'hosted.lid' ? 'hosted' : 's.whatsapp.net';
                return true;
            }
            return false;
        };
        
        if (server === 'lid' || server === 'hosted.lid') {
            mapToPn();
        } else if (server === 's.whatsapp.net' || server === 'hosted') {
            mapToPn();
        }
        
        if (server === 'hosted') return jidEncode(user, 'hosted');
        return jidEncode(user, 's.whatsapp.net');
    } catch (error) {
        return jid;
    }
};

// Build comparable JIDs
const buildComparableIds = (jid) => {
    if (!jid) return [];
    
    try {
        let decoded;
        try {
            decoded = jidDecode(jid);
        } catch (e) {
            // If jidDecode fails, return the JID as-is
            return [jid];
        }
        
        // Handle undefined decoded result
        if (!decoded || typeof decoded !== 'object' || !decoded?.user) {
            return [normalizeJidWithLid(jid)].filter(Boolean);
        }
        
        const variants = new Set();
        const normalizedServer = decoded.server === 'c.us' ? 's.whatsapp.net' : decoded.server;
        
        variants.add(jidEncode(decoded.user, normalizedServer));
        
        const isPnServer = normalizedServer === 's.whatsapp.net' || normalizedServer === 'hosted';
        const isLidServer = normalizedServer === 'lid' || normalizedServer === 'hosted.lid';
        
        if (isPnServer) {
            const lidUser = getLidMappingValue(decoded.user, 'pnToLid');
            if (lidUser) {
                const lidServer = normalizedServer === 'hosted' ? 'hosted.lid' : 'lid';
                variants.add(jidEncode(lidUser, lidServer));
            }
        } else if (isLidServer) {
            const pnUser = getLidMappingValue(decoded.user, 'lidToPn');
            if (pnUser) {
                const pnServer = normalizedServer === 'hosted.lid' ? 'hosted' : 's.whatsapp.net';
                variants.add(jidEncode(pnUser, pnServer));
            }
        }
        
        return Array.from(variants);
    } catch (error) {
        return [jid];
    }
};

// Find participant
const findParticipant = (participants = [], userIds) => {
    const targets = (Array.isArray(userIds) ? userIds : [userIds])
        .filter(Boolean)
        .flatMap(id => buildComparableIds(id));
    
    if (!targets.length) return null;
    
    return participants.find(participant => {
        if (!participant) return false;
        
        const participantIds = [participant.id, participant.lid, participant.userJid]
            .filter(Boolean)
            .flatMap(id => buildComparableIds(id));
        
        return participantIds.some(id => targets.includes(id));
    }) || null;
};

const isAdmin = async (sock, participant, groupId, groupMetadata = null) => {
    if (!participant) return false;
    if (!groupId || !groupId.endsWith('@g.us')) return false;
    
    let liveMetadata = groupMetadata;
    if (!liveMetadata || !liveMetadata.participants) {
        if (groupId) {
            liveMetadata = await getLiveGroupMetadata(sock, groupId);
        } else {
            return false;
        }
    }
    
    if (!liveMetadata || !liveMetadata.participants) return false;
    
    const foundParticipant = findParticipant(liveMetadata.participants, participant);
    if (!foundParticipant) return false;
    
    return foundParticipant.admin === 'admin' || foundParticipant.admin === 'superadmin';
};

const isBotAdmin = async (sock, groupId, groupMetadata = null) => {
    if (!sock.user || !groupId) return false;
    if (!groupId.endsWith('@g.us')) return false;
    
    try {
        const botId = sock.user.id;
        const botLid = sock.user.lid;
        
        if (!botId) return false;
        
        const botJids = [botId];
        if (botLid) botJids.push(botLid);
        
        const liveMetadata = await getLiveGroupMetadata(sock, groupId);
        if (!liveMetadata || !liveMetadata.participants) return false;
        
        const participant = findParticipant(liveMetadata.participants, botJids);
        if (!participant) return false;
        
        return participant.admin === 'admin' || participant.admin === 'superadmin';
    } catch (error) {
        return false;
    }
};

const isUrl = (text) => {
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    return urlRegex.test(text);
};

const hasGroupLink = (text) => {
    const linkRegex = /chat.whatsapp.com\/([0-9A-Za-z]{20,24})/i;
    return linkRegex.test(text);
};

const isSystemJid = (jid) => {
    if (!jid) return true;
    return jid.includes('@broadcast') || 
           jid.includes('status.broadcast') || 
           jid.includes('@newsletter') ||
           jid.includes('@newsletter.');
};

// ==================== MAIN MESSAGE HANDLER ====================

const handleMessage = async (sock, msg) => {
    try {
        // Check if socket is fully authenticated and ready
        if (!sock.user || !sock.user.id) {
            console.log('Socket not ready, skipping message');
            return;
        }
        
        if (!msg.message) return;
        
        const from = msg.key.remoteJid;
        
        // Validate JID format
        if (!from || !from.includes('@')) {
            return;
        }
        
        // Log every incoming message for debugging
        const msgKeys = Object.keys(msg.message).join(',');
        console.log(`[handleMessage] from=${from} type=${msgKeys}`);
        
        // Filter system messages
        if (isSystemJid(from)) return;
        
        // Handle group participant join - send service menu
        if (msg.messageStubType && msg.messageStubType.includes('GROUP_PARTICIPANT_ADD')) {
            try {
// DISABLED:                const serviceCmd = getCommand('service');
// DISABLED:                if (serviceCmd && serviceCmd.sendInteractiveMenu) {
                    const participants = msg.messageStubParameters || [];
                    for (const participant of participants) {
                        try {
                            const pData = typeof participant === 'string' ? JSON.parse(participant) : participant;
                            if (pData?.id) {
// DISABLED:                                await serviceCmd.sendInteractiveMenu(sock, pData.id, 'main');
                            }
                        } catch (e) {
                            console.error('[WelcomeParse Error]', e.message);
                        }
                    }
// DISABLED:                 }
            } catch (e) {
                console.error('[GroupWelcome Error]', e.message);
            }
            return;
        }
        
        // Auto ViewOnce
        await handleAutoViewOnce(sock, msg, from);
        
        // Auto-React
        try {
            delete require.cache[require.resolve('../config')];
            const cfg = require('../config');
            
            if (cfg.autoReact && msg.message && !msg.key.fromMe) {
                const content = msg.message.ephemeralMessage?.message || msg.message;
                const text = content.conversation || content.extendedTextMessage?.text || '';
                
                const emojis = ['❤️', '🔥', '👌', '💀', '😁', '✨', '👍', '🤨', '😎', '😂'];
                const mode = cfg.autoReactMode || 'bot';
                
                if (mode === 'bot') {
                    const prefixList = ['.', '/', '#'];
                    if (prefixList.includes(text?.trim()[0])) {
                        await sock.sendMessage(from, {
                            react: { text: '⏳', key: msg.key }
                        });
                    }
                }
                
                if (mode === 'all') {
                    const rand = emojis[Math.floor(Math.random() * emojis.length)];
                    await sock.sendMessage(from, {
                        react: { text: rand, key: msg.key }
                    });
                }
            }
        } catch (e) {
            console.error('[AutoReact Error]', e.message);
        }
        
        // Unwrap message
        const content = getMessageContent(msg);
        
        let actualMessageTypes = [];
        if (content) {
            const allKeys = Object.keys(content);
            const protocolMessages = ['protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo'];
            actualMessageTypes = allKeys.filter(key => !protocolMessages.includes(key));
        }
        
        if (!content || actualMessageTypes.length === 0) return;
        
        const messageType = actualMessageTypes[0];
        
        // Compute sender with validation
        let sender = msg.key.fromMe 
            ? sock.user.id.split(':')[0] + '@s.whatsapp.net' 
            : msg.key.participant || msg.key.remoteJid;
        
        // Validate and normalize sender
        if (sender && sender.includes('@')) {
            try {
                sender = normalizeJidWithLid(sender);
            } catch (e) {
                sender = msg.key.remoteJid; // Fallback to from
            }
        } else {
            sender = msg.key.remoteJid;
        }
        
        const isGroup = from.endsWith('@g.us');
        
        const groupMetadata = isGroup ? await getCachedGroupMetadata(sock, from) : null;
        
        // Track group messages
        if (isGroup) {
            addMessage(from, sender);
        }
        
        // Anti-group mention
        if (isGroup) {
            const groupSettings = database.getGroupSettings(from);
            if (groupSettings.antigroupmention) {
                await handleAntigroupmention(sock, msg, groupMetadata);
            }
        }
        
        // Auto-reply check
        if (isGroup && !msg.key.fromMe) {
            try {
                const autoreplyCmd = require('../commands/automation/autoreply');
                if (autoreplyCmd.checkAutoreply) {
                    const body = content?.conversation || content?.extendedTextMessage?.text || '';
                    if (body) {
                        await autoreplyCmd.checkAutoreply(sock, msg, body);
                    }
                }
            } catch (error) {
                // Silently ignore autoreply errors
            }
        }
        
        // Check for button responses
        const btn = content.buttonsResponseMessage || msg.message?.buttonsResponseMessage;
        if (btn) {
            const buttonId = btn.selectedButtonId;
            
            if (buttonId === 'btn_menu') {
                    const menuCmd = getCommand('menu');
                    if (menuCmd) {
                        const context = await createContext(sock, msg, from, sender, isGroup, groupMetadata);
                        await menuCmd.execute(sock, msg, [], context);
                    }
                    return;
                }
        }
        
// DISABLED:        // Handle service menu interactive responses
// DISABLED:        try {
// DISABLED:            const serviceCmd = getCommand('service');
// DISABLED:            if (serviceCmd && serviceCmd.handleServiceResponse) {
// DISABLED:                const btnContext = { sock, msg, from, sender, isGroup, groupMetadata, content };
// DISABLED:                const handled = await serviceCmd.handleServiceResponse(sock, msg, btnContext);
// DISABLED:                if (handled) {
// DISABLED:                    console.log(`[ServiceMenu] handled response from ${from}`);
// DISABLED:                    return;
// DISABLED:                }
// DISABLED:            }
// DISABLED:        } catch (e) {
// DISABLED:            console.error('[ServiceMenu Error]', e.message);
// DISABLED:        }
        
// DISABLED:        // Debug: log any interactive response that wasn't handled
// DISABLED:        if (msg.message?.interactiveResponseMessage) {
// DISABLED:            console.log(`[ServiceMenu] unhandled interactiveResponseMessage from=${from} keys=${Object.keys(msg.message.interactiveResponseMessage).join(',')}`);
// DISABLED:        }
// DISABLED:        if (content?.interactiveResponseMessage) {
// DISABLED:            console.log(`[ServiceMenu] unhandled content.interactiveResponseMessage from=${from} keys=${Object.keys(content.interactiveResponseMessage).join(',')}`);
// DISABLED:        }
        
// DISABLED:        // Debug: log if content has interactiveResponseMessage but handleServiceResponse returned false
// DISABLED:        if (content?.interactiveResponseMessage?.nativeFlowResponseMessage) {
// DISABLED:            console.log(`[ServiceMenu] content has nativeFlowResponseMessage but handleServiceResponse returned false`);
// DISABLED:            console.log(`[ServiceMenu] nativeFlowResponseMessage keys=${Object.keys(content.interactiveResponseMessage.nativeFlowResponseMessage).join(',')}`);
// DISABLED:            console.log(`[ServiceMenu] paramsJson=${content.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson}`);
// DISABLED:        }
        
        // Get message body
        let body = '';
        if (content.conversation) {
            body = content.conversation;
        } else if (content.extendedTextMessage) {
            body = content.extendedTextMessage.text || '';
        } else if (content.imageMessage) {
            body = content.imageMessage.caption || '';
        } else if (content.videoMessage) {
            body = content.videoMessage.caption || '';
        }
        
        body = (body || '').trim();
        
        // Anti-all protection
        if (isGroup) {
            const groupSettings = database.getGroupSettings(from);
            if (groupSettings.antiall) {
                const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
                const senderIsOwner = isOwner(sender);
                
                if (!senderIsAdmin && !senderIsOwner) {
                    const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
                    if (botIsAdmin) {
                        await sock.sendMessage(from, { delete: msg.key });
                        return;
                    }
                }
            }
        }
        
        // Anti-tag
        if (isGroup) {
            const groupSettings = database.getGroupSettings(from);
            if (groupSettings.antitag && !msg.key.fromMe) {
                const ctx = content.extendedTextMessage?.contextInfo;
                const mentionedJids = ctx?.mentionedJid || [];
                
                const messageText = body || content.imageMessage?.caption || content.videoMessage?.caption || '';
                const textMentions = messageText.match(/@[\d+\s\-()~.]+/g) || [];
                const numericMentions = messageText.match(/@(\d{10,})/g) || [];
                
                const totalMentions = Math.max(mentionedJids.length, numericMentions.length);
                
                if (totalMentions >= 3) {
                    const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
                    const senderIsOwner = isOwner(sender);
                    
                    if (!senderIsAdmin && !senderIsOwner) {
                        const action = (groupSettings.antitagAction || 'delete').toLowerCase();
                        
                        if (action === 'delete') {
                            try {
                                await sock.sendMessage(from, { delete: msg.key });
                            } catch (e) {}
                        } else if (action === 'kick') {
                            const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
                            if (botIsAdmin) {
                                try {
                                    await sock.groupParticipantsUpdate(from, [sender], 'remove');
                                } catch (e) {}
                            }
                        }
                        return;
                    }
                }
            }
        }
        
        // Auto-sticker
        if (isGroup) {
            const groupSettings = database.getGroupSettings(from);
            if (groupSettings.autosticker) {
                const mediaMessage = content?.imageMessage || content?.videoMessage;
                if (mediaMessage && !body.startsWith(config.prefix)) {
                    const stickerCmd = getCommand('sticker');
                    if (stickerCmd) {
                        try {
                            const context = await createContext(sock, msg, from, sender, isGroup, groupMetadata);
                            await stickerCmd.execute(sock, msg, [], context);
                            return;
                        } catch (error) {
                            console.error('[AutoSticker Error]:', error.message);
                        }
                    }
                }
            }
        }
        
        // Check prefix
        if (!body.startsWith(config.prefix)) return;
        
        // Parse command
        const args = body.slice(config.prefix.length).trim().split(/\s+/);
        const commandName = args.shift().toLowerCase();
        
        // Get command
        const command = getCommand(commandName);
        if (!command) return;
        
        // Permission checks
        if (config.selfMode && !isOwner(sender)) return;
        
        if (command.ownerOnly && !isOwner(sender)) {
            console.log(`Unauthorized command attempt: ${commandName} by ${sender}`);
            return sock.sendMessage(from, { text: config.messages.ownerOnly }, { quoted: msg });
        }
        
        if (command.modOnly && !isMod(sender) && !isOwner(sender)) {
            return sock.sendMessage(from, { text: '🔒 This command is only for moderators!' }, { quoted: msg });
        }
        
        if (command.groupOnly && !isGroup) {
            return sock.sendMessage(from, { text: config.messages.groupOnly }, { quoted: msg });
        }
        
        if (command.privateOnly && isGroup) {
            return sock.sendMessage(from, { text: config.messages.privateOnly }, { quoted: msg });
        }
        
        if (command.adminOnly && !(await isAdmin(sock, sender, from, groupMetadata)) && !isOwner(sender)) {
            return sock.sendMessage(from, { text: config.messages.adminOnly }, { quoted: msg });
        }
        
        if (command.botAdminNeeded) {
            const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
            if (!botIsAdmin) {
                return sock.sendMessage(from, { text: config.messages.botAdminNeeded }, { quoted: msg });
            }
        }
        
        // Auto-typing
        if (config.autoTyping) {
            await sock.sendPresenceUpdate('composing', from);
        }
        
        // Execute command
        console.log(`Executing command: ${commandName} from ${sender}`);
        
        try {
            const context = await createContext(sock, msg, from, sender, isGroup, groupMetadata);
            await command.execute(sock, msg, args, context);
        } catch (cmdError) {
            console.error(`Error executing command ${commandName}:`, cmdError.message);
            console.error(cmdError.stack);
            try {
                // Try to send error message without quoted to avoid jidDecode issues
                await sock.sendMessage(from, { text: '❌ Une erreur est survenue lors de l\'exécution de la commande.' });
            } catch (e) {
                console.error('Failed to send error message:', e.message);
            }
        }
        
    } catch (error) {
        console.error('Error in message handler:', error);
    }
};

// Create context object for commands
const createContext = async (sock, msg, from, sender, isGroup, groupMetadata) => {
    // Validate inputs
    if (!from || !from.includes('@')) {
        from = msg.key.remoteJid;
    }

    // console.log('Creating context for:', { from, sender, isGroup });
    
    return {
        from,
        sender,
        isGroup,
        groupMetadata,
        isOwner: isOwner(sender),
        isAdmin: await isAdmin(sock, sender, from, groupMetadata),
        isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
        isMod: isMod(sender),
        reply: (text) => {
            if (!from || !from.includes('@')) return Promise.resolve();
            return sock.sendMessage(from, { text }, { quoted: msg });
        }
        // ,react: (emoji) => {
        //     if (!from || !from.includes('@')) return Promise.resolve();
        //     return sock.sendMessage(from, { react: { text: emoji, key: msg.key } });
        // }
    };
};

// ==================== GROUP UPDATE HANDLER ====================

const handleGroupUpdate = async (sock, update) => {
    try {
        const { id, participants, action } = update;
        
        if (!id || !id.endsWith('@g.us')) return;
        
        const groupSettings = database.getGroupSettings(id);
        
        if (!groupSettings.welcome && !groupSettings.goodbye) return;
        
        const groupMetadata = await getCachedGroupMetadata(sock, id);
        if (!groupMetadata) return;
        
        for (const participant of participants) {
            const participantJid = typeof participant === 'string' ? participant : participant.id;
            if (!participantJid) continue;
            
            const participantNumber = participantJid.split('@')[0];
            
            if (action === 'add' && groupSettings.welcome) {
                try {
                    let displayName = participantNumber;
                    
                    const participantInfo = groupMetadata.participants?.find(p => {
                        const pId = p.id || p.jid || p.participant;
                        return pId === participantJid || pId?.split('@')[0] === participantNumber;
                    });
                    
                    if (participantInfo?.notify) {
                        displayName = participantInfo.notify;
                    } else if (participantInfo?.name) {
                        displayName = participantInfo.name;
                    }
                    
                    let profilePicUrl = '';
                    try {
                        profilePicUrl = await sock.profilePictureUrl(participantJid, 'image');
                    } catch (ppError) {
                        profilePicUrl = 'https://img.whatsapp.net/watermark/1';
                    }
                    
                    const groupName = groupMetadata.subject || 'the group';
                    const now = new Date();
                    const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                    
                    let welcomeMsg = groupSettings.welcomeMessage || 'Welcome @user to @group! 👋\nEnjoy your stay!';
                    welcomeMsg = welcomeMsg
                        .replace('@user', `@${displayName}`)
                        .replace('@group', groupName)
                        .replace('#memberCount', groupMetadata.participants?.length || '0')
                        .replace('time', timeString);
                    
                    await sock.sendMessage(id, {
                        text: welcomeMsg,
                        mentions: [participantJid]
                    });
                } catch (welcomeError) {
                    console.error('Welcome error:', welcomeError);
                }
            } else if (action === 'remove' && groupSettings.goodbye) {
                try {
                    let goodbyeMsg = groupSettings.goodbyeMessage || 'Goodbye @user 👋 We will miss you!';
                    goodbyeMsg = goodbyeMsg.replace('@user', `@${participantNumber}`);
                    
                    await sock.sendMessage(id, {
                        text: goodbyeMsg,
                        mentions: [participantJid]
                    });
                } catch (goodbyeError) {
                    console.error('Goodbye error:', goodbyeError);
                }
            }
        }
    } catch (error) {
        console.error('Error handling group update:', error);
    }
};

// ==================== ANTI-LINK HANDLER ====================

const handleAntilink = async (sock, msg, groupMetadata) => {
    try {
        const from = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        
        const groupSettings = database.getGroupSettings(from);
        if (!groupSettings.antilink) return;
        
        const body = msg.message?.conversation || 
                     msg.message?.extendedTextMessage?.text || 
                     msg.message?.imageMessage?.caption || 
                     msg.message?.videoMessage?.caption || '';
        
        const linkPattern = /(https?:\/\/)?([a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.)+[a-zA-Z]{2,}(\/[^\s]*)?/i;
        
        if (linkPattern.test(body)) {
            const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
            const senderIsOwner = isOwner(sender);
            
            if (senderIsAdmin || senderIsOwner) return;
            
            const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
            const action = (groupSettings.antilinkAction || 'delete').toLowerCase();
            
            if (action === 'kick' && botIsAdmin) {
                try {
                    await sock.sendMessage(from, { delete: msg.key });
                    await sock.groupParticipantsUpdate(from, [sender], 'remove');
                } catch (e) {
                    console.error('Failed to kick for antilink:', e);
                }
            } else {
                try {
                    await sock.sendMessage(from, { delete: msg.key });
                } catch (e) {
                    console.error('Failed to delete message for antilink:', e);
                }
            }
        }
    } catch (error) {
        console.error('Error in antilink handler:', error);
    }
};

// ==================== ANTI-GROUP MENTION HANDLER ====================

const handleAntigroupmention = async (sock, msg, groupMetadata) => {
    try {
        const from = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        
        const groupSettings = database.getGroupSettings(from);
        if (!groupSettings.antigroupmention) return;
        
        let isForwardedStatus = false;
        
        if (msg.message) {
            isForwardedStatus = isForwardedStatus || !!msg.message.groupStatusMentionMessage;
            isForwardedStatus = isForwardedStatus || 
                (msg.message.protocolMessage && msg.message.protocolMessage.type === 25);
            isForwardedStatus = isForwardedStatus || 
                (msg.message.extendedTextMessage?.contextInfo?.forwardedNewsletterMessageInfo);
            isForwardedStatus = isForwardedStatus || !!msg.message.contextInfo?.isForwarded;
        }
        
        if (isForwardedStatus) {
            const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
            const senderIsOwner = isOwner(sender);
            
            if (senderIsAdmin || senderIsOwner) return;
            
            const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
            const action = (groupSettings.antigroupmentionAction || 'delete').toLowerCase();
            
            if (action === 'kick' && botIsAdmin) {
                try {
                    await sock.sendMessage(from, { delete: msg.key });
                    await sock.groupParticipantsUpdate(from, [sender], 'remove');
                } catch (e) {
                    console.error('Failed to kick for antigroupmention:', e);
                }
            } else {
                try {
                    await sock.sendMessage(from, { delete: msg.key });
                } catch (e) {
                    console.error('Failed to delete message for antigroupmention:', e);
                }
            }
        }
    } catch (error) {
        console.error('Error in antigroupmention handler:', error);
    }
};

// ==================== AUTO-REPLY, SCHEDULE, REMINDER CHECK ====================

const initializeAutomation = () => {
    // Check every 30 seconds
    setInterval(async () => {
        try {
            // Get all sessions and their sockets
            const sessionManager = require('./sessionManager');
            const sessions = sessionManager.getAllSessions();
            
            for (const sessionData of sessions) {
                const session = sessionManager.getSession(sessionData.id);
                
                // Only process authenticated sessions
                if (!session || !session.socket || session.state !== 'authenticated') {
                    continue;
                }
                
                const activeSock = session.socket;
                
                // Verify socket is connected
                if (!activeSock.user || !activeSock.user.id) {
                    continue;
                }
                
                // Check scheduled messages
                const scheduleCmd = require('../commands/automation/schedule');
                if (scheduleCmd.checkScheduled) {
                    await scheduleCmd.checkScheduled(activeSock);
                }
                
                // Check reminders
                const reminderCmd = require('../commands/automation/reminder');
                if (reminderCmd.checkReminders) {
                    await reminderCmd.checkReminders(activeSock);
                }
            }
        } catch (error) {
            console.error('[Automation Error]', error.message);
        }
    }, 30000);
};

// ==================== ANTI-CALL ====================

const initializeAntiCall = (sock) => {
    sock.ev.on('call', async (calls) => {
        try {
            delete require.cache[require.resolve('../config')];
            const cfg = require('../config');
            
            if (!cfg.defaultGroupSettings.anticall) return;
            
            for (const call of calls) {
                if (call.status === 'offer') {
                    await sock.rejectCall(call.id, call.from);
                    await sock.updateBlockStatus(call.from, 'block');
                    await sock.sendMessage(call.from, {
                        text: '🚫 Calls are not allowed. You have been blocked.'
                    });
                }
            }
        } catch (err) {
            console.error('[ANTICALL ERROR]', err);
        }
    });
};

// ==================== EXPORTS ====================

module.exports = {
    handleMessage,
    handleGroupUpdate,
    handleAntilink,
    handleAntigroupmention,
    initializeAntiCall,
    initializeAutomation,
    isOwner,
    isAdmin,
    isBotAdmin,
    isMod,
    getCachedGroupMetadata,
    findParticipant
};
