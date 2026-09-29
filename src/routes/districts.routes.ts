import { Router } from 'express';
import { z } from 'zod';
import { collections } from '../db';
import { sendRepresentation } from '../http/conditional';
import { sendPage } from '../http/listing';
import { methodNotAllowed } from '../http/methodNotAllowed';
import { isoDateTime, pageQuery, parse, sortParam } from '../http/validation';
import { toDistrict, toSubstation } from '../representations';
import { districtSummary } from '../services/generation';
import { loadDistrict } from '../services/lookups';

export const districtsRouter = Router();

/** GET /districts/{districtId} */
districtsRouter
  .route('/:districtId')
  .get(async (req, res) => {
    const district = await loadDistrict(req.user!, req.params.districtId);
    sendRepresentation(req, res, toDistrict(district), { lastModified: district.updated_at });
  })
  .all(methodNotAllowed('GET'));

const substationsQuery = z.strictObject({ ...pageQuery, sort: sortParam(['id', 'name'], 'id') });

/** GET /districts/{districtId}/substations - scoped collection of the district's grid substations. */
districtsRouter
  .route('/:districtId/substations')
  .get(async (req, res) => {
    const district = await loadDistrict(req.user!, req.params.districtId);
    const { page, page_size, sort } = parse(substationsQuery, req.query, 'query');
    await sendPage(req, res, collections.substations(), {
      filter: { district_id: district._id },
      sort: { [sort.field === 'id' ? '_id' : sort.field]: sort.direction },
      page: { page, page_size },
      toJson: toSubstation,
      modifiedAt: (s) => s.updated_at,
    });
  })
  .all(methodNotAllowed('GET'));

const summaryQuery = z.strictObject({ at: isoDateTime.optional() });

/**
 * GET /districts/{districtId}/generation-summary - processing resource: aggregate
 * current power and today's energy across every installation in the district.
 */
districtsRouter
  .route('/:districtId/generation-summary')
  .get(async (req, res) => {
    const district = await loadDistrict(req.user!, req.params.districtId);
    const { at } = parse(summaryQuery, req.query, 'query');
    // Default to "now", truncated to the minute so the representation (and its ETag) is stable
    // between readings rather than changing on every request.
    const instant = at ? new Date(at) : new Date(Math.floor(Date.now() / 60_000) * 60_000);
    const summary = await districtSummary(district, instant);
    sendRepresentation(req, res, summary, {
      lastModified: summary.last_reading_at ? new Date(summary.last_reading_at) : null,
    });
  })
  .all(methodNotAllowed('GET'));
