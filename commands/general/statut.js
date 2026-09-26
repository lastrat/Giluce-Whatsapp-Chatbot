/**
 * Statut Command - React and mark all WhatsApp statuses as read
 */

const config = require('../../config');

module.exports = {
    name: 'statut',
    aliases: ['status', 'statuts', 'readstatus'],
    category: 'general',
    description: 'React and mark all WhatsApp statuses as read',
    usage: '.statut [on/off/emoji]',
    
    async execute(sock, msg, args, context) {
        try {
            const { from, isAdmin, isOwner, isGroup } = context;
            const subCommand = args[0]?.toLowerCase();
            
            // Handle on/off toggle
            if (subCommand === 'on' || subCommand === 'off' || subCommand === 'enable' || subCommand === 'disable') {
                // Allow owner everywhere, or anyone in private chat, or admins in groups
                if (!isOwner && isGroup && !isAdmin) {
                    return await sock.sendMessage(from, {
                        text: '❌ Seuls les admins peuvent modifier ce paramètre.'
                    }, { quoted: msg });
                }
                
                const newStatus = subCommand === 'on' || subCommand === 'enable';
                config.autoStatut = newStatus;
                
                const statusText = newStatus ? '✅ Activé' : '❌ Désactivé';
                await sock.sendMessage(from, {
                    text: `${statusText} - Marquage automatique des statuts comme lu`
                }, { quoted: msg });
                return;
            }
            
            // Show current status if no arguments
            if (!subCommand || subCommand === 'status' || subCommand === 'statut') {
                const currentStatus = config.autoStatut ? '✅ Activé' : '❌ Désactivé';
                const currentEmoji = config.autoStatutEmoji || '👀';
                
                const statusText = `📊 *Statut du marquage automatique*\n\n` +
                    `État: ${currentStatus}\n` +
                    `Emoji: ${currentEmoji}\n\n` +
                    `📝 *Commandes:*\n` +
                    `• .statut on/off - Activer/désactiver\n` +
                    `• .statut [emoji] - Marquer les statuts avec un emoji personnalisé`;
                
                await sock.sendMessage(from, { text: statusText }, { quoted: msg });
                return;
            }
            
            // Manual execution with custom emoji
            const handlerModule = require('../../src/handler');
            const statusBroadcasts = handlerModule.STATUS_BROADCASTS || [];
            
            if (statusBroadcasts.length === 0) {
                return await sock.sendMessage(from, {
                    text: '📭 Aucun statut à marquer comme lu.\n\nLes statuts sont stockés lorsque vous recevez des mises à jour de statut.'
                }, { quoted: msg });
            }
            
            const emoji = subCommand || '👀';
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
