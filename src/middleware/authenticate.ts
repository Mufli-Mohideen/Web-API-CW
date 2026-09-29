import type { RequestHandler } from 'express';
import { hashDeviceKey } from '../auth/deviceKeys';
import { verifyUserToken } from '../auth/tokens';
import { collections } from '../db';
import { ApiError } from '../errors/ApiError';
import type { UserRole } from '../types';

export const DEVICE_KEY_HEADER = 'X-Device-Key';

function bearerToken(header: string | undefined): string | undefined {
  return header?.match(/^Bearer\s+(\S+)$/i)?.[1];
}

/** Read path: an SLSEA user presenting a JWT access token. Device keys are refused here. */
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
    next();
  } catch {
    next(ApiError.unauthorized('The access token is invalid or has expired'));
  }
};

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (req.user && roles.includes(req.user.role)) return next();
    next(ApiError.forbidden(`This operation requires one of the roles: ${roles.join(', ')}`));
  };
}

/** Write path: a metering device authenticating as its installation with its API key. */
export const authenticateDevice: RequestHandler = async (req, _res, next) => {
  const key = req.get(DEVICE_KEY_HEADER);
  if (!key) {
    if (bearerToken(req.get('Authorization'))) {
      return next(ApiError.forbidden('SLSEA users are read-only clients and cannot write generation readings'));
    }
    return next(ApiError.unauthorized(`A device API key is required in the ${DEVICE_KEY_HEADER} header`));
  }

  const installation = await collections.installations().findOne({ api_key_hash: hashDeviceKey(key) });
  if (!installation || installation.status === 'DECOMMISSIONED') {
    return next(ApiError.unauthorized('The device API key is not recognised'));
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
