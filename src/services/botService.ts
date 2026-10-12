import http from 'http';
import { getPool } from '../db/connection';
import { BotAgent, BotCommand, BotCommandType, OverviewSummary } from '../types';
import { killSwitchService } from './killSwitchService';
import { deploymentService } from './deploymentService';

export class BotService {
  private simulatorUrl: string = process.env.BOT_SIMULATOR_URL || 'http://localhost:8788';

  constructor() {
    // Keep online bots active with live simulated heartbeats
    setInterval(() => {
      const now = new Date();
      for (const bot of this.initialBots) {
        if (bot.status === 'online') {
          bot.last_heartbeat = now;
          bot.cpu_percent = Math.round((6 + Math.random() * 14) * 10) / 10;
          bot.memory_percent = Math.round((30 + Math.random() * 15) * 10) / 10;
          bot.uptime_seconds += 5;
        }
      }
    }, 5000);
  }

  // Seed baseline bots matching PDF Page 2 UI
  private initialBots: BotAgent[] = [
    {
      id: 'bot-01',
      name: 'Kaotam BOT',
      device_name: 'LAPTOP-RCVDH...',
      status: 'online',
      cpu_percent: 18.4,
      memory_percent: 41.2,
      uptime_seconds: 86400,
      last_heartbeat: new Date(),
      last_task_desc: 'Standby for queue',
      last_task_status: 'Done',
      code_version: 'oxide-2026-09-17T15-48-05',
      is_active_accepting: true,
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 'bot-02',
      name: 'Kaotam B...',
      device_name: 'DESKTOP-048C...',
      status: 'online',
      cpu_percent: 7.1,
      memory_percent: 33.8,
      uptime_seconds: 4200,
      last_heartbeat: new Date(),
      last_task_desc: 'test 1092 สำเร็จ UF-1W3-ON4',
      last_task_status: 'Done',
      code_version: 'oxide-2026-09-17T15-48-05',
      is_active_accepting: true,
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 'bot-03',
      name: 'Kaotam B...',
      device_name: 'DESKTOP-LDD0...',
      status: 'online',
      cpu_percent: 12.0,
      memory_percent: 45.0,
      uptime_seconds: 15400,
      last_heartbeat: new Date(),
      last_task_desc: 'WEB BONUS 1 รอบ',
      last_task_status: 'Done',
      code_version: 'oxide-2026-09-17T15-48-05',
      is_active_accepting: true,
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 'bot-04',
      name: 'Kaotam B...',
      device_name: 'DESKTOP-D6RE...',
      status: 'online',
      cpu_percent: 5.5,
      memory_percent: 29.1,
      uptime_seconds: 32000,
      last_heartbeat: new Date(),
      last_task_desc: 'test 1092 สำเร็จ UF-1W3-ON4',
      last_task_status: 'Done',
      code_version: 'oxide-2026-09-17T15-48-05',
      is_active_accepting: true,
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 'bot-05',
      name: 'Kaotam B...',
      device_name: 'NODE-SERVER-05...',
      status: 'online',
      cpu_percent: 9.3,
      memory_percent: 38.4,
      uptime_seconds: 54000,
      last_heartbeat: new Date(),
      last_task_desc: 'Standby for queue',
      last_task_status: 'Done',
      code_version: 'oxide-2026-09-17T15-48-05',
      is_active_accepting: true,
      created_at: new Date(),
      updated_at: new Date(),
    },
  ];

  public async getBots(): Promise<BotAgent[]> {
    try {
      const pool = getPool();
      const res = await pool.query(`SELECT * FROM oxide_bot_agents ORDER BY id ASC;`);
      if (res.rows.length > 0) {
        return res.rows.map((row) => {
          const init = this.initialBots.find((b) => b.id === row.id) || this.initialBots[0];
          return {
            id: row.id,
            name: row.name,
            device_name: row.device_name,
            status: row.status,
            cpu_percent: parseFloat(row.cpu_percent) || 0,
            memory_percent: parseFloat(row.memory_percent) || 0,
            uptime_seconds: parseInt(row.uptime_seconds, 10) || 0,
            last_heartbeat: row.last_heartbeat ? new Date(row.last_heartbeat) : null,
            last_task_desc: init.last_task_desc || 'test 1092 สำเร็จ UF-1W3-ON4',
            last_task_status: init.last_task_status || 'Done',
            code_version: init.code_version || 'oxide-2026-09-17T15-48-05',
            is_active_accepting: row.status === 'online',
            created_at: new Date(row.created_at),
            updated_at: new Date(row.updated_at),
          };
        });
      }
    } catch {
      // In-memory fallback
    }
    return this.initialBots;
  }

