import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import type { UserRole } from '../types';

/** Claims carried in an SLSEA user's access token: identity, role and jurisdiction. */
export interface UserClaims {
  sub: string;
  role: UserRole;
  province_id: string | null;
  district_id: string | null;
}

const ISSUER = 'slsea-solar-api';
const AUDIENCE = 'slsea-read-clients';

export function signUserToken(claims: UserClaims): { token: string; expiresIn: number } {
  const token = jwt.sign(claims, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  const { exp, iat } = jwt.decode(token) as { exp: number; iat: number };
  return { token, expiresIn: exp - iat };
}

export function verifyUserToken(token: string): UserClaims {
  const payload = jwt.verify(token, env.jwtSecret, { issuer: ISSUER, audience: AUDIENCE }) as jwt.JwtPayload & UserClaims;
  return { sub: payload.sub!, role: payload.role, province_id: payload.province_id, district_id: payload.district_id };
}
