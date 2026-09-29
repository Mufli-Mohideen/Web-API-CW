import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

/** MongoDB Atlas connection string built from its parts, unless MONGODB_URI overrides it. */
function mongoUri(): string {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const user = encodeURIComponent(required('MONGO_USER'));
  const password = encodeURIComponent(required('MONGO_PASSWORD'));
  return `mongodb+srv://${user}:${password}@${required('MONGO_CLUSTER')}/?retryWrites=true&w=majority`;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  mongoUri: mongoUri(),
  mongoDbName: process.env.MONGO_DB_NAME ?? 'slsea_solar_db',
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
};
