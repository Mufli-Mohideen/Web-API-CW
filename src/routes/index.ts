import { Router } from 'express';
import { authenticateUser } from '../middleware/authenticate';
import { authRouter } from './auth.routes';
import { districtsRouter } from './districts.routes';
import { healthRouter } from './health.routes';
import { installationsRouter } from './installations.routes';
import { provincesRouter } from './provinces.routes';
import { readingsRouter } from './readings.routes';
import { substationsRouter } from './substations.routes';
import { usersRouter } from './users.routes';

export const apiRouter = Router();

// Public
apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);

// Read path: SLSEA users (JWT), scoped by jurisdiction
apiRouter.use('/users', authenticateUser, usersRouter);
apiRouter.use('/provinces', authenticateUser, provincesRouter);
apiRouter.use('/districts', authenticateUser, districtsRouter);
apiRouter.use('/substations', authenticateUser, substationsRouter);
apiRouter.use('/readings', authenticateUser, readingsRouter);

// Mixed: user reads + ADMIN registry writes (JWT), and device reading ingestion (device key).
// Authentication is therefore applied per route inside this router.
apiRouter.use('/installations', installationsRouter);
