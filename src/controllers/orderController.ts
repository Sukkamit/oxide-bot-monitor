import { Request, Response } from 'express';
import { z } from 'zod';
import { orderService } from '../services/orderService';

const createOrderSchema = z.object({
  external_order_id: z.string().optional(),
  externalOrderId: z.string().optional(),
  amount: z.number().positive('amount must be greater than 0').default(100),
  currency: z.string().optional().default('THB'),
});

const dispatchSchema = z.object({
  botId: z.string().optional(),
  bot_id: z.string().optional(),
});

export class OrderController {
  private static roundRobinIndex: number = 0;

  public getOrders = async (req: Request, res: Response): Promise<void> => {
    try {
      const status = req.query.status as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const orders = await orderService.getOrders(status, limit);
      res.status(200).json({ success: true, data: orders });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public getOrder = async (req: Request, res: Response): Promise<void> => {
    try {
      const orderId = isNaN(Number(req.params.id)) ? req.params.id : parseInt(req.params.id, 10);
      const data = await orderService.getOrderById(orderId);
      if (!data) {
        res.status(404).json({ success: false, error: 'order_not_found' });
        return;
      }
      res.status(200).json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  public createOrder = async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = createOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: 'invalid_order_data', details: parsed.error.issues });
        return;
      }

      const extId = parsed.data.external_order_id || parsed.data.externalOrderId || `ORD-${Date.now()}`;
      const amount = parsed.data.amount ?? 100;
      const currency = parsed.data.currency || 'THB';
      const order = await orderService.createOrder(extId, amount, currency);
      res.status(201).json({ success: true, data: order });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  };

  public dispatchOrder = async (req: Request, res: Response): Promise<void> => {
    try {
      const orderId = isNaN(Number(req.params.id)) ? req.params.id : parseInt(req.params.id, 10);
      const parsed = dispatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: 'invalid_dispatch_data', details: parsed.error.issues });
        return;
      }

      const { botService } = require('../services/botService');
      let targetBotId = parsed.data.bot_id || parsed.data.botId;

      if (!targetBotId) {
        // Automatically load-balance across online bots
        const bots = await botService.getBots();
        const onlineBots = bots.filter((b: any) => b.status === 'online');
        if (onlineBots.length > 0) {
          const index = OrderController.roundRobinIndex % onlineBots.length;
          targetBotId = onlineBots[index].id;
          OrderController.roundRobinIndex++;
        } else {
          res.status(400).json({
            success: false,
            error: 'NO_ONLINE_BOTS: ไม่มีบอทเครื่องใดที่ออนไลน์ (Online) อยู่ในระบบ กรุณากด "เริ่มทำงาน" ที่เครื่องบอทก่อนจ่ายงาน',
          });
          return;
        }
      }

      const finalBotId = targetBotId!;
      const result = await orderService.dispatchOrder(orderId, finalBotId);
      botService.updateBotTask(finalBotId, `กำลังประมวลผลออเดอร์ #${orderId}`, 'In Progress');

      try {
        const { wsManager } = require('../ws/websocketServer');
        wsManager.broadcast('order_dispatched', { orderId, botId: finalBotId });
      } catch {}

      res.status(200).json({
        success: true,
        order: result.order,
        data: result.order,
        message: result.message,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  };

  public completeOrder = async (req: Request, res: Response): Promise<void> => {
    try {
      const orderId = isNaN(Number(req.params.id)) ? req.params.id : parseInt(req.params.id, 10);
      const existing = await orderService.getOrderById(orderId);
      const botId = req.body?.botId || existing?.order?.assigned_bot_id || 'bot-01';
      const order = await orderService.completeOrder(orderId, botId, req.body?.result);

      const { botService } = require('../services/botService');
      botService.updateBotTask(botId, `สำเร็จออเดอร์ #${orderId}`, 'Done');

      try {
        const { wsManager } = require('../ws/websocketServer');
        wsManager.broadcast('order_completed', { orderId, botId });
      } catch {}

      res.status(200).json({ success: true, data: order });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  };
}

export const orderController = new OrderController();
