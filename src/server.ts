import { env } from './config/env';
import { app } from './app';
import { prisma } from './lib/prisma';

const server = app.listen(env.port, () => {
  console.log(`SLSEA Solar API listening on port ${env.port} (${env.nodeEnv})`);
});

function shutdown() {
  server.close(() => {
    void prisma.$disconnect().then(() => process.exit(0));
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
