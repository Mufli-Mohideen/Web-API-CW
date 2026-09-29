import { Router, type Request } from 'express';
import { MongoServerError, ObjectId, type Filter } from 'mongodb';
import { z } from 'zod';
import { jurisdictionFilter } from '../auth/scope';
import { collections } from '../db';
import { ApiError } from '../errors/ApiError';
import { etagFor, sendRepresentation } from '../http/conditional';
import { sendPage } from '../http/listing';
import { methodNotAllowed } from '../http/methodNotAllowed';
import { absoluteUrl } from '../http/urls';
import { isoDateTime, pageQuery, parse, sortParam } from '../http/validation';
import { authenticateDevice, authenticateUser } from '../middleware/authenticate';
import { toReading } from '../representations';
import { assertFiltersInScope, loadInstallation, parseObjectId } from '../services/lookups';
import type { GenerationReadingDoc } from '../types';

// ---- Query parameters shared by both readings collections ---------------------------------

const readingSort = sortParam(['timestamp', 'power_kw'], '-timestamp');
const timeWindow = {
  from: isoDateTime.optional(), // inclusive
  to: isoDateTime.optional(), // exclusive
};
const upper = z.string().trim().min(1).transform((value) => value.toUpperCase());

function windowFilter({ from, to }: { from?: string; to?: string }): Filter<GenerationReadingDoc> {
  if (from && to && new Date(from) >= new Date(to)) {
    throw ApiError.badRequest('Invalid time window', [{ field: 'from', issue: 'must be earlier than to' }]);
  }
  if (!from && !to) return {};
  return { timestamp: { ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lt: new Date(to) } : {}) } };
}

async function sendReadings(req: Request, res: Parameters<typeof sendPage>[1], filter: Filter<GenerationReadingDoc>, query: {
  page: number;
  page_size: number;
  sort: { field: 'timestamp' | 'power_kw'; direction: 1 | -1 };
}) {
  await sendPage(req, res, collections.readings(), {
    filter,
    sort: { [query.sort.field]: query.sort.direction, timestamp: query.sort.direction, _id: 1 },
    page: { page: query.page, page_size: query.page_size },
    toJson: toReading,
    modifiedAt: (r) => r.received_at,
  });
}

// ---- /installations/{installationId}/readings ----------------------------------------------

export const readingsForInstallationRouter = Router({ mergeParams: true });
type InstallationParams = { installationId: string };

const historyQuery = z.strictObject({ ...pageQuery, sort: readingSort, ...timeWindow });

const newReading = z.strictObject({
  timestamp: isoDateTime,
  power_kw: z.number().min(0),
  energy_kwh: z.number().min(0),
  voltage_v: z.number().min(0).max(1000),
});

/** Tolerated clock skew for device timestamps. */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

readingsForInstallationRouter
  .route('/')
  /** Analytical view: the paginated, time-filtered, sortable history of one installation. */
  .get(authenticateUser, async (req: Request<InstallationParams>, res) => {
    const installation = await loadInstallation(req.user!, req.params.installationId);
    const query = parse(historyQuery, req.query, 'query');
    await sendReadings(req, res, { installation_id: installation._id, ...windowFilter(query) }, query);
  })
  /**
   * Device ingestion. POST creates a new, server-identified reading: 201 Created with a
   * Location header. A device may only write readings for its own installation.
   */
  .post(authenticateDevice, async (req: Request<InstallationParams>, res) => {
    const device = req.device!;
    const installationId = parseObjectId(req.params.installationId, 'installation');
    if (!installationId.equals(device.installation_id)) {
      throw ApiError.forbidden('A device may only report readings for its own installation');
    }
    const input = parse(newReading, req.body, 'body');
    const timestamp = new Date(input.timestamp);
    const readingsUrl = `/installations/${installationId.toHexString()}/readings`;

    // Idempotent retries: the same reading re-sent (e.g. after a timeout) is not stored twice.
    const existing = await collections.readings().findOne({ installation_id: installationId, timestamp });
    if (existing) return replyToDuplicate(req, res, existing, input, readingsUrl);

    await assertPlausible(device, timestamp, input);

    const reading: GenerationReadingDoc = {
      _id: new ObjectId(),
      installation_id: installationId,
      substation_id: device.substation_id,
      district_id: device.district_id,
      province_id: device.province_id,
      timestamp,
      power_kw: input.power_kw,
      energy_kwh: input.energy_kwh,
      voltage_v: input.voltage_v,
      received_at: new Date(),
    };
    try {
      await collections.readings().insertOne(reading);
    } catch (error) {
      // Lost a race with a concurrent retry: the unique (installation_id, timestamp) index caught it.
      if (error instanceof MongoServerError && error.code === 11000) {
        const winner = await collections.readings().findOne({ installation_id: installationId, timestamp });
        if (winner) return replyToDuplicate(req, res, winner, input, readingsUrl);
      }
      throw error;
    }

    const body = toReading(reading);
    res.set('Location', absoluteUrl(req, `${readingsUrl}/${body.id}`));
    res.set('ETag', etagFor(body));
    res.set('Last-Modified', reading.received_at.toUTCString());
    res.status(201).json(body);
  })
  .all(methodNotAllowed('GET', 'POST'));

