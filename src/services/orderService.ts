import { getPool } from '../db/connection';
import { Order, OrderEvent, OrderStatus } from '../types';
import { killSwitchService } from './killSwitchService';

export class OrderService {
  private inMemoryOrders: Order[] = [
    {
      id: 1,
      external_order_id: 'TEST-ORDER-001',
      status: 'completed',
      amount: 1250.0,
      currency: 'THB',
      assigned_bot_id: 'bot-02',
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 2,
      external_order_id: 'TEST-ORDER-002',
      status: 'pending',
      amount: 499.0,
      currency: 'THB',
      created_at: new Date(),
      updated_at: new Date(),
    },
  ];

  public async getOrders(status?: string, limit: number = 20): Promise<Order[]> {
    try {
      const pool = getPool();
      let sql = `SELECT * FROM orders ORDER BY created_at DESC LIMIT $1;`;
      let params: any[] = [limit];

      if (status) {
        sql = `SELECT * FROM orders WHERE status = $1 ORDER BY created_at DESC LIMIT $2;`;
        params = [status, limit];
      }

      const res = await pool.query(sql, params);
      if (res.rows.length > 0) {
        return res.rows.map((r) => ({
          id: parseInt(r.id, 10),
          external_order_id: r.external_order_id,
          status: r.status as OrderStatus,
          amount: parseFloat(r.amount),
          currency: r.currency,
          assigned_bot_id: r.assigned_bot_id,
          created_at: new Date(r.created_at),
          updated_at: new Date(r.updated_at),
        }));
      }
    } catch {
      // In-memory fallback
    }
    return this.inMemoryOrders;
  }

  public async getOrderById(orderId: number | string): Promise<{ order: Order; events: OrderEvent[] } | null> {
    const orders = await this.getOrders();
    const order = orders.find((o) => o.id === Number(orderId) || o.external_order_id === String(orderId));
    if (!order) return null;

    let events: OrderEvent[] = [];
    try {
      const pool = getPool();
      const res = await pool.query(
        `SELECT * FROM order_events WHERE order_id = $1 ORDER BY created_at ASC;`,
        [order.id]
      );
      events = res.rows.map((r) => ({
        id: parseInt(r.id, 10),
        order_id: parseInt(r.order_id, 10),
        event_type: r.event_type,
        payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
        created_at: new Date(r.created_at),
      }));
    } catch {
      // Fallback dummy events
      events = [
        {
          id: 1,
          order_id: order.id,
          event_type: 'ORDER_CREATED',
          payload: { external_order_id: order.external_order_id, amount: order.amount },
          created_at: order.created_at,
        },
      ];
    }

    return { order, events };
  }

  public async createOrder(
    externalOrderId: string,
    amount: number = 100,
    currency: string = 'THB'
  ): Promise<Order> {
    const newOrder: Order = {
      id: Date.now(),
      external_order_id: externalOrderId,
      status: 'pending',
      amount,
      currency,
      created_at: new Date(),
      updated_at: new Date(),
    };

    try {
      const pool = getPool();
      const res = await pool.query(
        `INSERT INTO orders (external_order_id, status, amount, currency, created_at, updated_at)
         VALUES ($1, 'pending', $2, $3, NOW(), NOW())
         RETURNING *;`,
        [externalOrderId, amount, currency]
      );
      if (res.rows.length > 0) {
        newOrder.id = parseInt(res.rows[0].id, 10);
      }

      await pool.query(
        `INSERT INTO order_events (order_id, event_type, payload, created_at)
         VALUES ($1, 'ORDER_CREATED', $2, NOW());`,
        [newOrder.id, JSON.stringify({ externalOrderId, amount, currency })]
      );
    } catch (err: any) {
      console.warn('[Order DB Create Warning]:', err.message);
    }

    try {
      const { auditLogService } = require('./auditLogService');
      auditLogService.log('OPERATOR', 'ORDER_CREATED', 'ORDER', String(newOrder.id), {
        externalOrderId,
        amount,
        currency,
      });
    } catch {}

    this.inMemoryOrders.unshift(newOrder);
    return newOrder;
  }

