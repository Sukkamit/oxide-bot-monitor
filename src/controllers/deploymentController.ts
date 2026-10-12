import { Request, Response } from 'express';
import { z } from 'zod';
import { deploymentService } from '../services/deploymentService';
import { botService } from '../services/botService';
import { getPool } from '../db/connection';

const packSchema = z.object({
  customName: z.string().optional(),
  sourcePath: z.string().optional(),
  components: z.array(z.string()).optional(),
});

export class DeploymentController {
  public getPackages = async (_req: Request, res: Response): Promise<void> => {
    try {
      const pkgs = await deploymentService.getPackages();
      res.status(200).json({ success: true, data: pkgs });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public packCode = async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = packSchema.safeParse(req.body);
      const pkg = await deploymentService.createPackage(parsed.success ? parsed.data : undefined);
      res.status(201).json({ success: true, message: 'Code packaged successfully', data: pkg });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public deployAll = async (req: Request, res: Response): Promise<void> => {
    try {
      const latest = await deploymentService.getLatestPackage();
      const bots = await botService.getBots();
      const results: any[] = [];

      for (const b of bots) {
        b.code_version = latest.package_name;
        results.push({ botId: b.id, version: latest.package_name, status: 'updated' });
      }

      // Log in audit_logs
      try {
        const pool = getPool();
        await pool.query(
          `INSERT INTO audit_logs (actor, action, target_type, target_id, metadata, created_at)
           VALUES ('admin', 'DEPLOY_CODE_ALL_BOTS', 'SYSTEM', $1, $2, NOW());`,
          [latest.id, JSON.stringify({ package: latest.package_name, botsCount: bots.length })]
        );
      } catch {
        // ignore
      }

      res.status(200).json({
        success: true,
        message: `Package '${latest.package_name}' deployed to all ${bots.length} machines.`,
        data: results,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public deployBot = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const latest = await deploymentService.getLatestPackage();
      const bot = await botService.getBotById(id);

      if (!bot) {
        res.status(404).json({ success: false, error: 'bot_not_found' });
        return;
      }

      bot.code_version = latest.package_name;

      try {
        const pool = getPool();
        await pool.query(
          `INSERT INTO audit_logs (actor, action, target_type, target_id, metadata, created_at)
           VALUES ('admin', 'DEPLOY_CODE_SINGLE_BOT', 'BOT_AGENT', $1, $2, NOW());`,
          [id, JSON.stringify({ package: latest.package_name, botId: id })]
        );
      } catch {
        // ignore
      }

      res.status(200).json({
        success: true,
        message: `Package '${latest.package_name}' deployed to bot '${id}'.`,
        data: { botId: id, version: latest.package_name },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };
}

export const deploymentController = new DeploymentController();
