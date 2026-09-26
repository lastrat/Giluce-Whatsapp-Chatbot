/**
 * Anti-Delete Command - Toggle anti-delete message forwarding
 */

const antidelete = require('../../src/antidelete');

module.exports = {
    name: 'antidelete',
    aliases: ['ad'],
    category: 'general',
    description: 'Toggle anti-delete message forwarding to admin',
    usage: '.antidelete (on/off)',

    async execute(sock, msg, args, context) {
        const { from, sender } = context;

        try {
            const isGroup = from.endsWith('@g.us');
            let newState = null;

            if (isGroup) {
                const groupSettings = database.getGroupSettings(from);
                const current = groupSettings.antidelete || false;
                newState = args.length > 0 ? args[0].toLowerCase() === 'on' : !current;
                database.updateGroupSettings(from, { antidelete: newState });
            } else {
                const current = antidelete.isEnabled();
                newState = args.length > 0 ? args[0].toLowerCase() === 'on' : !current;
                antidelete.setEnabled(newState);
            }

            if (newState === null) return;

            await sock.sendMessage(from, {
                text: `✅ AntiDelete is now ${newState ? 'enabled' : 'disabled'}`
            });
        } catch (error) {
            console.error('Error in antidelete command:', error);
            await sock.sendMessage(from, {
                text: '❌ Error toggling antidelete: ' + error.message
            });
        }
    }
};
