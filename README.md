# Web-API-CW — SLSEA Real-Time Solar Generation Data API

NB6007CEM Web API Development coursework. The core REST API (Richardson Maturity Level 2) of the
Sri Lanka Sustainable Energy Authority's rooftop-solar data system: metering devices push
generation readings, and jurisdiction-scoped SLSEA users read the operational (live) and
analytical (historical) views.

- **Live API:** https://slsea-solar-api-3w9p.onrender.com/api/v1 (health: [/api/v1/health](https://slsea-solar-api-3w9p.onrender.com/api/v1/health))
- **Swagger UI:** https://slsea-solar-api-3w9p.onrender.com/docs (raw document at [/openapi.json](https://slsea-solar-api-3w9p.onrender.com/openapi.json))
- Hosted on Render (free tier: the first request after an idle period can take 30–50 s while the service wakes).

## Stack

Node.js 20, TypeScript, Express 5, MongoDB Atlas (official `mongodb` driver), zod validation,
JWT (`jsonwebtoken`) + bcrypt, Swagger UI. Hosted on Render.

## Domain model

```
Province 1──* District 1──* GridSubstation 1──* SolarInstallation 1──* GenerationReading
User (role + jurisdiction)
```

| Collection | `_id` | Notes |
| --- | --- | --- |
| `provinces` | code, e.g. `WP` | 9 provinces |
| `districts` | code, e.g. `CMB` | `province_id` |
| `grid_substations` | code, e.g. `SS-CMB-01` | `district_id`, `province_id` |
| `solar_installations` | ObjectId | `meter_id` (unique attribute — no separate Device entity), `capacity_kw`, `status`, ancestry ids, `api_key_hash` |
| `generation_readings` | ObjectId | append-only time series: `installation_id`, `timestamp`, `power_kw`, `energy_kwh` (cumulative), `voltage_v`, `received_at`, ancestry ids |
| `users` | ObjectId | `role` ∈ ADMIN / NATIONAL / PROVINCIAL / DISTRICT, `province_id`, `district_id` |

Each collection has a `$jsonSchema` validator and indexes, created at start-up
([src/dbSchema.ts](src/dbSchema.ts)). Readings have a unique `(installation_id, timestamp)` index.

## Resources

All paths are under `/api/v1`.

| Method | Path | Kind | Client |
| --- | --- | --- | --- |
| POST | `/auth/tokens` | credential exchange | anyone |
| GET | `/users/me` | atomic | user |
| GET | `/provinces`, `/provinces/{id}` | collection / atomic | user |
| GET | `/provinces/{id}/districts` | scoped collection | user |
| GET | `/districts/{id}` | atomic | user |
| GET | `/districts/{id}/substations` | scoped collection | user |
| GET | `/districts/{id}/generation-summary` | processing (aggregate) | user |
| GET | `/substations/{id}` | atomic | user |
| GET | `/substations/{id}/installations` | scoped collection | user |
| GET, POST | `/installations` | collection (POST: ADMIN) | user |
| GET, PUT, PATCH, DELETE | `/installations/{id}` | atomic (writes: ADMIN) | user |
| POST | `/installations/{id}/device-key` | key rotation | ADMIN |
| GET | `/installations/{id}/overview` | composite | user |
| GET | `/installations/{id}/latest-reading` | derived | user |
| GET | `/installations/{id}/readings` | scoped collection (history) | user |
| POST | `/installations/{id}/readings` | ingestion | **device** |
| GET | `/installations/{id}/readings/{readingId}` | atomic (append-only) | user |
| GET | `/readings` | collection filtered by jurisdiction + time | user |
| GET | `/health` | readiness | anyone |

**Collections** take `page`, `page_size` (≤ 500) and `sort` (`field` ascending, `-field`
descending) and return `{ data, pagination: { page, page_size, total_items, total_pages },
links: { self, first, last, prev, next } }`, plus `Link` and `X-Total-Count` headers.
The readings collections also filter by `from` (inclusive) and `to` (exclusive), and `/readings`
filters by `province_id`, `district_id`, `substation_id` and `installation_id`.

**Conditional requests:** every GET sends a strong `ETag` and `Last-Modified`. `If-None-Match`
and `If-Modified-Since` return `304` with an empty body. Registry writes honour `If-Match`
(`412` on mismatch).

**Errors** always look like `{ "error": { "code", "message", "details": [{ "field", "issue" }] } }`.

## Security model

| Client | Credential | Can |
| --- | --- | --- |
| Metering device | `X-Device-Key: sk_dev_…` (one per installation; only a SHA-256 hash is stored) | `POST` readings for **its own** installation only |
| SLSEA user | `Authorization: Bearer <JWT>` from `POST /auth/tokens` | read within its jurisdiction; ADMIN also manages installations |

- A device key on a read endpoint gets `403`, and a user token on the ingestion endpoint gets `403`.
- Jurisdiction: `NATIONAL` / `ADMIN` see the whole country, `PROVINCIAL` sees one province and
  `DISTRICT` sees one district. Out-of-scope resources, and filters that ask for them, get `403`.
- Passwords are hashed with bcrypt, the login endpoint is rate limited, and `helmet` sets the
  security headers.

## Demo credentials (seeded)

Users (password `Slsea@2026`): `admin@slsea.lk`, `national@slsea.lk`, `western@slsea.lk`,
`southern@slsea.lk`, `colombo@slsea.lk`, `gampaha@slsea.lk`, `galle@slsea.lk`.

Devices: installation `65f0a1b2c3d4e5f600000001` has meter `SLM-000001`. Its key comes from
`DEVICE_KEY_SECRET`; print it with `npm run device-key -- SLM-000001`.

## Running locally

```bash
npm install
cp .env.example .env   # fill in MongoDB Atlas credentials (or MONGODB_URI) and secrets
npm run seed           # drops and recreates all collections (~160k readings)
npm run dev            # http://localhost:3000/docs
npm run smoke          # end-to-end checks against the running server
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run with hot reload |
| `npm run build` / `npm start` | Compile to `dist/` / run the compiled server |
| `npm run typecheck` | Type-check app and scripts |
| `npm run seed` | Seed 9 provinces, 25 districts, 30 substations, 240 installations, 7 users, 7+ days of 15-min readings |
| `npm run device-key -- <meter_id>` | Print a seeded device's API key |
| `npm run simulate -- <base-url>` | Push each device's due readings through the API |
| `npm run smoke -- <base-url>` | 50 end-to-end checks of the design spine |

## Deployment (Render + MongoDB Atlas)

1. **Atlas:** create a database user, and under *Network Access* allow Render's published outbound
   IP ranges (listed on the service's *Connect* tab) plus your own IP for seeding. The API uses
   database `slsea_solar_db`.
2. **Seed** from your machine against Atlas: put the Atlas values in `.env`, then run `npm run seed`.
3. **Render:** *New → Blueprint* and pick this repo (it reads [render.yaml](render.yaml)). Enter
   `MONGO_USER`, `MONGO_PASSWORD` and `MONGO_CLUSTER`; `JWT_SECRET` is generated for you.
4. **Verify:** `npm run smoke -- https://slsea-solar-api-3w9p.onrender.com` (all 50 checks pass).
5. **Keep readings live (optional):** in GitHub *Settings → Secrets and variables → Actions*, add
   the variable `API_BASE_URL` and the secrets `DEVICE_KEY_SECRET` and `SEED_USER_PASSWORD`. The
   [simulate-devices](.github/workflows/simulate-devices.yml) workflow then pushes readings every
   15 minutes.
