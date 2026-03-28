# Meridian: Hackathon Design Document

> **Event:** TinyFish Hackathon, March 28 2026
> **Venue:** Acacia College, NUS UTown, Singapore
> **Team Size:** 3
> **Build Window:** 10:30 AM - 4:00 PM (5.5 hours)

**Note on code snippets:** All code in this document is illustrative pseudocode intended to convey architecture and data flow. Variable names, import paths, and exact API signatures should be verified against the latest Convex Agent, Convex Workflow, and TinyFish documentation during implementation.

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [Problem Statement](#2-problem-statement)
3. [User Experience Design](#3-user-experience-design)
4. [Tech Stack](#4-tech-stack)
5. [Architecture](#5-architecture)
6. [Data Models and Schema](#6-data-models-and-schema)
7. [Agent Design](#7-agent-design)
8. [Frontend Design](#8-frontend-design)
9. [Backend Design](#9-backend-design)
10. [TinyFish Integration](#10-tinyfish-integration)
11. [Demo Scenario](#11-demo-scenario)
12. [Tiered Scope and Fallback Plans](#12-tiered-scope-and-fallback-plans)
13. [Team Workstream Split](#13-team-workstream-split)
14. [Build Timeline](#14-build-timeline)
15. [Judging Alignment and Prize Strategy](#15-judging-alignment-and-prize-strategy)
16. [Risk Management](#16-risk-management)
17. [Pitch Script](#17-pitch-script)

---

## 1. Product Vision

### One-line Pitch

Meridian is a live web investigation agent that helps premium brands catch unauthorized cross-border marketplace sellers and auto-build enforcement-ready evidence packs in minutes instead of days.

### What It Is

Meridian is a geospatial investigation agent for unauthorized cross-border resellers. Given a product SKU and target markets, it:

- Browses live marketplaces in parallel using autonomous web agents
- Identifies suspicious listings based on pricing anomalies
- Verifies whether listings actually ship into protected regions
- Links related seller accounts across marketplaces
- Maps the geographic spread of suspicious seller activity
- Produces a human-reviewable enforcement case

### What It Is NOT

- Not a generic price-monitoring dashboard
- Not a simple scraping tool with a nice UI
- Not a chatbot wrapper around an API
- Not a broad enterprise platform (for hackathon purposes)

### Why This Wins

The hackathon rewards projects that use the live open web as the database, handle messy dynamic websites, show technical complexity, solve a real-world problem, and demonstrate autonomous agent behavior. Meridian hits all five. The agent does not just extract data; it investigates, verifies, and assembles a case.

---

## 2. Problem Statement

### Core Pain

Premium brands frequently face unauthorized sellers or diverted inventory appearing in the wrong geographic regions. This causes channel conflict, price erosion, weakened distributor relationships, brand damage, and large manual investigation costs.

### The User

The primary user is a brand protection manager, regional channel manager, or marketplace operations lead.

### Job To Be Done

"Help me quickly identify whether suspicious listings in foreign marketplaces are real channel leakage, determine who is behind them, and give me enough evidence to take action."

### Chosen Wedge

**Premium beauty and skincare brands facing unauthorized cross-border marketplace sellers.**

Why this wedge works:
- Recognizable and easy for judges to understand immediately
- Strong price differences across regions (Southeast Asia vs Europe vs US)
- Lots of marketplace fragmentation (Amazon, Lazada, Shopee, etc.)
- Visually simple product listings that are easy to demo
- Believable brand-protection use case with real market demand

---

## 3. User Experience Design

### Interaction Model

The application feels like an **investigation console**, not a dashboard or chatbot. Think: intelligence analyst workstation. The user launches an investigation, watches it unfold in real time, can interact with the agent via chat, and receives a completed case file.

### Primary Interaction Flow

1. **Initiate:** User describes the investigation via the chat panel (brand, product, regions, protected market)
2. **Parse:** The agent extracts structured parameters from the free-text prompt using `generateObject` with `InvestigationRequestSchema`. If the prompt is ambiguous or missing fields, the agent asks a clarifying question before launching.
3. **Watch:** The map and TinyFish monitor show live agent activity. The chat panel narrates progress.
4. **Interact (optional):** User sends follow-up messages mid-investigation ("Also check Lazada Singapore", "Focus on that German seller"). Follow-ups are handled as conversational responses; they do NOT re-trigger the investigation workflow.
5. **Review:** Evidence tab populates with findings. Case tab reveals the final enforcement pack.

### UI Layout

```
+---------------------------------------------------------------------+
|  HEADER: Meridian logo  .  Investigation #12  .  [Live]         |
+-----------------------------------+---------------------------------+
|                                   |                                 |
|      INVESTIGATION MAP            |     RIGHT PANEL (tabbed)        |
|      (deck.gl, dark basemap)      |                                 |
|                                   |  [Chat] [Evidence] [Case]       |
|   . Country markers (drop-in      |  +---------------------------+ |
|     animation as found)           |  |                           | |
|   . Animated shipping route       |  |  Chat messages from the   | |
|     arcs (dashed/marching ants)   |  |  investigator agent +     | |
|   . Seller cluster overlays       |  |  user can ask follow-ups  | |
|   . Severity color coding:        |  |                           | |
|     green=ok, amber=suspicious,   |  |  > "Check if this seller  | |
|     red=confirmed violation       |  |    also lists on Lazada"  | |
|                                   |  |                           | |
|                                   |  +---------------------------+ |
|                                   |  +---------------------------+ |
|                                   |  |  [Send message...]    >   | |
|                                   |  +---------------------------+ |
+-----------------------------------+---------------------------------+
|  BOTTOM BAR: TinyFish Live Monitor                                  |
|  +----------------+ +----------------+ +----------------+          |
|  | Agent 1        | | Agent 2        | | Agent 3        | Activity |
|  | Amazon.de      | | Amazon.fr      | | Lazada.sg      | Log      |
|  | [live browser  | | [live browser  | | [live browser  | (scroll) |
|  |  iframe]       | |  iframe]       | |  iframe]       |          |
|  | "Searching     | | "Opening       | | "Waiting..."   |          |
|  |  for SKU..."   | |  storefront"   | |                |          |
|  +----------------+ +----------------+ +----------------+          |
+---------------------------------------------------------------------+
```

### Layout Behavior

- **Input panel** (left sidebar from original plan) is removed. Investigation initiation happens through the chat panel. This is cleaner and more agentic.
- **Right panel** has three tabs:
  - **Chat** (default during investigation): Agent narration + user messages + streaming responses
  - **Evidence** (auto-populates): Suspicious listings table + seller dossier
  - **Case** (appears on completion): Final enforcement evidence pack
- **Bottom bar** is the TinyFish Live Monitor. Each parallel TinyFish agent gets a card showing a **live browser iframe** (via TinyFish's `streaming_url`), status label, and marketplace name. Height: ~150-180px. This is the theatrical demo element. When TinyFish returns a `STREAMING_URL` event, the URL is embedded as a read-only iframe so judges can watch the agent browsing in real time.
- **Map** is the center of gravity and largest element. It is interactive: clicking a marker highlights the corresponding listing in the Evidence tab.
- On investigation completion, the right panel auto-switches from Chat to Case tab.

### Design Style

**Concept:** Modern geographic intelligence console. The name "Meridian" (a line of longitude) drives the visual identity. The aesthetic should feel like a cartographic operations instrument, not a Silicon Valley SaaS dashboard. Hard edges, monospace data readouts, amber as brand color, coordinate grid textures, and restraint over decoration.

**Overall vibe:** "This was built by someone who has actually used intelligence tooling."

#### Shadcn Theme Configuration

| Setting | Value | Reasoning |
|---------|-------|-----------|
| Base Color | Zinc | Cool, technical grey scale; pairs cleanly with amber accents |
| Theme | Neutral | Custom severity colors (amber/emerald/red) serve as the accent palette |
| Chart Color | Neutral | Severity colors are semantic, not decorative |
| Heading | Geist | Technical, slightly condensed feel; reads as "engineered" |
| Font | Geist | Consistent with heading; distinctive without being showy |
| Icon Library | Lucide | Clean stroke-based icons, excellent coverage |
| Radius | None (0rem) | Hard edges signal precision and seriousness; strongest anti-generic signal |
| Menu | Default / Solid | Clear visual boundaries on dark backgrounds |
| Menu Accent | Subtle | Keeps attention on the investigation content, not the chrome |

#### Color System

| Role | Color | Hex | Tailwind | Usage |
|------|-------|-----|----------|-------|
| Background | Zinc 950 | #09090b | `bg-zinc-950` | App base background |
| Surface | Zinc 900 | #18181b | `bg-zinc-900` | Cards, panels, monitor cards |
| Border | Zinc 800 | #27272a | `border-zinc-800` | Panel dividers, card borders |
| Muted text | Zinc 500 | #71717a | `text-zinc-500` | Secondary info, timestamps |
| Body text | Zinc 100 | #f4f4f5 | `text-zinc-100` | Primary readable text |
| Brand accent | Amber 500 | #f59e0b | `text-amber-500` | Logo, active states, primary buttons, header glow |
| Normal finding | Emerald 500 | #10b981 | `text-emerald-500` | Verified clean listings, "all clear" |
| Suspicious | Amber 400 | #fbbf24 | `text-amber-400` | Price anomalies, warnings |
| Confirmed violation | Red 500 | #ef4444 | `text-red-500` | Verified violations, critical alerts |
| Map route (unverified) | Amber 500 50% | #f59e0b80 | -- | Suspected shipping routes (dashed) |
| Map route (verified) | Red 500 | #ef4444 | -- | Confirmed unauthorized routes (solid) |

The brand color (amber) is deliberately close to the "suspicious" severity color. The product is *about* investigation; the brand identity IS the investigation.

#### Typography

- **UI text:** Geist (heading and body). Clean, technical, slightly condensed.
- **Data readouts:** Geist Mono or JetBrains Mono. Used aggressively, not just for code. Price deviations, coordinates, seller IDs, timestamps, percentage figures, and investigation IDs should all render in monospace. When the agent narrates "Found 12 listings on Amazon.de," the number "12" should be monospace even within prose. This makes the whole product feel like an instrument panel.
- **Avoid:** Inter (the most generic font in AI tooling), system fonts, Arial.

#### Cards and Panels

- **No glassmorphism.** No blur, no transparency, no backdrop-filter. These are 2024 AI slop cliches.
- **Flat zinc-900 background** with a **single-pixel zinc-800 border**. Let the data be the visual interest.
- **Sharp corners** (radius 0). Ops tools do not have rounded corners.
- **Header bar accent:** A subtle bottom border glow in amber at low opacity to anchor the brand color:
  ```css
  .header { border-bottom: 1px solid rgba(245, 158, 11, 0.2); }
  ```

#### Background Texture: Coordinate Grid

Instead of solid backgrounds, use a subtle coordinate grid pattern at very low opacity (3-5%) on the map area and panel backgrounds. This reinforces the geographic intelligence identity without being distracting.

```css
.grid-texture {
  background-image:
    linear-gradient(rgba(244, 244, 245, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(244, 244, 245, 0.03) 1px, transparent 1px);
  background-size: 40px 40px;
}
```

This gives the dark background depth and makes the product instantly recognizable.

#### Map Styling

The map is the hero element. It should feel like a command center display.

- **Basemap:** Mapbox "Dark" style, further desaturated. Land colors tinted toward zinc. Ocean nearly black (#09090b).
- **Markers:** Small, sharp-edged **diamonds or squares** (not circles) with severity color fill. On discovery, a brief pulse animation (expanding ring) plays for 2 seconds, then stops. No persistent glow.
- **Route lines:** **Dashed lines with marching-ants animation** for unverified routes (amber, 50% opacity). **Solid lines** for verified routes (red). This is how actual intelligence tools render shipping lanes, not decorative arcs with glow effects.
- **Labels:** Country names in monospace, small, zinc-400 color.

#### TinyFish Monitor Cards

Each card has a distinct visual treatment from the rest of the UI:
- **Amber left border stripe** (2px solid amber-500) as a status accent
- Marketplace name in monospace, uppercase
- Status text in monospace, zinc-400
- A "LIVE" badge with a small pulsing red dot when the iframe is active
- When completed, the left border turns emerald; on error, it turns red

#### Investigation Header

The header should feel like an intelligence document identifier, not a generic app bar:

```
MERIDIAN  ·  INV-2026-0328-003  ·  SK-II FACIAL TREATMENT ESSENCE  ·  ● ACTIVE
```

All caps, monospace, dot-separated. The investigation ID uses a date-based format. The status indicator is a pulsing dot (green for active, amber for processing, grey for complete). This immediately signals "serious operational system" before judges even see the map.

---

## 4. Tech Stack

### Final Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend framework | Next.js (App Router) | React SSR, routing, Vercel deployment |
| UI components | Shadcn/ui (dark theme) | Pre-built accessible components |
| Styling | Tailwind CSS | Utility-first CSS |
| AI chat UI | AI Elements SDK | Message rendering (markdown, tool display), PromptInput, Conversation auto-scroll |
| Map visualization | deck.gl + Mapbox GL JS | Geospatial markers, animated arcs, dark basemap |
| Backend + database | Convex (Cloud) | Reactive database, serverless functions, real-time subscriptions, scheduling |
| AI agent framework | @convex-dev/agent | Agent definitions, threads, message persistence, streaming, tools |
| AI workflow engine | @convex-dev/workflow | Durable multi-step investigation workflows with retries |
| LLM provider | @ai-sdk/openai | Model provider adapter (used by Convex Agents internally) |
| Primary model | gpt-5.4 | Case generation, reasoning, investigation decisions |
| Fast model | gpt-5.4-mini | Bulk data normalization, listing classification, extraction |
| Web automation | TinyFish REST API (SSE) | Live marketplace browsing, data extraction, shipping verification |
| Validation | Zod v4 | Data contracts between all layers |
| Frontend hosting | Vercel | Deployment, edge network |
| Backend hosting | Convex Cloud | Managed serverless backend |

### What We Dropped and Why

| Dropped | Reason |
|---------|--------|
| Vercel AI SDK (direct) | Convex Agents wraps it internally with better reactive streaming |
| Separate API server | Convex serverless functions replace the need for Express/FastAPI |
| Any database (Postgres, SQLite, etc.) | Convex is the database, backend, and real-time layer in one |
| WebSocket/SSE plumbing | Convex reactive queries handle all real-time updates automatically |

### Key Technical Decisions

- **No separate database.** Convex is the single source of truth. All investigation data, findings, agent messages, and TinyFish streaming URLs flow through Convex tables.
- **No HTTP streaming plumbing.** Convex Agents stream via database deltas. The frontend subscribes to reactive queries. If the user's connection drops and reconnects, they see all updates they missed.
- **TinyFish via REST, not SDK.** TinyFish works with standard HTTP POST to their SSE endpoint. No heavy SDK dependency needed. We wrap calls in Convex actions.
- **Two model tiers.** GPT-5.4 for reasoning-heavy tasks (case generation, investigation decisions). GPT-5.4-mini for high-volume tasks (normalizing 20+ listing results, classification).
- **Workflow is the single orchestrator.** All investigation logic flows through one Convex Workflow. The chat panel narrates state changes but does not drive core investigation logic. This avoids dual-orchestrator ambiguity.
- **AI Elements for chat rendering.** AI Elements components are installed as editable source files (like shadcn). Convex Agent's `UIMessage` extends the AI SDK's `UIMessage`, so `useUIMessages` data flows directly into AI Elements components with no adapter layer. Only the rendering layer changes; data hooks and real-time streaming via Convex reactive queries are untouched.

---

## 5. Architecture

### System Architecture Diagram

```
                         +-------------------+
                         |    Next.js App     |
                         |    (Vercel)        |
                         |                   |
                         | - Investigation   |
                         |   Map (deck.gl)   |
                         | - Chat Panel      |
                         | - TinyFish Monitor|
                         | - Evidence/Case   |
                         +--------+----------+
                                  |
                          Convex React Client
                          (WebSocket, reactive queries)
                                  |
                         +--------v----------+
                         |   Convex Cloud     |
                         |                   |
                         | +---------------+ |
                         | | Queries       | |  <-- Frontend subscribes to these
                         | | (reactive)    | |      Auto-updates on any data change
                         | +---------------+ |
                         |                   |
                         | +---------------+ |
                         | | Mutations     | |  <-- Atomic writes to DB
                         | | (transactional)| |      Trigger query re-runs
                         | +---------------+ |
                         |                   |
                         | +---------------+ |
                         | | Actions       | |  <-- External API calls
                         | | (side effects)| |      TinyFish + OpenAI
                         | +---------------+ |
                         |                   |
                         | +---------------+ |
                         | | Agent         | |  <-- @convex-dev/agent
                         | | Component     | |      Threads, messages, tools, streaming
                         | +---------------+ |
                         |                   |
                         | +---------------+ |
                         | | Workflow      | |  <-- @convex-dev/workflow
                         | | Component     | |      SOLE orchestrator for investigations
                         | +---------------+ |
                         |                   |
                         | +---------------+ |
                         | | Database      | |  <-- All tables
                         | | (reactive)    | |      investigations, findings,
                         | +---------------+ |      agentMonitor, cases, etc.
                         +--------+---------++
                                  |          |
                        +---------+--+  +----+--------+
                        | TinyFish   |  | OpenAI API  |
                        | REST API   |  | (GPT-5.4)   |
                        | (SSE)      |  |             |
                        +------------+  +-------------+
```

### Data Flow

```
1. User sends message via Chat
        |
        v
2. Convex Mutation: saveMessage to agent thread + schedule workflow
        |
        v
3. Convex Workflow: investigationWorkflow starts
        |
        +---> Step 1: Search marketplaces (parallel TinyFish calls)
        |         |
        |         +--> TinyFish SSE stream processed
        |         +--> Screenshots/status written to agentMonitor table
        |         +--> Listings written to findings table
        |         +--> Agent narrates progress in chat thread
        |         +--> Frontend auto-updates (reactive queries):
        |               - Map shows new markers
        |               - Monitor shows screenshots
        |               - Chat shows agent messages
        |
        +---> Step 2: Deep investigate suspicious listings
        |         |
        |         +--> TinyFish opens listing, extracts seller info
        |         +--> TinyFish tests cart/shipping flow
        |         +--> Findings updated with verification status
        |         +--> Map draws route line on verification
        |
        +---> Step 3: Seller clustering
        |         |
        |         +--> GPT-5.4-mini compares seller signals
        |         +--> Seller dossier written to sellerDossiers table
        |         +--> Evidence tab populates
        |
        +---> Step 4: Generate case file
                  |
                  +--> GPT-5.4 synthesizes all evidence
                  +--> Case file written to cases table
                  +--> Chat shows summary message
                  +--> Right panel auto-switches to Case tab
```

---

## 6. Data Models and Schema

### Convex Schema

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Core investigation request
  investigations: defineTable({
    userId: v.optional(v.string()),
    threadId: v.string(),           // Links to agent thread
    brand: v.string(),
    sku: v.string(),
    regions: v.array(v.object({
      name: v.string(),             // e.g. "Germany"
      marketplace: v.string(),      // e.g. "amazon.de"
      marketplaceUrl: v.string(),   // e.g. "https://www.amazon.de"
      baselinePrice: v.number(),
      currency: v.string(),
    })),
    protectedMarket: v.string(),    // e.g. "France"
    status: v.union(
      v.literal("pending"),
      v.literal("searching"),
      v.literal("investigating"),
      v.literal("generating_case"),
      v.literal("completed"),
      v.literal("failed")
    ),
    createdAt: v.number(),
  }).index("by_thread", ["threadId"])
    .index("by_status", ["status"]),

  // Individual listing findings
  findings: defineTable({
    investigationId: v.id("investigations"),
    threadId: v.string(),
    // Listing data
    title: v.string(),
    marketplace: v.string(),        // e.g. "Amazon.de"
    region: v.string(),             // e.g. "Germany"
    sellerName: v.string(),
    listedPrice: v.number(),
    currency: v.string(),
    baselinePrice: v.number(),
    priceDeviation: v.number(),     // percentage
    listingUrl: v.string(),
    imageUrls: v.optional(v.array(v.string())),
    // Geospatial
    latitude: v.number(),
    longitude: v.number(),
    // Investigation status
    isSuspicious: v.boolean(),
    suspicionReasons: v.array(v.string()),
    // Shipping verification
    shippingVerified: v.optional(v.boolean()),
    shipsToProtectedMarket: v.optional(v.boolean()),
    shippingEvidence: v.optional(v.string()),
    // Seller linking
    sellerClusterId: v.optional(v.string()),
    // Metadata
    discoveredAt: v.number(),
  }).index("by_investigation", ["investigationId"])
    .index("by_thread", ["threadId"])
    .index("by_suspicious", ["investigationId", "isSuspicious"]),

  // TinyFish live monitor state
  agentMonitor: defineTable({
    investigationId: v.id("investigations"),
    agentIndex: v.number(),         // 0, 1, 2 for parallel agents
    region: v.string(),
    marketplace: v.string(),
    status: v.union(
      v.literal("idle"),
      v.literal("launching"),
      v.literal("searching"),
      v.literal("inspecting"),
      v.literal("verifying_shipping"),
      v.literal("crawling_storefront"),
      v.literal("completed"),
      v.literal("error")
    ),
    statusLabel: v.string(),        // Human-readable, e.g. "Opening seller storefront..."
    screenshotUrl: v.optional(v.string()),  // Stored in Convex file storage
    currentUrl: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_investigation", ["investigationId"]),

  // Seller dossiers (clustered seller profiles)
  sellerDossiers: defineTable({
    investigationId: v.id("investigations"),
    clusterId: v.string(),
    sellerNames: v.array(v.string()),
    marketplaces: v.array(v.string()),
    regions: v.array(v.string()),
    relatedListingIds: v.array(v.id("findings")),
    // Clustering signals
    signals: v.object({
      nameOverlap: v.boolean(),
      imageReuse: v.boolean(),
      descriptionSimilarity: v.boolean(),
      catalogOverlap: v.boolean(),
    }),
    confidenceScore: v.number(),    // 0-1
    // Geospatial footprint
    activeCountries: v.array(v.object({
      country: v.string(),
      latitude: v.number(),
      longitude: v.number(),
    })),
  }).index("by_investigation", ["investigationId"]),

  // Verified shipping routes
  shippingRoutes: defineTable({
    investigationId: v.id("investigations"),
    findingId: v.id("findings"),
    fromRegion: v.string(),
    fromLatitude: v.number(),
    fromLongitude: v.number(),
    toRegion: v.string(),           // Protected market
    toLatitude: v.number(),
    toLongitude: v.number(),
    verified: v.boolean(),
    verificationMethod: v.string(), // e.g. "cart_shipping_check"
    priceGap: v.number(),           // percentage
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical")
    ),
  }).index("by_investigation", ["investigationId"]),

  // Final case file
  cases: defineTable({
    investigationId: v.id("investigations"),
    threadId: v.string(),
    // Summary
    title: v.string(),
    executiveSummary: v.string(),
    // Evidence
    totalListingsFound: v.number(),
    suspiciousListings: v.number(),
    verifiedViolations: v.number(),
    sellerClustersIdentified: v.number(),
    // Detail sections
    findingSummaries: v.array(v.object({
      findingId: v.id("findings"),
      title: v.string(),
      marketplace: v.string(),
      sellerName: v.string(),
      priceDeviation: v.number(),
      shippingVerified: v.boolean(),
    })),
    sellerDossierSummaries: v.array(v.object({
      clusterId: v.string(),
      sellerNames: v.array(v.string()),
      confidenceScore: v.number(),
      summary: v.string(),
    })),
    // Recommendations
    recommendedActions: v.array(v.object({
      action: v.string(),
      priority: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
      detail: v.string(),
    })),
    // Metadata
    generatedAt: v.number(),
  }).index("by_investigation", ["investigationId"])
    .index("by_thread", ["threadId"]),
});
```

### Zod Schemas for Data Contracts

These schemas validate data flowing between TinyFish results, Convex mutations, and GPT-5.4 structured outputs.

```typescript
// shared/schemas.ts
import { z } from "zod/v4";

// TinyFish extraction result
export const ListingExtractionSchema = z.object({
  title: z.string(),
  price: z.number(),
  currency: z.string(),
  sellerName: z.string(),
  listingUrl: z.string(),
  imageUrls: z.array(z.string()).optional(),
  shippingInfo: z.string().optional(),
});

// GPT-5.4 case generation output
export const CaseGenerationSchema = z.object({
  executiveSummary: z.string(),
  findingSummaries: z.array(z.object({
    findingId: z.string(),
    title: z.string(),
    marketplace: z.string(),
    sellerName: z.string(),
    priceDeviation: z.number(),
    shippingVerified: z.boolean(),
  })),
  sellerDossierSummaries: z.array(z.object({
    clusterId: z.string(),
    sellerNames: z.array(z.string()),
    confidenceScore: z.number(),
    summary: z.string(),
  })),
  recommendedActions: z.array(z.object({
    action: z.string(),
    priority: z.enum(["high", "medium", "low"]),
    detail: z.string(),
  })),
});

// Seller clustering signals
export const SellerClusteringSchema = z.object({
  clusters: z.array(z.object({
    clusterId: z.string(),
    sellerNames: z.array(z.string()),
    signals: z.object({
      nameOverlap: z.boolean(),
      imageReuse: z.boolean(),
      descriptionSimilarity: z.boolean(),
      catalogOverlap: z.boolean(),
    }),
    confidenceScore: z.number().min(0).max(1),
  })),
});
```

---

## 7. Agent Design

### Agent Definitions

We define multiple specialized agents, each with focused responsibilities:

```typescript
// convex/agents/investigator.ts
import { Agent } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { components } from "../_generated/api";

export const investigatorAgent = new Agent(components.agent, {
  name: "Meridian Investigator",
  languageModel: openai.chat("gpt-5.4"),
  instructions: `You are Meridian, an AI brand protection investigator.
Your role is to help premium brands identify unauthorized cross-border
marketplace sellers. You investigate live marketplaces using browsing tools,
find suspicious listings, verify shipping into protected regions, link
related seller accounts, and build enforcement-ready evidence cases.

When investigating, you should:
- Search multiple marketplaces in parallel when possible
- Flag listings with significant price deviations from baseline
- Verify shipping eligibility into the protected market
- Look for seller patterns (similar names, shared images, template descriptions)
- Narrate your investigation steps clearly so the user can follow along
- Be specific about what you find and what it means

When generating a case, you should:
- Present findings with confidence levels
- Clearly distinguish verified facts from inferences
- Recommend specific next actions
- Keep language professional and suitable for legal/compliance review`,
  tools: {
    searchMarketplace,
    inspectListing,
    verifyShipping,
    crawlStorefront,
    clusterSellers,
    generateCaseFile,
  },
  maxSteps: 15,
});

export const extractorAgent = new Agent(components.agent, {
  name: "Data Extractor",
  languageModel: openai.chat("gpt-5.4-mini"),
  instructions: `You normalize raw marketplace listing data into structured
JSON. You identify price anomalies by comparing against provided baseline
prices. You flag listings as suspicious when price deviations exceed 15%
below baseline or when listings appear in unexpected regions.`,
  maxSteps: 3,
});
```

### Tool Definitions

Each tool wraps a specific capability. Tools that call TinyFish run as Convex actions. Tools that read/write to the database use Convex queries/mutations via the tool context.

```typescript
// convex/tools/searchMarketplace.ts
import { createTool } from "@convex-dev/agent";
import { z } from "zod/v4";
import { internal } from "../_generated/api";

export const searchMarketplace = createTool({
  description: "Search a marketplace for a product and extract all listings with prices and seller info",
  inputSchema: z.object({
    marketplaceUrl: z.string().describe("The marketplace URL to search, e.g. https://www.amazon.de"),
    searchQuery: z.string().describe("The product name or SKU to search for"),
    region: z.string().describe("The marketplace region, e.g. Germany"),
    baselinePrice: z.number().describe("The official price in this region for comparison"),
    currency: z.string().describe("The currency code, e.g. EUR"),
  }),
  execute: async (ctx, args): Promise<string> => {
    // 1. Initialize monitor card for this agent
    await ctx.runMutation(internal.monitor.initAgent, {
      investigationId: ctx.investigationId,
      agentIndex: args.agentIndex,
      region: args.region,
      marketplace: args.marketplaceUrl,
    });

    // 2. Call TinyFish SSE endpoint
    const response = await fetch("https://agent.tinyfish.ai/v1/automation/run-sse", {
      method: "POST",
      headers: {
        "X-API-Key": process.env.TINYFISH_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: args.marketplaceUrl,
        goal: `Search for "${args.searchQuery}". Extract ALL listings on the
          first 2 pages of results. For each listing extract: title, price,
          currency, seller name, listing URL, and any shipping information
          visible. Return results as a JSON array.`,
        proxy_config: { enabled: true },
      }),
    });

    // 3. Process SSE stream, updating monitor and findings
    const listings = await processTinyFishStream(
      response,
      ctx,
      args,
    );

    return `Found ${listings.length} listings on ${args.region}. ` +
      `${listings.filter(l => l.isSuspicious).length} flagged as suspicious.`;
  },
});

export const verifyShipping = createTool({
  description: "Verify whether a marketplace listing can actually ship to the protected market by testing the cart/checkout flow",
  inputSchema: z.object({
    listingUrl: z.string().describe("The URL of the listing to verify"),
    protectedMarket: z.string().describe("The country to check shipping to, e.g. France"),
    findingId: z.string().describe("The ID of the finding to update with verification results"),
  }),
  execute: async (ctx, args): Promise<string> => {
    // Call TinyFish to interact with the listing's cart flow
    const response = await fetch("https://agent.tinyfish.ai/v1/automation/run-sse", {
      method: "POST",
      headers: {
        "X-API-Key": process.env.TINYFISH_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: args.listingUrl,
        goal: `Add this product to cart. Then go to checkout or shipping
          options. Check if shipping to ${args.protectedMarket} is available.
          Report: can_ship (true/false), shipping_cost if available,
          estimated_delivery if available. Return as JSON.`,
        proxy_config: { enabled: true },
      }),
    });

    const result = await processTinyFishStream(response, ctx, args);

    // Update the finding with verification
    await ctx.runMutation(internal.findings.updateShippingVerification, {
      findingId: args.findingId,
      shippingVerified: true,
      shipsToProtectedMarket: result.can_ship,
      shippingEvidence: JSON.stringify(result),
    });

    // If verified, create a shipping route
    if (result.can_ship) {
      await ctx.runMutation(internal.routes.createRoute, {
        // ... route data
      });
    }

    return result.can_ship
      ? `CONFIRMED: This listing CAN ship to ${args.protectedMarket}.`
      : `This listing does NOT ship to ${args.protectedMarket}.`;
  },
});

export const crawlStorefront = createTool({
  description: "Visit a seller's storefront page and extract all their listings for the target brand",
  inputSchema: z.object({
    sellerStorefrontUrl: z.string().describe("The URL of the seller's storefront"),
    brandName: z.string().describe("The brand to filter listings for"),
  }),
  execute: async (ctx, args): Promise<string> => {
    // TinyFish browses the storefront
    // Returns related listings for clustering
    // ...
  },
});

export const clusterSellers = createTool({
  description: "Analyze seller data across findings and identify likely related seller accounts",
  inputSchema: z.object({
    investigationId: z.string().describe("The investigation to cluster sellers for"),
  }),
  execute: async (ctx, args): Promise<string> => {
    // Read all findings for the investigation
    // Use GPT-5.4-mini to compare seller signals
    // Write seller dossiers to DB
    // ...
  },
});
```

### Workflow Definition

The investigation workflow orchestrates the multi-step process with durability:

```typescript
// convex/workflows/investigate.ts
import { WorkflowManager } from "@convex-dev/workflow";
import { components, internal } from "../_generated/api";

const workflow = new WorkflowManager(components.workflow);

export const investigationWorkflow = workflow.define({
  args: {
    investigationId: v.id("investigations"),
    threadId: v.string(),
    brand: v.string(),
    sku: v.string(),
    regions: v.array(v.object({
      name: v.string(),
      marketplace: v.string(),
      marketplaceUrl: v.string(),
      baselinePrice: v.number(),
      currency: v.string(),
    })),
    protectedMarket: v.string(),
  },
  handler: async (step, args) => {
    // Step 1: Search all marketplaces in parallel
    await Promise.all(
      args.regions.map((region, index) =>
        step.runAction(
          internal.agents.searchRegion,
          {
            investigationId: args.investigationId,
            threadId: args.threadId,
            agentIndex: index,
            ...region,
            searchQuery: `${args.brand} ${args.sku}`,
          },
          { retry: true }
        )
      )
    );

    // Step 2: Deep investigate top suspicious listings
    await step.runAction(
      internal.agents.deepInvestigate,
      {
        investigationId: args.investigationId,
        threadId: args.threadId,
        protectedMarket: args.protectedMarket,
      },
      { retry: true }
    );

    // Step 3: Cluster sellers
    await step.runAction(
      internal.agents.clusterSellers,
      {
        investigationId: args.investigationId,
        threadId: args.threadId,
      },
      { retry: true }
    );

    // Step 4: Generate case file
    await step.runAction(
      internal.agents.generateCase,
      {
        investigationId: args.investigationId,
        threadId: args.threadId,
        protectedMarket: args.protectedMarket,
      },
      { retry: true }
    );
  },
});
```

---

## 8. Frontend Design

### Page Structure

```
app/
  layout.tsx                    # Root layout with Convex provider
  page.tsx                      # Landing / new investigation page
  globals.css                   # Add: @source "../node_modules/streamdown/dist/*.js" for markdown
  investigation/
    [id]/
      page.tsx                  # Main investigation console
      components/
        InvestigationMap.tsx     # deck.gl map component
        ChatPanel.tsx           # Agent chat using AI Elements components
        EvidencePanel.tsx       # Findings table + seller dossiers
        CasePanel.tsx           # Final case file display
        TinyFishMonitor.tsx     # Bottom bar with agent screenshots
        RightPanel.tsx          # Tabbed container for Chat/Evidence/Case
        ActivityLog.tsx         # Scrolling text log in bottom bar
components/
  ai-elements/                  # AI Elements SDK (installed as editable source)
    conversation.tsx            # Auto-scrolling message container
    message.tsx                 # Message bubble with markdown rendering
    prompt-input.tsx            # Auto-resizing input with keyboard shortcuts
    tool.tsx                    # Collapsible tool call display with status badges
```

### Key Frontend Components

#### InvestigationMap (deck.gl)

Layers:
- **ScatterplotLayer**: Country-level markers for findings. Color-coded by severity. Drop-in animation on creation.
- **ArcLayer**: Shipping route lines between source region and protected market. Animated dash effect. Thickness by confidence. Color: amber for suspected, red for verified.
- **TextLayer**: Country labels on markers.
- **IconLayer** (stretch): Seller cluster icons.

Basemap: Mapbox GL JS with dark style. Requires MAPBOX_ACCESS_TOKEN env var.

Interaction: Clicking a marker triggers a callback that switches the right panel to Evidence tab and highlights the corresponding finding.

#### ChatPanel

**Data layer** (unchanged): `useUIMessages` from `@convex-dev/agent/react` for paginated, streaming message display. Convex Agent's `UIMessage` extends the AI SDK's `UIMessage`, so the data feeds directly into AI Elements components.

**Rendering layer** (AI Elements SDK):
- `<Conversation>` — auto-scrolling message container with scroll-to-bottom button
- `<Message>` + `<MessageResponse>` — role-aware bubbles with full GFM markdown rendering and syntax highlighting (via streamdown). Handles incomplete streaming markdown natively, replacing `SmoothText`.
- `<Tool>` — collapsible tool invocation display with status badges (pending, running, completed, error). Shows tool input/output. Default collapsed.
- `<PromptInput>` + `<PromptInputTextarea>` + `<PromptInputSubmit>` — auto-resizing textarea, Enter to send, Shift+Enter for newline, status-aware submit button.
- `<MessageActions>` — retry and copy buttons on assistant messages.

**Theme customization:** AI Elements installs as editable source files (like shadcn). The investigation console aesthetic (0 border-radius, `font-mono`, amber-500 accents, zinc-900/950 palette) is applied by editing the installed component source directly. No wrapper overrides needed.

#### TinyFishMonitor

Each agent card shows:
- Status indicator (green dot = active, amber = waiting, grey = complete)
- Marketplace label
- Current screenshot (img tag, updated via reactive query)
- Status label text
- Current URL (truncated)

Cards are rendered from `useQuery(api.monitor.listByInvestigation, { investigationId })`. This query auto-updates whenever the Convex action writes a new screenshot or status.

Screenshots are stored in Convex file storage. The agent monitor mutation stores the storage ID, and the query returns a URL via `ctx.storage.getUrl()`.

#### EvidencePanel

Two sub-sections:
1. **Findings table**: Sortable by price deviation. Columns: marketplace, seller, price, deviation %, region, suspicious (badge), shipping verified (badge). Click row to expand detail.
2. **Seller dossier cards**: One card per identified cluster. Shows seller names, marketplaces, confidence score, signal badges (name overlap, image reuse, etc.).

#### CasePanel

Structured display of the generated case file:
- Executive summary
- Key statistics (listings found, suspicious, verified violations, seller clusters)
- Finding summaries with expandable detail
- Seller cluster summaries
- Recommended actions with priority badges
- (Stretch) Export to PDF button

---

## 9. Backend Design

### Convex Function Organization

```
convex/
  schema.ts                     # Database schema (see section 6)
  convex.config.ts              # Component registration (agent + workflow)
  
  agents/
    investigator.ts             # Main investigator agent definition
    extractor.ts                # Data extraction agent definition
  
  tools/
    searchMarketplace.ts        # TinyFish marketplace search tool
    inspectListing.ts           # TinyFish listing detail extraction tool
    verifyShipping.ts           # TinyFish cart/shipping verification tool
    crawlStorefront.ts          # TinyFish seller storefront crawl tool
    clusterSellers.ts           # GPT-5.4-mini seller clustering tool
    generateCaseFile.ts         # GPT-5.4 case generation tool
  
  workflows/
    investigate.ts              # Durable investigation workflow definition
  
  functions/
    investigations.ts           # CRUD for investigations table
    findings.ts                 # CRUD for findings table
    monitor.ts                  # Agent monitor read/write functions
    routes.ts                   # Shipping routes read/write functions
    cases.ts                    # Case file read/write functions
    chat.ts                     # Chat message queries + send mutation
  
  lib/
    tinyfish.ts                 # TinyFish SSE stream processor utility
    geocoding.ts                # Country name to lat/lng mapping
    constants.ts                # Region coordinates, marketplace URLs, etc.
```

### Key Backend Functions

```typescript
// convex/functions/chat.ts
// Sending a message from the user and triggering investigation

export const sendMessage = mutation({
  args: { threadId: v.string(), prompt: v.string() },
  handler: async (ctx, { threadId, prompt }) => {
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      prompt,
    });
    // Schedule async response
    await ctx.scheduler.runAfter(0, internal.chat.generateResponse, {
      threadId,
      promptMessageId: messageId,
    });
    return { messageId };
  },
});

export const generateResponse = internalAction({
  args: { threadId: v.string(), promptMessageId: v.string() },
  handler: async (ctx, { threadId, promptMessageId }) => {
    await investigatorAgent.streamText(
      ctx,
      { threadId },
      { promptMessageId },
      { saveStreamDeltas: true },
    );
  },
});

// Listing messages for the chat panel
export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const paginated = await listUIMessages(ctx, components.agent, args);
    const streams = await syncStreams(ctx, components.agent, args);
    return { ...paginated, streams };
  },
});
```

```tsx
// app/investigation/[id]/components/ChatPanel.tsx
// Frontend rendering with AI Elements + Convex Agent data

import { useUIMessages } from "@convex-dev/agent/react";
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse, MessageActions, MessageAction } from "@/components/ai-elements/message";
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { PromptInput, PromptInputBody, PromptInputTextarea, PromptInputFooter, PromptInputSubmit } from "@/components/ai-elements/prompt-input";

export default function ChatPanel({ threadId }: { threadId: string }) {
  const [input, setInput] = useState("");
  const sendMessage = useMutation(api.functions.chat.sendMessage);

  // Data from Convex Agent — UIMessage extends AI SDK's UIMessage
  const { results, status } = useUIMessages(
    api.functions.chat.listMessages,
    { threadId },
    { initialNumItems: 50, stream: true }
  );

  const isStreaming = status === "streaming";

  return (
    <div className="flex flex-col h-full">
      <Conversation>
        <ConversationContent>
          {results.map((msg) => (
            <Message key={msg.key} from={msg.role}>
              <MessageContent>
                {msg.parts.map((part, i) => {
                  if (part.type === "text") {
                    return <MessageResponse key={i}>{part.text}</MessageResponse>;
                  }
                  if (part.type.startsWith("tool-")) {
                    return (
                      <Tool key={i}>
                        <ToolHeader type={part.type} state={part.state} />
                        <ToolContent>
                          <ToolInput input={part.input} />
                          <ToolOutput output={part.output} />
                        </ToolContent>
                      </Tool>
                    );
                  }
                  return null;
                })}
              </MessageContent>
            </Message>
          ))}
        </ConversationContent>
      </Conversation>

      <PromptInput onSubmit={() => { sendMessage({ threadId, prompt: input }); setInput(""); }}>
        <PromptInputBody>
          <PromptInputTextarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Send message..." />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputSubmit status={isStreaming ? "streaming" : "ready"} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
```

```typescript
// convex/functions/monitor.ts
// Real-time agent monitor functions

export const listByInvestigation = query({
  args: { investigationId: v.id("investigations") },
  handler: async (ctx, { investigationId }) => {
    const monitors = await ctx.db
      .query("agentMonitor")
      .withIndex("by_investigation", q => q.eq("investigationId", investigationId))
      .collect();

    // Resolve screenshot URLs from file storage
    return Promise.all(monitors.map(async (m) => ({
      ...m,
      screenshotUrl: m.screenshotUrl
        ? await ctx.storage.getUrl(m.screenshotUrl)
        : null,
    })));
  },
});

export const updateAgent = internalMutation({
  args: {
    investigationId: v.id("investigations"),
    agentIndex: v.number(),
    status: v.string(),
    statusLabel: v.string(),
    screenshotUrl: v.optional(v.string()),
    currentUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Find existing monitor entry
    const existing = await ctx.db
      .query("agentMonitor")
      .withIndex("by_investigation", q =>
        q.eq("investigationId", args.investigationId))
      .filter(q => q.eq(q.field("agentIndex"), args.agentIndex))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("agentMonitor", {
        ...args,
        region: "",
        marketplace: "",
        updatedAt: Date.now(),
      });
    }
  },
});
```

### TinyFish SSE Stream Processor

```typescript
// convex/lib/tinyfish.ts
// Utility to process TinyFish SSE responses and update monitor/findings

export async function processTinyFishStream(
  response: Response,
  ctx: ToolCtx,
  meta: { investigationId: string; agentIndex: number; region: string },
): Promise<any> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let result = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n").filter(l => l.startsWith("data: "));

    for (const line of lines) {
      const data = JSON.parse(line.slice(6));

      if (data.type === "STEP") {
        // Update monitor with current step
        await ctx.runMutation(internal.monitor.updateAgent, {
          investigationId: meta.investigationId,
          agentIndex: meta.agentIndex,
          status: "searching",
          statusLabel: data.step_description || "Working...",
          screenshotUrl: data.screenshot_url || undefined,
          currentUrl: data.current_url || undefined,
        });
      }

      if (data.type === "COMPLETE") {
        result = data.result;
        await ctx.runMutation(internal.monitor.updateAgent, {
          investigationId: meta.investigationId,
          agentIndex: meta.agentIndex,
          status: "completed",
          statusLabel: "Done",
        });
      }

      if (data.type === "ERROR") {
        await ctx.runMutation(internal.monitor.updateAgent, {
          investigationId: meta.investigationId,
          agentIndex: meta.agentIndex,
          status: "error",
          statusLabel: data.error || "Error occurred",
        });
        throw new Error(data.error);
      }
    }
  }

  return result;
}
```

---

## 10. TinyFish Integration

### API Usage Pattern

All TinyFish calls go through the SSE endpoint:

```
POST https://agent.tinyfish.ai/v1/automation/run-sse
Headers:
  X-API-Key: TINYFISH_API_KEY
  Content-Type: application/json

Body:
{
  "url": "https://www.amazon.de",
  "goal": "Search for SK-II Facial Treatment Essence...",
  "proxy_config": { "enabled": true }
}
```

### Specific TinyFish Goals by Step

**Step 1: Marketplace Search**
```
Goal: Search for "{brand} {sku}". Navigate to the search results page.
Extract ALL listings visible on the first 2 pages. For each listing,
extract: product title, price (as a number), currency, seller/merchant
name, listing URL. If shipping information is visible on the search
results page, extract that too. Return all results as a JSON array.
```

**Step 2: Listing Inspection**
```
Goal: Open this product listing page. Extract: full product title, 
current price, seller name, seller storefront URL if available, 
all product images, product description, and any shipping/delivery
information shown on the page. Return as JSON.
```

**Step 3: Shipping Verification**
```
Goal: On this product listing, click "Add to Cart" or equivalent.
Then navigate to the cart or checkout. Look for shipping options or
delivery address selection. Check if shipping to {protectedMarket}
is available. Report: can_ship (true/false), shipping_cost if shown,
estimated_delivery_days if shown. Do NOT complete any purchase.
Return as JSON.
```

**Step 4: Storefront Crawl**
```
Goal: This is a seller's storefront page. Find and extract all 
listings from this seller that are related to the brand "{brand}".
For each listing extract: title, price, currency, URL. Also extract
the seller's display name, rating if visible, and how long they 
have been active if shown. Return as JSON.
```

### Screenshots

TinyFish SSE events include `screenshot_url` fields during step execution. We capture these and store them in Convex file storage for the monitor panel. The monitor cards update in real time via reactive queries.

### Parallel Execution

For the demo, we run 2-3 TinyFish agents in parallel (one per marketplace region). Each gets its own `agentIndex` in the monitor panel. Convex Workflow handles running these as parallel steps.

### Fallback: Cached Results

For demo reliability, pre-run the TinyFish calls on target marketplaces the night before. Cache the structured results. If a live call fails during the demo, the tool can fall back to cached results while still showing the "live" monitor animation.

---

## 11. Demo Scenario

### Hero Narrative

A premium skincare brand (SK-II) has official pricing in Singapore, Germany, and France. The user suspects gray-market diversion into Europe.

### Demo Script (2-3 minutes)

**[0:00-0:15] Setup**
User types in chat: "Investigate SK-II Facial Treatment Essence. Check Amazon Germany, Amazon France, and Lazada Singapore. Baseline prices: SGD 299, EUR 189, EUR 195. Protect the France market."

**[0:15-0:45] Launch**
Three TinyFish agent cards appear in the bottom bar. Screenshots show browsers launching. Map is empty but ready. Chat narrates: "Starting investigation across 3 marketplaces..."

**[0:45-1:15] Discovery**
Markers drop onto the map as listings are found. Chat: "Found 12 listings on Amazon.de, 8 on Amazon.fr, 6 on Lazada.sg. Flagging 4 suspicious listings based on price deviation..."

**[1:15-1:45] Deep Investigation**
TinyFish monitor shows one agent clicking into a suspicious Amazon.de listing priced at EUR 139 (27% below baseline). Agent opens the listing, navigates to the seller's storefront. Chat: "Seller 'BeautyDeals_EU' on Amazon.de has this product at 27% below official price. Investigating storefront..."

**[1:45-2:15] Verification**
Agent adds item to cart, checks shipping. Chat: "CONFIRMED: This listing ships to France. Verified via cart shipping check." A solid red route line draws from Germany to France on the map.

**[2:15-2:45] Seller Linking**
Chat: "Found 3 additional SK-II products from the same seller. Similar listing patterns detected on a separate Amazon.fr account 'EU_Beauty_Shop'. Confidence: 78% these are the same operator." Seller cluster overlay appears on the map.

**[2:45-3:00] Case Delivery**
Right panel switches to Case tab. Chat: "Investigation complete. 2 verified violations, 1 seller cluster identified. Evidence pack ready for review." Case file shows executive summary, findings, seller dossier, and recommended actions.

### Backup Plan

If live TinyFish calls fail:
1. Use cached results from pre-run calls
2. The monitor shows a "replay" of the pre-recorded screenshots
3. All other logic (case generation, map visualization) runs live

---

## 12. Tiered Scope and Fallback Plans

### Tier 1: "We Win Something" (must complete by 2:30 PM)

- [ ] Single marketplace search via TinyFish returning structured listing data
- [ ] Suspicious listing flagging by price deviation
- [ ] Deep investigation on one listing: open it, extract seller info
- [ ] Basic map with country markers (static dots, color-coded)
- [ ] Agent chat panel with AI Elements (markdown rendering, tool display, auto-scroll)
- [ ] GPT-5.4 generated case summary
- [ ] TinyFish monitor with at least status labels (screenshots stretch)
- [ ] Clean dark-themed UI with Shadcn components

### Tier 2: "Strong Contender" (target by 3:30 PM)

Everything in Tier 1, plus:
- [ ] Parallel multi-marketplace runs (2-3 regions)
- [ ] Shipping verification via cart interaction
- [ ] Animated map with route arcs for verified shipping
- [ ] TinyFish monitor with live screenshots
- [ ] Seller storefront crawl with related listings
- [ ] Seller clustering with simple heuristic signals
- [ ] Seller dossier panel in Evidence tab
- [ ] Streaming agent messages via Convex deltas

### Tier 3: "Clear Winner" (only if Tier 2 solid by 3:00 PM)

Everything in Tier 2, plus:
- [ ] Interactive chat: user sends follow-ups, agent adapts mid-investigation
- [ ] Seller relationship mini-graph (force-directed visualization)
- [ ] Risk scoring with weighted signals
- [ ] "Investigation replay" mode on the map (animated sequence of discoveries)
- [ ] Multi-product investigation (expand from one SKU to full seller catalog)
- [ ] Exportable case file (PDF/JSON)

### Panic MVP (if everything breaks by 3 PM)

If TinyFish is down, APIs are flaky, and nothing works:
- [ ] Hard-coded demo data loaded from JSON fixtures
- [ ] Map shows pre-placed markers and one pre-drawn route
- [ ] Agent chat replays pre-written messages with smooth streaming
- [ ] Case file renders from static data
- [ ] Pitch emphasizes architecture and vision over live functionality

---

## 13. Team Workstream Split

### Builder A: Frontend + Visualization

**Owns:** Next.js app, all React components, deck.gl map, Shadcn theming, TinyFish monitor UI

**Hackathon day tasks:**
1. Scaffold Next.js app with Convex provider, Shadcn dark theme, layout shell
2. Build the investigation map with deck.gl (markers first, arcs second)
3. Build the TinyFish monitor bottom bar
4. Build the tabbed right panel (Chat, Evidence, Case)
5. Wire up Convex reactive queries to all components
6. Polish dark theme, animations, and responsive layout

**AI agent focus:** Component scaffolding, Tailwind styling, deck.gl layer configuration

**Human focus:** Map interactions, layout decisions, demo flow polish

### Builder B: Agent Orchestration + TinyFish Integration

**Owns:** Convex backend, agent definitions, TinyFish API calls, SSE processing, workflow orchestration

**Hackathon day tasks:**
1. Set up Convex project with schema, agent component, workflow component
2. Implement TinyFish SSE stream processor utility
3. Build the searchMarketplace tool (first and most critical)
4. Build the inspectListing and verifyShipping tools
5. Wire up the investigation workflow with parallel steps
6. Implement the agent monitor mutations (screenshots, status updates)
7. Test end-to-end: user message triggers workflow, data flows to DB

**AI agent focus:** Boilerplate Convex functions, TinyFish API integration code, error handling

**Human focus:** TinyFish goal prompt engineering, investigation logic, workflow orchestration

### Builder C: Intelligence Layer + Demo Prep

**Owns:** GPT-5.4 prompts, seller clustering logic, case generation, evidence assembly, demo data, pitch

**Hackathon day tasks:**
1. Build the clusterSellers tool (seller comparison via GPT-5.4-mini)
2. Build the generateCaseFile tool (GPT-5.4 structured output)
3. Define Zod schemas for all data contracts
4. Create fallback demo data (cached TinyFish results, pre-built case)
5. Build the chat interaction handler (user sends follow-ups)
6. Write and rehearse the demo pitch
7. QA the full end-to-end flow and fix edge cases

**AI agent focus:** Zod schema generation, case file template code, prompt drafting

**Human focus:** Clustering heuristic design, case quality tuning, pitch delivery

### Critical Coordination Points (Before Hacking Starts)

By 10:30 AM, all three builders must agree on:

1. **Convex schema** (section 6 of this doc): lock the table shapes
2. **Zod schemas** (section 6): lock the data contracts
3. **SSE event types**: `listing_found`, `shipping_verified`, `seller_linked`, `case_complete`
4. **Monitor update format**: agentIndex, status enum, statusLabel string
5. **Map data format**: { latitude, longitude, severity, type } for markers; { from, to, verified } for arcs
6. **Target demo websites**: exact URLs and search terms for the hero scenario

---

## 14. Build Timeline

| Time | Builder A (Frontend) | Builder B (Backend) | Builder C (Intelligence) |
|------|---------------------|--------------------|-----------------------|
| 09:45-10:30 | Workshop + setup: clone repo, install deps, verify Mapbox token | Workshop + setup: init Convex project, deploy schema, verify TinyFish API key | Workshop + setup: verify OpenAI key, lock demo scenario, create cached fallback data |
| 10:30-11:00 | Scaffold Next.js app, Convex provider, dark theme, layout shell | Implement TinyFish SSE processor utility | Define all Zod schemas, create seed data fixtures |
| 11:00-12:00 | Build investigation map (deck.gl markers) + TinyFish monitor bottom bar | Build searchMarketplace tool + agent monitor mutations | Build clusterSellers tool + seller comparison prompts |
| 12:00-12:30 | Wire map to Convex queries (markers appear on new findings) | Build inspectListing tool + storefront crawl | Build generateCaseFile tool + case output schema |
| **12:30** | **CHECKPOINT: Map shows markers from live TinyFish data** | **CHECKPOINT: One marketplace search works end-to-end** | **CHECKPOINT: Case generation produces valid output from test data** |
| 12:30-13:30 | Build tabbed right panel (Chat with AI Elements + useUIMessages, Evidence table) | Build verifyShipping tool + shipping route mutations | Refine case generation prompts, build chat response handler |
| 13:30-14:30 | Add map arc layer for shipping routes, animate on verification | Wire up investigation workflow (parallel marketplace runs) | Build seller dossier display, wire clustering to evidence panel |
| **14:30** | **CHECKPOINT: Full UI renders with all panels populated** | **CHECKPOINT: Workflow runs 2-3 marketplaces in parallel** | **CHECKPOINT: Case file + seller dossiers display correctly** |
| 14:30-15:15 | Polish: animations, responsive layout, loading states, error states | Test full flow end-to-end, fix bugs, implement fallback to cached data | Rehearse demo, write pitch script, prepare backup recorded run |
| 15:15-15:45 | Final visual polish, demo hardening | Final backend hardening, edge cases | Rehearse demo x2, assign speaking roles |
| 15:45-16:00 | Final check: all panels render, map works | Final check: workflow completes | Record backup video of full demo |
| **16:00** | **CODE FREEZE** | **CODE FREEZE** | **CODE FREEZE** |

---

## 15. Judging Alignment and Prize Strategy

### Main Prizes

| Criterion | Our Strength | How We Show It |
|-----------|-------------|----------------|
| Technical complexity | Multi-step agent workflow, parallel live browsing, shipping verification via cart interaction, seller clustering, structured case generation | The TinyFish monitor makes complexity visible. Judges watch the agent navigate, click, and verify. |
| Utility | Replaces hours of manual analyst work. Real brand protection use case with measurable ROI. | Demo the full loop: input product, get enforcement-ready case. Emphasize "minutes instead of days." |
| Agentic web fit | The web is not just a data source; it is the operating environment. The agent browses, interacts, and verifies. | Shipping verification through cart interaction is the hero moment. Traditional scrapers cannot do this. |

### Spot Prizes We Target

| Prize | Why We Fit | How to Position |
|-------|-----------|----------------|
| Deep Sea Architect (technical elegance + positive impact) | Shipping verification through cart interaction is the "aha" moment. Positive impact: helps brands protect legitimate distribution channels. | In the pitch, say: "The magic moment is when the agent adds an item to a German seller's cart, checks if it can ship to France, and confirms the violation. That is something only an autonomous browser agent can do." |
| Most Likely to Be the Next Unicorn (PMF + product vision) | Brand protection is a $4B+ market. Clear wedge (beauty brands), clear expansion path (any vertical, any region). | End the demo with 15 seconds on "where this goes": "We start with beauty brands on 3 marketplaces. The architecture scales to any vertical and any region. The brand protection market is $4B and growing." |

### Prizes We Probably Do Not Target

| Prize | Why Not |
|-------|---------|
| Most Likely to Go Viral | Our use case is professional/enterprise, not "unhinged Black Mirror" |
| Rube Goldberg | We are optimizing for elegance, not over-engineering |
| WTF (What the Fish) | Our use case is serious and commercially viable |

---

## 16. Risk Management

### Risk 1: TinyFish API Fails During Demo

**Likelihood:** Medium (live APIs are unpredictable)
**Impact:** High (core functionality breaks)
**Mitigation:**
- Pre-run all TinyFish calls the night before on target sites
- Cache structured outputs as JSON fixtures in the Convex DB
- Tool functions check for cached results and fall back gracefully
- Monitor panel can replay pre-recorded screenshots
- Mark which parts of the demo are "live" vs "cached" in case judges ask

### Risk 2: Demo Looks Too Dashboard-Like

**Likelihood:** Low (our UX is designed against this)
**Impact:** Medium (judges think "just another scraping tool")
**Mitigation:**
- TinyFish monitor is the antidote: watching the agent browse is inherently agentic
- Chat narration makes the agent's reasoning visible
- Shipping verification via cart interaction is clearly beyond scraping
- Seller linking demonstrates multi-step reasoning, not just data collection

### Risk 3: Map Visualization Is Half-Baked

**Likelihood:** Medium (deck.gl setup can be time-consuming)
**Impact:** Medium (map is a central visual element)
**Mitigation:**
- Tier 1 map is just colored dots on a dark basemap (achievable in 1 hour)
- Arc layer is Tier 2 (only add if dots work by 1 PM)
- If deck.gl proves difficult, fall back to a simpler Mapbox GL JS implementation
- Worst case: static map image with overlaid markers using absolute positioning

### Risk 4: Convex Agent/Workflow Complexity

**Likelihood:** Low-Medium (team may not have deep Convex experience)
**Impact:** High (backend is the core)
**Mitigation:**
- Convex has excellent documentation and an AI-friendly llms.txt
- The agent component has working example code we can reference
- Fallback: skip the Workflow component entirely, use simple scheduled actions instead
- The database and reactive queries work regardless of agent framework

### Risk 5: Scope Creep

**Likelihood:** High (hackathon excitement + AI coding speed)
**Impact:** Medium (half-built features hurt more than missing features)
**Mitigation:**
- Tier system is explicitly defined with checkpoints
- "If it is not in the current tier, it does not exist"
- Builder C is responsible for scope enforcement and demo quality
- At 2:30 PM, all three builders stop building new features and shift to hardening

### Risk 6: Team Merge Conflicts / Integration Failures

**Likelihood:** Medium (3 people building in parallel)
**Impact:** High (wasted time debugging integration)
**Mitigation:**
- Schema and data contracts locked by 10:30 AM
- Each builder works on separate files/directories
- Convex's reactive model means frontend and backend can be developed independently (frontend subscribes to queries, backend writes to tables)
- Integration test at each checkpoint (12:30, 14:30)

---

## 17. Pitch Script

### 30-Second Elevator Pitch

"Every premium brand has a gray market problem. Right now, catching unauthorized resellers means an analyst manually browsing dozens of marketplace sites across countries, checking prices, testing shipping, and building a case. It takes days. Meridian does that investigation autonomously. You give it a product and your protected markets. It launches parallel agents across live marketplaces, finds suspicious listings, verifies whether they actually ship cross-border, links related seller accounts, and delivers a ready-to-act enforcement case. What took an analyst a week, Meridian does in minutes."

### 2-Minute Demo Script

**[Open]** "Let me show you Meridian in action."

**[Input]** "We are investigating SK-II Facial Treatment Essence. Three markets: Germany, France, Singapore. We are protecting the French market."

*[Type the investigation prompt into the chat panel]*

**[Watch]** "Watch the bottom bar. Three TinyFish agents just launched, each browsing a different marketplace. You can see the actual browser screenshots updating in real time."

*[Point to TinyFish monitor]*

**[Discover]** "Listings are dropping onto the map as they are found. See these amber markers? Those are price anomalies. This one on Amazon.de is 27% below the official price."

*[Point to map markers]*

**[Verify]** "Now the agent is doing something a scraper cannot do. It is adding this item to a cart and testing if it ships to France..."

*[Point to TinyFish monitor showing cart flow]*

"Confirmed. This listing ships to France. That red line on the map is a verified unauthorized shipping route."

*[Point to animated arc on map]*

**[Link]** "The agent found that this seller has 3 other SK-II listings, and there is a second account on Amazon.fr with matching listing patterns. 78% confidence these are the same operator."

*[Point to seller dossier in Evidence tab]*

**[Deliver]** "And here is the enforcement case: executive summary, evidence with screenshots, seller dossier, and recommended actions. Ready for the brand's legal team."

*[Switch to Case tab]*

**[Close]** "Meridian turns days of manual investigation into minutes of autonomous analysis. We start with beauty brands on 3 marketplaces. The architecture scales to any vertical, any geography. The brand protection market is over $4 billion, and growing."

---

## Appendix A: Environment Variables

```env
# Convex
# NEXT_PUBLIC_CONVEX_URL is auto-generated by `npx convex dev` into .env.local
NEXT_PUBLIC_CONVEX_URL=https://your-project.convex.cloud
# CONVEX_DEPLOY_KEY is only needed for production/preview deployments (not dev)
# Create at: https://dashboard.convex.dev/project/settings#production-deploy-keys
CONVEX_DEPLOY_KEY=

# OpenAI (provided by hackathon)
OPENAI_API_KEY=sk-...

# TinyFish (provided by hackathon)
TINYFISH_API_KEY=tf-...

# Mapbox
NEXT_PUBLIC_MAPBOX_TOKEN=pk....
```

## Appendix B: Geocoding Constants

```typescript
// convex/lib/constants.ts
export const REGION_COORDINATES: Record<string, { lat: number; lng: number }> = {
  "Singapore": { lat: 1.3521, lng: 103.8198 },
  "Germany": { lat: 51.1657, lng: 10.4515 },
  "France": { lat: 46.2276, lng: 2.2137 },
  "Japan": { lat: 36.2048, lng: 138.2529 },
  "United Kingdom": { lat: 55.3781, lng: -3.4360 },
  "United States": { lat: 37.0902, lng: -95.7129 },
  "Australia": { lat: -25.2744, lng: 133.7751 },
  "South Korea": { lat: 35.9078, lng: 127.7669 },
  "Thailand": { lat: 15.8700, lng: 100.9925 },
  "Malaysia": { lat: 4.2105, lng: 101.9758 },
};

export const MARKETPLACE_URLS: Record<string, string> = {
  "Amazon Germany": "https://www.amazon.de",
  "Amazon France": "https://www.amazon.fr",
  "Amazon Japan": "https://www.amazon.co.jp",
  "Lazada Singapore": "https://www.lazada.sg",
  "Shopee Singapore": "https://shopee.sg",
};

export const SEVERITY_THRESHOLDS = {
  low: 0.10,      // 10% price deviation
  medium: 0.20,   // 20% price deviation
  high: 0.30,     // 30% price deviation
  critical: 0.40, // 40%+ price deviation
};
```

## Appendix C: Seller Clustering Heuristic

Sellers are clustered using simple, explainable signals. No ML or graph algorithms.

| Signal | Weight | Detection Method |
|--------|--------|-----------------|
| Name overlap | 0.3 | GPT-5.4-mini scores similarity of seller display names |
| Image reuse | 0.3 | Compare product image URLs across listings (exact match) |
| Description similarity | 0.2 | GPT-5.4-mini scores template similarity of listing descriptions |
| Catalog overlap | 0.2 | Same brand SKUs listed across storefronts |

**Clustering rule:** Sum weighted signals. Score >= 0.5 = "likely related" (same cluster). This is simple, explainable to judges, and does not require ML infrastructure.
