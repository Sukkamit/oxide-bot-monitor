import { Request, Response } from 'express';
import { z } from 'zod';
import { botService } from '../services/botService';
import { killSwitchService } from '../services/killSwitchService';
import { getPool } from '../db/connection';

const killSwitchSchema = z.object({
  enabled: z.boolean(),
  actor: z.string().optional().default('admin'),
});

export class SystemController {
  public getOverview = async (_req: Request, res: Response): Promise<void> => {
    try {
      const summary = await botService.getOverviewSummary();
      res.status(200).json({ success: true, data: summary });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public getKillSwitch = async (_req: Request, res: Response): Promise<void> => {
    try {
      const status = await killSwitchService.getStatus();
      res.status(200).json({ success: true, data: status });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public toggleKillSwitch = async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = killSwitchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: 'invalid_payload', details: parsed.error.issues });
        return;
      }

      const result = await killSwitchService.setStatus(parsed.data.enabled, parsed.data.actor);
      res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public getAuditLogs = async (_req: Request, res: Response): Promise<void> => {
    try {
      const pool = getPool();
      const result = await pool.query(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 50;`);
      res.status(200).json({ success: true, data: result.rows });
    } catch (err: any) {
      res.status(200).json({ success: true, data: [] });
    }
  };
}

export const systemController = new SystemController();
