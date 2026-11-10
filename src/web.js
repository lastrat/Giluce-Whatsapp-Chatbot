const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || process.env.WEB_PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/src', express.static(path.join(__dirname, '../src')));

let sock = null;
let qrData = null;
let connectionStatus = 'idle';
let statusMessage = 'En attente de connexion...';
let listeners = [];

function setSocket(socket) {
    sock = socket;
}

const broadcast = () => {
    const payload = { qrData, connectionStatus, statusMessage };
    listeners.forEach(fn => {
        try { fn(payload); } catch {}
    });
};

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`data: ${JSON.stringify({ qrData, connectionStatus, statusMessage })}\n\n`);
    const onStatus = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    listeners.push(onStatus);
    req.on('close', () => {
        listeners = listeners.filter(fn => fn !== onStatus);
    });
});

app.post('/qr', (req, res) => {
    const { qr } = req.body || {};
    qrData = qr || null;
    if (qrData) {
        connectionStatus = 'qr';
        statusMessage = 'Scannez le QR code avec WhatsApp';
    }
    broadcast();
    res.json({ ok: true });
});

app.post('/status', (req, res) => {
    const { status, message } = req.body || {};
    connectionStatus = status || connectionStatus;
    statusMessage = message || statusMessage;
    broadcast();
    res.json({ ok: true });
});

app.post('/send', async (req, res) => {
    try {
        const { phone, message } = req.body || {};
        
        if (!phone || !message) {
            return res.status(400).json({ 
                ok: false, 
                error: 'Phone number and message are required' 
            });
        }
        
        if (!sock) {
            return res.status(503).json({ 
                ok: false, 
                error: 'WhatsApp not connected' 
            });
        }
        
        // Format phone number to WhatsApp JID
        let jid = phone.replace(/\D/g, '');
        if (!jid.includes('@')) {
            jid = jid + '@s.whatsapp.net';
        }
        
        await sock.sendMessage(jid, { text: message });
        
        res.json({ ok: true, message: 'Message sent successfully' });
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ 
            ok: false, 
            error: error.message || 'Failed to send message' 
        });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

const server = app.listen(PORT, HOST, () => {
    console.log(`Web QR interface available at http://${HOST}:${PORT}`);
});

module.exports = {
    updateQR: (qr) => {
        qrData = qr;
        if (qr) {
            connectionStatus = 'qr';
            statusMessage = 'Scannez le QR code avec WhatsApp';
        }
        broadcast();
    },
    setStatus: (status, message) => {
        connectionStatus = status;
        statusMessage = message || statusMessage;
        broadcast();
    },
    setSocket: setSocket,
    close: () => {
        server.close();
    }
};
