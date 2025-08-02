# OurSaas

OurSaas is a **multi-tenant WhatsApp messaging and marketing SaaS API** built with **Node.js**, **Express**, **TypeScript**, **Drizzle ORM**, **PostgreSQL**, **Redis**, and **BullMQ**. It powers campaigns, templates, contacts, channels, billing, team permissions, automation workflows, and realtime inbox events for WhatsApp Business Cloud API workspaces.

## Features

- **Multi-tenant workspaces** — isolated tenants, roles (owner/admin/agent/viewer), and API keys
- **WhatsApp Cloud API** — channels, webhooks, templates, media, and message delivery
- **Campaigns & automation** — scheduled broadcasts, drip flows, and queue-backed workers
- **Contacts & segments** — CRM-style contact lists with import/export helpers
- **Billing** — Stripe, PayPal, Razorpay, and MercadoPago integrations
- **Realtime** — Socket.IO inbox events with Redis adapter support
- **Storage** — AWS S3 and Google Cloud Storage uploads
- **AI assist** — OpenAI-backed chatbot training hooks
- **Tested core** — pure helpers in `server/lib/` with an enforced **100% coverage gate**

## Tech stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20+, TypeScript (ESM) |
| API | Express 4 |
| Database | PostgreSQL + Drizzle ORM |
| Queue / cache | BullMQ, Redis / ioredis |
| Realtime | Socket.IO |
| Auth | Sessions, JWT, Passport, API keys |
| Testing | Vitest + V8 coverage (100% gate on `server/lib`) |

## Requirements

- Node.js 20+
- PostgreSQL 16+
- Redis 7+
- npm 10+

## Quick start

```bash
# 1. Configure environment
cp .env.example .env
# set DATABASE_URL, SESSION_SECRET, FRONTEND_ORIGIN, REDIS_URL

# 2. Install dependencies
npm install

# 3. Push the schema (optional for first boot)
npm run db:push

# 4. Run the test suite (enforces 100% coverage on core logic)
npm test

# 5. Start the API
npm run dev
```

The API listens on `PORT` (default `5000`).

## Available scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the TypeScript API with hot reload (`tsx`) |
| `npm run build` | Bundle the server for production |
| `npm start` | Run the production build |
| `npm test` | Run Vitest with the 100% coverage gate |
| `npm run test:watch` | Run tests in watch mode |
| `npm run db:push` | Push Drizzle schema to PostgreSQL |

## Testing & coverage

Reusable business logic lives in `server/lib/` and is verified by a deterministic
Vitest suite. Coverage is enforced at **100% statements, branches, functions, and
lines** (see `vitest.config.ts`); a failing threshold fails the build.

```bash
npm test
# → coverage/ contains an HTML + lcov report
```

| Module | Responsibility |
|--------|----------------|
| `server/lib/numbers.ts` | Safe numeric parsing, rounding, clamping, percentages |
| `server/lib/currency.ts` | Money formatting, thousands grouping, FX conversion |
| `server/lib/pricing.ts` | Line totals, tax, and order totals |
| `server/lib/coupon.ts` | Coupon validity windows and discount calculation |
| `server/lib/pagination.ts` | Page counts, clamping, slicing, and page ranges |
| `server/lib/validation.ts` | Email/phone/password and required-field checks |
| `server/lib/text.ts` | Slugify, truncate, title-case, and i18n value lookup |
| `server/lib/orderStatus.ts` | Lifecycle transitions and status colors |
| `server/lib/permissions.ts` | Role-based access matrix for tenant teams |

## Docker

A multi-stage `Dockerfile` provides a **test target** (runs the coverage gate) and
a lean **runtime target**.

```bash
# Run the containerized test suite
docker build --target test -t oursaas-test .

# Full stack (API + Postgres + Redis)
docker compose up --build
```

## Project structure

```
├── server/
│   ├── lib/            # Pure business helpers (100% test coverage)
│   │   └── __tests__/  # Vitest unit tests
│   ├── controllers/    # HTTP controllers
│   ├── routes/         # Express routers
│   ├── services/       # Domain services (WhatsApp, campaigns, billing)
│   ├── repositories/   # Data access
│   ├── middlewares/    # Auth, tenant, validation
│   └── index.ts        # API entrypoint
├── shared/             # Shared Drizzle schema and constants
├── packages/oursaas-core/  # Shared core utilities package
├── .github/workflows/  # CI pipeline (test + coverage)
├── Dockerfile
├── docker-compose.yml
└── vitest.config.ts
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Session signing secret |
| `FRONTEND_ORIGIN` / `CLIENT_ORIGIN` / `ALLOWED_ORIGINS` | CORS allowlist |
| `REDIS_URL` | Redis connection for queues and Socket.IO |
| `PORT` | HTTP listen port (default `5000`) |

## License

Released under the MIT License.
