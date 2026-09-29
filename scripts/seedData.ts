/** Reference data for Sri Lanka: 9 provinces, 25 districts (with approximate centroids), 30 grid substations. */

export const PROVINCES = [
  { id: 'WP', name: 'Western' },
  { id: 'CP', name: 'Central' },
  { id: 'SP', name: 'Southern' },
  { id: 'NP', name: 'Northern' },
  { id: 'EP', name: 'Eastern' },
  { id: 'NW', name: 'North Western' },
  { id: 'NC', name: 'North Central' },
  { id: 'UP', name: 'Uva' },
  { id: 'SG', name: 'Sabaragamuwa' },
];

// installations: share of the 240 seeded rooftop sites (denser in urban districts).
export const DISTRICTS = [
  { id: 'CMB', name: 'Colombo', province: 'WP', lat: 6.93, lng: 79.86, installations: 29 },
  { id: 'GMP', name: 'Gampaha', province: 'WP', lat: 7.09, lng: 80.0, installations: 24 },
  { id: 'KLT', name: 'Kalutara', province: 'WP', lat: 6.58, lng: 80.03, installations: 12 },
  { id: 'KND', name: 'Kandy', province: 'CP', lat: 7.29, lng: 80.63, installations: 16 },
  { id: 'MTL', name: 'Matale', province: 'CP', lat: 7.47, lng: 80.62, installations: 7 },
  { id: 'NWE', name: 'Nuwara Eliya', province: 'CP', lat: 6.97, lng: 80.77, installations: 6 },
  { id: 'GLE', name: 'Galle', province: 'SP', lat: 6.05, lng: 80.22, installations: 12 },
  { id: 'MTR', name: 'Matara', province: 'SP', lat: 5.95, lng: 80.55, installations: 9 },
  { id: 'HBT', name: 'Hambantota', province: 'SP', lat: 6.12, lng: 81.12, installations: 8 },
  { id: 'JAF', name: 'Jaffna', province: 'NP', lat: 9.66, lng: 80.02, installations: 9 },
  { id: 'KLN', name: 'Kilinochchi', province: 'NP', lat: 9.39, lng: 80.4, installations: 5 },
  { id: 'MNR', name: 'Mannar', province: 'NP', lat: 8.98, lng: 79.9, installations: 5 },
  { id: 'VAV', name: 'Vavuniya', province: 'NP', lat: 8.75, lng: 80.5, installations: 5 },
  { id: 'MLT', name: 'Mullaitivu', province: 'NP', lat: 9.27, lng: 80.81, installations: 4 },
  { id: 'BTC', name: 'Batticaloa', province: 'EP', lat: 7.73, lng: 81.7, installations: 7 },
  { id: 'AMP', name: 'Ampara', province: 'EP', lat: 7.3, lng: 81.67, installations: 8 },
  { id: 'TRC', name: 'Trincomalee', province: 'EP', lat: 8.59, lng: 81.21, installations: 7 },
  { id: 'KRN', name: 'Kurunegala', province: 'NW', lat: 7.49, lng: 80.36, installations: 14 },
  { id: 'PTM', name: 'Puttalam', province: 'NW', lat: 8.04, lng: 79.84, installations: 8 },
  { id: 'ANP', name: 'Anuradhapura', province: 'NC', lat: 8.31, lng: 80.4, installations: 10 },
  { id: 'PLN', name: 'Polonnaruwa', province: 'NC', lat: 7.94, lng: 81.0, installations: 6 },
  { id: 'BDL', name: 'Badulla', province: 'UP', lat: 6.99, lng: 81.06, installations: 7 },
  { id: 'MNG', name: 'Monaragala', province: 'UP', lat: 6.87, lng: 81.35, installations: 5 },
  { id: 'RTN', name: 'Ratnapura', province: 'SG', lat: 6.68, lng: 80.4, installations: 9 },
  { id: 'KGL', name: 'Kegalle', province: 'SG', lat: 7.25, lng: 80.35, installations: 8 },
];

// One or more grid substations per district (30 in total).
export const SUBSTATIONS: Record<string, string[]> = {
  CMB: ['Kolonnawa', 'Pannipitiya', 'Dehiwala'],
  GMP: ['Biyagama', 'Kotugoda'],
  KLT: ['Panadura'],
  KND: ['Kiribathkumbura', 'Pallekele'],
  MTL: ['Ukuwela'],
  NWE: ['Nuwara Eliya'],
  GLE: ['Galle'],
  MTR: ['Matara'],
  HBT: ['Hambantota'],
  JAF: ['Chunnakam'],
  KLN: ['Kilinochchi'],
  MNR: ['Mannar'],
  VAV: ['Vavuniya'],
  MLT: ['Mullaitivu'],
  BTC: ['Batticaloa'],
  AMP: ['Ampara'],
  TRC: ['Trincomalee'],
  KRN: ['Kurunegala', 'Pannala'],
  PTM: ['Puttalam'],
  ANP: ['Anuradhapura'],
  PLN: ['Polonnaruwa'],
  BDL: ['Badulla'],
  MNG: ['Monaragala'],
  RTN: ['Ratnapura'],
  KGL: ['Kegalle'],
};

export const DEMO_USERS = [
  { email: 'admin@slsea.lk', name: 'SLSEA Registry Administrator', role: 'ADMIN', province: null, district: null },
  { email: 'national@slsea.lk', name: 'National Energy Analyst', role: 'NATIONAL', province: null, district: null },
  { email: 'western@slsea.lk', name: 'Western Province Operator', role: 'PROVINCIAL', province: 'WP', district: null },
  { email: 'southern@slsea.lk', name: 'Southern Province Operator', role: 'PROVINCIAL', province: 'SP', district: null },
  { email: 'colombo@slsea.lk', name: 'Colombo District Operator', role: 'DISTRICT', province: 'WP', district: 'CMB' },
  { email: 'gampaha@slsea.lk', name: 'Gampaha District Operator', role: 'DISTRICT', province: 'WP', district: 'GMP' },
  { email: 'galle@slsea.lk', name: 'Galle District Operator', role: 'DISTRICT', province: 'SP', district: 'GLE' },
] as const;

export const TYPICAL_CAPACITIES_KW = [3, 5, 5, 5, 8, 10, 10, 10, 15, 20, 30];
