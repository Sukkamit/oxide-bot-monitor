import http from 'http';
import dotenv from 'dotenv';
import { app } from './app';
import { wsManager } from './ws/websocketServer';
import { initDatabase } from './db/migrate';
import { botService } from './services/botService';
import { killSwitchService } from './services/killSwitchService';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3002', 10);

async function startServer() {
  // Initialize Database tables if connected
  try {
    await initDatabase();
  } catch (err: any) {
    console.warn('[DB Init Warning]: Database connection not available, operating in resilient memory-store mode.');
  }

  const server = http.createServer(app);

  // Mount Real-time WebSocket Server on /ws
  wsManager.init(server);

  server.listen(PORT, async () => {
    const killSwitch = await killSwitchService.getStatus();
    console.log('===============================================================');
    console.log('🚀 OXIDE Bot Monitor & Centralized Order Service Started');
    console.log(`🌐 Web Dashboard & API : http://localhost:${PORT}`);
    console.log(`⚡ WebSocket Stream     : ws://localhost:${PORT}/ws`);
    console.log(`🛡️  Global Kill-Switch   : ${killSwitch.label}`);
    console.log(`🤖 Bot Simulator Target : ${process.env.BOT_SIMULATOR_URL || 'http://localhost:8788'}`);
    console.log('===============================================================');

    // Run periodic Heartbeat watchdog in background (every 10 seconds)
    setInterval(async () => {
      try {
        const timedOutBots = await botService.checkHeartbeatTimeouts(30);
        if (timedOutBots.length > 0) {
          console.warn(`[Watchdog Alert]: Heartbeat timeout detected for bots: ${timedOutBots.join(', ')}`);
        }
      } catch (err) {
        // quiet watchdog error
      }
    }, 10000);
  });
}

if (process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    console.error('Fatal Server Error:', err);
    process.exit(1);
  });
}
