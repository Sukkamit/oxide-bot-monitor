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
  botId: z.string().optional().default('bot-02'),
  bot_id: z.string().optional(),
});

export class OrderController {
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
      const orderId = parseInt(req.params.id, 10);
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
      const orderId = parseInt(req.params.id, 10);
      const parsed = dispatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: 'invalid_dispatch_data', details: parsed.error.issues });
        return;
      }

      // Automatically select an online bot if not specified
      const { botService } = require('../services/botService');
      const bots = await botService.getBots();
      const onlineBot = bots.find((b: any) => b.status === 'online') || bots[0];
      const targetBotId = parsed.data.bot_id || parsed.data.botId || onlineBot?.id || 'bot-02';

      const result = await orderService.dispatchOrder(orderId, targetBotId);
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
      const orderId = parseInt(req.params.id, 10);
      const botId = req.body?.botId || 'bot-01';
      const order = await orderService.completeOrder(orderId, botId, req.body?.result);
      res.status(200).json({ success: true, data: order });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  };
}

export const orderController = new OrderController();
