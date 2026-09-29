import { Router } from 'express';
import { z } from 'zod';
import { districtFilter, provinceFilter } from '../auth/scope';
import { collections } from '../db';
import { sendRepresentation } from '../http/conditional';
import { sendPage } from '../http/listing';
import { methodNotAllowed } from '../http/methodNotAllowed';
import { pageQuery, parse, sortParam } from '../http/validation';
import { toDistrict, toProvince } from '../representations';
import { loadProvince } from '../services/lookups';

export const provincesRouter = Router();

const listQuery = z.strictObject({ ...pageQuery, sort: sortParam(['id', 'name'], 'id') });
const sortField = (field: 'id' | 'name') => (field === 'id' ? '_id' : field);

/** GET /provinces - the provinces within the caller's jurisdiction. */
provincesRouter
  .route('/')
  .get(async (req, res) => {
    const { page, page_size, sort } = parse(listQuery, req.query, 'query');
    await sendPage(req, res, collections.provinces(), {
      filter: provinceFilter(req.user!),
      sort: { [sortField(sort.field)]: sort.direction },
      page: { page, page_size },
      toJson: toProvince,
      modifiedAt: (p) => p.updated_at,
    });
  })
  .all(methodNotAllowed('GET'));

/** GET /provinces/{provinceId} */
provincesRouter
  .route('/:provinceId')
  .get(async (req, res) => {
    const province = await loadProvince(req.user!, req.params.provinceId);
    sendRepresentation(req, res, toProvince(province), { lastModified: province.updated_at });
  })
  .all(methodNotAllowed('GET'));

/** GET /provinces/{provinceId}/districts - scoped collection: districts only exist within a province. */
provincesRouter
  .route('/:provinceId/districts')
  .get(async (req, res) => {
    const province = await loadProvince(req.user!, req.params.provinceId);
    const { page, page_size, sort } = parse(listQuery, req.query, 'query');
    await sendPage(req, res, collections.districts(), {
      filter: { province_id: province._id, ...districtFilter(req.user!) },
      sort: { [sortField(sort.field)]: sort.direction },
      page: { page, page_size },
      toJson: toDistrict,
      modifiedAt: (d) => d.updated_at,
    });
  })
  .all(methodNotAllowed('GET'));