  public async getBotById(botId: string): Promise<BotAgent | null> {
    const bots = await this.getBots();
    return bots.find((b) => b.id === botId) || null;
  }

  public async sendCommand(
    botId: string,
    command: BotCommandType,
    requestedBy: string = 'admin'
  ): Promise<{ success: boolean; command: string; botId: string; result?: any }> {
    const bot = await this.getBotById(botId);
    if (!bot) {
      throw new Error(`Bot '${botId}' not found.`);
    }

    // Call simulator if available
    let simResult: any = null;
    if (['start', 'stop', 'restart', 'status'].includes(command)) {
      try {
        simResult = await this.callSimulator(botId, command);
      } catch (err: any) {
        console.warn(`[Bot Simulator Connection Notice]: ${err.message}`);
      }
    }

    // Update in Database
    let nextStatus = bot.status;
    if (command === 'start' || command === 'restart') nextStatus = 'online';
    if (command === 'stop') nextStatus = 'offline';

    try {
      const pool = getPool();
      await pool.query(
        `UPDATE oxide_bot_agents
         SET status = $1, last_heartbeat = NOW(), updated_at = NOW()
         WHERE id = $2;`,
        [nextStatus, botId]
      );

      // Record in oxide_bot_commands
      const cmdRes = await pool.query(
        `INSERT INTO oxide_bot_commands (bot_id, command, requested_by, status, result, created_at, completed_at)
         VALUES ($1, $2, $3, 'success', $4, NOW(), NOW())
         RETURNING id;`,
        [botId, command === 'update_code' ? 'restart' : command, requestedBy, JSON.stringify(simResult || { action: command })]
      );

      // Record in audit_logs
      await pool.query(
        `INSERT INTO audit_logs (actor, action, target_type, target_id, metadata, created_at)
         VALUES ($1, $2, 'BOT_AGENT', $3, $4, NOW());`,
        [requestedBy, `BOT_COMMAND_${command.toUpperCase()}`, botId, JSON.stringify({ command, nextStatus, simResult })]
      );
    } catch (err: any) {
      console.warn('[Bot DB Command Warning]:', err.message);
    }

    // Update memory cache
    const targetBot = this.initialBots.find((b) => b.id === botId);
    if (targetBot) {
      targetBot.status = nextStatus;
      targetBot.last_heartbeat = new Date();
      targetBot.is_active_accepting = nextStatus === 'online';
    }

    try {
      const { auditLogService } = require('./auditLogService');
      auditLogService.log(
        requestedBy,
        `BOT_COMMAND_${command.toUpperCase()}`,
        'BOT_AGENT',
        botId,
        { command, nextStatus }
      );
    } catch {}

    try {
      const { wsManager } = require('../ws/websocketServer');
      wsManager.broadcast('bot_updated', { botId, status: nextStatus, command });
    } catch {
      // ws not ready
    }

    return {
      success: true,
      command,
      botId,
      result: simResult || { status: nextStatus },
    };
  }

  public async receiveHeartbeat(
    botId: string,
    metrics?: { cpu?: number; memory?: number; uptime?: number; status?: string }
  ): Promise<BotAgent> {
    const cpu = metrics?.cpu ?? 10.5;
    const memory = metrics?.memory ?? 35.0;
    const uptime = metrics?.uptime ?? 1200;
    const status = (metrics?.status as any) || 'online';

    try {
      const pool = getPool();
      await pool.query(
        `UPDATE oxide_bot_agents
         SET cpu_percent = $1, memory_percent = $2, uptime_seconds = uptime_seconds + 5,
             last_heartbeat = NOW(), status = $3, updated_at = NOW()
         WHERE id = $4;`,
        [cpu, memory, status, botId]
      );
    } catch {
      // Memory fallback
    }

    const targetBot = this.initialBots.find((b) => b.id === botId);
    if (targetBot) {
      targetBot.cpu_percent = cpu;
      targetBot.memory_percent = memory;
      targetBot.uptime_seconds = uptime;
      targetBot.status = status;
      targetBot.last_heartbeat = new Date();
      targetBot.is_active_accepting = status === 'online';
      try {
        const { wsManager } = require('../ws/websocketServer');
        wsManager.broadcast('bot_heartbeat', { botId, metrics: { cpu, memory, uptime, status } });
      } catch {}
      return targetBot;
    }

    const fetched = (await this.getBotById(botId))!;
    try {
      const { wsManager } = require('../ws/websocketServer');
      wsManager.broadcast('bot_heartbeat', { botId, metrics: { cpu, memory, uptime, status } });
    } catch {}
    return fetched;
  }

