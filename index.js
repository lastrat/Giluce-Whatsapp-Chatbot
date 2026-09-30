/**
 * Giluce WhatsApp Bot - Console Single-Session Mode
 */

process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';
process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';

const path = require('path');
const fs = require('fs');
const config = require('./config');
const sessionManager = require('./src/sessionManager');
const handler = require('./src/handler');
const QRCode = require('qrcode-terminal');
const qrcode = require('qrcode');
const webInterface = require('./src/web');

const SESSIONS_DIR = path.join(__dirname, 'sessions');

const startBot = async () => {
    console.log('Starting Giluce WhatsApp Bot in console mode...');

    let sessionId;
    const dirs = require('fs').readdirSync(SESSIONS_DIR, { withFileTypes: true });
    const existing = dirs.find(dir => dir.isDirectory());
    if (existing) {
        sessionId = existing.name;
        console.log(`Found existing session: ${sessionId}`);
    } else {
        sessionId = sessionManager.generateSessionId();
        console.log(`Created new session: ${sessionId}`);
    }

    const session = await sessionManager.createSession(sessionId);
    const sock = session.socket;

    webInterface.setStatus('idle', 'En attente de connexion...');

    let restarting = false;
    let pairingSuccess = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    const RECONNECT_DELAY = 3000;

    const attemptReconnect = async () => {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.log('\nMax reconnection attempts reached. Please restart the bot.\n');
            webInterface.setStatus('error', 'Tentatives de reconnexion épuisées. Redémarrez le bot.');
            process.exit(1);
            return;
        }

        reconnectAttempts++;
        console.log(`Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${RECONNECT_DELAY / 1000}s...`);
        webInterface.setStatus('connecting', `Reconnexion... Tentative ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);

        setTimeout(async () => {
            const result = await sessionManager.reconnectSession(sessionId);
            if (result && result.socket) {
                console.log('Reconnected successfully.\n');
                reconnectAttempts = 0;
                attachSocketEvents(result.socket, sessionId);
            } else {
                console.log('Reconnection failed. Retrying...\n');
                attemptReconnect();
            }
        }, RECONNECT_DELAY);
    };

    const attachSocketEvents = (socket, sessionId) => {
        socket.ev.on('messages.upsert', async ({ messages }) => {
            for (const msg of messages) {
                const keys = msg.message ? Object.keys(msg.message).join(',') : 'none';
                const category = msg.category || 'none';
                const broadcast = msg.broadcast || 'none';
                console.log(`[messages.upsert] from=${msg.key.remoteJid} fromMe=${msg.key.fromMe} keys=${keys} category=${category} broadcast=${broadcast}`);
                if (!msg.message) {
                    console.log(`[messages.upsert] msgKeys=${Object.keys(msg).join(',')}`);
                }
                try {
                    await handler.handleMessage(socket, msg);
                } catch (error) {
                    console.error(`Error processing message:`, error);
                }
            }
        });

        socket.ev.on('connection.update', (update) => {
            const { connection, qr, isNewLogin } = update;
            if (qr) {
                console.log('\n========================================');
                console.log('QR Code received. Scan it with WhatsApp:');
                QRCode.generate(qr, { small: true });
                console.log('========================================\n');
                qrcode.toDataURL(qr).then(dataUrl => {
                    webInterface.updateQR(dataUrl);
                }).catch(err => {
                    console.error('[WebQR] Failed to generate QR image:', err.message);
                });
                webInterface.setStatus('qr', 'Scannez le QR code avec WhatsApp');
            }
            if (connection === 'open') {
                console.log(`\nBot connected as ${socket.user?.id || 'Unknown'}\n`);
                webInterface.setStatus('connected', `Connecté en tant que ${socket.user?.id || 'Unknown'}`);
                restarting = false;
                pairingSuccess = false;
            }
            if ((connection === 'close' || isNewLogin) && !restarting) {
                const lastDisconnect = update.lastDisconnect || {};
                const error = lastDisconnect.error || {};
                const errorMessage = error.message || '';
                const statusCode = error.status || error.code || error.attrs?.code;

                if (errorMessage.includes('pairing configured successfully') || isNewLogin) {
                    pairingSuccess = true;
                    console.log('\nPairing successful. Reconnecting...\n');
                    webInterface.setStatus('paired', 'Pairing réussi. Reconnexion...');
                    restarting = true;
                    attemptReconnect();
                    return;
                }

                if (errorMessage.includes('restart required') || statusCode === 515 || statusCode === 428) {
                    if (pairingSuccess) {
                        console.log('\nPairing successful. Reconnecting...\n');
                        webInterface.setStatus('paired', 'Pairing réussi. Reconnexion...');
                        restarting = true;
                        attemptReconnect();
                        return;
                    }
                    restarting = true;
                    console.log('\nConnection error. Reconnecting...\n');
                    webInterface.setStatus('error', 'Erreur de connexion. Reconnexion...');
                    attemptReconnect();
                    return;
                }

                if (connection === 'close') {
                    console.log('\nConnection closed. Reconnecting...\n');
                    webInterface.setStatus('error', 'Connexion fermée. Reconnexion...');
                    restarting = true;
                    attemptReconnect();
                    return;
                }
            }
        });

        socket.ev.on('error', (err) => {
            console.error('Socket error:', err.message);
        });
    };

    attachSocketEvents(sock, sessionId);

    handler.initializeAutomation();

    console.log(`
╔═══════════════════════════════════════════════════╗
║   Giluce WhatsApp Bot - Console Mode             ║
║                                                   ║
║   ⚡ Prefix: ${config.prefix}                     ║
║   👑 Owner: ${config.ownerName[0]}                ║
║   🌐 Web QR: http://localhost:3000                ║
╚═══════════════════════════════════════════════════╝
    `);
};

startBot().catch((err) => {
    console.error('Failed to start bot:', err);
    process.exit(1);
});

process.on('SIGINT', () => {
    console.log('\nShutting down...');
    webInterface.close();
    process.exit(0);
});
