# Web-API-CW — SLSEA Real-Time Solar Generation Data API

NB6007CEM Web API Development coursework. A REST API (Richardson Maturity Level 2) for the
Sri Lanka Sustainable Energy Authority that ingests generation readings pushed by rooftop
solar metering devices and serves operational (live) and analytical (historical) reads to
jurisdiction-scoped SLSEA users.

## Stack

- Node.js 20+, TypeScript, Express 5
- PostgreSQL with Prisma ORM
- OpenAPI 3 document served through Swagger UI at `/docs`

## Domain model

```
Province 1──* District 1──* GridSubstation 1──* SolarInstallation 1──* GenerationReading
User (role + jurisdiction: national | province | district)
```

- The meter/inverter identifier (`meterId`) is an attribute of `SolarInstallation`, not a
  separate Device entity.
- `GenerationReading` is an append-only time series, not last-value fields on the installation.

## Getting started

```bash
npm install
cp .env.example .env        # set DATABASE_URL
npm run db:migrate          # create schema
npm run db:seed             # load seed data
npm run dev                 # http://localhost:3000, docs at /docs
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run with hot reload |
| `npm run build` | Generate Prisma client and compile to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | Type-check without emitting |
| `npm run db:migrate` | Create/apply a development migration |
| `npm run db:deploy` | Apply migrations in production |
| `npm run db:seed` | Seed the database |
