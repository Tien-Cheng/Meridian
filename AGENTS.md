# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Additional Instructions
- Use `Context7` or `Jina` MCP if available to pull up the latest documentation for libraries used

---

## Project Overview

**Meridian** is a geospatial investigation agent for detecting unauthorized cross-border marketplace sellers. Given a product SKU and target markets, it browses live marketplaces in parallel using autonomous web agents (TinyFish), identifies suspicious listings, verifies shipping eligibility, links related seller accounts, and produces enforcement-ready evidence packs.

This is a hackathon project. Design doc is at `docs/design-doc.md`.

## Commands

```bash
pnpm install          # Install dependencies
pnpm run dev          # Start both Next.js frontend and Convex backend in parallel
pnpm run dev:frontend # Next.js only
pnpm run dev:backend  # Convex only
pnpm run build        # Production build
pnpm run lint         # ESLint (excludes convex/_generated/)
```

`pnpm run dev` runs a `predev` hook that initializes Convex, seeds data via `setup.mjs`, and opens the Convex dashboard before starting both servers.

## Architecture

### Stack
- **Frontend:** Next.js (App Router) + React 19 + Tailwind CSS 4 + shadcn/ui (radix-nova style)
- **Backend:** Convex (serverless functions, real-time database, scheduling)
- **Auth:** `@convex-dev/auth` with JWT
- **External APIs:** TinyFish (browser automation agents), OpenAI, Mapbox (geospatial)
- **Package manager:** pnpm

### Directory Layout
- `app/` — Next.js App Router pages and layouts
- `components/` — React components; `ui/` holds shadcn primitives
- `convex/` — All backend code: schema, queries, mutations, actions, auth, HTTP routes
- `convex/_generated/` — Auto-generated types and API; never edit manually
- `lib/` — Shared utilities (`utils.ts` with `cn()`)
- `docs/` — Design documentation

### Frontend ↔ Backend Data Flow
- Client components use `useQuery()`, `useMutation()`, `useAction()` from `convex/react`
- Server components call Convex via `fetchQuery` / `preloadQuery` (no WebSocket)
- Auth state via `useConvexAuth()` and `ConvexAuthNextjsServerProvider` in the root layout

### Convex Backend Patterns
- **Queries** — read-only, reactive, run in transactions
- **Mutations** — transactional writes
- **Actions** — Node.js runtime, can call external APIs (TinyFish, OpenAI, Mapbox); not transactional
- `convex/auth.ts` / `convex/auth.config.ts` — auth setup (do not rename or restructure)
- `convex/http.ts` — HTTP routes (required for Convex Auth callbacks)
- `convex/schema.ts` — always include `...authTables` spread

### Authentication
The root layout wraps everything in `ConvexAuthNextjsServerProvider`. The client provider is in `components/ConvexClientProvider.tsx`. The sign-in page lives at `app/signin/`. Auth is required before accessing Convex data.

### Styling
- Tailwind CSS v4 (configured via PostCSS, no `tailwind.config.js`)
- shadcn/ui components added via `npx shadcn@latest add <component>`
- `cn()` helper from `lib/utils.ts` for merging class names

## Key Convex Conventions
- Validators use `v` from `convex/values`; always match schema types exactly
- Generated API imported from `convex/_generated/api`; data model types from `convex/_generated/dataModel`
- Actions (not mutations) call external APIs like TinyFish or OpenAI
- Use `internalMutation` / `internalQuery` / `internalAction` for functions not exposed to the client
- Scheduled functions use `ctx.scheduler.runAfter()` or cron jobs in a `crons.ts` file
- Tests (when added): use `convex-test` with `vitest` and `@edge-runtime/vm`; test files in `convex/`

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
