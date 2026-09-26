/**
 * Schedule Command - Schedule messages to be sent later
 * Usage:
 * .schedule add [time] [message] - Schedule a message
 * .schedule list - List scheduled messages
 * .schedule remove [id] - Remove scheduled message
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../database');
const SCHEDULE_DB = path.join(DB_PATH, 'scheduled.json');

// Initialize database
const initDB = () => {
    if (!fs.existsSync(SCHEDULE_DB)) {
        fs.writeFileSync(SCHEDULE_DB, JSON.stringify({}));
    }
};
initDB();

// Read/Write functions
const readDB = () => {
    try {
        return JSON.parse(fs.readFileSync(SCHEDULE_DB, 'utf-8'));
    } catch {
        return {};
    }
};

const writeDB = (data) => {
    fs.writeFileSync(SCHEDULE_DB, JSON.stringify(data, null, 2));
};

// Check and send scheduled messages
const checkScheduled = async (sock) => {
    // Check if socket is valid and connected
    if (!sock || !sock.user || !sock.user.id) {
        console.log('[Schedule] Socket not ready, skipping');
        return; // Socket not ready, skip
    }
    
    const data = readDB();
    const now = Date.now();
    let changed = false;
    let pendingCount = 0;
    
    console.log(`[Schedule] Checking scheduled messages... Total entries: ${Object.keys(data).length}, Now: ${new Date(now).toISOString()}`);
    
    for (const [id, schedule] of Object.entries(data)) {
        if (schedule.scheduledTime <= now && !schedule.sent) {
            pendingCount++;
            console.log(`[Schedule] Found pending message ${id}: scheduledTime=${new Date(schedule.scheduledTime).toISOString()}, chatId=${schedule.chatId}, message=${schedule.message.substring(0, 50)}`);
            try {
                // Verify socket is still valid before sending
                if (!sock || !sock.user) {
                    console.log(`[Schedule] Socket invalid for message ${id}, skipping`);
                    continue;
                }
                
                console.log(`[Schedule] Sending message ${id} to ${schedule.chatId}...`);
                await sock.sendMessage(schedule.chatId, {
                    text: schedule.message
                });
                schedule.sent = true;
                changed = true;
                console.log(`[Schedule] Message sent successfully to ${schedule.chatId}`);
            } catch (error) {
                // If connection closed, mark as failed but don't delete
                if (error.message?.includes('Connection Closed') || error.isServer) {
                    console.log(`[Schedule] Connection closed, will retry later for ${id}`);
                    schedule.failed = true;
                    changed = true;
                } else {
                    console.error(`[Schedule] Error sending message ${id}:`, error.message);
                }
            }
        }
    }
    
    console.log(`[Schedule] Check complete. Pending messages found: ${pendingCount}`);
    
    if (changed) {
        writeDB(data);
    }
};

// Parse time input (e.g., "10:30", "2h", "30m", "2026-03-27 17:23", "2025-12-01")
const parseTime = (timeStr) => {
    const now = new Date();
    
    // Try date patterns first
    // Format: YYYY-MM-DD HH:MM (with space)
    let datePattern = /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})$/;
    let dateMatch = timeStr.match(datePattern);
    
    if (dateMatch) {
        const [, year, month, day, hour, minute] = dateMatch;
        const scheduled = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), 0, 0);
        
        if (scheduled <= now) {
            return null;
        }
        return scheduled.getTime();
    }
    
    // Format: YYYY-MM-DD (no time)
    datePattern = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
    dateMatch = timeStr.match(datePattern);
    
    if (dateMatch) {
        const [, year, month, day] = dateMatch;
        const scheduled = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0, 0);
        
        if (scheduled <= now) {
            return null;
        }
        return scheduled.getTime();
    }
    
    // Format: HH:MM (24-hour)
    if (timeStr.includes(':') && !timeStr.startsWith('-')) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        const scheduled = new Date(now);
        scheduled.setHours(hours, minutes, 0, 0);
        
        if (scheduled <= now) {
            scheduled.setDate(scheduled.getDate() + 1);
        }
        return scheduled.getTime();
    }
    
    // Format: Number + unit (e.g., "30m", "2h", "1d")
    const match = timeStr.match(/^(\d+)([smhd])$/i);
    if (match) {
        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        
        switch (unit) {
            case 's': return now.getTime() + value * 1000;
            case 'm': return now.getTime() + value * 60 * 1000;
            case 'h': return now.getTime() + value * 60 * 60 * 1000;
            case 'd': return now.getTime() + value * 24 * 60 * 60 * 1000;
        }
    }
    
    return null;
};

// Format time for display
const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
};

module.exports = {
    name: 'schedule',
    aliases: ['sched', 'planifier'],
    category: 'automation',
    desc: 'Schedule messages to be sent later',
    usage: 'add [time] [message] / list / remove [id]',
    
    async execute(sock, msg, args, extra) {
        const { from, isGroup } = extra;
        
        const subCommand = args[0]?.toLowerCase();
        
        if (!subCommand || subCommand === 'list') {
            // List scheduled messages
            const data = readDB();
            const now = Date.now();
            
            // Get schedules for this chat
            const chatSchedules = Object.entries(data)
                .filter(([_, s]) => s.chatId === from && !s.sent)
                .sort((a, b) => a[1].scheduledTime - b[1].scheduledTime);
            
            let response = `📅 *Messages Planifiés*\n\n`;
            
            if (chatSchedules.length === 0) {
                response += 'Aucun message planifié pour ce chat.\n\n';
            } else {
                response += `📋 *${chatSchedules.length} message(s):*\n\n`;
                
                chatSchedules.forEach(([id, schedule], i) => {
                    const timeLeft = schedule.scheduledTime - now;
                    const minutesLeft = Math.floor(timeLeft / 60000);
                    
                    response += `${i + 1}. 🆔 ${id.substring(0, 8)}...\n`;
                    response += `   ⏰ ${formatTime(schedule.scheduledTime)}`;
                    if (minutesLeft > 0) {
                        response += ` (dans ${minutesLeft}min)`;
                    }
                    response += `\n   💬 ${schedule.message.substring(0, 40)}${schedule.message.length > 40 ? '...' : ''}\n\n`;
                });
            }
            
            response += '📝 *Usage:*\n';
            response += '• .schedule add [time] [message]\n';
            response += '• .schedule add [number] [time] [message]\n';
            response += '• .schedule list\n';
            response += '• .schedule remove [id]\n\n';
            response += '⏱️ *Formats de temps:*\n';
            response += '• HH:MM (ex: 14:30)\n';
            response += '• Xm (ex: 30m)\n';
            response += '• Xh (ex: 2h)\n';
            response += '• Xd (ex: 1d)\n';
            response += '• YYYY-MM-DD (ex: 2025-12-01)\n';
            response += '• YYYY-MM-DD HH:MM (ex: 2025-12-01 14:30)';
            
            await sock.sendMessage(from, { text: response }, { quoted: msg });
            return;
        }
        
        switch (subCommand) {
            case 'add':
            case 'create':
            case 'planifier':
                if (args.length < 3) {
                    await extra.reply(`❌ Usage: .schedule add [time] [message]

⏱️ *Formats de temps:*
• HH:MM → 14:30
• Xm → 30m (minutes)
• Xh → 2h (heures)
• Xd → 1d (jours)
• YYYY-MM-DD → 2025-12-01
• YYYY-MM-DD HH:MM → 2025-12-01 14:30

📝 *Pour un autre numéro:*
.schedule add [numéro] [time] [message]

📝 *Exemple:*
.schedule add 30m Bonjour à tous!
.schedule add 2025-12-01 14:30 Réunion
.schedule add 2376725980 1h Salut!`);
                    return;
                }
                
                // Check if first arg is a phone number (starts with country code or digits)
                let targetChatId = from;
                let timeStr;
                let message;
                
                // Detect if first arg is phone number (contains mostly digits, possibly with + or country code)
                const firstArg = args[1];
                const phonePattern = /^[+]?\d{6,}$/;
                
                if (phonePattern.test(firstArg.replace(/\s/g, ''))) {
                    // It's a phone number - format as WhatsApp JID
                    let phoneNumber = firstArg.replace(/[+\s]/g, '');
                    
                    // Add country code if not present (assuming Cameroon 237)
                    if (!phoneNumber.startsWith('237') && phoneNumber.length <= 9) {
                        phoneNumber = '237' + phoneNumber;
                    }
                    
                    targetChatId = phoneNumber + '@s.whatsapp.net';
                    
                    // Check if args[2] is a date (YYYY-MM-DD) and args[3] is time (HH:MM)
                    const arg2 = args[2];
                    const arg3 = args[3];
                    
                    // If arg2 is a date pattern and arg3 looks like time, combine them
                    if (arg2 && arg2.match(/^\d{4}-\d{1,2}-\d{1,2}$/) && arg3 && arg3.includes(':')) {
                        timeStr = arg2 + ' ' + arg3;
                        message = args.slice(4).join(' ');
                    } else {
                        timeStr = arg2;
                        message = args.slice(3).join(' ');
                    }
                    
                    if (!timeStr || !message) {
                        await extra.reply('❌ Usage: .schedule add [numéro] [time] [message]\n\nExemple: .schedule add 2376725980 1h Salut!');
                        return;
                    }
                } else {
                    // No phone number, use current chat
                    timeStr = args[1];
                    message = args.slice(2).join(' ');
                }
                
                const scheduledTime = parseTime(timeStr);
                
                if (!scheduledTime) {
                    await extra.reply('❌ Format de temps invalide.\nUtilisez: HH:MM, Xm, Xh, Xd, ou YYYY-MM-DD');
                    return;
                }
                
                const scheduleId = `sched_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const scheduleData = readDB();
                
                scheduleData[scheduleId] = {
                    chatId: targetChatId,
                    message: message,
                    scheduledTime: scheduledTime,
                    sent: false,
                    createdAt: Date.now()
                };
                
                writeDB(scheduleData);
                
                const timeUntil = scheduledTime - Date.now();
                const minutes = Math.floor(timeUntil / 60000);
                
                const targetDisplay = targetChatId === from ? 'ce chat' : targetChatId.split('@')[0];
                
                await extra.reply(`✅ *Message planifié!*

📱 Destination: ${targetDisplay}
⏰ Sera envoyé: ${formatTime(scheduledTime)}
💬 Message: ${message}
⏳ Dans: ${minutes} minute(s)`);
                break;
                
            case 'remove':
            case 'delete':
            case 'del':
                if (args.length < 2) {
                    await extra.reply('❌ Usage: .schedule remove [id]');
                    return;
                }
                
                const removeId = args[1];
                const scheduleDataDel = readDB();
                
                // Find matching ID
                const foundKey = Object.keys(scheduleDataDel).find(k => 
                    k.includes(removeId) || k.startsWith(removeId)
                );
                
                if (foundKey) {
                    delete scheduleDataDel[foundKey];
                    writeDB(scheduleDataDel);
                    await extra.reply(`✅ Message planifié supprimé!`);
                } else {
                    await extra.reply('❌ ID de message planifié non trouvé.');
                }
                break;
                
            default:
                await extra.reply('❌ Commande invalide.\n\nUsage:\n• .schedule add [time] [message]\n• .schedule list\n• .schedule remove [id]');
        }
    }
};

// Export check function
module.exports.checkScheduled = checkScheduled;