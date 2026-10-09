import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import type { UserRole } from '../types';

/**
 * Scopes carried in access tokens (space-separated, as in OAuth 2.0):
 *   readings:read       - read the hierarchy, installations and readings (within the jurisdiction)
 *   registry:write      - manage the installation registry (ADMIN only)
 *   installation:write  - post readings for ONE installation (metering devices only)
 * Scopes say WHAT a client may do; jurisdiction (province / district claims) and the token
 * subject say WHERE - those finer, attribute-based checks are applied per record.
 */
export const SCOPES = {
  readingsRead: 'readings:read',
  registryWrite: 'registry:write',
  installationWrite: 'installation:write',
} as const;

const ISSUER = 'slsea-solar-api';
const USER_AUDIENCE = 'slsea-read-clients';
const DEVICE_AUDIENCE = 'slsea-metering-devices';

/** Claims carried in an SLSEA user's access token: identity, role, jurisdiction and scopes. */
export interface UserClaims {
  sub: string;
  role: UserRole;
  province_id: string | null;
  district_id: string | null;
  scope: string;
}

/** Claims carried in a metering device's access token: the installation it acts as. */
export interface DeviceClaims {
  sub: string; // installation id
  meter_id: string;
  scope: string;
}

export function scopesForRole(role: UserRole): string {
  return role === 'ADMIN' ? `${SCOPES.readingsRead} ${SCOPES.registryWrite}` : SCOPES.readingsRead;
}

export function hasScope(granted: string | undefined, required: string): boolean {
  return (granted ?? '').split(' ').includes(required);
}

function sign(payload: object, audience: string, expiresIn: string): { token: string; expiresIn: number } {
  const token = jwt.sign(payload, env.jwtSecret, {
    expiresIn: expiresIn as SignOptions['expiresIn'],
    issuer: ISSUER,
    audience,
  });
  const { exp, iat } = jwt.decode(token) as { exp: number; iat: number };
  return { token, expiresIn: exp - iat };
}

export function signUserToken(claims: Omit<UserClaims, 'scope'>): { token: string; expiresIn: number } {
  return sign({ ...claims, scope: scopesForRole(claims.role) }, USER_AUDIENCE, env.jwtExpiresIn);
}

export function verifyUserToken(token: string): UserClaims {
  const payload = jwt.verify(token, env.jwtSecret, { issuer: ISSUER, audience: USER_AUDIENCE }) as jwt.JwtPayload & UserClaims;
  return {
    sub: payload.sub!,
    role: payload.role,
    province_id: payload.province_id,
    district_id: payload.district_id,
    scope: payload.scope ?? scopesForRole(payload.role),
  };
}

/** Short-lived token a device obtains by presenting its installation's API key. */
export function signDeviceToken(installationId: string, meterId: string): { token: string; expiresIn: number } {
  return sign({ sub: installationId, meter_id: meterId, scope: SCOPES.installationWrite }, DEVICE_AUDIENCE, env.deviceJwtExpiresIn);
}

export function verifyDeviceToken(token: string): DeviceClaims {
  const payload = jwt.verify(token, env.jwtSecret, { issuer: ISSUER, audience: DEVICE_AUDIENCE }) as jwt.JwtPayload & DeviceClaims;
  return { sub: payload.sub!, meter_id: payload.meter_id, scope: payload.scope };
}

/** True when the token is a valid device token (used to give a precise 403 on the read path). */
export function isDeviceToken(token: string): boolean {
  try {
    verifyDeviceToken(token);
    return true;
  } catch {
    return false;
  }
}

/** True when the token is a valid user token (used to give a precise 403 on the write path). */
export function isUserToken(token: string): boolean {
  try {
    verifyUserToken(token);
    return true;
  } catch {
    return false;
  }
}
