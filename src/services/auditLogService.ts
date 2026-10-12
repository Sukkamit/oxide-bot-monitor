import { getPool } from '../db/connection';
import { AuditLog } from '../types';

export class AuditLogService {
  private inMemoryLogs: AuditLog[] = [
    {
      id: 1,
      actor: 'SYSTEM',
      action: 'SYSTEM_INITIALIZED',
      target_type: 'SYSTEM',
      target_id: 'oxide-monitor',
      metadata: { service: 'oxide-bot-monitor', status: 'READY' },
      created_at: new Date(Date.now() - 60000),
    },
    {
      id: 2,
      actor: 'SYSTEM',
      action: 'HEARTBEAT_WATCHDOG_READY',
      target_type: 'WATCHDOG',
      target_id: 'watchdog-agent',
      metadata: { intervalSeconds: 5, timeoutSeconds: 30 },
      created_at: new Date(Date.now() - 30000),
    },
  ];

  public async getLogs(limit: number = 50): Promise<AuditLog[]> {
    try {
      const pool = getPool();
      const result = await pool.query(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1;`, [limit]);
      if (result.rows.length > 0) {
        return result.rows.map((r) => ({
          id: parseInt(r.id, 10),
          actor: r.actor,
          action: r.action,
          target_type: r.target_type,
          target_id: r.target_id,
          metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
          created_at: new Date(r.created_at),
        }));
      }
    } catch {
      // Database not available, use in-memory store
    }
    return this.inMemoryLogs.slice(0, limit);
  }

  public async log(
    actor: string,
    action: string,
    targetType: string,
    targetId?: string | null,
    metadata?: Record<string, unknown>
  ): Promise<AuditLog> {
    const newLog: AuditLog = {
      id: Date.now(),
      actor,
      action,
      target_type: targetType,
      target_id: targetId || null,
      metadata: metadata || null,
      created_at: new Date(),
    };

    try {
      const pool = getPool();
      const res = await pool.query(
        `INSERT INTO audit_logs (actor, action, target_type, target_id, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING *;`,
        [actor, action, targetType, targetId || null, JSON.stringify(metadata || {})]
      );
      if (res.rows.length > 0) {
        newLog.id = parseInt(res.rows[0].id, 10);
      }
    } catch {
      // In-memory fallback
    }

    this.inMemoryLogs.unshift(newLog);
    if (this.inMemoryLogs.length > 100) {
      this.inMemoryLogs = this.inMemoryLogs.slice(0, 100);
    }

    try {
      const { wsManager } = require('../ws/websocketServer');
      wsManager.broadcast('audit_log_created', newLog);
    } catch {
      // WS not available
    }

    return newLog;
  }
}

export const auditLogService = new AuditLogService();
