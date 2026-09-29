import { Router } from 'express';
import { z } from 'zod';
import { collections } from '../db';
import { sendRepresentation } from '../http/conditional';
import { sendPage } from '../http/listing';
import { methodNotAllowed } from '../http/methodNotAllowed';
import { pageQuery, parse } from '../http/validation';
import { toInstallation, toSubstation } from '../representations';
import { INSTALLATION_STATUSES } from '../types';
import { installationSort } from './installations.routes';
import { loadSubstation } from '../services/lookups';

export const substationsRouter = Router();

/** GET /substations/{substationId} */
substationsRouter
  .route('/:substationId')
  .get(async (req, res) => {
    const substation = await loadSubstation(req.user!, req.params.substationId);
    sendRepresentation(req, res, toSubstation(substation), { lastModified: substation.updated_at });
  })
  .all(methodNotAllowed('GET'));

const installationsQuery = z.strictObject({
  ...pageQuery,
  sort: installationSort,
  status: z.enum(INSTALLATION_STATUSES).optional(),
});

/** GET /substations/{substationId}/installations - scoped collection of installations on this grid node. */
substationsRouter
  .route('/:substationId/installations')
  .get(async (req, res) => {
    const substation = await loadSubstation(req.user!, req.params.substationId);
    const { page, page_size, sort, status } = parse(installationsQuery, req.query, 'query');
    await sendPage(req, res, collections.installations(), {
      filter: { substation_id: substation._id, ...(status ? { status } : {}) },
      sort: { [sort.field]: sort.direction, _id: 1 },
      page: { page, page_size },
      projection: { api_key_hash: 0 },
      toJson: toInstallation,
      modifiedAt: (i) => i.updated_at,
    });
  })
  .all(methodNotAllowed('GET'));
