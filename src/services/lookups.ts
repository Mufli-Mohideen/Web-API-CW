import { ObjectId } from 'mongodb';
import { canRead, canReadDistrict, canReadProvince, outOfJurisdiction } from '../auth/scope';
import type { UserClaims } from '../auth/tokens';
import { collections } from '../db';
import { ApiError } from '../errors/ApiError';

/**
 * Load a single resource for a user: 404 if it does not exist, 403 if it exists but lies
 * outside the user's jurisdiction.
 */

export async function loadProvince(user: UserClaims, id: string) {
  const province = await collections.provinces().findOne({ _id: id.toUpperCase() });
  if (!province) throw ApiError.notFound(`Province ${id}`);
  if (!canReadProvince(user, province._id)) throw outOfJurisdiction(`Province ${province._id}`);
  return province;
}

export async function loadDistrict(user: UserClaims, id: string) {
  const district = await collections.districts().findOne({ _id: id.toUpperCase() });
  if (!district) throw ApiError.notFound(`District ${id}`);
  if (!canReadDistrict(user, district)) throw outOfJurisdiction(`District ${district._id}`);
  return district;
}

export async function loadSubstation(user: UserClaims, id: string) {
  const substation = await collections.substations().findOne({ _id: id.toUpperCase() });
  if (!substation) throw ApiError.notFound(`Grid substation ${id}`);
  if (!canRead(user, substation)) throw outOfJurisdiction(`Grid substation ${substation._id}`);
  return substation;
}

export function parseObjectId(id: string, what: string): ObjectId {
  if (!ObjectId.isValid(id) || !/^[a-f0-9]{24}$/i.test(id)) {
    throw ApiError.badRequest(`Invalid ${what} id`, [{ field: 'id', issue: 'must be a 24-character hexadecimal id' }]);
  }
  return new ObjectId(id);
}

export async function loadInstallation(user: UserClaims, id: string) {
  const installation = await collections.installations().findOne({ _id: parseObjectId(id, 'installation') });
  if (!installation) throw ApiError.notFound(`Installation ${id}`);
  if (!canRead(user, installation)) throw outOfJurisdiction(`Installation ${id}`);
  return installation;
}

/**
 * Explicit filters on a collection (?province_id=, ?district_id=, ...) must stay inside the
 * caller's jurisdiction: asking for another district is refused (403) rather than silently
 * returning nothing. Unknown ids simply match no documents.
 */
export async function assertFiltersInScope(
  user: UserClaims,
  filters: { province_id?: string; district_id?: string; substation_id?: string; installation_id?: ObjectId },
): Promise<void> {
  if (filters.province_id && !canReadProvince(user, filters.province_id)) {
    throw outOfJurisdiction(`Province ${filters.province_id}`);
  }
  if (filters.district_id) {
    const district = await collections.districts().findOne({ _id: filters.district_id });
    if (district && !canReadDistrict(user, district)) throw outOfJurisdiction(`District ${district._id}`);
  }
  if (filters.substation_id) {
    const substation = await collections.substations().findOne({ _id: filters.substation_id });
    if (substation && !canRead(user, substation)) throw outOfJurisdiction(`Grid substation ${substation._id}`);
  }
  if (filters.installation_id) {
    const installation = await collections.installations().findOne({ _id: filters.installation_id });
    if (installation && !canRead(user, installation)) throw outOfJurisdiction(`Installation ${filters.installation_id}`);
  }
}
