import { Router } from 'express';
import { MongoServerError, ObjectId } from 'mongodb';
import { z } from 'zod';
import { generateDeviceKey, hashDeviceKey } from '../auth/deviceKeys';
import { jurisdictionFilter } from '../auth/scope';
import { collections } from '../db';
import { ApiError } from '../errors/ApiError';
import { checkIfMatch, etagFor, latestDate, sendRepresentation } from '../http/conditional';
import { sendPage } from '../http/listing';
import { methodNotAllowed } from '../http/methodNotAllowed';
import { absoluteUrl } from '../http/urls';
import { pageQuery, parse, sortParam } from '../http/validation';
import { authenticateUser, requireRole } from '../middleware/authenticate';
import { toInstallation } from '../representations';
import { dailyEnergy, findLatestReading, toLatestReading } from '../services/generation';
import { assertFiltersInScope, loadInstallation } from '../services/lookups';
import { readingsForInstallationRouter } from './readings.routes';
import { INSTALLATION_STATUSES, type SolarInstallationDoc } from '../types';

export const installationsRouter = Router();

export const installationSort = sortParam(['meter_id', 'name', 'capacity_kw', 'commissioned_at', 'created_at'], 'meter_id');

const upper = z.string().trim().min(1).transform((value) => value.toUpperCase());

const listQuery = z.strictObject({
  ...pageQuery,
  sort: installationSort,
  status: z.enum(INSTALLATION_STATUSES).optional(),
  province_id: upper.optional(),
  district_id: upper.optional(),
  substation_id: upper.optional(),
});

/** GET /installations - national installation collection, filterable by jurisdiction and status. */
installationsRouter
  .route('/')
  .get(authenticateUser, async (req, res) => {
    const { page, page_size, sort, ...filters } = parse(listQuery, req.query, 'query');
    await assertFiltersInScope(req.user!, filters);
    const filter = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined));
    await sendPage(req, res, collections.installations(), {
      filter: { ...filter, ...jurisdictionFilter(req.user!) },
      sort: { [sort.field]: sort.direction, _id: 1 },
      page: { page, page_size },
      projection: { api_key_hash: 0 },
      toJson: toInstallation,
      modifiedAt: (i) => i.updated_at,
    });
  })
  .post(authenticateUser, requireRole('ADMIN'), async (req, res) => {
    const input = parse(createBody, req.body, 'body');
    const doc = await buildInstallation(input);
    const deviceKey = generateDeviceKey();
    const now = new Date();
    const installation: SolarInstallationDoc = {
      _id: new ObjectId(),
      ...doc,
      api_key_hash: hashDeviceKey(deviceKey),
      created_at: now,
      updated_at: now,
    };
    await withUniqueMeterId(() => collections.installations().insertOne(installation));

    const representation = toInstallation(installation);
    res.set('Location', absoluteUrl(req, `/installations/${representation.id}`));
    res.set('ETag', etagFor(representation));
    res.set('Last-Modified', now.toUTCString());
    res.set('Cache-Control', 'no-store'); // the body carries a one-time secret
    // The device API key is returned exactly once; only its hash is stored.
    res.status(201).json({ ...representation, device_api_key: deviceKey });
  })
  .all(methodNotAllowed('GET', 'POST'));

// ---- Registry writes (ADMIN only) ----------------------------------------------------------

const location = z
  .strictObject({
    // Bounding box of Sri Lanka.
    latitude: z.number().min(5.8).max(10),
    longitude: z.number().min(79.4).max(82),
  })
  .nullable();

const fields = {
  meter_id: z.string().trim().regex(/^[A-Z0-9-]{3,32}$/i, 'must be 3-32 letters, digits or dashes').transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(200).nullable(),
  location,
  capacity_kw: z.number().positive().max(1000),
  status: z.enum(INSTALLATION_STATUSES),
  commissioned_at: z.iso.date().nullable(),
  substation_id: upper,
};

