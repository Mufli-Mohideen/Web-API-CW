import dns from 'node:dns';
import { MongoClient, type Db } from 'mongodb';
import { env } from './config/env';
import { ensureSchema } from './dbSchema';
import type {
  DistrictDoc,
  GenerationReadingDoc,
  GridSubstationDoc,
  ProvinceDoc,
  SolarInstallationDoc,
  UserDoc,
} from './types';

// Public resolvers for the mongodb+srv:// SRV lookup (some local networks block it).
if (env.mongoUri.startsWith('mongodb+srv://')) dns.setServers(['8.8.8.8', '8.8.4.4']);

const client = new MongoClient(env.mongoUri);
let db: Db | null = null;

export async function connectDB(): Promise<Db> {
  if (db) return db;
  await client.connect();
  db = client.db(env.mongoDbName);
  await ensureSchema(db);
  console.log(`Connected to MongoDB (${env.mongoDbName})`);
  return db;
}

export function getDB(): Db {
  if (!db) throw new Error('Database not initialised. Call connectDB() before handling requests.');
  return db;
}

export async function closeDB(): Promise<void> {
  await client.close();
  db = null;
}

export async function pingDB(): Promise<boolean> {
  try {
    await getDB().command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

/** Typed collection handles. */
export const collections = {
  provinces: () => getDB().collection<ProvinceDoc>('provinces'),
  districts: () => getDB().collection<DistrictDoc>('districts'),
  substations: () => getDB().collection<GridSubstationDoc>('grid_substations'),
  installations: () => getDB().collection<SolarInstallationDoc>('solar_installations'),
  readings: () => getDB().collection<GenerationReadingDoc>('generation_readings'),
  users: () => getDB().collection<UserDoc>('users'),
};
