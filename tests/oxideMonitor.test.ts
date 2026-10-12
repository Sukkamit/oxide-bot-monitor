import request from 'supertest';
import { app } from '../src/app';
import { killSwitchService } from '../src/services/killSwitchService';
import { botService } from '../src/services/botService';
import { deploymentService } from '../src/services/deploymentService';
import { orderService } from '../src/services/orderService';

describe('OXIDE Bot Monitor & Centralized Order Service Test Suite', () => {
  beforeEach(async () => {
    // Reset Kill Switch to Enabled by default
    await killSwitchService.setStatus(true, 'test_runner');
  });

  describe('1. System Health & Overview Summary', () => {
    it('GET /health should return 200 OK', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('oxide-bot-monitor');
    });

    it('GET /api/v1/overview should return metrics matching UI specification', async () => {
      const res = await request(app).get('/api/v1/overview');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('onlineCount');
      expect(res.body.data).toHaveProperty('activeCount');
      expect(res.body.data).toHaveProperty('standbyCount');
      expect(res.body.data).toHaveProperty('totalMachines');
      expect(res.body.data.totalMachines).toBeGreaterThanOrEqual(3);
      expect(res.body.data.killSwitchActive).toBe(true);
      expect(res.body.data.latestPackage).toBeDefined();
    });
  });

  describe('2. Global System Control (Kill-Switch)', () => {
    it('GET /api/v1/system/kill-switch should return current status', async () => {
      const res = await request(app).get('/api/v1/system/kill-switch');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isEnabled).toBe(true);
      expect(res.body.data.status).toBe('ENABLED');
    });

    it('POST /api/v1/system/kill-switch should disable the entire system', async () => {
      const res = await request(app)
        .post('/api/v1/system/kill-switch')
        .send({ enabled: false, actor: 'admin_test' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isEnabled).toBe(false);
      expect(res.body.data.status).toBe('DISABLED');

      const overview = await request(app).get('/api/v1/overview');
      expect(overview.body.data.killSwitchActive).toBe(false);
    });

    it('Reject order dispatch when Kill-Switch is active (DISABLED)', async () => {
      // 1. Disable Kill-Switch
      await killSwitchService.setStatus(false, 'test_runner');

      // 2. Create an order
      const createRes = await request(app)
        .post('/api/v1/orders')
        .send({ externalOrderId: 'KILL-SW-TEST-001', amount: 350 });
      expect(createRes.status).toBe(201);
      const orderId = createRes.body.data.id;

      // 3. Attempt dispatch - MUST be rejected!
      const dispatchRes = await request(app)
        .post(`/api/v1/orders/${orderId}/dispatch`)
        .send({ botId: 'bot-02' });

      expect(dispatchRes.status).toBe(400);
      expect(dispatchRes.body.success).toBe(false);
      expect(dispatchRes.body.error).toContain('KILL_SWITCH_ACTIVE');

      // 4. Re-enable Kill-Switch and verify dispatch works
      await killSwitchService.setStatus(true, 'test_runner');
      const retryDispatch = await request(app)
        .post(`/api/v1/orders/${orderId}/dispatch`)
        .send({ botId: 'bot-02' });

      expect(retryDispatch.status).toBe(200);
      expect(retryDispatch.body.success).toBe(true);
      expect(retryDispatch.body.order.status).toBe('processing');
    });
  });

  describe('3. Bot Instance Fleet & Commands', () => {
    it('GET /api/v1/bots should list all bot agents', async () => {
      const res = await request(app).get('/api/v1/bots');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);

      const bot = res.body.data[0];
      expect(bot).toHaveProperty('id');
      expect(bot).toHaveProperty('name');
      expect(bot).toHaveProperty('device_name');
      expect(bot).toHaveProperty('status');
      expect(bot).toHaveProperty('cpu_percent');
      expect(bot).toHaveProperty('memory_percent');
      expect(bot).toHaveProperty('last_task_desc');
    });

    it('POST /api/v1/bots/:id/commands should send start/stop/restart commands', async () => {
      const res = await request(app)
        .post('/api/v1/bots/bot-02/commands')
        .send({ command: 'restart', requestedBy: 'test_admin' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.command).toBe('restart');
      expect(res.body.botId).toBe('bot-02');
    });

    it('POST /api/v1/bots/:id/heartbeat should update telemetry metrics', async () => {
      const res = await request(app)
        .post('/api/v1/bots/bot-02/heartbeat')
        .send({
          cpu: 14.5,
          memory: 38.2,
          uptime: 9999,
          status: 'online',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.cpu_percent).toBe(14.5);
      expect(res.body.data.memory_percent).toBe(38.2);
    });

    it('POST /api/v1/bots/watchdog/check should detect heartbeat timeouts', async () => {
      const res = await request(app).post('/api/v1/bots/watchdog/check');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('timedOutBots');
    });
  });

  describe('4. Code Deployment & Package Distribution', () => {
    it('GET /api/v1/deployments/packages should return available packages', async () => {
      const res = await request(app).get('/api/v1/deployments/packages');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('POST /api/v1/deployments/packages should pack a new bot code archive', async () => {
      const res = await request(app)
        .post('/api/v1/deployments/packages')
        .send({ customName: 'oxide-test-pack-01' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.package_name).toContain('oxide-test-pack-01');
    });

    it('POST /api/v1/deployments/deploy-all should distribute code to all machines', async () => {
      const res = await request(app).post('/api/v1/deployments/deploy-all');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);

      const botsRes = await request(app).get('/api/v1/bots');
      const latestPkg = (await deploymentService.getLatestPackage()).package_name;
      botsRes.body.data.forEach((b: any) => {
        expect(b.code_version).toBe(latestPkg);
      });
    });

    it('POST /api/v1/deployments/deploy-bot/:id should update a specific bot', async () => {
      const res = await request(app).post('/api/v1/deployments/deploy-bot/bot-03');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.botId).toBe('bot-03');
    });
  });

  describe('5. Order Tracking & State Machine Workflow', () => {
    let testOrderId: number;

    it('POST /api/v1/orders should create an order in PENDING status', async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .send({ externalOrderId: 'ORD-TEST-999', amount: 1200, currency: 'THB' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.external_order_id).toBe('ORD-TEST-999');
      expect(res.body.data.status).toBe('pending');
      testOrderId = res.body.data.id;
    });

    it('POST /api/v1/orders/:id/dispatch should dispatch to assigned bot', async () => {
      const res = await request(app)
        .post(`/api/v1/orders/${testOrderId}/dispatch`)
        .send({ botId: 'bot-02' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.order.status).toBe('processing');
      expect(res.body.order.assigned_bot_id).toBe('bot-02');
    });

    it('POST /api/v1/orders/:id/complete should mark order as COMPLETED', async () => {
      const res = await request(app)
        .post(`/api/v1/orders/${testOrderId}/complete`)
        .send({ botId: 'bot-02', result: { txId: 'TX-OXIDE-1234' } });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('completed');
    });
  });

  describe('6. Audit Logs', () => {
    it('GET /api/v1/system/audit-logs should return history of operations', async () => {
      const res = await request(app).get('/api/v1/system/audit-logs');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
