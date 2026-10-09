/**
 * End-to-end smoke test of a running deployment: exercises the design spine (status codes,
 * headers, pagination, filtering, sorting, conditional requests, error contract, write-read
 * split and jurisdiction scoping) and prints PASS/FAIL per check.
 *
 * Usage: npm run smoke -- https://your-deployment.example.com
 * Env:   SEED_USER_PASSWORD, DEVICE_KEY_SECRET (must match the values used to seed)
 *
 * Note: it ingests one reading for installation SLM-000001 and creates, updates and deletes
 * a temporary installation, exactly as real clients would.
 */
import 'dotenv/config';
import { deriveDeviceKey } from '../src/auth/deviceKeys';

const base = (process.argv[2] ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, '') + '/api/v1';
const password = process.env.SEED_USER_PASSWORD ?? 'Slsea@2026';
const secret = process.env.DEVICE_KEY_SECRET ?? 'slsea-demo-device-secret';
const INSTALLATION = '65f0a1b2c3d4e5f600000001'; // SLM-000001, Colombo
const OTHER_INSTALLATION = '65f0a1b2c3d4e5f600000002';
const deviceKey = deriveDeviceKey(secret, 'SLM-000001');

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`);
}

async function call(method: string, path: string, opts: { token?: string; device?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.device) headers['X-Device-Key'] = opts.device;
  if (opts.body !== undefined) headers['Content-Type'] ??= 'application/json';
  const res = await fetch(base + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, headers: res.headers, json, text };
}

const isErrorContract = (json: any) =>
  typeof json?.error?.code === 'string' && typeof json?.error?.message === 'string' && Array.isArray(json?.error?.details);

async function login(email: string) {
  const res = await call('POST', '/auth/tokens', { body: { email, password } });
  return res.json?.access_token as string;
}

async function main() {
  console.log(`Smoke testing ${base}\n`);

  const health = await call('GET', '/health');
  check('GET /health -> 200, database up', health.status === 200 && health.json?.database === 'up', health.text);

  // --- Authentication & the write-read split --------------------------------------------------
  const noAuth = await call('GET', '/provinces');
  check('No token -> 401 with error contract', noAuth.status === 401 && isErrorContract(noAuth.json), noAuth.text);
  const badLogin = await call('POST', '/auth/tokens', { body: { email: 'national@slsea.lk', password: 'wrong' } });
  check('Wrong password -> 401', badLogin.status === 401, badLogin.text);

  const national = await login('national@slsea.lk');
  const colombo = await login('colombo@slsea.lk');
  const western = await login('western@slsea.lk');
  const admin = await login('admin@slsea.lk');
  check('Users obtain JWT access tokens', Boolean(national && colombo && western && admin));

  const exchange = await call('POST', '/auth/device-tokens', { device: deviceKey });
  check('Device key exchanged for a JWT with the installation:write scope',
    exchange.status === 200 && Boolean(exchange.json?.access_token) && exchange.json?.scope === 'installation:write' && exchange.json?.installation_id === INSTALLATION,
    exchange.text);
  const device = exchange.json?.access_token as string;
  const badKey = await call('POST', '/auth/device-tokens', { device: 'sk_dev_not-a-real-key' });
  check('Unknown device key -> 401', badKey.status === 401, badKey.text);

  const deviceRead = await call('GET', '/provinces', { token: device });
  check('Device token on the read path -> 403', deviceRead.status === 403, deviceRead.text);
  const keyRead = await call('GET', '/provinces', { device: deviceKey });
  check('Device key on the read path -> 403', keyRead.status === 403, keyRead.text);
  const userWrite = await call('POST', `/installations/${INSTALLATION}/readings`, {
    token: admin,
    body: { timestamp: new Date().toISOString(), power_kw: 1, energy_kwh: 1, voltage_v: 230 },
  });
  check('User token on the write path -> 403', userWrite.status === 403, userWrite.text);

  // --- Jurisdiction scoping ------------------------------------------------------------------
  const cmbProvinces = await call('GET', '/provinces', { token: colombo });
  check('District user sees only its own province', cmbProvinces.json?.pagination?.total_items === 1 && cmbProvinces.json.data[0].id === 'WP', cmbProvinces.text);
  const otherDistrict = await call('GET', '/districts/GLE', { token: colombo });
  check('District user reading another district -> 403', otherDistrict.status === 403 && isErrorContract(otherDistrict.json), otherDistrict.text);
  const ownDistrict = await call('GET', '/districts/CMB', { token: colombo });
  check('District user reading own district -> 200', ownDistrict.status === 200, ownDistrict.text);
  const otherFilter = await call('GET', '/readings?district_id=GLE', { token: colombo });
  check('District user filtering another district -> 403', otherFilter.status === 403, otherFilter.text);
  const provincial = await call('GET', '/installations?page_size=500', { token: western });
  check('Provincial user sees only its province installations', provincial.status === 200 && provincial.json.data.every((i: any) => i.province_id === 'WP'), provincial.text.slice(0, 200));

  // --- Hierarchy, composite and derived resources --------------------------------------------
  const provinces = await call('GET', '/provinces', { token: national });
  check('GET /provinces -> 9 provinces', provinces.json?.pagination?.total_items === 9, provinces.text.slice(0, 200));
  const districts = await call('GET', '/provinces/WP/districts', { token: national });
  check('GET /provinces/WP/districts -> 3 districts', districts.json?.pagination?.total_items === 3, districts.text.slice(0, 200));
  const substations = await call('GET', '/districts/CMB/substations', { token: national });
  check('GET /districts/CMB/substations -> 200', substations.status === 200 && substations.json.data.length > 0);
  const subInstallations = await call('GET', `/substations/${substations.json?.data?.[0]?.id}/installations`, { token: national });
  check('GET /substations/{id}/installations -> 200', subInstallations.status === 200 && subInstallations.json.data.length > 0);
  const overview = await call('GET', `/installations/${INSTALLATION}/overview`, { token: national });
  check('Composite overview has hierarchy + latest reading + daily energy',
    overview.status === 200 && overview.json.district?.id === 'CMB' && overview.json.latest_reading && overview.json.last_7_days?.daily?.length === 7, overview.text.slice(0, 200));
  const latest = await call('GET', `/installations/${INSTALLATION}/latest-reading`, { token: national });
  check('Latest-reading derived resource -> 200', latest.status === 200 && typeof latest.json?.capacity_utilisation_percent === 'number', latest.text);
  const summary = await call('GET', '/districts/CMB/generation-summary', { token: national });
  check('District generation summary -> 200', summary.status === 200 && typeof summary.json?.current_power_kw === 'number' && typeof summary.json?.today_energy_kwh === 'number', summary.text.slice(0, 200));

  // --- Pagination, filtering, sorting --------------------------------------------------------
  const page2 = await call('GET', `/installations/${INSTALLATION}/readings?page=2&page_size=10`, { token: national });
  check('Pagination: total count + prev/next links',
    page2.status === 200 && page2.json.data.length === 10 && page2.json.pagination.total_items > 600 && page2.json.links.prev && page2.json.links.next, page2.text.slice(0, 300));
  check('Pagination headers: Link + X-Total-Count', Boolean(page2.headers.get('link')?.includes('rel="next"') && page2.headers.get('x-total-count')));
  const asc = await call('GET', `/installations/${INSTALLATION}/readings?sort=timestamp&page_size=5`, { token: national });
  const desc = await call('GET', `/installations/${INSTALLATION}/readings?sort=-timestamp&page_size=5`, { token: national });
  const ascending = (list: any[]) => list.every((r, i) => i === 0 || list[i - 1].timestamp <= r.timestamp);
  check('Sorting by timestamp ascending', ascending(asc.json?.data ?? []));
  check('Sorting by timestamp descending', ascending([...(desc.json?.data ?? [])].reverse()));
  const from = new Date(Date.now() - 24 * 3600_000).toISOString();
  const windowed = await call('GET', `/readings?district_id=CMB&from=${from}&page_size=100`, { token: national });
  check('Filtering by district + time window',
    windowed.status === 200 && windowed.json.data.length > 0 && windowed.json.data.every((r: any) => r.timestamp >= from), windowed.text.slice(0, 200));
  const badSort = await call('GET', `/installations/${INSTALLATION}/readings?sort=colour`, { token: national });
  check('Invalid query -> 400 with field details', badSort.status === 400 && badSort.json?.error?.details?.[0]?.field === 'sort', badSort.text);

  // --- Conditional GET -----------------------------------------------------------------------
  const first = await call('GET', '/provinces/WP', { token: national });
  const etag = first.headers.get('etag')!;
  const lastModified = first.headers.get('last-modified')!;
  check('GET returns ETag + Last-Modified', Boolean(etag && lastModified));
  const notModified = await call('GET', '/provinces/WP', { token: national, headers: { 'If-None-Match': etag } });
  check('If-None-Match current ETag -> 304, empty body', notModified.status === 304 && notModified.text === '');
  const notModifiedSince = await call('GET', '/provinces/WP', { token: national, headers: { 'If-Modified-Since': lastModified } });
  check('If-Modified-Since -> 304', notModifiedSince.status === 304);
  const stale = await call('GET', '/provinces/WP', { token: national, headers: { 'If-None-Match': '"stale"' } });
  check('If-None-Match stale ETag -> 200', stale.status === 200);

  // --- Content negotiation & error contract --------------------------------------------------
  const xml = await call('GET', '/provinces', { token: national, headers: { Accept: 'application/xml' } });
  check('Accept: application/xml -> 406', xml.status === 406 && isErrorContract(xml.json), xml.text);
  const notFound = await call('GET', '/districts/XYZ', { token: national });
  check('Unknown district -> 404 with error contract', notFound.status === 404 && isErrorContract(notFound.json), notFound.text);

  // --- Device ingestion ----------------------------------------------------------------------
  const before = (await call('GET', `/installations/${INSTALLATION}/latest-reading`, { token: national })).json;
  const reading = {
    timestamp: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(),
    power_kw: before?.power_kw ?? 0,
    energy_kwh: Math.round(((before?.energy_kwh ?? 0) + 0.001) * 1000) / 1000,
    voltage_v: 230.4,
  };
  const noKey = await call('POST', `/installations/${INSTALLATION}/readings`, { body: reading });
  check('Ingest without device token -> 401', noKey.status === 401, noKey.text);
  const rawKey = await call('POST', `/installations/${INSTALLATION}/readings`, { device: deviceKey, body: reading });
  check('Ingest with the raw device key (no token) -> 401', rawKey.status === 401, rawKey.text);
  const created = await call('POST', `/installations/${INSTALLATION}/readings`, { token: device, body: reading });
  check('Ingest -> 201 Created + Location + ETag', created.status === 201 && Boolean(created.headers.get('location') && created.headers.get('etag')), created.text);
  const location = created.headers.get('location');
  if (location) {
    const fetched = await fetch(location, { headers: { Authorization: `Bearer ${national}` } });
    check('Location resolves to the new reading', fetched.status === 200);
  }
  const replay = await call('POST', `/installations/${INSTALLATION}/readings`, { token: device, body: reading });
  check('Identical retry -> 200, not duplicated', replay.status === 200 && replay.headers.get('location') === location, replay.text);
  const conflicting = await call('POST', `/installations/${INSTALLATION}/readings`, { token: device, body: { ...reading, power_kw: reading.power_kw + 1 } });
  check('Different reading, same timestamp -> 409', conflicting.status === 409, conflicting.text);
  const regression = await call('POST', `/installations/${INSTALLATION}/readings`, {
    token: device,
    body: { ...reading, timestamp: new Date(Date.parse(reading.timestamp) + 1000).toISOString(), energy_kwh: 1 },
  });
  check('Cumulative energy going backwards -> 422', regression.status === 422, regression.text);
  const invalid = await call('POST', `/installations/${INSTALLATION}/readings`, { token: device, body: { power_kw: -1 } });
  check('Malformed reading -> 400 with details', invalid.status === 400 && invalid.json?.error?.details?.length > 0, invalid.text);
  const foreign = await call('POST', `/installations/${OTHER_INSTALLATION}/readings`, { token: device, body: reading });
  check("Device writing another installation's readings -> 403", foreign.status === 403, foreign.text);
  const textBody = await call('POST', `/installations/${INSTALLATION}/readings`, { token: device, body: 'x', headers: { 'Content-Type': 'text/plain' } });
  check('Non-JSON body -> 415', textBody.status === 415, textBody.text);
  if (location) {
    const readingPath = location.slice(location.indexOf('/api/v1') + '/api/v1'.length);
    const put = await call('PUT', readingPath, { token: admin, body: reading });
    check('PUT on an append-only reading -> 405 + Allow', put.status === 405 && put.headers.get('allow') === 'GET', put.text);
  }

  // --- Registry CRUD (ADMIN), idempotency, optimistic concurrency ----------------------------
  const meterId = `SMOKE-${Date.now()}`;
  const newInstallation = { meter_id: meterId, name: 'Smoke Test Rooftop', capacity_kw: 5, substation_id: 'SS-CMB-01' };
  const forbidden = await call('POST', '/installations', { token: national, body: newInstallation });
  check('Non-admin creating an installation -> 403', forbidden.status === 403, forbidden.text);
  const made = await call('POST', '/installations', { token: admin, body: newInstallation });
  check('Admin POST /installations -> 201 + Location + one-time device key',
    made.status === 201 && Boolean(made.headers.get('location')) && String(made.json?.device_api_key).startsWith('sk_dev_'), made.text);
  const id = made.json?.id;
  if (id) {
    const duplicate = await call('POST', '/installations', { token: admin, body: newInstallation });
    check('Duplicate meter_id -> 409', duplicate.status === 409, duplicate.text);
    const current = await call('GET', `/installations/${id}`, { token: admin });
    const replacement = { ...newInstallation, meter_id: meterId, name: 'Smoke Test Rooftop (renamed)', address: null, location: null, status: 'ACTIVE', commissioned_at: '2026-01-15' };
    const put1 = await call('PUT', `/installations/${id}`, { token: admin, body: replacement, headers: { 'If-Match': current.headers.get('etag')! } });
    const put2 = await call('PUT', `/installations/${id}`, { token: admin, body: replacement });
    check('PUT is idempotent (same result twice)', put1.status === 200 && put2.status === 200 && put1.json?.name === put2.json?.name && put1.headers.get('etag') === put2.headers.get('etag'), put1.text);
    const staleWrite = await call('PATCH', `/installations/${id}`, { token: admin, body: { capacity_kw: 6 }, headers: { 'If-Match': current.headers.get('etag')! } });
    check('Write with stale If-Match -> 412', staleWrite.status === 412 && isErrorContract(staleWrite.json), staleWrite.text);
    const patched = await call('PATCH', `/installations/${id}`, { token: admin, body: { capacity_kw: 6 }, headers: { 'Content-Type': 'application/merge-patch+json' } });
    check('PATCH (merge patch) -> 200', patched.status === 200 && patched.json?.capacity_kw === 6, patched.text);
    const deleted = await call('DELETE', `/installations/${id}`, { token: admin });
    check('DELETE -> 204', deleted.status === 204, deleted.text);
    const deletedAgain = await call('DELETE', `/installations/${id}`, { token: admin });
    check('DELETE again -> 404 (state unchanged)', deletedAgain.status === 404, deletedAgain.text);
  }
  const withHistory = await call('DELETE', `/installations/${INSTALLATION}`, { token: admin });
  check('DELETE an installation with history -> 409', withHistory.status === 409, withHistory.text);

  console.log(`\n${failures === 0 ? 'All checks passed' : `${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