  // Heartbeat Timeout Detector (Detects crashed/silent nodes)
  public async checkHeartbeatTimeouts(timeoutSeconds: number = 30): Promise<string[]> {
    const expiredBotIds: string[] = [];
    const threshold = new Date(Date.now() - timeoutSeconds * 1000);

    const bots = await this.getBots();
    for (const b of bots) {
      if (b.status === 'online' && b.last_heartbeat && b.last_heartbeat < threshold) {
        expiredBotIds.push(b.id);
        b.status = 'error';
        b.is_active_accepting = false;

        try {
          const pool = getPool();
          await pool.query(
            `UPDATE oxide_bot_agents SET status = 'error', updated_at = NOW() WHERE id = $1;`,
            [b.id]
          );
          await pool.query(
            `INSERT INTO audit_logs (actor, action, target_type, target_id, metadata, created_at)
             VALUES ('SYSTEM_WATCHDOG', 'BOT_HEARTBEAT_TIMEOUT', 'BOT_AGENT', $1, $2, NOW());`,
            [b.id, JSON.stringify({ timeoutSeconds, lastHeartbeat: b.last_heartbeat })]
          );
        } catch {
          // ignore
        }

        try {
          const { auditLogService } = require('./auditLogService');
          auditLogService.log(
            'SYSTEM_WATCHDOG',
            'BOT_HEARTBEAT_TIMEOUT',
            'BOT_AGENT',
            b.id,
            { timeoutSeconds, lastHeartbeat: b.last_heartbeat }
          );
        } catch {}
      }
    }

    if (expiredBotIds.length > 0) {
      try {
        const { wsManager } = require('../ws/websocketServer');
        wsManager.broadcast('bots_timeout', { expiredBotIds });
      } catch {}
    }

    return expiredBotIds;
  }

  public async getOverviewSummary(): Promise<OverviewSummary> {
    const bots = await this.getBots();
    const killSwitch = await killSwitchService.getStatus();
    const latestPkg = await deploymentService.getLatestPackage();
    
    let orders: any[] = [];
    try {
      const { orderService } = require('./orderService');
      orders = await orderService.getOrders();
    } catch {}

    const onlineBots = bots.filter((b) => b.status === 'online');
    const onlineCount = onlineBots.length;

    // Identify orders currently in processing
    const processingOrders = orders.filter((o: any) => o.status === 'processing');
    const busyBotIds = new Set<string>(
      processingOrders.map((o: any) => o.assigned_bot_id).filter(Boolean)
    );
    bots.forEach((b) => {
      if ((b.last_task_status || '').toLowerCase() === 'in progress') {
        busyBotIds.add(b.id);
      }
    });

    const busyOnlineBots = onlineBots.filter((b) => busyBotIds.has(b.id));
    const inProgressCount = Math.max(processingOrders.length, busyOnlineBots.length);

    let activeCount = 0;
    let standbyCount = 0;

    if (!killSwitch.isEnabled) {
      // When Kill-Switch is OFF, system ceases dispatching/accepting work
      activeCount = 0;
      standbyCount = onlineCount;
    } else {
      // Active count represents bots actively assigned/processing work
      activeCount = inProgressCount;
      standbyCount = Math.max(0, onlineCount - inProgressCount);
    }

    return {
      onlineCount,
      activeCount,
      standbyCount,
      inProgressCount,
      totalMachines: bots.length,
      killSwitchActive: killSwitch.isEnabled,
      killSwitchLabel: killSwitch.label,
      latestPackage: latestPkg,
    };
  }

  private callSimulator(botId: string, command: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.simulatorUrl}/bots/${botId}/commands`);
      const body = JSON.stringify({ command });

      const req = http.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 2000,
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({ ok: true, data });
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Simulator connection timed out'));
      });
      req.write(body);
      req.end();
    });
  }

  public updateBotTask(botId: string, taskDesc: string, taskStatus?: 'Failed' | 'Done' | 'In Progress'): void {
    const b = this.initialBots.find((bot) => bot.id === botId);
    if (b) {
      b.last_task_desc = taskDesc;
      b.last_task_status = taskStatus;
      try {
        const { wsManager } = require('../ws/websocketServer');
        wsManager.broadcast('bot_updated', { botId, last_task_desc: taskDesc, last_task_status: taskStatus });
      } catch {}
    }
  }
}

export const botService = new BotService();
