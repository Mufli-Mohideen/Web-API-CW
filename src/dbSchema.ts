import type { Db, Document, IndexDescription } from 'mongodb';

/**
 * Database-level integrity: a $jsonSchema validator and the indexes for every collection.
 * Applied idempotently at start-up (collMod on existing collections).
 */

const date = { bsonType: 'date' };
const str = { bsonType: 'string' };
const num = { bsonType: ['double', 'int', 'long', 'decimal'], minimum: 0 };
const nullable = (schema: Document) => ({ ...schema, bsonType: [...[schema.bsonType].flat(), 'null'] });

const specs: Record<string, { validator: Document; indexes: IndexDescription[] }> = {
  provinces: {
    validator: { required: ['_id', 'name', 'created_at', 'updated_at'], properties: { _id: str, name: str } },
    indexes: [{ key: { name: 1 }, unique: true }],
  },
  districts: {
    validator: {
      required: ['_id', 'name', 'province_id', 'created_at', 'updated_at'],
      properties: { _id: str, name: str, province_id: str },
    },
    indexes: [{ key: { name: 1 }, unique: true }, { key: { province_id: 1 } }],
  },
  grid_substations: {
    validator: {
      required: ['_id', 'name', 'district_id', 'province_id'],
      properties: { _id: str, name: str, district_id: str, province_id: str, capacity_mva: nullable(num) },
    },
    indexes: [{ key: { district_id: 1 } }, { key: { province_id: 1 } }],
  },
  solar_installations: {
    validator: {
      required: ['meter_id', 'name', 'capacity_kw', 'status', 'substation_id', 'district_id', 'province_id', 'api_key_hash'],
      properties: {
        meter_id: str,
        name: str,
        capacity_kw: num,
        status: { enum: ['ACTIVE', 'INACTIVE', 'DECOMMISSIONED'] },
        substation_id: str,
        district_id: str,
        province_id: str,
        api_key_hash: str,
        commissioned_at: nullable(date),
      },
    },
    indexes: [
      { key: { meter_id: 1 }, unique: true },
      { key: { api_key_hash: 1 }, unique: true },
      { key: { substation_id: 1 } },
      { key: { district_id: 1 } },
      { key: { province_id: 1 } },
    ],
  },
  generation_readings: {
    validator: {
      required: ['installation_id', 'substation_id', 'district_id', 'province_id', 'timestamp', 'power_kw', 'energy_kwh', 'voltage_v', 'received_at'],
      properties: {
        installation_id: { bsonType: 'objectId' },
        timestamp: date,
        power_kw: num,
        energy_kwh: num,
        voltage_v: num,
        received_at: date,
      },
    },
    indexes: [
      // One reading per installation per instant (retry detection) + history / latest lookups.
      { key: { installation_id: 1, timestamp: -1 }, unique: true },
      // Jurisdiction + time-window filters on the national readings collection.
      { key: { district_id: 1, timestamp: -1 } },
      { key: { province_id: 1, timestamp: -1 } },
      { key: { substation_id: 1, timestamp: -1 } },
      { key: { timestamp: -1 } },
    ],
  },
  users: {
    validator: {
      required: ['email', 'name', 'password_hash', 'role'],
      properties: { email: str, role: { enum: ['ADMIN', 'NATIONAL', 'PROVINCIAL', 'DISTRICT'] } },
    },
    indexes: [{ key: { email: 1 }, unique: true }],
  },
};

export async function ensureSchema(db: Db): Promise<void> {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const [name, spec] of Object.entries(specs)) {
    const validator = { $jsonSchema: { bsonType: 'object', ...spec.validator } };
    if (existing.has(name)) {
      await db.command({ collMod: name, validator, validationLevel: 'strict' });
    } else {
      await db.createCollection(name, { validator, validationLevel: 'strict' });
    }
    await db.collection(name).createIndexes(spec.indexes);
  }
}
