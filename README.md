# CBOP v2

Internal business operations platform for Etherence IT, Etherence Pentest, CYBERCOM CTF, and AttackOS.

## What is CBOP?

CBOP replaces SaaS tools with a self-hosted operations platform. It handles invoices, deals, tasks, projects, reports, and automation — all in one place, on our own Ubuntu 24.04 homeserver.

**Agents handle decisions. Automations handle execution. Humans close deals.**

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS + TanStack Query
- **Backend**: Hono.js + Node.js
- **Database**: PostgreSQL (Docker container)
- **Auth**: better-auth + JWT + httpOnly cookies
- **Automations**: n8n (6 workflows)
- **Agents**: OpenClaw (5 AI agents)
- **Messaging**: OpenClaw → Telegram Bot API + WhatsApp Business API
- **PDF**: Puppeteer (HTML to PDF)
- **Backup**: AWS S3 + pg_dump cron
- **Infrastructure**: Docker + Nginx Proxy Manager

## Project Structure

```
cbop-v2/
├── app/                    # Next.js App Router pages
│   ├── (auth)/            # Auth routes (login, etc.)
│   ├── (dashboard)/       # Protected dashboard routes
│   ├── layout.tsx         # Root layout
│   └── globals.css        # Global styles
├── api/                   # Hono.js backend
│   ├── lib/               # Shared utilities
│   │   ├── db.ts         # PostgreSQL connection
│   │   ├── auth.ts       # better-auth setup
│   │   └── openclaw.ts   # OpenClaw integration
│   ├── middleware/        # Auth middleware
│   │   ├── require-auth.ts
│   │   └── require-role.ts
│   ├── routes/           # API route handlers (added in later slices)
│   └── index.ts          # Hono app entry
├── migrations/           # Database migrations
│   └── 001_initial_schema.sql
├── n8n/                  # n8n workflow exports (added in Slice 11)
├── docs/                 # Documentation
│   ├── MASTER.md         # Complete specification
│   └── ...
├── docker-compose.yml    # All services
├── Dockerfile            # CBOP app container
├── package.json          # Dependencies
├── .env.example          # Environment variables template
└── README.md             # This file
```

## Setup Instructions

### Prerequisites

- Ubuntu 24.04 server (or similar Linux environment)
- Docker + Docker Compose installed
- Node.js 18+ (for local development)
- OpenClaw running at `http://127.0.0.1:18789` (or configure URL in .env)

### 1. Clone the repository

```bash
git clone <gitea-url>/cbop-v2.git
cd cbop-v2
```

### 2. Create .env file

```bash
cp .env.example .env
# Edit .env and fill in all required values
```

**Important environment variables to configure:**
- `DATABASE_URL` - PostgreSQL connection string
- `BETTER_AUTH_SECRET` - Secret key for auth (min 32 chars)
- `OPENCLAW_URL` - OpenClaw endpoint
- `OPENCLAW_API_KEY` - OpenClaw API key
- `OUTLINE_URL` - Outline wiki URL
- `OUTLINE_API_TOKEN` - Outline API token
- `N8N_WEBHOOK_SECRET` - Secret for n8n webhooks
- `AWS_ACCESS_KEY_ID` - AWS credentials for S3 backup
- `AWS_SECRET_ACCESS_KEY` - AWS secret key
- `S3_BUCKET_NAME` - S3 bucket for backups

### 3. Start all services

```bash
docker-compose up -d
```

This starts:
- PostgreSQL (port 5432)
- n8n (port 5678)
- Outline (port 3000)
- Nextcloud (port 8080)
- Gitea (port 3001)
- Uptime Kuma (port 3002)
- Nginx Proxy Manager (ports 80, 443, 81)
- CBOP app (port 3003)

### 4. Run database migrations

```bash
# Wait for PostgreSQL to be ready
docker-compose exec postgres pg_isready

# Run migration
docker-compose exec postgres psql -U cbop_user -d cbop_v2 -f /docker-entrypoint-initdb.d/001_initial_schema.sql
```

### 5. Access the application

- **CBOP**: http://localhost:3003
- **n8n**: http://localhost:5678
- **Outline**: http://localhost:3000
- **Nextcloud**: http://localhost:8080
- **Gitea**: http://localhost:3001
- **Uptime Kuma**: http://localhost:3002
- **Nginx Proxy Manager**: http://localhost:81

### 6. Configure Nginx Proxy Manager (optional)