  // Dispatch Order to Bot (Checks Global Kill-Switch & Bot Online Status First!)
  public async dispatchOrder(
    orderId: number | string,
    botId: string
  ): Promise<{ success: boolean; order: Order; message: string }> {
    // 1. Check Global Kill-Switch!
    const killSwitch = await killSwitchService.getStatus();
    if (!killSwitch.isEnabled) {
      throw new Error('KILL_SWITCH_ACTIVE: Cannot dispatch order while global system is turned off.');
    }

    const { order } = (await this.getOrderById(orderId)) || {};
    if (!order) {
      throw new Error(`Order #${orderId} not found.`);
    }

    // 2. Validate Target Bot is Online & Available
    const { botService } = require('./botService');
    const bot = await botService.getBotById(botId);
    if (!bot) {
      throw new Error(`BOT_NOT_FOUND: ไม่พบเครื่องบอท '${botId}' ในระบบ`);
    }
    if (bot.status !== 'online') {
      throw new Error(`BOT_NOT_AVAILABLE: บอท '${botId}' (${bot.name}) อยู่ในสถานะ '${bot.status.toUpperCase()}' ไม่พร้อมรับงาน (กรุณากด "เริ่มทำงาน" ที่เครื่องบอทก่อน)`);
    }

    order.status = 'processing';
    order.assigned_bot_id = botId;
    order.updated_at = new Date();

    try {
      const pool = getPool();
      await pool.query(
        `UPDATE orders SET status = 'processing', updated_at = NOW() WHERE id = $1;`,
        [order.id]
      );
      await pool.query(
        `INSERT INTO order_events (order_id, event_type, payload, created_at)
         VALUES ($1, 'ORDER_DISPATCHED_TO_BOT', $2, NOW());`,
        [order.id, JSON.stringify({ botId, timestamp: new Date() })]
      );
    } catch {
      // Fallback
    }

    try {
      const { auditLogService } = require('./auditLogService');
      auditLogService.log('DISPATCHER', 'ORDER_DISPATCHED', 'ORDER', String(order.id), {
        botId,
        botName: bot.name,
        amount: order.amount,
        externalOrderId: order.external_order_id,
      });
    } catch {}

    return {
      success: true,
      order,
      message: `Order #${orderId} dispatched to bot '${botId}' successfully.`,
    };
  }

  // Complete Order
  public async completeOrder(
    orderId: number | string,
    botId: string,
    result?: Record<string, unknown>
  ): Promise<Order> {
    const { order } = (await this.getOrderById(orderId)) || {};
    if (!order) throw new Error(`Order #${orderId} not found.`);

    // Guard: Validate that the assigned bot is online and active
    const effectiveBotId = botId || order.assigned_bot_id;
    if (effectiveBotId) {
      const { botService } = require('./botService');
      const bot = await botService.getBotById(effectiveBotId);
      if (bot && bot.status !== 'online') {
        throw new Error(
          `BOT_STOPPED: ไม่สามารถกดสำเร็จงานได้ เนื่องจากบอท '${effectiveBotId}' (${bot.name}) อยู่ในสถานะ '${bot.status.toUpperCase()}' (หยุดทำงานอยู่) กรุณากด "เริ่มทำงาน" ก่อน`
        );
      }
    }

    order.status = 'completed';
    order.updated_at = new Date();

    try {
      const pool = getPool();
      await pool.query(
        `UPDATE orders SET status = 'completed', updated_at = NOW() WHERE id = $1;`,
        [order.id]
      );
      await pool.query(
        `INSERT INTO order_events (order_id, event_type, payload, created_at)
         VALUES ($1, 'ORDER_COMPLETED', $2, NOW());`,
        [order.id, JSON.stringify({ botId, result, timestamp: new Date() })]
      );
    } catch {
      // Fallback
    }

    try {
      const { auditLogService } = require('./auditLogService');
      auditLogService.log(botId, 'ORDER_COMPLETED', 'ORDER', String(order.id), {
        result,
        amount: order.amount,
      });
    } catch {}

    return order;
  }

  // Heartbeat Timeout Handling on Orders (Bot crash detector)
  public async handleBotTimeoutOnOrders(crashedBotId: string): Promise<number> {
    const orders = await this.getOrders('processing');
    let updated = 0;

    for (const o of orders) {
      if (o.assigned_bot_id === crashedBotId) {
        o.status = 'failed';
        o.failure_reason = `Assigned bot '${crashedBotId}' stopped sending heartbeat (Node Timeout).`;
        o.updated_at = new Date();
        updated++;

        try {
          const pool = getPool();
          await pool.query(
            `UPDATE orders SET status = 'failed', updated_at = NOW() WHERE id = $1;`,
            [o.id]
          );
          await pool.query(
            `INSERT INTO order_events (order_id, event_type, payload, created_at)
             VALUES ($1, 'BOT_HEARTBEAT_TIMEOUT_ORDER_FAILED', $2, NOW());`,
            [o.id, JSON.stringify({ crashedBotId, reason: o.failure_reason })]
          );
        } catch {
          // Fallback
        }
      }
    }

    return updated;
  }
}

export const orderService = new OrderService();
