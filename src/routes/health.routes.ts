import { Router } from 'express';
import { pingDB } from '../db';

export const healthRouter = Router();

// Liveness + database readiness, used to demonstrate the deployment is operational.
healthRouter.get('/', async (_req, res) => {
  const database = (await pingDB()) ? 'up' : 'down';
  res.set('Cache-Control', 'no-store');
  res.status(database === 'up' ? 200 : 503).json({
    status: database === 'up' ? 'ok' : 'degraded',
    database,
    timestamp: new Date().toISOString(),
  });
});
