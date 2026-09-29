import { ApiError } from '../errors/ApiError';
import type { UserClaims } from './tokens';

/**
 * Jurisdiction scoping for the read path.
 * Every substation, installation and reading carries province_id/district_id, so a user's
 * jurisdiction becomes a filter that is ANDed into every query, and a check on every item.
 */

type Located = { province_id: string; district_id: string };

/** Filter for substations, installations and readings. */
export function jurisdictionFilter(user: UserClaims): Record<string, string> {
  if (user.role === 'DISTRICT') return { district_id: user.district_id! };
  if (user.role === 'PROVINCIAL') return { province_id: user.province_id! };
  return {}; // ADMIN and NATIONAL see the whole country
}

/** Filter for the provinces collection (a district user sees only its parent province). */
export function provinceFilter(user: UserClaims): Record<string, string> {
  return user.role === 'PROVINCIAL' || user.role === 'DISTRICT' ? { _id: user.province_id! } : {};
}

/** Filter for the districts collection. */
export function districtFilter(user: UserClaims): Record<string, string> {
  if (user.role === 'DISTRICT') return { _id: user.district_id! };
  if (user.role === 'PROVINCIAL') return { province_id: user.province_id! };
  return {};
}

export function canReadProvince(user: UserClaims, provinceId: string): boolean {
  return (user.role !== 'PROVINCIAL' && user.role !== 'DISTRICT') || user.province_id === provinceId;
}

export function canReadDistrict(user: UserClaims, district: { _id: string; province_id: string }): boolean {
  return canRead(user, { province_id: district.province_id, district_id: district._id });
}

export function canRead(user: UserClaims, item: Located): boolean {
  if (user.role === 'DISTRICT') return user.district_id === item.district_id;
  if (user.role === 'PROVINCIAL') return user.province_id === item.province_id;
  return true;
}

export function outOfJurisdiction(what: string): ApiError {
  return ApiError.forbidden(`${what} is outside your jurisdiction`);
}
