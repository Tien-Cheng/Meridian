<p align="center">
  <img src="public/meridian-logo.svg" alt="Meridian" width="80" />
</p>

<h1 align="center">Meridian</h1>

<p align="center">
  <strong>AI-powered investigation agent for detecting counterfeit pharmaceuticals across online marketplaces</strong>
</p>

<p align="center">
  Built at the TinyFish Hackathon &middot; March 28, 2026 &middot; NUS, Singapore
</p>

---

## The Problem

Counterfeit and unauthorized pharmaceuticals are a global public health crisis. The WHO estimates up to 10% of medicines worldwide are substandard or falsified — rising to 30% in parts of Africa and Asia. The explosion of online marketplaces has made this exponentially harder to police: fake drugs appear on Amazon, Lazada, Shopee, Telegram channels, and grey-market "online pharmacy" sites with listings nearly indistinguishable from legitimate sellers.

**Counterfeit drugs kill an estimated 500,000+ people annually.** This is not about protecting revenue — it is about protecting lives.

## What Meridian Does

Meridian is a **geospatial investigation console** — not a dashboard, not a chatbot. Think: pharmaceutical intelligence analyst workstation. Given a drug name and target markets, Meridian autonomously:

1. **Searches** live marketplaces in parallel using [TinyFish](https://www.tinyfish.ai/) browser automation agents
2. **Identifies** suspicious listings based on counterfeit risk signals (pricing anomalies, missing pharmacy credentials, seller red flags)
3. **Verifies** whether listings ship into protected/regulated regions
4. **Links** related seller accounts across marketplaces to uncover distribution networks
5. **Maps** the geographic spread of suspicious sellers on an interactive map
6. **Generates** an enforcement-ready case file with evidence suitable for regulators and legal teams


## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Next.js Frontend (App Router + React 19)               │
│  ┌───────────┬────────────┬──────────┬────────────────┐ │
│  │ Chat Panel│ Map (Deck.gl│ Evidence │ TinyFish       │ │
│  │           │ + Mapbox)   │ Panel    │ Agent Monitor  │ │
│  └───────────┴────────────┴──────────┴────────────────┘ │
└────────────────────────┬────────────────────────────────┘
                         │ Real-time subscriptions
┌────────────────────────▼────────────────────────────────┐
│  Convex Backend                                         │
│  ┌──────────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Investigation │  │ AI Agent │  │ Workflow Engine    │ │
│  │ Queries/      │  │ (OpenAI) │  │ (parallel search, │ │
│  │ Mutations     │  │          │  │  verify, cluster)  │ │
│  └──────────────┘  └──────────┘  └───────────────────┘ │
└────────────────────────┬────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
     ┌─────────┐  ┌──────────┐  ┌───────────┐
     │ TinyFish│  │  OpenAI  │  │  Mapbox   │
     │ (browse)│  │ (reason) │  │ (geocode) │
     └─────────┘  └──────────┘  └───────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui |
| Visualization | Deck.gl, Mapbox GL, react-map-gl |
| Backend | Convex (real-time database, serverless functions, scheduling) |
| AI | Convex Agents + Workflows, OpenAI, Vercel AI SDK |
| Browser Automation | TinyFish (autonomous web agents) |
| Auth | @convex-dev/auth with JWT |

### Key Backend Tools

| Tool | Purpose |
|------|---------|
| `searchMarketplace` | Search listings across marketplaces for a given drug |
| `inspectListing` | Deep-dive into seller and product details |
| `verifyShipping` | Check if items ship to protected/regulated markets |
| `crawlStorefront` | Extract full seller profile and inventory |
| `clusterSellers` | Link related seller accounts via behavioral patterns |
| `generateCaseFile` | Synthesize findings into a legal-ready enforcement case |

## Getting Started

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/)
- A [Convex](https://convex.dev/) account
- API keys for: TinyFish, OpenAI, Mapbox

### Setup

```bash
pnpm install
pnpm run dev
```

This runs a setup hook that initializes Convex, seeds demo data, and starts both the Next.js frontend and Convex backend in parallel.

### Commands

```bash
pnpm run dev          # Start frontend + backend
pnpm run dev:frontend # Next.js only
pnpm run dev:backend  # Convex only
pnpm run build        # Production build
pnpm run lint         # ESLint
```

## Project Structure

```
app/                        # Next.js App Router
  investigation/[id]/       # Investigation console (map, chat, evidence, case)
  signin/                   # Authentication
components/
  ui/                       # shadcn/ui primitives
  ai-elements/              # Chat interface components
convex/
  agents/                   # AI investigator agent
  workflows/                # Investigation workflow orchestration
  tools/                    # Marketplace search, verify, cluster tools
  functions/                # Queries, mutations, actions
  schema.ts                 # Data model
  lib/                      # Utilities (geocoding, demo data)
docs/                       # Design documentation
```

## Team

Built in 5.5 hours by a team of 3 at the TinyFish Hackathon, NUS Acacia College, Singapore.

## License

MIT
