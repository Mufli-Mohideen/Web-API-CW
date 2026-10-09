import type { RequestHandler } from 'express';
import { ObjectId } from 'mongodb';
import { hashDeviceKey } from '../auth/deviceKeys';
import { hasScope, isDeviceToken, isUserToken, SCOPES, verifyDeviceToken, verifyUserToken } from '../auth/tokens';
import { collections } from '../db';
import { ApiError } from '../errors/ApiError';
import type { SolarInstallationDoc, UserRole } from '../types';

export const DEVICE_KEY_HEADER = 'X-Device-Key';

function bearerToken(header: string | undefined): string | undefined {
  return header?.match(/^Bearer\s+(\S+)$/i)?.[1];
}

/** Read path: an SLSEA user presenting a JWT access token with the readings:read scope. */
export const authenticateUser: RequestHandler = (req, _res, next) => {
  const token = bearerToken(req.get('Authorization'));
  if (!token) {
    if (req.get(DEVICE_KEY_HEADER)) {
      return next(ApiError.forbidden('Metering devices are write-only clients and cannot read data'));
    }
    return next(ApiError.unauthorized('A Bearer access token is required'));
  }
  try {
    req.user = verifyUserToken(token);
  } catch {
    if (isDeviceToken(token)) {
      return next(ApiError.forbidden('Metering devices are write-only clients and cannot read data'));
    }
    return next(ApiError.unauthorized('The access token is invalid or has expired'));
  }
  if (!hasScope(req.user.scope, SCOPES.readingsRead)) {
    return next(ApiError.forbidden(`This operation requires the ${SCOPES.readingsRead} scope`));
  }
  next();
};

/** Requires a scope on the authenticated user's token (e.g. registry:write for registry changes). */
export function requireScope(scope: string): RequestHandler {
  return (req, _res, next) => {
    if (req.user && hasScope(req.user.scope, scope)) return next();
    next(ApiError.forbidden(`This operation requires the ${scope} scope`));
  };
}

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (req.user && roles.includes(req.user.role)) return next();
    next(ApiError.forbidden(`This operation requires one of the roles: ${roles.join(', ')}`));
  };
}

/**
 * Looks up the installation an API key belongs to. Used only by the token exchange
 * (POST /auth/device-tokens); the key itself is never accepted on the ingestion route.
 */
export async function installationForDeviceKey(key: string): Promise<SolarInstallationDoc> {
  const installation = await collections.installations().findOne({ api_key_hash: hashDeviceKey(key) });
  if (!installation || installation.status === 'DECOMMISSIONED') {
    throw ApiError.unauthorized('The device API key is not recognised');
  }
  if (installation.status !== 'ACTIVE') {
    throw ApiError.forbidden('This installation is inactive and cannot report readings');
  }
  return installation;
}

/**
 * Write path: a metering device presenting its short-lived JWT (scope installation:write).
 * The token subject is the installation the device acts as.
 */
export const authenticateDevice: RequestHandler = async (req, _res, next) => {
  const token = bearerToken(req.get('Authorization'));
  if (!token) {
    if (req.get(DEVICE_KEY_HEADER)) {
      return next(ApiError.unauthorized('Exchange the device API key for an access token at POST /auth/device-tokens'));
    }
    return next(ApiError.unauthorized('A device access token is required'));
  }

  let claims;
  try {
    claims = verifyDeviceToken(token);
  } catch {
    if (isUserToken(token)) {
      return next(ApiError.forbidden('SLSEA users are read-only clients and cannot write generation readings'));
    }
    return next(ApiError.unauthorized('The device access token is invalid or has expired'));
  }
  if (!hasScope(claims.scope, SCOPES.installationWrite) || !ObjectId.isValid(claims.sub)) {
    return next(ApiError.forbidden(`This operation requires the ${SCOPES.installationWrite} scope`));
  }

  // Re-check the installation on every write, so a decommissioned or deactivated site
  // stops reporting immediately rather than when its token expires.
  const installation = await collections.installations().findOne({ _id: new ObjectId(claims.sub) });
  if (!installation || installation.status === 'DECOMMISSIONED') {
    return next(ApiError.unauthorized('The device is no longer registered'));
  }
  if (installation.status !== 'ACTIVE') {
    return next(ApiError.forbidden('This installation is inactive and cannot report readings'));
  }

  req.device = {
    installation_id: installation._id,
    meter_id: installation.meter_id,
    capacity_kw: installation.capacity_kw,
    substation_id: installation.substation_id,
    district_id: installation.district_id,
    province_id: installation.province_id,
  };
  next();
};
