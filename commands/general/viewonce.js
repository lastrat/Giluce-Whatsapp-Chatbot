/**
 * ViewOnce Command - Reveal view-once messages
 */

const config = require('../../config');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

module.exports = {
    name: 'viewonce',
    aliases: ['readvo', 'read', 'vv', 'readviewonce', 'vo'],
    category: 'general',
    description: 'Reveal view-once messages (images/videos/audio)',
    usage: '.viewonce (reply to view-once message)',
    
    async execute(sock, msg, args, context) {
        const { from } = context;
        
        try {
            const chatId = msg.key.remoteJid;
            const ownerJid = `${config.ownerNumber[0]}@s.whatsapp.net`;

            // Try to get contextInfo from different message types
            const ctx = msg.message?.extendedTextMessage?.contextInfo
                || msg.message?.imageMessage?.contextInfo
                || msg.message?.videoMessage?.contextInfo
                || msg.message?.buttonsResponseMessage?.contextInfo
                || msg.message?.listResponseMessage?.contextInfo;

            if (!ctx?.quotedMessage || !ctx?.stanzaId) {
                return await sock.sendMessage(
                    ownerJid,
                    { text: '🗑️ Reply to a *view-once* message to reveal it.' },
                    { quoted: msg }
                );
            }

            const quotedMsg = ctx.quotedMessage;

            // Check various patterns used for view-once messages
            const hasViewOnce =
                !!quotedMsg.viewOnceMessageV2 ||
                !!quotedMsg.viewOnceMessageV2Extension ||
                !!quotedMsg.viewOnceMessage ||
                !!quotedMsg.viewOnce ||
                !!quotedMsg?.imageMessage?.viewOnce ||
                !!quotedMsg?.videoMessage?.viewOnce ||
                !!quotedMsg?.audioMessage?.viewOnce;

            if (!hasViewOnce) {
                return await sock.sendMessage(
                    ownerJid,
                    { text: '❌ This is not a view-once message!' },
                    { quoted: msg }
                );
            }

            let actualMsg = null;
            let mtype = null;

            // Newer Baileys: viewOnceMessageV2Extension
            if (quotedMsg.viewOnceMessageV2Extension?.message) {
                actualMsg = quotedMsg.viewOnceMessageV2Extension.message;
                mtype = Object.keys(actualMsg)[0];
            } else if (quotedMsg.viewOnceMessageV2?.message) {
                // Classic Baileys: viewOnceMessageV2
                actualMsg = quotedMsg.viewOnceMessageV2.message;
                mtype = Object.keys(actualMsg)[0];
            } else if (quotedMsg.viewOnceMessage?.message) {
                // Older: viewOnceMessage
                actualMsg = quotedMsg.viewOnceMessage.message;
                mtype = Object.keys(actualMsg)[0];
            } else if (quotedMsg.imageMessage?.viewOnce) {
                // Direct message with viewOnce flag on media
                actualMsg = { imageMessage: quotedMsg.imageMessage };
                mtype = 'imageMessage';
            } else if (quotedMsg.videoMessage?.viewOnce) {
                actualMsg = { videoMessage: quotedMsg.videoMessage };
                mtype = 'videoMessage';
            } else if (quotedMsg.audioMessage?.viewOnce) {
                actualMsg = { audioMessage: quotedMsg.audioMessage };
                mtype = 'audioMessage';
            }

            if (!actualMsg || !mtype) {
                return await sock.sendMessage(
                    ownerJid,
                    { text: '❌ Unsupported view-once message type.' },
                    { quoted: msg }
                );
            }

            const downloadType =
                mtype === 'imageMessage'
                    ? 'image'
                    : mtype === 'videoMessage'
                    ? 'video'
                    : 'audio';

            const mediaStream = await downloadContentFromMessage(
                actualMsg[mtype],
                downloadType
            );

            let buffer = Buffer.from([]);
            for await (const chunk of mediaStream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            const captionBase = actualMsg[mtype]?.caption || '';
            const senderJid = ctx.participant || msg.key.participant || msg.key.remoteJid;
            const senderNum = senderJid ? senderJid.split('@')[0] : 'inconnu';
            const caption = captionBase ? `${captionBase}\n\n📱 Expéditeur: @${senderNum}` : `📱 Expéditeur: @${senderNum}`;

            if (/video/.test(mtype)) {
                await sock.sendMessage(
                    ownerJid,
                    {
                        video: buffer,
                        caption,
                        mimetype: 'video/mp4'
                    },
                    { quoted: msg }
                );
            } else if (/image/.test(mtype)) {
                await sock.sendMessage(
                    ownerJid,
                    {
                        image: buffer,
                        caption,
                        mimetype: 'image/jpeg'
                    },
                    { quoted: msg }
                );
            } else if (/audio/.test(mtype)) {
                await sock.sendMessage(
                    ownerJid,
                    {
                        audio: buffer,
                        ptt: true,
                        mimetype: 'audio/ogg; codecs=opus'
                    },
                    { quoted: msg }
                );
            }
        } catch (error) {
            console.error('Error in viewonce command:', error);
            await sock.sendMessage(
                ownerJid,
                {
                    text: '❌ Error processing view-once message: ' + (error.message || 'Unknown error')
                },
                { quoted: msg }
            );
        }
    }
};
