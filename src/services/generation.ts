import type { ObjectId } from 'mongodb';
import { collections } from '../db';
import { addDays, localDate, localDayStart, round, TIMEZONE } from '../time';
import type { DistrictDoc, GenerationReadingDoc, SolarInstallationDoc } from '../types';

/** A reading older than this no longer counts as "generating now". */
export const STALE_AFTER_MINUTES = 30;
const STALE_AFTER_MS = STALE_AFTER_MINUTES * 60 * 1000;

export async function findLatestReading(installationId: ObjectId, at?: Date): Promise<GenerationReadingDoc | null> {
  return collections.readings().findOne(
    { installation_id: installationId, ...(at ? { timestamp: { $lte: at } } : {}) },
    { sort: { timestamp: -1 } }, // served by the unique (installation_id, timestamp) index
  );
}

/**
 * The last-known-reading resource: the most recent reading, enriched with derived fields
 * (utilisation of installed capacity, staleness) rather than returned as a raw row.
 */
export function toLatestReading(installation: SolarInstallationDoc, reading: GenerationReadingDoc, now = new Date()) {
  return {
    installation_id: installation._id.toHexString(),
    meter_id: installation.meter_id,
    reading_id: reading._id.toHexString(),
    timestamp: reading.timestamp.toISOString(),
    power_kw: reading.power_kw,
    energy_kwh: reading.energy_kwh,
    voltage_v: reading.voltage_v,
    received_at: reading.received_at.toISOString(),
    capacity_kw: installation.capacity_kw,
    capacity_utilisation_percent: installation.capacity_kw > 0 ? round((reading.power_kw / installation.capacity_kw) * 100, 1) : 0,
    is_stale: now.getTime() - reading.timestamp.getTime() > STALE_AFTER_MS,
    stale_after_minutes: STALE_AFTER_MINUTES,
  };
}

/** Energy per local day = rise of the cumulative counter within that day. */
export async function dailyEnergy(installationId: ObjectId, days: number, now = new Date()) {
  const from = addDays(localDayStart(now), -(days - 1));
  const rows = await collections
    .readings()
    .aggregate<{ _id: string; max_energy: number; min_energy: number; peak_power: number; count: number }>([
      { $match: { installation_id: installationId, timestamp: { $gte: from, $lte: now } } },
      {
        $group: {
          _id: { $dateToString: { date: '$timestamp', format: '%Y-%m-%d', timezone: TIMEZONE } },
          max_energy: { $max: '$energy_kwh' },
          min_energy: { $min: '$energy_kwh' },
          peak_power: { $max: '$power_kw' },
          count: { $sum: 1 },
        },
      },
    ])
    .toArray();
  const byDay = new Map(rows.map((row) => [row._id, row]));

  return Array.from({ length: days }, (_, i) => {
    const date = localDate(addDays(from, i));
    const row = byDay.get(date);
    return {
      date,
      energy_kwh: row ? round(row.max_energy - row.min_energy) : 0,
      peak_power_kw: row ? row.peak_power : 0,
      readings_count: row?.count ?? 0,
    };
  });
}

/**
 * District generation summary (processing resource): aggregates, across every installation
 * in the district, the power generating now and the energy generated so far today.
 * `at` allows the same figures to be computed for a past instant.
 */
export async function districtSummary(district: DistrictDoc, at: Date) {
  const dayStart = localDayStart(at);
  const [substations, installations] = await Promise.all([
    collections.substations().find({ district_id: district._id }).sort({ _id: 1 }).toArray(),
    collections
      .installations()
      .find({ district_id: district._id }, { projection: { api_key_hash: 0 } })
      .toArray(),
  ]);

  const readings = collections.readings();
  const [latest, today] = await Promise.all([
    // Latest reading per installation within the reporting window.
    readings
      .aggregate<{ _id: ObjectId; timestamp: Date; power_kw: number }>([
        { $match: { district_id: district._id, timestamp: { $gt: new Date(at.getTime() - STALE_AFTER_MS), $lte: at } } },
        { $sort: { installation_id: 1, timestamp: -1 } },
        { $group: { _id: '$installation_id', timestamp: { $first: '$timestamp' }, power_kw: { $first: '$power_kw' } } },
      ])
      .toArray(),
    // Today's energy per installation: rise of its cumulative counter since local midnight.
    readings
      .aggregate<{ _id: ObjectId; energy_kwh: number }>([
        { $match: { district_id: district._id, timestamp: { $gte: dayStart, $lte: at } } },
        { $group: { _id: '$installation_id', max: { $max: '$energy_kwh' }, min: { $min: '$energy_kwh' } } },
        { $project: { energy_kwh: { $subtract: ['$max', '$min'] } } },
      ])
      .toArray(),
  ]);

  const latestBy = new Map(latest.map((row) => [row._id.toHexString(), row]));
  const todayBy = new Map(today.map((row) => [row._id.toHexString(), row.energy_kwh]));

  const totals = { installations: 0, active: 0, reporting: 0, capacity_kw: 0, power_kw: 0, energy_kwh: 0 };
  const perSubstation = new Map(substations.map((s) => [s._id, { ...totals }]));
  let lastReadingAt: Date | null = null;

  for (const installation of installations) {
    const id = installation._id.toHexString();
    const live = latestBy.get(id);
    const sub = perSubstation.get(installation.substation_id);
    for (const bucket of sub ? [totals, sub] : [totals]) {
      bucket.installations += 1;
      if (installation.status === 'ACTIVE') {
        bucket.active += 1;
        bucket.capacity_kw += installation.capacity_kw;
      }
      if (live) {
        bucket.reporting += 1;
        bucket.power_kw += live.power_kw;
      }
      bucket.energy_kwh += todayBy.get(id) ?? 0;
    }
    if (live && (!lastReadingAt || live.timestamp > lastReadingAt)) lastReadingAt = live.timestamp;
  }

  const shape = (t: typeof totals) => ({
    installations_total: t.installations,
    installations_active: t.active,
    installations_reporting: t.reporting,
    installed_capacity_kw: round(t.capacity_kw),
    current_power_kw: round(t.power_kw),
    capacity_utilisation_percent: t.capacity_kw > 0 ? round((t.power_kw / t.capacity_kw) * 100, 1) : 0,
    today_energy_kwh: round(t.energy_kwh),
  });

  return {
    district_id: district._id,
    district_name: district.name,
    province_id: district.province_id,
    at: at.toISOString(),
    date: localDate(at),
    timezone: TIMEZONE,
    reporting_window_minutes: STALE_AFTER_MINUTES,
    last_reading_at: lastReadingAt?.toISOString() ?? null,
    ...shape(totals),
    substations: substations.map((s) => ({ substation_id: s._id, name: s.name, ...shape(perSubstation.get(s._id)!) })),
  };
}