// POST: server-assigned id; optional fields may be omitted.
const createBody = z.strictObject({
  ...fields,
  address: fields.address.default(null),
  location: fields.location.default(null),
  status: fields.status.default('ACTIVE'),
  commissioned_at: fields.commissioned_at.default(null),
});
// PUT: a full replacement - every field must be supplied (nullable ones as null).
const replaceBody = z.strictObject(fields);
// PATCH (JSON merge patch): any subset of fields, at least one.
const patchBody = z
  .strictObject(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'must contain at least one field' });

type InstallationInput = z.infer<typeof replaceBody>;

/** Validates references and derives the denormalised ancestry from the substation. */
async function buildInstallation(input: InstallationInput) {
  const substation = await collections.substations().findOne({ _id: input.substation_id });
  if (!substation) {
    throw ApiError.unprocessable('The referenced grid substation does not exist', [
      { field: 'substation_id', issue: `no grid substation with id ${input.substation_id}` },
    ]);
  }
  return {
    meter_id: input.meter_id,
    name: input.name,
    address: input.address,
    location: input.location,
    capacity_kw: input.capacity_kw,
    status: input.status,
    commissioned_at: input.commissioned_at ? new Date(`${input.commissioned_at}T00:00:00Z`) : null,
    substation_id: substation._id,
    district_id: substation.district_id,
    province_id: substation.province_id,
  };
}

async function withUniqueMeterId<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw ApiError.conflict('Another installation already uses this meter_id', [
        { field: 'meter_id', issue: 'must be unique' },
      ]);
    }
    throw error;
  }
}

async function replaceInstallation(current: SolarInstallationDoc, input: InstallationInput) {
  const next = await buildInstallation(input);
  // Nothing changed: leave the document (and updated_at / ETag) untouched, so replaying the
  // same PUT yields an identical representation.
  const unchanged = (Object.keys(next) as (keyof typeof next)[]).every(
    (key) => JSON.stringify(next[key]) === JSON.stringify(current[key]),
  );
  if (unchanged) return current;
  const updated = await withUniqueMeterId(() =>
    collections
      .installations()
      .findOneAndUpdate(
        { _id: current._id },
        { $set: { ...next, updated_at: new Date() } },
        { returnDocument: 'after', projection: { api_key_hash: 0 } },
      ),
  );
  if (!updated) throw ApiError.notFound(`Installation ${current._id.toHexString()}`);
  return updated;
}

/** GET / PUT / PATCH / DELETE /installations/{installationId} */
installationsRouter
  .route('/:installationId')
  .get(authenticateUser, async (req, res) => {
    const installation = await loadInstallation(req.user!, req.params.installationId);
    sendRepresentation(req, res, toInstallation(installation), { lastModified: installation.updated_at });
  })
  // PUT is idempotent: replaying the same full representation leaves the same state.
  .put(authenticateUser, requireRole('ADMIN'), async (req, res) => {
    const current = await loadInstallation(req.user!, req.params.installationId);
    checkIfMatch(req, toInstallation(current));
    const input = parse(replaceBody, req.body, 'body');
    const updated = await replaceInstallation(current, input);
    sendRepresentation(req, res, toInstallation(updated), { lastModified: updated.updated_at });
  })
  .patch(authenticateUser, requireRole('ADMIN'), async (req, res) => {
    const current = await loadInstallation(req.user!, req.params.installationId);
    checkIfMatch(req, toInstallation(current));
    const changes = parse(patchBody, req.body, 'body');
    const merged = { ...toInstallation(current), ...changes } as unknown as InstallationInput;
    const updated = await replaceInstallation(current, parse(replaceBody, pickFields(merged), 'body'));
    sendRepresentation(req, res, toInstallation(updated), { lastModified: updated.updated_at });
  })
  // Generation history is append-only and must not be destroyed: an installation that has
  // reported readings is decommissioned (PATCH status) instead of deleted.
  .delete(authenticateUser, requireRole('ADMIN'), async (req, res) => {
    const current = await loadInstallation(req.user!, req.params.installationId);
    checkIfMatch(req, toInstallation(current));
    const readings = await collections.readings().countDocuments({ installation_id: current._id }, { limit: 1 });
    if (readings > 0) {
      throw ApiError.conflict('Installation has generation history and cannot be deleted', [
        { field: 'status', issue: 'decommission it instead: PATCH {"status": "DECOMMISSIONED"}' },
      ]);
    }
    await collections.installations().deleteOne({ _id: current._id });
    res.status(204).end();
  })
  .all(methodNotAllowed('GET', 'PUT', 'PATCH', 'DELETE'));