1. Access Nginx Proxy Manager at http://localhost:81
2. Default credentials: `admin@example.com` / `changeme`
3. Set up proxy hosts for all services with custom domains
4. Configure SSL certificates (Let's Encrypt)

## Development

### Install dependencies

```bash
npm install
```

### Run development server

```bash
npm run dev
```

Application will be available at http://localhost:3003

### Run type checking

```bash
npm run type-check
```

### Build for production

```bash
npm run build
npm start
```

## Database Migrations

Migrations are in the `migrations/` directory. They run automatically when the PostgreSQL container starts (via `docker-entrypoint-initdb.d`).

To run migrations manually:

```bash
docker-compose exec postgres psql -U cbop_user -d cbop_v2 -f /path/to/migration.sql
```

## Backup & Restore

### Automated Backups

Set up a cron job on the host machine:

```bash
# Add to crontab -e
0 2 * * * docker-compose -f /path/to/cbop-v2/docker-compose.yml exec -T postgres pg_dump -U cbop_user cbop_v2 | gzip > /tmp/cbop_$(date +\%Y\%m\%d).sql.gz && aws s3 cp /tmp/cbop_$(date +\%Y\%m\%d).sql.gz s3://cbop-backups/ && rm /tmp/cbop_$(date +\%Y\%m\%d).sql.gz
```

### Manual Backup

```bash
docker-compose exec postgres pg_dump -U cbop_user cbop_v2 > backup.sql
```

### Restore from Backup

```bash
docker-compose exec -T postgres psql -U cbop_user -d cbop_v2 < backup.sql
```

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    HOME SERVER (Ubuntu 24.04)                 │
│                                                              │
│  ┌──────────────┐    HTTP calls     ┌───────────────────┐   │
│  │  CBOP        │ ──────────────── ▶│  OpenClaw         │   │
│  │  (Next.js +  │                   │  (Agent runner +  │   │
│  │   Hono.js)   │◀── agent results──│   Messaging hub)  │   │
│  └──────┬───────┘                   └────────┬──────────┘   │
│         │                                    │               │
│         │ SQL queries           Telegram Bot API             │
│         ▼                       WhatsApp Business API        │
│  ┌──────────────┐                            │               │
│  │  PostgreSQL  │                            ▼               │
│  │              │               ┌────────────────────────┐  │
│  └──────────────┘               │  Telegram (team)       │  │
│                                 │  WhatsApp (clients)    │  │
│  ┌──────────────┐               └────────────────────────┘  │
│  │  n8n         │    webhooks    ┌───────────────────────┐  │
│  │  (automations│◀──────────────│  CBOP API             │  │
│  │   6 workflows│                │  (fires webhooks)      │  │
│  │              │─── OpenClaw ──▶│                       │  │
│  └──────────────┘    /send       └───────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Key Rules

1. **No Supabase** - Plain PostgreSQL + better-auth only
2. **No Redis** - n8n handles all automations
3. **All messaging through OpenClaw** - Never call Telegram/WhatsApp APIs directly
4. **SOPs from Outline only** - Notion is retired
5. **No global search bar** - Table filters only
6. **Finance routes CEO-only** - Enforced at middleware level
7. **Every task requires a project** - `project_id` is NOT NULL
8. **Slide-over panels only** - No modals, no separate create pages

## Build Phases

CBOP is built in feature slices (vertical slices of functionality):

- ✅ **Slice 0**: Infrastructure Setup (current)
- **Slice 1**: Auth + Shell
- **Slice 2**: Home Dashboard
- **Slice 3**: Sales Pipeline
- **Slice 4**: Invoices + PDF
- **Slice 5**: Leads + Clients
- **Slice 6**: Tasks + Projects
- **Slice 7**: Work Sessions
- **Slice 8**: Templates + PDF Export
- **Slice 9**: CEO Panel
- **Slice 10**: Settings + System Jobs
- **Slice 11**: n8n Automations
- **Slice 12**: OpenClaw Agents
- **Slice 13**: Security Audit + Deploy

## Documentation

- `docs/MASTER.md` - Complete specification (all features, all slices)
- `CLAUDE.md` - Instructions for Claude Code sessions
- `HANDOFF.md` - Current state and next steps

## Support

For issues or questions, check the documentation or contact the team.

---

**Version**: 2.0.0
**Last Updated**: May 2026
**Status**: Slice 0 Complete
