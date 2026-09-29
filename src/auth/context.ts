import type { ObjectId } from 'mongodb';
import type { UserClaims } from './tokens';

/** The authenticated device: an installation acting as itself (write path only). */
export interface DevicePrincipal {
  installation_id: ObjectId;
  meter_id: string;
  capacity_kw: number;
  substation_id: string;
  district_id: string;
  province_id: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserClaims;
    device?: DevicePrincipal;
  }
}
