import type {
  DistrictDoc,
  GenerationReadingDoc,
  GridSubstationDoc,
  ProvinceDoc,
  SolarInstallationDoc,
  UserDoc,
} from './types';

/**
 * Stored documents -> JSON representations. Internal fields (_id naming, credential hashes,
 * denormalised ancestry on readings) are not exposed; dates are ISO 8601 UTC strings.
 */

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);
const isoDay = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : null);

export const toProvince = (p: ProvinceDoc) => ({
  id: p._id,
  name: p.name,
  created_at: iso(p.created_at),
  updated_at: iso(p.updated_at),
});

export const toDistrict = (d: DistrictDoc) => ({
  id: d._id,
  name: d.name,
  province_id: d.province_id,
  created_at: iso(d.created_at),
  updated_at: iso(d.updated_at),
});

export const toSubstation = (s: GridSubstationDoc) => ({
  id: s._id,
  name: s.name,
  district_id: s.district_id,
  province_id: s.province_id,
  capacity_mva: s.capacity_mva,
  created_at: iso(s.created_at),
  updated_at: iso(s.updated_at),
});

export const toInstallation = (i: SolarInstallationDoc) => ({
  id: i._id.toHexString(),
  meter_id: i.meter_id,
  name: i.name,
  address: i.address,
  location: i.location,
  capacity_kw: i.capacity_kw,
  status: i.status,
  commissioned_at: isoDay(i.commissioned_at),
  substation_id: i.substation_id,
  district_id: i.district_id,
  province_id: i.province_id,
  created_at: iso(i.created_at),
  updated_at: iso(i.updated_at),
});

export const toReading = (r: GenerationReadingDoc) => ({
  id: r._id.toHexString(),
  installation_id: r.installation_id.toHexString(),
  timestamp: iso(r.timestamp),
  power_kw: r.power_kw,
  energy_kwh: r.energy_kwh,
  voltage_v: r.voltage_v,
  received_at: iso(r.received_at),
});

export const toUser = (u: UserDoc) => ({
  id: u._id.toHexString(),
  email: u.email,
  name: u.name,
  role: u.role,
  province_id: u.province_id,
  district_id: u.district_id,
});
