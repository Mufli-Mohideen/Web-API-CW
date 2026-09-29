import type { ObjectId } from 'mongodb';

/**
 * Stored document shapes. The domain hierarchy is
 *   Province 1──* District 1──* GridSubstation 1──* SolarInstallation 1──* GenerationReading
 * plus User. Reference data (provinces, districts, substations) uses its natural code as _id;
 * dynamic data (installations, readings, users) uses ObjectIds.
 */

export interface ProvinceDoc {
  _id: string; // e.g. "WP"
  name: string;
  created_at: Date;
  updated_at: Date;
}

export interface DistrictDoc {
  _id: string; // e.g. "CMB"
  name: string;
  province_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface GridSubstationDoc {
  _id: string; // e.g. "SS-CMB-01"
  name: string;
  district_id: string;
  province_id: string; // denormalised ancestor for jurisdiction filters
  capacity_mva: number | null;
  created_at: Date;
  updated_at: Date;
}

export const INSTALLATION_STATUSES = ['ACTIVE', 'INACTIVE', 'DECOMMISSIONED'] as const;
export type InstallationStatus = (typeof INSTALLATION_STATUSES)[number];

export interface SolarInstallationDoc {
  _id: ObjectId;
  meter_id: string; // meter/inverter identifier: an attribute, not a separate Device entity
  name: string;
  address: string | null;
  location: { latitude: number; longitude: number } | null;
  capacity_kw: number;
  status: InstallationStatus;
  commissioned_at: Date | null;
  substation_id: string;
  district_id: string; // denormalised from the substation
  province_id: string; // denormalised from the substation
  api_key_hash: string; // SHA-256 of the device API key (the key itself is never stored)
  created_at: Date;
  updated_at: Date;
}

/** Append-only time series: one document per reading, never updated in place. */
export interface GenerationReadingDoc {
  _id: ObjectId;
  installation_id: ObjectId;
  // Ancestry copied at ingest: the reading stays attributed to where it was produced,
  // and regional queries need no join.
  substation_id: string;
  district_id: string;
  province_id: string;
  timestamp: Date; // when the device measured it
  power_kw: number; // instantaneous power
  energy_kwh: number; // cumulative lifetime energy counter
  voltage_v: number;
  received_at: Date; // when the API stored it
}

export const USER_ROLES = ['ADMIN', 'NATIONAL', 'PROVINCIAL', 'DISTRICT'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * An SLSEA person (read-client). Jurisdiction by role:
 *   ADMIN / NATIONAL -> whole country; PROVINCIAL -> province_id; DISTRICT -> district_id (+ its province_id).
 * ADMIN may also manage the installation registry. No user role can write readings.
 */
export interface UserDoc {
  _id: ObjectId;
  email: string;
  name: string;
  password_hash: string;
  role: UserRole;
  province_id: string | null;
  district_id: string | null;
  created_at: Date;
  updated_at: Date;
}
