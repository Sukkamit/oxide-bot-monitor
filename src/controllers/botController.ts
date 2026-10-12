import { Request, Response } from 'express';
import { z } from 'zod';
import { botService } from '../services/botService';
import { BotCommandType } from '../types';

const commandSchema = z.object({
  command: z.enum(['start', 'stop', 'restart', 'status', 'update_code']),
  requestedBy: z.string().optional().default('admin'),
});

const heartbeatSchema = z.object({
  cpu: z.number().optional(),
  memory: z.number().optional(),
  uptime: z.number().optional(),
  status: z.enum(['online', 'offline', 'starting', 'stopping', 'error']).optional(),
});

export class BotController {
  public getBots = async (_req: Request, res: Response): Promise<void> => {
    try {
      const bots = await botService.getBots();
      res.status(200).json({ success: true, data: bots });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public getBot = async (req: Request, res: Response): Promise<void> => {
    try {
      const bot = await botService.getBotById(req.params.id);
      if (!bot) {
        res.status(404).json({ success: false, error: 'bot_not_found' });
        return;
      }
      res.status(200).json({ success: true, data: bot });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public sendCommand = async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = commandSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: 'invalid_command', details: parsed.error.issues });
        return;
      }

      const result = await botService.sendCommand(
        req.params.id,
        parsed.data.command as BotCommandType,
        parsed.data.requestedBy
      );

      res.status(200).json(result);
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  };

  public heartbeat = async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = heartbeatSchema.safeParse(req.body);
      const metrics = parsed.success ? parsed.data : undefined;
      const bot = await botService.receiveHeartbeat(req.params.id, metrics);
      res.status(200).json({ success: true, data: bot });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public checkWatchdog = async (_req: Request, res: Response): Promise<void> => {
    try {
      const timedOutBots = await botService.checkHeartbeatTimeouts(30);
      res.status(200).json({ success: true, data: { timedOutBots } });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };
}

export const botController = new BotController();
