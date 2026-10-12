import { getPool } from '../db/connection';

export class KillSwitchService {
  private killSwitchActive: boolean = true; // true = System OPEN/ENABLED, false = System SHUTDOWN/KILL-SWITCH ACTIVE

  public async getStatus(): Promise<{
    isEnabled: boolean;
    status: 'ENABLED' | 'DISABLED';
    label: string;
    description: string;
  }> {
    try {
      const pool = getPool();
      const res = await pool.query(`SELECT value FROM system_settings WHERE key = 'kill_switch';`);
      if (res.rows.length > 0) {
        this.killSwitchActive = res.rows[0].value === 'ENABLED';
      }
    } catch {
      // Fallback to in-memory state
    }

    return {
      isEnabled: this.killSwitchActive,
      status: this.killSwitchActive ? 'ENABLED' : 'DISABLED',
      label: this.killSwitchActive ? 'ทั้งระบบ: เปิด' : 'ทั้งระบบ: ปิด (Kill-Switch Active)',
      description: this.killSwitchActive
        ? 'ระบบเปิดรับออเดอร์ปกติ บอทสามารถรับงานได้'
        : 'ปิดทั้งระบบเพื่อหยุดการรับออเดอร์ บอททุกเครื่องจะปฏิเสธการประมวลผล',
    };
  }

  public async setStatus(
    enabled: boolean,
    actor: string = 'admin'
  ): Promise<{
    isEnabled: boolean;
    status: 'ENABLED' | 'DISABLED';
    label: string;
  }> {
    const previous = this.killSwitchActive;
    this.killSwitchActive = enabled;
    const value = enabled ? 'ENABLED' : 'DISABLED';

    try {
      const pool = getPool();
      await pool.query(
        `INSERT INTO system_settings (key, value, updated_by, updated_at)
         VALUES ('kill_switch', $1, $2, NOW())
         ON CONFLICT (key) DO UPDATE
         SET value = $1, updated_by = $2, updated_at = NOW();`,
        [value, actor]
      );

      // Record in audit_logs
      await pool.query(
        `INSERT INTO audit_logs (actor, action, target_type, target_id, metadata, created_at)
         VALUES ($1, $2, 'SYSTEM', 'kill_switch', $3, NOW());`,
        [
          actor,
          enabled ? 'GLOBAL_SYSTEM_ENABLED' : 'GLOBAL_SYSTEM_KILL_SWITCH_ACTIVATED',
          JSON.stringify({ previous, newStatus: value, timestamp: new Date() }),
        ]
      );
    } catch (err: any) {
      console.warn('[KillSwitch DB Warning]:', err.message);
    }

    try {
      const { auditLogService } = require('./auditLogService');
      auditLogService.log(
        actor,
        enabled ? 'GLOBAL_SYSTEM_ENABLED' : 'GLOBAL_SYSTEM_KILL_SWITCH_ACTIVATED',
        'SYSTEM',
        'kill_switch',
        { previous, newStatus: value }
      );
    } catch {}

    try {
      // Dynamic import or require to avoid circular dependency
      const { wsManager } = require('../ws/websocketServer');
      wsManager.broadcast('kill_switch_updated', {
        isEnabled: this.killSwitchActive,
        status: value,
        label: enabled ? 'ทั้งระบบ: เปิด' : 'ทั้งระบบ: ปิด (Kill-Switch Active)',
      });
    } catch {
      // Ignore if ws not ready
    }

    return {
      isEnabled: this.killSwitchActive,
      status: value,
      label: enabled ? 'ทั้งระบบ: เปิด' : 'ทั้งระบบ: ปิด (Kill-Switch Active)',
    };
  }
}

export const killSwitchService = new KillSwitchService();
