import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  proto
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { handleWhatsAppMessage } from './handlers/commands';

const logger = pino({ level: 'silent' });

async function startOddsbantaWhatsAppBot() {
  console.log('====================================================');
  console.log('⚡ Starting Oddsbanta Standalone WhatsApp Bot Service');
  console.log('====================================================');

  // Ensure auth directory exists
  if (!fs.existsSync(config.authDir)) {
    fs.mkdirSync(config.authDir, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`📡 Using WhatsApp Web Version: ${version.join('.')} (Latest: ${isLatest})`);

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false, // We handle printing manually with qrcode-terminal
    browser: ['Oddsbanta Bot', 'Chrome', '1.0.0'],
    syncFullHistory: false
  });

  // Handle Credentials update
  sock.ev.on('creds.update', saveCreds);

  // Handle Connection updates (QR code, Connect, Disconnect)
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📲 SCAN THIS QR CODE WITH WHATSAPP ON YOUR PHONE:');
      console.log('Steps: Open WhatsApp -> Linked Devices -> Link a Device:\n');
      qrcode.generate(qr, { small: true });
      console.log('\nWaiting for device scan...');
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`⚠️ Connection closed due to: ${lastDisconnect?.error}, reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(startOddsbantaWhatsAppBot, 3000);
      } else {
        console.log('❌ Device logged out. Please delete auth_info directory and re-scan QR code.');
      }
    } else if (connection === 'open') {
      console.log('✅ Oddsbanta WhatsApp Bot CONNECTED SUCCESSFULLY!');
      console.log('🤖 Ready to receive and process user prediction commands.');
    }
  });

  // Handle Incoming Messages
  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (m.type !== 'notify') return;

      for (const msg of m.messages) {
        // Ignore messages sent by the bot itself or status broadcasts
        if (msg.key.fromMe) continue;
        if (msg.key.remoteJid === 'status@broadcast') continue;

        const senderJid = msg.key.remoteJid;
        if (!senderJid) continue;

        // Extract message text (conversation or extendedTextMessage)
        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          '';

        if (!text.trim()) continue;

        // Format phone number
        const senderPhone = senderJid.split('@')[0];
        console.log(`📨 [Message from ${senderPhone}]: "${text}"`);

        // Process message through command & paywall engine
        const replyText = await handleWhatsAppMessage(senderPhone, text);

        // Send reply
        await sock.sendMessage(senderJid, { text: replyText });
        console.log(`📤 [Reply sent to ${senderPhone}]`);
      }
    } catch (err) {
      console.error('❌ Error handling incoming WhatsApp message:', err);
    }
  });
}

// Lightweight HTTP server for Cloud health checks (Google Cloud Run / Compute Engine keepalive)
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'oddsbanta-whatsapp-bot', timestamp: new Date().toISOString() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(config.port, () => {
  console.log(`🌐 Health check server listening on port ${config.port}`);
});

// Launch the bot
startOddsbantaWhatsAppBot().catch((err) => {
  console.error('Fatal bot launch error:', err);
});
