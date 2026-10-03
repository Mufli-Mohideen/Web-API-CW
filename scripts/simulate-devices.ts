/**
 * Device simulator: acts as every ACTIVE installation's metering device and pushes the
 * readings due since its last report, through the public write path
 * (POST /installations/{id}/readings with X-Device-Key). Keeps the deployed dataset "live".
 *
 * Usage: npm run simulate -- https://your-deployment.example.com
 * Env:   DEVICE_KEY_SECRET (as used to seed), SEED_USER_PASSWORD (to read the last report)
 */
import 'dotenv/config';
import { deriveDeviceKey } from '../src/auth/deviceKeys';
import { floorToSlot, simulateSlot, SLOT_MS } from './solarModel';

const base = (process.argv[2] ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, '') + '/api/v1';
const secret = process.env.DEVICE_KEY_SECRET ?? 'slsea-demo-device-secret';
const password = process.env.SEED_USER_PASSWORD ?? 'Slsea@2026';
// GitHub only honours the 15-minute schedule loosely (runs can be hours apart on a quiet repo),
// so each run back-fills up to 12 hours of missed slots; anything older stays a gap.
const MAX_POSTS_PER_DEVICE = Number(process.env.MAX_POSTS_PER_DEVICE ?? 48);
const CONCURRENCY = 16;

interface Installation {
  id: string;
  meter_id: string;
  district_id: string;
  capacity_kw: number;
}

async function json(res: Response) {
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function main() {
  // Reading the last report needs a read-client token (devices cannot read).
  const login = await fetch(`${base}/auth/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'national@slsea.lk', password }),
  });
  if (!login.ok) throw new Error(`login failed: ${login.status}`);
  const token = (await json(login)).access_token as string;
  const auth = { Authorization: `Bearer ${token}` };

  const list = await json(await fetch(`${base}/installations?status=ACTIVE&page_size=500`, { headers: auth }));
  const installations: Installation[] = list.data;
  const now = floorToSlot(new Date());
  const stats = { created: 0, replayed: 0, failed: 0 };

  async function simulate(installation: Installation) {
    const latestRes = await fetch(`${base}/installations/${installation.id}/latest-reading`, { headers: auth });
    if (!latestRes.ok) return;
    const latest = await json(latestRes);
    let energy: number = latest.energy_kwh;
    const due: { timestamp: string; power_kw: number; energy_kwh: number; voltage_v: number }[] = [];
    // The cumulative counter keeps counting through any gap; only the last few slots are posted.
    for (let t = floorToSlot(new Date(latest.timestamp)).getTime() + SLOT_MS; t <= now.getTime(); t += SLOT_MS) {
      const slot = simulateSlot({ meterId: installation.meter_id, districtId: installation.district_id, capacityKw: installation.capacity_kw, at: new Date(t) });
      energy += slot.energyIncrementKwh;
      due.push({ timestamp: new Date(t).toISOString(), power_kw: slot.powerKw, energy_kwh: Math.round(energy * 1000) / 1000, voltage_v: slot.voltageV });
    }
    for (const reading of due.slice(-MAX_POSTS_PER_DEVICE)) {
      const res = await fetch(`${base}/installations/${installation.id}/readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Key': deriveDeviceKey(secret, installation.meter_id) },
        body: JSON.stringify(reading),
      });
      if (res.status === 201) stats.created += 1;
      else if (res.status === 200) stats.replayed += 1;
      else {
        stats.failed += 1;
        console.warn(`${installation.meter_id} ${reading.timestamp}: ${res.status} ${await res.text()}`);
      }
    }
  }

  const queue = [...installations];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await simulate(next);
    }),
  );
  console.log(`Simulated ${installations.length} devices up to ${now.toISOString()}: ${stats.created} created, ${stats.replayed} replayed, ${stats.failed} failed`);
  if (stats.failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
