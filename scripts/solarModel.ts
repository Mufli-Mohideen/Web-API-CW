/**
 * Synthetic but plausible rooftop PV behaviour for seeding and device simulation:
 * zero overnight, a sine-shaped rise and fall between sunrise and sunset (Sri Lanka
 * time), scaled by capacity, a per-district daily weather factor and per-slot cloud noise.
 */

export const SLOT_MINUTES = 15;
export const SLOT_MS = SLOT_MINUTES * 60 * 1000;
const COLOMBO_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const SUNRISE_H = 6.0;
const SUNSET_H = 18.25;
const PERFORMANCE_RATIO = 0.82;

/** Small deterministic PRNG (mulberry32) so seeds are reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Fraction of clear-sky output (0..1) at an instant, from local solar hour. */
export function solarFraction(at: Date): number {
  const local = new Date(at.getTime() + COLOMBO_OFFSET_MS);
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  if (hour <= SUNRISE_H || hour >= SUNSET_H) return 0;
  return Math.pow(Math.sin((Math.PI * (hour - SUNRISE_H)) / (SUNSET_H - SUNRISE_H)), 1.25);
}

/** Weather factor for a district on a local day (0.45 overcast .. 1 clear). */
export function weatherFactor(districtId: string, at: Date): number {
  const day = new Date(at.getTime() + COLOMBO_OFFSET_MS).toISOString().slice(0, 10);
  return 0.45 + 0.55 * rng(hash(`${districtId}:${day}`))();
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/** One reading's instantaneous values for an installation at a slot. */
export function simulateSlot(opts: { meterId: string; districtId: string; capacityKw: number; at: Date }) {
  const random = rng(hash(`${opts.meterId}:${opts.at.getTime()}`));
  const sun = solarFraction(opts.at);
  const cloud = sun > 0 ? 0.85 + 0.15 * random() - (random() < 0.08 ? 0.4 * random() : 0) : 0;
  const powerKw = round(Math.max(0, opts.capacityKw * PERFORMANCE_RATIO * sun * weatherFactor(opts.districtId, opts.at) * cloud), 3);
  // AC-side voltage around 230 V nominal, rising slightly while exporting.
  const voltageV = round(229 + (random() - 0.5) * 5 + (opts.capacityKw > 0 ? (powerKw / opts.capacityKw) * 4 : 0), 1);
  return { powerKw, voltageV, energyIncrementKwh: powerKw * (SLOT_MINUTES / 60) };
}

/** Floor an instant to its 15-minute reporting slot. */
export function floorToSlot(at: Date): Date {
  return new Date(Math.floor(at.getTime() / SLOT_MS) * SLOT_MS);
}
