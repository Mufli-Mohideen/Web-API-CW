/**
 * Seeds the database with a foreign-key-consistent dataset:
 *   9 provinces, 25 districts, 30 grid substations, 240 solar installations,
 *   7 users (one per role/jurisdiction), and 15-minute generation readings for every
 *   installation from 7 days before today (local time) up to now.
 *
 * Usage: npm run seed            (drops and recreates all collections)
 * Env:   DEVICE_KEY_SECRET       derives each seeded device's API key (see scripts/device-key.ts)
 *        SEED_USER_PASSWORD      password for the demo users (default Slsea@2026)
 */
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import { deriveDeviceKey, hashDeviceKey } from '../src/auth/deviceKeys';
import { closeDB, collections, connectDB, getDB } from '../src/db';
import { ensureSchema } from '../src/dbSchema';
import { addDays, localDayStart } from '../src/time';
import type { GenerationReadingDoc, SolarInstallationDoc, UserDoc } from '../src/types';
import { DEMO_USERS, DISTRICTS, PROVINCES, SUBSTATIONS, TYPICAL_CAPACITIES_KW } from './seedData';
import { floorToSlot, hash, rng, simulateSlot, SLOT_MS } from './solarModel';

const HISTORY_DAYS = 7;
const BATCH_SIZE = 10_000;

export const deviceKeySecret = process.env.DEVICE_KEY_SECRET ?? 'slsea-demo-device-secret';
const userPassword = process.env.SEED_USER_PASSWORD ?? 'Slsea@2026';

/** Stable ObjectId for the n-th seeded installation, so ids survive a re-seed. */
export const installationObjectId = (n: number) => new ObjectId(`65f0a1b2c3d4e5f6${n.toString(16).padStart(8, '0')}`);
export const meterIdFor = (n: number) => `SLM-${String(n).padStart(6, '0')}`;

