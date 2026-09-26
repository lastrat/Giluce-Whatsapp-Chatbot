/**
 * Statut Command - React and mark all WhatsApp statuses as read
 */

const config = require('../../config');

module.exports = {
    name: 'statut',
    aliases: ['status', 'statuts', 'readstatus'],
    category: 'general',
    description: 'React and mark all WhatsApp statuses as read',
    usage: '.statut',
    
    async execute(sock, msg, args, context) {
        try {
            const { from } = context;
            
            // Get all stored status broadcasts from the handler
            const handlerModule = require('../../src/handler');
            const statusBroadcasts = handlerModule.STATUS_BROADCASTS || [];
            
            if (statusBroadcasts.length === 0) {
                return await sock.sendMessage(from, {
                    text: '📭 Aucun statut à marquer comme lu.\n\nLes statuts sont stockés lorsque vous recevez des mises à jour de statut.'
                }, { quoted: msg });
            }
            
            const emoji = args[0] || '👀';
            let processed = 0;
            let failed = 0;
            
            await sock.sendMessage(from, {
                text: `🔄 Marquage de ${statusBroadcasts.length} statut(s) comme lu...`
            });
            
            // React to each status broadcast
            for (const status of statusBroadcasts) {
                try {
                    if (!status.key) continue;
                    
                    await sock.sendMessage(from, {
                        react: { text: emoji, key: status.key }
                    });
                    processed++;
                    
                    // Small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (error) {
                    console.error('[Statut] Error reacting to status:', error.message);
                    failed++;
                }
            }
            
            // Clear processed status broadcasts
            handlerModule.STATUS_BROADCASTS.length = 0;
            
            const resultText = `✅ *Statuts traités!*\n\n` +
                `📊 Total: ${statusBroadcasts.length}\n` +
                `✅ Réussis: ${processed}\n` +
                `❌ Échoués: ${failed}\n` +
                `😀 Emoji utilisé: ${emoji}`;
            
            await sock.sendMessage(from, { text: resultText }, { quoted: msg });
            
        } catch (error) {
            console.error('[Statut] Error:', error);
            await sock.sendMessage(from, {
                text: '❌ Erreur lors du marquage des statuts.'
            }, { quoted: msg });
        }
    }
};
