/**
 * Purge Command - Remove all members from a group
 * Destructive command: requires admin + confirmation
 */

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
    name: 'purge',
    description: 'Remove all members from the group',
    category: 'admin',
    groupOnly: true,
    adminOnly: true,
    botAdminNeeded: true,

    async execute(sock, msg, args, context) {
        const { from, sender, groupMetadata } = context;

        if (!groupMetadata || !groupMetadata.participants) {
            await sock.sendMessage(from, { text: '❌ Impossible de récupérer la liste des membres!' });
            return;
        }

        // Confirm mode
        if (args[0]?.toLowerCase() !== 'confirm') {
            const count = groupMetadata.participants.length;
            await sock.sendMessage(from, {
                text: `⚠️ *ATTENTION - Commande destructive*\n\n` +
                      `Vous êtes sur le point d'expulser *tous les membres* du groupe.\n\n` +
                      `👥 Membres actuels : *${count}*\n\n` +
                      `Tapez *.purge confirm* pour confirmer.\n` +
                      `Toute autre action annulera l'opération.`
            });
            return;
        }

        // Base identifier (strips device suffix "123:45@s.whatsapp.net" -> "123")
        const baseId = (jid) => {
            if (!jid) return '';
            return jid.split('@')[0].split(':')[0];
        };

        // Build ALL possible bot identifiers (JID + LID) to protect the bot
        const botBases = new Set();
        if (sock.user?.id) botBases.add(baseId(sock.user.id));
        if (sock.user?.lid) botBases.add(baseId(sock.user.lid));
        const senderBase = baseId(sender);

        // Filter out: bot itself (all its id formats) and the admin who launched the command
        const targets = groupMetadata.participants
            .map(p => p.id)
            .filter(id => {
                if (!id) return false;
                const base = baseId(id);
                return base && !botBases.has(base) && base !== senderBase;
            });

        if (targets.length === 0) {
            await sock.sendMessage(from, { text: '❌ Aucun membre à expulser!' });
            return;
        }

        await sock.sendMessage(from, {
            text: `🧹 *Purge démarrée...*\n\nExpulsion de *${targets.length}* membres en cours.\nVeuillez patienter...`
        });

        let removed = 0;
        let failed = 0;

        // Remove in batches to avoid rate limits
        const batchSize = 10;
        for (let i = 0; i < targets.length; i += batchSize) {
            const batch = targets.slice(i, i + batchSize);
            try {
                await sock.groupParticipantsUpdate(from, batch, 'remove');
                removed += batch.length;
            } catch (error) {
                failed += batch.length;
                console.error('[Purge] Batch error:', error.message);
            }
            // Delay between batches to avoid WhatsApp rate limits
            if (i + batchSize < targets.length) {
                await sleep(2000);
            }
        }

        await sock.sendMessage(from, {
            text: `✅ *Purge terminée!*\n\n👤 Expulsés : *${removed}*\n` +
                  (failed > 0 ? `❌ Échecs : *${failed}*\n` : '') +
                  `\nVous êtes désormais seul(e) dans le groupe (avec le bot).`
        });
    }
};