function pickFields(source: InstallationInput): InstallationInput {
  const keys = Object.keys(fields) as (keyof InstallationInput)[];
  return Object.fromEntries(keys.map((key) => [key, source[key]])) as InstallationInput;
}

/** POST /installations/{installationId}/device-key - rotate a device's API key (ADMIN). */
installationsRouter
  .route('/:installationId/device-key')
  .post(authenticateUser, requireRole('ADMIN'), async (req, res) => {
    const current = await loadInstallation(req.user!, req.params.installationId);
    const deviceKey = generateDeviceKey();
    const rotatedAt = new Date();
    await collections.installations().updateOne(
      { _id: current._id },
      { $set: { api_key_hash: hashDeviceKey(deviceKey), updated_at: rotatedAt } },
    );
    res.set('Cache-Control', 'no-store');
    res.status(200).json({
      installation_id: current._id.toHexString(),
      meter_id: current.meter_id,
      device_api_key: deviceKey,
      rotated_at: rotatedAt.toISOString(),
    });
  })
  .all(methodNotAllowed('POST'));

// ---- Derived and composite read resources -------------------------------------------------

/**
 * GET /installations/{installationId}/overview - composite resource: the installation with
 * its place in the grid hierarchy, its last-known reading, and its recent daily energy.
 */
installationsRouter
  .route('/:installationId/overview')
  .get(authenticateUser, async (req, res) => {
    const installation = await loadInstallation(req.user!, req.params.installationId);
    const [substation, district, province, latest, days] = await Promise.all([
      collections.substations().findOne({ _id: installation.substation_id }),
      collections.districts().findOne({ _id: installation.district_id }),
      collections.provinces().findOne({ _id: installation.province_id }),
      findLatestReading(installation._id),
      dailyEnergy(installation._id, 7),
    ]);
    const body = {
      installation: toInstallation(installation),
      substation: substation && { id: substation._id, name: substation.name },
      district: district && { id: district._id, name: district.name },
      province: province && { id: province._id, name: province.name },
      latest_reading: latest && toLatestReading(installation, latest),
      today: days[days.length - 1],
      last_7_days: {
        energy_kwh: Math.round(days.reduce((sum, day) => sum + day.energy_kwh, 0) * 1000) / 1000,
        daily: days,
      },
    };
    sendRepresentation(req, res, body, { lastModified: latestDate([installation.updated_at, latest?.received_at]) });
  })
  .all(methodNotAllowed('GET'));

/**
 * GET /installations/{installationId}/latest-reading - derived resource for the operational
 * view: the single most recent reading, not a lookup of a stored "last value".
 */
installationsRouter
  .route('/:installationId/latest-reading')
  .get(authenticateUser, async (req, res) => {
    const installation = await loadInstallation(req.user!, req.params.installationId);
    const latest = await findLatestReading(installation._id);
    if (!latest) throw ApiError.notFound(`Readings for installation ${req.params.installationId}`);
    sendRepresentation(req, res, toLatestReading(installation, latest), { lastModified: latest.received_at });
  })
  .all(methodNotAllowed('GET'));

// Readings sub-collection: /installations/{installationId}/readings[/{readingId}]
installationsRouter.use('/:installationId/readings', readingsForInstallationRouter);
