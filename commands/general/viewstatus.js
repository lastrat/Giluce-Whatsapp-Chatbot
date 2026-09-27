/**
 * ViewStatus Command - View/download WhatsApp statuses to mark them as seen
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const config = require('../../config');

module.exports = {
    name: 'viewstatus',
    aliases: ['viewstatus', 'vs', 'seestatus', 'statusview'],
    category: 'general',
    description: 'View/download WhatsApp statuses to mark them as seen',
    usage: '.viewstatus',
    
    async execute(sock, msg, args, context) {
        try {
            const { from } = context;
            
            // Get all stored status broadcasts from the handler
            const handlerModule = require('../../src/handler');
            const statusBroadcasts = handlerModule.STATUS_BROADCASTS || [];
            
            if (statusBroadcasts.length === 0) {
                return await sock.sendMessage(from, {
                    text: '📭 Aucun statut récent à visionner.\n\nLes statuts sont stockés lorsque vous recevez des mises à jour de statut.'
                }, { quoted: msg });
            }
            
            await sock.sendMessage(from, {
                text: `🔄 Visionnage de ${statusBroadcasts.length} statut(s)...\n\nCela peut prendre un moment.`
            });
            
            let processed = 0;
            let failed = 0;
            
            // Process each status broadcast
            for (const status of statusBroadcasts) {
                try {
                    if (!status.message) continue;
                    
                    const statusMsg = status.message;
                    let mtype = null;
                    let downloadType = null;
                    let caption = '';
                    
                    // Determine message type
                    if (statusMsg.imageMessage) {
                        mtype = 'imageMessage';
                        downloadType = 'image';
                        caption = statusMsg.imageMessage.caption || '';
                    } else if (statusMsg.videoMessage) {
                        mtype = 'videoMessage';
                        downloadType = 'video';
                        caption = statusMsg.videoMessage.caption || '';
                    } else if (statusMsg.audioMessage) {
                        mtype = 'audioMessage';
                        downloadType = 'audio';
                        caption = '';
                    } else if (statusMsg.documentMessage) {
                        mtype = 'documentMessage';
                        downloadType = 'document';
                        caption = statusMsg.documentMessage.fileName || '';
                    } else {
                        // Text status or unsupported type
                        if (statusMsg.conversation) {
                            await sock.sendMessage(from, {
                                text: `📝 *Statut textuel*\n\n${statusMsg.conversation}`
                            });
                            processed++;
                        } else if (statusMsg.extendedTextMessage?.text) {
                            await sock.sendMessage(from, {
                                text: `📝 *Statut textuel*\n\n${statusMsg.extendedTextMessage.text}`
                            });
                            processed++;
                        }
                        continue;
                    }
                    
                    // Download the media
                    console.log(`[ViewStatus] Downloading ${downloadType} from status...`);
                    const mediaStream = await downloadContentFromMessage(statusMsg[mtype], downloadType);
                    let buffer = Buffer.from([]);
                    for await (const chunk of mediaStream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    
                    if (buffer.length === 0) {
                        console.log(`[ViewStatus] Empty buffer for ${downloadType}`);
                        failed++;
                        continue;
                    }
                    
                    console.log(`[ViewStatus] Downloaded ${buffer.length} bytes, sending...`);
                    
                    // Send the media to user
                    const sendOptions = { quoted: msg };
                    
                    if (mtype === 'imageMessage') {
                        await sock.sendMessage(from, {
                            image: buffer,
                            caption: caption || '📸 Statut',
                            mimetype: 'image/jpeg'
                        }, sendOptions);
                    } else if (mtype === 'videoMessage') {
                        await sock.sendMessage(from, {
                            video: buffer,
                            caption: caption || '🎥 Statut',
                            mimetype: 'video/mp4'
                        }, sendOptions);
                    } else if (mtype === 'audioMessage') {
                        await sock.sendMessage(from, {
                            audio: buffer,
                            mimetype: 'audio/ogg; codecs=opus',
                            ptt: true
                        }, sendOptions);
                    } else if (mtype === 'documentMessage') {
                        await sock.sendMessage(from, {
                            document: buffer,
                            mimetype: statusMsg.documentMessage.mimetype || 'application/octet-stream',
                            fileName: statusMsg.documentMessage.fileName || 'document'
                        }, sendOptions);
                    }
                    
                    processed++;
                    console.log(`[ViewStatus] Sent ${downloadType} successfully`);
                    
                    // Small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                } catch (error) {
                    console.error('[ViewStatus] Error processing status:', error.message);
                    failed++;
                }
            }
            
            // Clear processed status broadcasts
            handlerModule.STATUS_BROADCASTS.length = 0;
            
            const resultText = `✅ *Statuts visionnés!*\n\n` +
                `📊 Total: ${statusBroadcasts.length}\n` +
                `✅ Réussis: ${processed}\n` +
                `❌ Échoués: ${failed}\n\n` +
                `💡 Les statuts ont été marqués comme vus par le bot.`;
            
            await sock.sendMessage(from, { text: resultText }, { quoted: msg });
            
        } catch (error) {
            console.error('[ViewStatus] Error:', error);
            await sock.sendMessage(from, {
                text: '❌ Erreur lors du visionnage des statuts.'
            }, { quoted: msg });
        }
    }
};
