# Deployment Guide

This document covers setup, configuration, and deployment of the JIRA Kanban Sync application.

## Prerequisites

- Node.js 18+ (for Next.js 15)
- Docker and Docker Compose (for PostgreSQL)
- JIRA Cloud account with API token access
- Anthropic API key (for Claude-powered story breakdown)

## Local Development Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Database

The application uses PostgreSQL (v16) running in Docker:

```bash
docker-compose up -d
```

This starts a PostgreSQL container at `localhost:5432` with:
- Username: `postgres`
- Password: `postgres`
- Database: `kanban`

### 3. Configure Environment Variables

Create a `.env.local` file based on `.env.example`:

```bash
cp .env.example .env.local
```

Then populate the required variables (see [Environment Variables](#environment-variables) below).

### 4. Database Setup

Push the Prisma schema to the database:

```bash
npx prisma db push
```

This creates the required `Story` and `WorkUnit` tables.

### 5. Run the Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:3000`.

## Environment Variables

JIRA credentials are stored per project (Settings panel), not in the environment.

| Variable | Description | Example |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | API key for Claude (used for story breakdown) | From [console.anthropic.com](https://console.anthropic.com) |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/kanban` |
| `NODE_ENV` | Environment mode | `development` or `production` |

### Getting JIRA API Token

1. Log in to your JIRA Cloud account
2. Go to **Settings** → **Security** → **API tokens**
3. Click **Create API token**
4. Copy the token and add it to the project's Settings panel in the app

## Running Tests

The application uses Vitest for unit testing. Tests run against a separate test database:

```bash
npm test
```

For interactive test UI:

```bash
npm run test:ui
```

For watch mode:

```bash
npm run test:watch
```

Test configuration uses `.env.test` which connects to a separate PostgreSQL database.

## Production Deployment

### Build

Create an optimized production build:

```bash
npm run build
```

This compiles Next.js and TypeScript into `.next/`.

### Start Production Server

```bash
npm start
```

The application will run on the default port (typically 3000, configurable via `PORT` environment variable).

### Environment Configuration

For production, ensure:
- All required environment variables are set securely (use environment secrets, not committed files)
- `NODE_ENV=production`
- `DATABASE_URL` points to your production PostgreSQL instance
- Anthropic API key is set to production credentials, and each project's JIRA credentials are configured in its Settings panel
- Database backups are configured
- PostgreSQL is running on a secure, non-exposed port

### Database in Production

Use a managed PostgreSQL service (AWS RDS, Heroku Postgres, etc.) or secure self-hosted instance. The application connects via the `DATABASE_URL` environment variable.

## Architecture Overview

The application consists of:

1. **Frontend (Next.js)** — React UI for viewing and managing stories/work units
2. **Backend API** — Next.js API routes for mutations (create, update, move work units)
3. **Sync Engine** — Fetches stories from JIRA and syncs to local database
4. **Claude Integration** — Breaks down stories into work units using Claude API
5. **Database (PostgreSQL)** — Stores stories and work units

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed system design.

## Troubleshooting

### Database Connection Issues

```bash
# Test PostgreSQL connection
docker-compose exec postgres pg_isready -U postgres

# View PostgreSQL logs
docker-compose logs postgres
```

### JIRA API Errors

- Verify the project's JIRA site URL in Settings includes `https://`
- Confirm API token is valid (tokens expire after 90 days by default)
- Confirm the JIRA project key configured in the project's Settings exists and is accessible
- Ensure email address has sufficient JIRA permissions

### Claude API Errors

- Verify `ANTHROPIC_API_KEY` is correct
- Check Claude API rate limits and usage
- Ensure request size is within API limits (story descriptions should be reasonable length)

### Port Already in Use

Change the development server port:

```bash
PORT=3001 npm run dev
```

Or for PostgreSQL:

```bash
docker-compose down
# Modify docker-compose.yml to use different port
docker-compose up -d
```

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start development server (with hot reload) |
| `npm run build` | Build for production |
| `npm start` | Start production server |
| `npm run lint` | Run Next.js linting |
| `npm test` | Run test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:ui` | Run tests with Vitest UI |
| `npx prisma db push` | Sync Prisma schema to database |
| `npx prisma studio` | Open Prisma Studio to view/edit data |
