import { Router } from 'express';
import { prisma } from '../lib/prisma';

export const healthRouter = Router();

// Liveness + database readiness, used to demonstrate the deployment is operational.
healthRouter.get('/', async (_req, res) => {
  let database = 'up';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'down';
  }
  res.status(database === 'up' ? 200 : 503).json({
    status: database === 'up' ? 'ok' : 'degraded',
    database,
    timestamp: new Date().toISOString(),
  });
});