type ReadingInput = z.infer<typeof newReading>;

function replyToDuplicate(req: Request, res: Parameters<typeof sendPage>[1], existing: GenerationReadingDoc, input: ReadingInput, readingsUrl: string) {
  const location = absoluteUrl(req, `${readingsUrl}/${existing._id.toHexString()}`);
  const identical =
    existing.power_kw === input.power_kw && existing.energy_kwh === input.energy_kwh && existing.voltage_v === input.voltage_v;
  if (!identical) {
    throw ApiError.conflict('A different reading already exists for this installation at this timestamp', [
      { field: 'timestamp', issue: `readings are append-only; existing reading: ${location}` },
    ]);
  }
  // Replay of an already-stored reading: 200 pointing at the existing resource, nothing created.
  const body = toReading(existing);
  res.set('Location', location);
  res.set('ETag', etagFor(body));
  res.status(200).json(body);
}

/** Domain rules a well-formed reading must also satisfy (422 when violated). */
async function assertPlausible(device: NonNullable<Request['device']>, timestamp: Date, input: ReadingInput) {
  const problems: { field: string; issue: string }[] = [];
  if (timestamp.getTime() > Date.now() + MAX_FUTURE_SKEW_MS) {
    problems.push({ field: 'timestamp', issue: 'must not be in the future' });
  }
  if (input.power_kw > device.capacity_kw * 1.2) {
    problems.push({ field: 'power_kw', issue: `exceeds the installation's capacity of ${device.capacity_kw} kW` });
  }
  // energy_kwh is a cumulative counter: it can never fall between consecutive readings.
  const [previous, next] = await Promise.all([
    collections.readings().findOne({ installation_id: device.installation_id, timestamp: { $lt: timestamp } }, { sort: { timestamp: -1 } }),
    collections.readings().findOne({ installation_id: device.installation_id, timestamp: { $gt: timestamp } }, { sort: { timestamp: 1 } }),
  ]);
  if (previous && input.energy_kwh < previous.energy_kwh) {
    problems.push({ field: 'energy_kwh', issue: `cumulative counter cannot decrease (previous reading: ${previous.energy_kwh} kWh)` });
  }
  if (next && input.energy_kwh > next.energy_kwh) {
    problems.push({ field: 'energy_kwh', issue: `exceeds the later reading's counter (${next.energy_kwh} kWh)` });
  }
  if (problems.length) throw ApiError.unprocessable('Reading is not plausible for this installation', problems);
}

/** GET /installations/{installationId}/readings/{readingId} - one reading (append-only: GET only). */
readingsForInstallationRouter
  .route('/:readingId')
  .get(authenticateUser, async (req: Request<InstallationParams & { readingId: string }>, res) => {
    const installation = await loadInstallation(req.user!, req.params.installationId);
    const reading = await collections.readings().findOne({
      _id: parseObjectId(req.params.readingId, 'reading'),
      installation_id: installation._id,
    });
    if (!reading) throw ApiError.notFound(`Reading ${req.params.readingId}`);
    sendRepresentation(req, res, toReading(reading), { lastModified: reading.received_at });
  })
  .all(methodNotAllowed('GET'));

// ---- /readings: national analytical collection --------------------------------------------

export const readingsRouter = Router();

const nationalQuery = z.strictObject({
  ...pageQuery,
  sort: readingSort,
  ...timeWindow,
  province_id: upper.optional(),
  district_id: upper.optional(),
  substation_id: upper.optional(),
  installation_id: z.string().optional(),
});

/**
 * GET /readings - readings across installations, filtered by jurisdiction
 * (province / district / substation / installation) and time window, always within
 * the caller's own jurisdiction.
 */
readingsRouter
  .route('/')
  .get(async (req, res) => {
    const query = parse(nationalQuery, req.query, 'query');
    const installationId = query.installation_id ? parseObjectId(query.installation_id, 'installation') : undefined;
    const filters = {
      province_id: query.province_id,
      district_id: query.district_id,
      substation_id: query.substation_id,
      installation_id: installationId,
    };
    await assertFiltersInScope(req.user!, filters);
    const filter = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined));
    await sendReadings(req, res, { ...filter, ...windowFilter(query), ...jurisdictionFilter(req.user!) }, query);
  })
  .all(methodNotAllowed('GET'));
