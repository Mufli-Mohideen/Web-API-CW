import { app } from './app';
import { env } from './config/env';
import { closeDB, connectDB } from './db';

connectDB()
  .then(() => {
    const server = app.listen(env.port, () => {
      console.log(`SLSEA Solar API listening on port ${env.port} (${env.nodeEnv})`);
    });
    const shutdown = () => server.close(() => void closeDB().then(() => process.exit(0)));
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  })
  .catch((error: Error) => {
    console.error('Failed to connect to MongoDB:', error.message);
    process.exit(1);
  });
