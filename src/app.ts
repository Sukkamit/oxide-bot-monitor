import express from 'express';
import path from 'path';
import { botController } from './controllers/botController';
import { systemController } from './controllers/systemController';
import { deploymentController } from './controllers/deploymentController';
import { orderController } from './controllers/orderController';

export const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Health check
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'oxide-bot-monitor', timestamp: new Date().toISOString() });
});

// System & Overview Routes
app.get('/api/v1/overview', systemController.getOverview);
app.get('/api/v1/system/kill-switch', systemController.getKillSwitch);
app.post('/api/v1/system/kill-switch', systemController.toggleKillSwitch);
app.get('/api/v1/system/audit-logs', systemController.getAuditLogs);

// Bot Management & Telemetry Routes
app.get('/api/v1/bots', botController.getBots);
app.post('/api/v1/bots/watchdog/check', botController.checkWatchdog);
app.get('/api/v1/bots/:id', botController.getBot);
app.post('/api/v1/bots/:id/commands', botController.sendCommand);
app.post('/api/v1/bots/:id/heartbeat', botController.heartbeat);

// Code Deployment & Packaging Routes
app.get('/api/v1/deployments/packages', deploymentController.getPackages);
app.post('/api/v1/deployments/packages', deploymentController.packCode);
app.post('/api/v1/deployments/deploy-all', deploymentController.deployAll);
app.post('/api/v1/deployments/deploy-bot/:id', deploymentController.deployBot);

// Order Tracking & State Machine Routes
app.get('/api/v1/orders', orderController.getOrders);
app.post('/api/v1/orders', orderController.createOrder);
app.get('/api/v1/orders/:id', orderController.getOrder);
app.post('/api/v1/orders/:id/dispatch', orderController.dispatchOrder);
app.post('/api/v1/orders/:id/complete', orderController.completeOrder);

// Dashboard SPA Fallback
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});
