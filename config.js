/**
 * Global Configuration for WhatsApp MD Bot
 * Based on KnightBot-Mini structure
 */

module.exports = {
    // Bot Owner Configuration
    ownerNumber: ['237698954932'], // Add your number without + or spaces
    ownerName: ['Giluce Bot', 'Admin'],
    
    // Bot Configuration
    botName: 'Giluce',
    prefix: '.',
    sessionName: 'session',
    sessionID: process.env.SESSION_ID || '',
    newsletterJid: '120363161513685998@newsletter', 
    
    // Sticker Configuration
    packname: 'Giluce Bot',
    
    // Bot Behavior
    selfMode: false, // Private mode - only owner can use commands
    autoRead: false,
    autoTyping: true,
    autoBio: false,
    autoSticker: false,
    autoReact: false,
    autoReactMode: 'all', // set bot or all via cmd
    antiviewonce: true,
    
    // Group Settings Defaults
    defaultGroupSettings: {
        antilink: false,
        antilinkAction: 'delete', // 'delete', 'kick', 'warn'
        antitag: false,
        antitagAction: 'delete',
        antiall: false,
        antiviewonce: true,
        antibot: false,
        anticall: false,
        antigroupmention: false,
        antigroupmentionAction: 'delete',
        welcome: true,
        welcomeMessage: '╭╼━≪•𝐆𝐈𝐋𝐔𝐂𝐄•≫━╾╮\n┃𝚆𝙴𝙻𝙲𝙾𝙼𝙴: @user 👋\n┃Member count: #memberCount\n┃𝚃𝙸𝙼𝙴: time⏰\n╰━━━━━━━━━━━━━━━╯\n\n*@user* Welcome to *@group*! 🎉\n\n> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ Giluce*',
        goodbye: true,
        goodbyeMessage: 'Goodbye @user 👋 We will miss you!',
        antiSpam: false,
        antidelete: false,
        nsfw: false,
        detect: false,
        chatbot: false,
        autosticker: false
    },
    
    // API Keys
    apiKeys: {
        openai: process.env.OPENAI_API_KEY || '',
        deepai: '',
        remove_bg: '',
        rapidapi: process.env.RAPIDAPI_KEY || ''
    },
    
    // Message Configuration
    messages: {
        wait: '⏳ Please wait...',
        success: '✅ Success!',
        error: '❌ Error occurred!',
        ownerOnly: '👑 This command is only for bot owner!',
        adminOnly: '🛡️ This command is only for group admins!',
        groupOnly: '👥 This command can only be used in groups!',
        privateOnly: '💬 This command can only be used in private chat!',
        botAdminNeeded: '🤖 Bot needs to be admin to execute this command!',
        invalidCommand: '❓ Invalid command! Type .menu for help'
    },
    
    // Timezone
    timezone: 'Africa/Douala',
    
    // Limits
    maxWarnings: 3,
    
    // Social Links
    social: {
        github: 'https://github.com/giluce',
        website: 'https://giluce.com'
    }
};