async function main() {
  if (!process.env.DEVICE_KEY_SECRET) console.warn('DEVICE_KEY_SECRET not set: using the demo secret');
  await connectDB();
  const db = getDB();
  for (const name of ['provinces', 'districts', 'grid_substations', 'solar_installations', 'generation_readings', 'users']) {
    await db.collection(name).drop().catch(() => undefined);
  }
  await ensureSchema(db);

  const now = new Date();
  const random = rng(20260930);

  // --- Hierarchy ----------------------------------------------------------------------------
  await collections.provinces().insertMany(PROVINCES.map((p) => ({ _id: p.id, name: p.name, created_at: now, updated_at: now })));
  await collections.districts().insertMany(
    DISTRICTS.map((d) => ({ _id: d.id, name: d.name, province_id: d.province, created_at: now, updated_at: now })),
  );
  const substations = DISTRICTS.flatMap((d) =>
    SUBSTATIONS[d.id].map((name, i) => ({
      _id: `SS-${d.id}-${String(i + 1).padStart(2, '0')}`,
      name: `${name} Grid Substation`,
      district_id: d.id,
      province_id: d.province,
      capacity_mva: [31.5, 63, 90, 126][Math.floor(random() * 4)],
      created_at: now,
      updated_at: now,
    })),
  );
  await collections.substations().insertMany(substations);

  // --- Installations ------------------------------------------------------------------------
  const installations: SolarInstallationDoc[] = [];
  let n = 0;
  for (const district of DISTRICTS) {
    const local = substations.filter((s) => s.district_id === district.id);
    for (let i = 0; i < district.installations; i++) {
      n += 1;
      const substation = local[i % local.length];
      const meterId = meterIdFor(n);
      const status = n % 60 === 0 ? 'INACTIVE' : 'ACTIVE'; // a few offline sites
      installations.push({
        _id: installationObjectId(n),
        meter_id: meterId,
        name: `${district.name} Rooftop ${String(i + 1).padStart(3, '0')}`,
        address: `No. ${1 + Math.floor(random() * 250)}, ${substation.name.replace(' Grid Substation', '')} Road, ${district.name}`,
        location: {
          latitude: Math.round((district.lat + (random() - 0.5) * 0.12) * 1e5) / 1e5,
          longitude: Math.round((district.lng + (random() - 0.5) * 0.12) * 1e5) / 1e5,
        },
        capacity_kw: TYPICAL_CAPACITIES_KW[Math.floor(random() * TYPICAL_CAPACITIES_KW.length)],
        status,
        commissioned_at: new Date(Date.UTC(2019 + Math.floor(random() * 6), Math.floor(random() * 12), 1 + Math.floor(random() * 28))),
        substation_id: substation._id,
        district_id: district.id,
        province_id: district.province,
        api_key_hash: hashDeviceKey(deriveDeviceKey(deviceKeySecret, meterId)),
        created_at: now,
        updated_at: now,
      });
    }
  }
  await collections.installations().insertMany(installations);

  // --- Users --------------------------------------------------------------------------------
  const passwordHash = await bcrypt.hash(userPassword, 10);
  const users: UserDoc[] = DEMO_USERS.map((u) => ({
    _id: new ObjectId(),
    email: u.email,
    name: u.name,
    password_hash: passwordHash,
    role: u.role,
    province_id: u.province,
    district_id: u.district,
    created_at: now,
    updated_at: now,
  }));
  await collections.users().insertMany(users);

  // --- Generation readings (append-only time series) ----------------------------------------
  const start = addDays(localDayStart(now), -HISTORY_DAYS);
  const end = floorToSlot(now);
  let batch: GenerationReadingDoc[] = [];
  let total = 0;
  const flush = async () => {
    if (!batch.length) return;
    await collections.readings().insertMany(batch, { ordered: false });
    total += batch.length;
    batch = [];
    process.stdout.write(`\r  readings: ${total}`);
  };

  for (const installation of installations) {
    // Lifetime counter at the start of the window: roughly its age x typical daily yield.
    const ageDays = (start.getTime() - installation.commissioned_at!.getTime()) / 86_400_000;
    let energy = Math.round(ageDays * installation.capacity_kw * 3.6 * (0.8 + 0.2 * rng(hash(installation.meter_id))()));
    // Inactive sites stopped reporting two days ago.
    const stopAt = installation.status === 'ACTIVE' ? end : addDays(end, -2);
    for (let t = start.getTime(); t <= stopAt.getTime(); t += SLOT_MS) {
      const at = new Date(t);
      const slot = simulateSlot({ meterId: installation.meter_id, districtId: installation.district_id, capacityKw: installation.capacity_kw, at });
      energy += slot.energyIncrementKwh;
      batch.push({
        _id: new ObjectId(),
        installation_id: installation._id,
        substation_id: installation.substation_id,
        district_id: installation.district_id,
        province_id: installation.province_id,
        timestamp: at,
        power_kw: slot.powerKw,
        energy_kwh: Math.round(energy * 1000) / 1000,
        voltage_v: slot.voltageV,
        received_at: new Date(t + 5_000 + Math.floor(rng(t)() * 20_000)),
      });
      if (batch.length >= BATCH_SIZE) await flush();
    }
  }
  await flush();

  console.log(`\nSeeded ${PROVINCES.length} provinces, ${DISTRICTS.length} districts, ${substations.length} substations, ` +
    `${installations.length} installations, ${users.length} users, ${total} readings.`);
  console.log(`Demo users (password "${userPassword}"): ${DEMO_USERS.map((u) => u.email).join(', ')}`);
  console.log('Demo devices:');
  for (const i of installations.slice(0, 3)) {
    console.log(`  installation ${i._id.toHexString()}  ${i.meter_id}  X-Device-Key: ${deriveDeviceKey(deviceKeySecret, i.meter_id)}`);
  }
  await closeDB();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error);
    await closeDB();
    process.exit(1);
  });
}
