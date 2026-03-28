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

Meridian is a live web investigation agent that helps pharmaceutical companies and health regulators detect counterfeit drug listings across online marketplaces and auto-build enforcement-ready evidence packs in minutes instead of days.

### What It Is

Meridian is a geospatial investigation agent for counterfeit and unauthorized pharmaceutical sales online. Given a drug name and target markets, it:

- Browses live marketplaces and online pharmacies in parallel using autonomous web agents
- Identifies suspicious listings based on counterfeit risk signals (pricing anomalies, missing credentials, seller red flags)
- Verifies whether listings ship to unregulated regions or bypass pharmacy verification
- Links related seller accounts across marketplaces to uncover distribution networks
- Maps the geographic spread of suspicious pharmaceutical sellers
- Produces a human-reviewable enforcement case with evidence suitable for regulators and legal teams

### What It Is NOT

- Not a generic price-monitoring dashboard
- Not a simple scraping tool with a nice UI
- Not a chatbot wrapper around an API
- Not a broad enterprise compliance platform (for hackathon purposes)
- Not a tool that makes medical claims or diagnoses counterfeits from images (it identifies *risk signals*, not chemical composition)

### Why This Wins

The hackathon rewards projects that use the live open web as the database, handle messy dynamic websites, show technical complexity, solve a real-world problem, and demonstrate autonomous agent behavior. Meridian hits all five. The agent does not just extract data; it investigates, verifies, and assembles a case.

**The public health angle elevates this beyond ecommerce monitoring.** Counterfeit drugs kill an estimated 500,000+ people annually. This is not about protecting revenue; it is about protecting lives. That emotional weight lands differently with judges than channel conflict or price erosion.

---

## 2. Problem Statement

### Core Pain

Counterfeit and unauthorized pharmaceuticals are a global public health crisis. The WHO estimates that up to 10% of medicines worldwide are substandard or falsified, rising to 30% in parts of Africa and Asia. The online marketplace explosion has made this exponentially harder to police. Fake drugs appear on Amazon, Lazada, Shopee, Telegram channels, and grey-market "online pharmacy" sites, often with sophisticated-looking listings that are nearly indistinguishable from legitimate sellers.

The problem is not just fakes. It includes:
- Prescription drugs sold without pharmacy verification or prescriptions
- Expired or diverted medication resold at suspicious discounts
- Sellers with no verifiable pharmacy license operating across multiple platforms
- Cross-border shipping of controlled or regulated substances into markets with strict import rules

### The User

The primary user is a pharmaceutical brand protection officer, regulatory compliance investigator, or public health enforcement analyst.

### Job To Be Done

"Help me quickly identify suspicious online listings of our drugs, determine whether they are likely counterfeit or unauthorized, find out who is behind them, and give me enough evidence to escalate to regulators or our legal team."

### Chosen Wedge

**GLP-1 receptor agonists (semaglutide/Ozempic, tirzepatide/Mounjaro) facing rampant online counterfeiting.**

Why this wedge works:
- Massive current public health crisis: FDA has issued multiple warnings about counterfeit Ozempic in 2024-2026
- Extremely high demand and chronic shortages create perfect conditions for counterfeiting
- Recognizable drug names that judges will instantly understand
- Strong price signals: legitimate Ozempic costs $800-1,000+/month in the US; counterfeits appear at 60-80% discounts
- Cross-border angle is natural: sellers in Southeast Asia and Eastern Europe shipping to US/EU consumers
- Emotionally compelling: people are injecting these drugs. Counterfeits can cause serious harm or death.
- Multiple marketplace fragmentation: Amazon, Lazada, Shopee, Telegram, standalone pharmacy sites
- Clear regulatory framework: pharmacy credentials, prescription requirements, import restrictions

---

## 3. User Experience Design

### Interaction Model

The application feels like an **investigation console**, not a dashboard or chatbot. Think: pharmaceutical intelligence analyst workstation. The user launches an investigation, watches it unfold in real time, can interact with the agent via chat, and receives a completed case file.

### Primary Interaction Flow

1. **Initiate:** User describes the investigation via the chat panel (drug name, markets to scan, what to look for)
2. **Parse:** The agent extracts structured parameters from the free-text prompt using `generateObject` with `InvestigationRequestSchema`. If the prompt is ambiguous or missing fields, the agent asks a clarifying question before launching.
3. **Watch:** The map and TinyFish monitor show live agent activity. The chat panel narrates progress.
4. **Interact (optional):** User sends follow-up messages mid-investigation ("Also check Shopee Thailand", "Focus on that seller with no pharmacy badge"). Follow-ups are handled as conversational responses; they do NOT re-trigger the investigation workflow.
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
|   . Animated supply chain route   |  |  Chat messages from the   | |
|     arcs (dashed/marching ants)   |  |  investigator agent +     | |
|   . Seller cluster overlays       |  |  user can ask follow-ups  | |
|   . Risk color coding:            |  |                           | |
|     green=verified pharmacy,      |  |  > "Check if that seller  | |
|     amber=suspicious,             |  |    has a pharmacy license" | |
|     red=high-risk counterfeit     |  |                           | |
|                                   |  +---------------------------+ |
|                                   |  +---------------------------+ |
|                                   |  |  [Send message...]    >   | |
|                                   |  +---------------------------+ |
+-----------------------------------+---------------------------------+
|  BOTTOM BAR: TinyFish Live Monitor                                  |
|  +----------------+ +----------------+ +----------------+          |
|  | Agent 1        | | Agent 2        | | Agent 3        | Activity |
|  | Amazon.com     | | Lazada.sg      | | Shopee.sg      | Log      |
|  | [live browser  | | [live browser  | | [live browser  | (scroll) |
|  |  iframe]       | |  iframe]       | |  iframe]       |          |
|  | "Checking      | | "Opening       | | "Waiting..."   |          |
|  |  seller creds" | |  listing..."   | |                |          |
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
| Verified pharmacy | Emerald 500 | #10b981 | `text-emerald-500` | Verified legitimate sellers, "all clear" |
| Suspicious listing | Amber 400 | #fbbf24 | `text-amber-400` | Missing credentials, price anomalies, warnings |
| High-risk counterfeit | Red 500 | #ef4444 | `text-red-500` | Multiple risk signals, confirmed violations |
| Map route (unverified) | Amber 500 50% | #f59e0b80 | -- | Suspected supply routes (dashed) |
| Map route (confirmed) | Red 500 | #ef4444 | -- | Confirmed unauthorized supply routes (solid) |

The brand color (amber) is deliberately close to the "suspicious" severity color. The product is *about* investigation; the brand identity IS the investigation.

#### Typography

- **UI text:** Geist (heading and body). Clean, technical, slightly condensed.
- **Data readouts:** Geist Mono or JetBrains Mono. Used aggressively, not just for code. Price deviations, coordinates, seller IDs, timestamps, risk scores, and investigation IDs should all render in monospace. When the agent narrates "Found 12 listings on Amazon.com," the number "12" should be monospace even within prose. This makes the whole product feel like an instrument panel.
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
- **Markers:** Small, sharp-edged **diamonds or squares** (not circles) with risk color fill. On discovery, a brief pulse animation (expanding ring) plays for 2 seconds, then stops. No persistent glow.
- **Route lines:** **Dashed lines with marching-ants animation** for suspected supply routes (amber, 50% opacity). **Solid lines** for confirmed unauthorized routes (red). This is how actual intelligence tools render supply chains, not decorative arcs with glow effects.
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
MERIDIAN  ·  INV-2026-0328-003  ·  SEMAGLUTIDE (OZEMPIC)  ·  ● ACTIVE
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
| Fast model | gpt-5.4-mini | Bulk data normalization, listing classification, risk signal extraction |
| Web automation | TinyFish REST API (SSE) | Live marketplace browsing, data extraction, credential verification |
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
- **Two model tiers.** GPT-5.4 for reasoning-heavy tasks (case generation, risk assessment, investigation decisions). GPT-5.4-mini for high-volume tasks (normalizing 20+ listing results, extracting risk signals from page content).
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
        |         +--> TinyFish opens listing page, extracts full detail
        |         +--> TinyFish checks for pharmacy credentials/badges
        |         +--> TinyFish tests shipping availability
        |         +--> Findings updated with risk signals + verification
        |         +--> Map draws supply route on verification
        |
        +---> Step 3: Seller network analysis
        |         |
        |         +--> GPT-5.4-mini compares seller signals across findings
        |         +--> Seller dossier written to sellerDossiers table
        |         +--> Evidence tab populates
        |
        +---> Step 4: Generate case file
                  |
                  +--> GPT-5.4 synthesizes all evidence
                  +--> Risk assessment + recommended regulatory actions
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
    drugName: v.string(),           // e.g. "Ozempic (semaglutide)"
    drugCategory: v.string(),       // e.g. "GLP-1 receptor agonist"
    regions: v.array(v.object({
      name: v.string(),             // e.g. "Singapore"
      marketplace: v.string(),      // e.g. "Lazada Singapore"
      marketplaceUrl: v.string(),   // e.g. "https://www.lazada.sg"
      legitimatePrice: v.number(),  // Official/expected price
      currency: v.string(),
      requiresPrescription: v.boolean(),
    })),
    regulatoryContext: v.string(),   // e.g. "Prescription-only in Singapore, FDA-approved in US"
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
    marketplace: v.string(),        // e.g. "Lazada Singapore"
    region: v.string(),             // e.g. "Singapore"
    sellerName: v.string(),
    listedPrice: v.number(),
    currency: v.string(),
    legitimatePrice: v.number(),
    priceDeviation: v.number(),     // percentage below legitimate price
    listingUrl: v.string(),
    imageUrls: v.optional(v.array(v.string())),
    // Geospatial
    latitude: v.number(),
    longitude: v.number(),
    // Risk signals (the core pivot from brand protection)
    riskScore: v.number(),          // 0-1 composite risk score
    riskLevel: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical")
    ),
    riskSignals: v.array(v.object({
      signal: v.string(),          // e.g. "no_pharmacy_license"
      label: v.string(),           // e.g. "No pharmacy license displayed"
      weight: v.number(),          // 0-1 contribution to risk score
      evidence: v.string(),        // What the agent observed
    })),
    // Pharmaceutical-specific fields
    hasPharmacyCredentials: v.optional(v.boolean()),
    requiresPrescriptionCheck: v.optional(v.boolean()),
    prescriptionRequired: v.optional(v.boolean()),  // Does the listing ask for Rx?
    batchNumberVisible: v.optional(v.boolean()),
    expiryDateVisible: v.optional(v.boolean()),
    sellerVerificationBadge: v.optional(v.boolean()),
    // Shipping verification
    shippingVerified: v.optional(v.boolean()),
    shipsInternationally: v.optional(v.boolean()),
    shippingOrigin: v.optional(v.string()),
    shippingEvidence: v.optional(v.string()),
    // Seller linking
    sellerClusterId: v.optional(v.string()),
    // Metadata
    discoveredAt: v.number(),
  }).index("by_investigation", ["investigationId"])
    .index("by_thread", ["threadId"])
    .index("by_risk", ["investigationId", "riskLevel"]),

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
      v.literal("verifying_credentials"),
      v.literal("checking_shipping"),
      v.literal("crawling_storefront"),
      v.literal("completed"),
      v.literal("error")
    ),
    statusLabel: v.string(),        // Human-readable, e.g. "Checking pharmacy credentials..."
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
      sharedShippingOrigin: v.boolean(),
    }),
    confidenceScore: v.number(),    // 0-1
    // Network risk assessment
    networkRiskLevel: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical")
    ),
    // Geospatial footprint
    activeCountries: v.array(v.object({
      country: v.string(),
      latitude: v.number(),
      longitude: v.number(),
    })),
  }).index("by_investigation", ["investigationId"]),

  // Supply chain routes (replaces "shipping routes" from brand protection version)
  supplyRoutes: defineTable({
    investigationId: v.id("investigations"),
    findingId: v.id("findings"),
    fromRegion: v.string(),         // Seller / shipping origin
    fromLatitude: v.number(),
    fromLongitude: v.number(),
    toRegion: v.string(),           // Destination market
    toLatitude: v.number(),
    toLongitude: v.number(),
    verified: v.boolean(),
    verificationMethod: v.string(), // e.g. "shipping_page_check", "cart_test"
    riskLevel: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical")
    ),
    concern: v.string(),            // e.g. "Rx drug shipped internationally without prescription verification"
  }).index("by_investigation", ["investigationId"]),

  // Final case file
  cases: defineTable({
    investigationId: v.id("investigations"),
    threadId: v.string(),
    // Summary
    title: v.string(),
    executiveSummary: v.string(),
    publicHealthRiskAssessment: v.string(),
    // Evidence
    totalListingsFound: v.number(),
    suspiciousListings: v.number(),
    highRiskListings: v.number(),
    sellerNetworksIdentified: v.number(),
    // Detail sections
    findingSummaries: v.array(v.object({
      findingId: v.id("findings"),
      title: v.string(),
      marketplace: v.string(),
      sellerName: v.string(),
      riskScore: v.number(),
      riskLevel: v.string(),
      topRiskSignals: v.array(v.string()),
    })),
    sellerDossierSummaries: v.array(v.object({
      clusterId: v.string(),
      sellerNames: v.array(v.string()),
      confidenceScore: v.number(),
      networkRiskLevel: v.string(),
      summary: v.string(),
    })),
    // Recommendations
    recommendedActions: v.array(v.object({
      action: v.string(),
      priority: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
      detail: v.string(),
      targetEntity: v.string(),    // e.g. "Lazada Trust & Safety", "Singapore HSA"
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

// Investigation request parsed from user prompt
export const InvestigationRequestSchema = z.object({
  drugName: z.string(),
  drugCategory: z.string().optional(),
  regions: z.array(z.object({
    name: z.string(),
    marketplace: z.string(),
    marketplaceUrl: z.string(),
    legitimatePrice: z.number(),
    currency: z.string(),
    requiresPrescription: z.boolean(),
  })),
  regulatoryContext: z.string().optional(),
});

// TinyFish extraction result
export const ListingExtractionSchema = z.object({
  title: z.string(),
  price: z.number(),
  currency: z.string(),
  sellerName: z.string(),
  listingUrl: z.string(),
  imageUrls: z.array(z.string()).optional(),
  shippingInfo: z.string().optional(),
  // Pharmaceutical-specific extractions
  pharmacyBadgeVisible: z.boolean().optional(),
  prescriptionRequired: z.boolean().optional(),
  batchNumber: z.string().optional(),
  expiryDate: z.string().optional(),
  sellerRating: z.number().optional(),
  sellerAccountAge: z.string().optional(),
  productDescriptionSnippet: z.string().optional(),
});

// Risk signal assessment (GPT-5.4-mini output)
export const RiskSignalAssessmentSchema = z.object({
  riskScore: z.number().min(0).max(1),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  signals: z.array(z.object({
    signal: z.string(),
    label: z.string(),
    weight: z.number().min(0).max(1),
    evidence: z.string(),
  })),
});

// GPT-5.4 case generation output
export const CaseGenerationSchema = z.object({
  executiveSummary: z.string(),
  publicHealthRiskAssessment: z.string(),
  findingSummaries: z.array(z.object({
    findingId: z.string(),
    title: z.string(),
    marketplace: z.string(),
    sellerName: z.string(),
    riskScore: z.number(),
    riskLevel: z.string(),
    topRiskSignals: z.array(z.string()),
  })),
  sellerDossierSummaries: z.array(z.object({
    clusterId: z.string(),
    sellerNames: z.array(z.string()),
    confidenceScore: z.number(),
    networkRiskLevel: z.string(),
    summary: z.string(),
  })),
  recommendedActions: z.array(z.object({
    action: z.string(),
    priority: z.enum(["high", "medium", "low"]),
    detail: z.string(),
    targetEntity: z.string(),
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
      sharedShippingOrigin: z.boolean(),
    }),
    confidenceScore: z.number().min(0).max(1),
    networkRiskLevel: z.enum(["low", "medium", "high", "critical"]),
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
  instructions: `You are Meridian, an AI pharmaceutical safety investigator.
Your role is to help pharmaceutical companies and health regulators detect
counterfeit, unauthorized, or suspicious drug listings on online marketplaces.
You investigate live marketplaces using browsing tools, identify high-risk
listings, verify seller credentials, check shipping patterns, link related
seller accounts, and build enforcement-ready evidence cases.

When investigating, you should:
- Search multiple marketplaces in parallel when possible
- Flag listings with counterfeit risk signals:
  * Price significantly below legitimate market price (>30% discount on Rx drugs is a major red flag)
  * Seller has no visible pharmacy license or verification badge
  * No prescription requirement for prescription-only drugs
  * Missing batch numbers or expiration dates
  * New seller account with no established history
  * Stock photos instead of real product photography
  * Shipping from regions not associated with the drug manufacturer
  * Templated or generic product descriptions
  * Seller operates across multiple platforms with slight name variations
- Verify seller pharmacy credentials where visible
- Check whether prescription drugs are being sold without prescription requirements
- Look for seller patterns across platforms (similar names, shared images, same shipping origin)
- Narrate your investigation steps clearly so the user can follow along
- Be specific about what you find and what the risk implications are

When generating a case, you should:
- Present findings with risk scores and confidence levels
- Clearly distinguish verified facts from inferences
- Frame recommendations in terms of regulatory escalation paths
  (marketplace takedown, regulatory agency report, law enforcement referral)
- Keep language professional and suitable for regulatory/legal review
- Emphasize public health risk in the executive summary`,
  tools: {
    searchMarketplace,
    inspectListing,
    verifySellerCredentials,
    checkShippingAvailability,
    crawlStorefront,
    assessRiskSignals,
    clusterSellers,
    generateCaseFile,
  },
  maxSteps: 15,
});

export const extractorAgent = new Agent(components.agent, {
  name: "Risk Signal Extractor",
  languageModel: openai.chat("gpt-5.4-mini"),
  instructions: `You normalize raw marketplace listing data into structured
JSON and assess counterfeit risk signals. You evaluate each listing against
known pharmaceutical counterfeit indicators: pricing anomalies, missing
pharmacy credentials, absence of prescription requirements for Rx drugs,
missing batch/expiry information, seller account characteristics, and
shipping origin patterns. You produce a composite risk score (0-1) and
individual signal assessments.`,
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
  description: "Search a marketplace for a pharmaceutical product and extract all listings with prices, seller info, and any visible pharmacy credentials",
  inputSchema: z.object({
    marketplaceUrl: z.string().describe("The marketplace URL to search, e.g. https://www.lazada.sg"),
    searchQuery: z.string().describe("The drug name or product to search for"),
    region: z.string().describe("The marketplace region, e.g. Singapore"),
    legitimatePrice: z.number().describe("The official/expected price for comparison"),
    currency: z.string().describe("The currency code, e.g. SGD"),
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
          first 2 pages of results. For each listing extract: product title,
          price, currency, seller name, listing URL, any pharmacy or
          verification badges visible, whether a prescription is mentioned
          as required, and any shipping information visible. Also note if the
          product images look like stock photos vs real product photography.
          Return results as a JSON array.`,
        proxy_config: { enabled: true },
      }),
    });

    // 3. Process SSE stream, updating monitor and findings
    const listings = await processTinyFishStream(response, ctx, args);

    // 4. Run risk signal assessment on extracted listings
    const assessed = await assessListingRisks(ctx, listings, args);

    return `Found ${assessed.length} listings on ${args.region}. ` +
      `${assessed.filter(l => l.riskLevel === "high" || l.riskLevel === "critical").length} flagged as high-risk.`;
  },
});

export const verifySellerCredentials = createTool({
  description: "Navigate to a seller's profile or storefront to check for pharmacy licenses, verification badges, account age, and other trust signals",
  inputSchema: z.object({
    sellerProfileUrl: z.string().describe("The URL of the seller's profile or storefront page"),
    findingId: z.string().describe("The ID of the finding to update with credential verification"),
    marketplace: z.string().describe("Which marketplace this seller is on"),
  }),
  execute: async (ctx, args): Promise<string> => {
    const response = await fetch("https://agent.tinyfish.ai/v1/automation/run-sse", {
      method: "POST",
      headers: {
        "X-API-Key": process.env.TINYFISH_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: args.sellerProfileUrl,
        goal: `Visit this seller's profile page. Extract: seller display name,
          account creation date or "member since" date if visible, seller
          rating and number of reviews, whether any pharmacy license or
          verification badge is displayed, what product categories they sell
          in (are they a general goods seller or pharmaceutical specialist?),
          and how many total products they list. Return as JSON.`,
        proxy_config: { enabled: true },
      }),
    });

    const result = await processTinyFishStream(response, ctx, args);

    await ctx.runMutation(internal.findings.updateCredentialVerification, {
      findingId: args.findingId,
      hasPharmacyCredentials: result.pharmacyBadge || false,
      sellerVerificationBadge: result.verificationBadge || false,
    });

    const credentialStatus = result.pharmacyBadge
      ? "Seller HAS a pharmacy credential/badge."
      : "WARNING: Seller has NO visible pharmacy credentials.";

    return `${credentialStatus} Account age: ${result.accountAge || "unknown"}. ` +
      `Rating: ${result.rating || "no rating"}. Categories: ${result.categories || "unknown"}.`;
  },
});

export const checkShippingAvailability = createTool({
  description: "Check whether a listing ships to specific regions by examining the shipping options or delivery page",
  inputSchema: z.object({
    listingUrl: z.string().describe("The URL of the listing to check"),
    targetRegions: z.array(z.string()).describe("Countries to check shipping availability for"),
    findingId: z.string().describe("The ID of the finding to update"),
  }),
  execute: async (ctx, args): Promise<string> => {
    const response = await fetch("https://agent.tinyfish.ai/v1/automation/run-sse", {
      method: "POST",
      headers: {
        "X-API-Key": process.env.TINYFISH_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: args.listingUrl,
        goal: `On this product listing, look for shipping/delivery information.
          Check if the product ships to these countries: ${args.targetRegions.join(", ")}.
          Also identify where the product ships FROM (origin country/region).
          Check if the checkout flow asks for a prescription or medical verification
          at any point. Report: ships_to (list of countries), ships_from (origin),
          prescription_check_in_flow (true/false). Do NOT complete any purchase.
          Return as JSON.`,
        proxy_config: { enabled: true },
      }),
    });

    const result = await processTinyFishStream(response, ctx, args);

    await ctx.runMutation(internal.findings.updateShippingVerification, {
      findingId: args.findingId,
      shippingVerified: true,
      shipsInternationally: result.ships_to?.length > 1,
      shippingOrigin: result.ships_from,
      shippingEvidence: JSON.stringify(result),
    });

    if (result.ships_to?.length > 0) {
      for (const region of result.ships_to) {
        await ctx.runMutation(internal.routes.createRoute, {
          // ... supply route data
        });
      }
    }

    const prescriptionNote = result.prescription_check_in_flow
      ? "Checkout DOES include a prescription verification step."
      : "WARNING: No prescription verification in checkout flow.";

    return `Ships from: ${result.ships_from || "unknown"}. ` +
      `Ships to: ${result.ships_to?.join(", ") || "unknown"}. ${prescriptionNote}`;
  },
});

export const crawlStorefront = createTool({
  description: "Visit a seller's storefront page and extract all their pharmaceutical listings to assess scope of operation",
  inputSchema: z.object({
    sellerStorefrontUrl: z.string().describe("The URL of the seller's storefront"),
    drugName: z.string().describe("The primary drug being investigated"),
  }),
  execute: async (ctx, args): Promise<string> => {
    // TinyFish browses the storefront
    // Returns related pharmaceutical listings for clustering and risk assessment
    // ...
  },
});

export const assessRiskSignals = createTool({
  description: "Analyze a listing's extracted data and compute a composite counterfeit risk score based on pharmaceutical safety signals",
  inputSchema: z.object({
    findingId: z.string().describe("The finding to assess"),
  }),
  execute: async (ctx, args): Promise<string> => {
    // Uses GPT-5.4-mini to evaluate risk signals
    // Updates finding with riskScore, riskLevel, and individual signals
    // ...
  },
});

export const clusterSellers = createTool({
  description: "Analyze seller data across findings and identify likely related seller accounts that may form a distribution network",
  inputSchema: z.object({
    investigationId: z.string().describe("The investigation to cluster sellers for"),
  }),
  execute: async (ctx, args): Promise<string> => {
    // Read all findings for the investigation
    // Use GPT-5.4-mini to compare seller signals
    // Write seller dossiers to DB with network risk level
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
    drugName: v.string(),
    drugCategory: v.string(),
    regions: v.array(v.object({
      name: v.string(),
      marketplace: v.string(),
      marketplaceUrl: v.string(),
      legitimatePrice: v.number(),
      currency: v.string(),
      requiresPrescription: v.boolean(),
    })),
    regulatoryContext: v.string(),
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
            searchQuery: args.drugName,
          },
          { retry: true }
        )
      )
    );

    // Step 2: Deep investigate high-risk listings
    //   - Verify seller credentials (pharmacy badges, account age)
    //   - Check shipping availability and prescription requirements
    //   - Crawl seller storefronts for scope assessment
    await step.runAction(
      internal.agents.deepInvestigate,
      {
        investigationId: args.investigationId,
        threadId: args.threadId,
        drugName: args.drugName,
        regulatoryContext: args.regulatoryContext,
      },
      { retry: true }
    );

    // Step 3: Cluster sellers into distribution networks
    await step.runAction(
      internal.agents.clusterSellers,
      {
        investigationId: args.investigationId,
        threadId: args.threadId,
      },
      { retry: true }
    );

    // Step 4: Generate enforcement case file
    await step.runAction(
      internal.agents.generateCase,
      {
        investigationId: args.investigationId,
        threadId: args.threadId,
        drugName: args.drugName,
        regulatoryContext: args.regulatoryContext,
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
- **ScatterplotLayer**: Country-level markers for findings. Color-coded by risk level. Drop-in animation on creation.
- **ArcLayer**: Supply route lines between shipping origin and destination. Animated dash effect. Thickness by risk level. Color: amber for suspected, red for confirmed high-risk.
- **TextLayer**: Country labels on markers.
- **IconLayer** (stretch): Seller network cluster icons.

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
1. **Findings table**: Sortable by risk score. Columns: marketplace, seller, price, risk score, risk level (badge with color), top risk signals (tag chips), region. Click row to expand detail showing all risk signals with evidence.
2. **Seller dossier cards**: One card per identified network. Shows seller names, marketplaces, confidence score, network risk level, signal badges (name overlap, image reuse, shared shipping origin, etc.).

#### CasePanel

Structured display of the generated case file:
- Executive summary with public health risk framing
- Key statistics (listings found, high-risk, seller networks)
- Public health risk assessment section
- Finding summaries with risk scores and expandable detail
- Seller network summaries
- Recommended actions with priority badges AND target entities (e.g. "Report to Singapore HSA", "File marketplace takedown on Lazada")
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
    extractor.ts                # Risk signal extraction agent definition
  
  tools/
    searchMarketplace.ts        # TinyFish marketplace search tool
    inspectListing.ts           # TinyFish listing detail extraction tool
    verifySellerCredentials.ts  # TinyFish seller credential check tool
    checkShipping.ts            # TinyFish shipping/prescription check tool
    crawlStorefront.ts          # TinyFish seller storefront crawl tool
    assessRiskSignals.ts        # GPT-5.4-mini risk signal assessment tool
    clusterSellers.ts           # GPT-5.4-mini seller clustering tool
    generateCaseFile.ts         # GPT-5.4 case generation tool
  
  workflows/
    investigate.ts              # Durable investigation workflow definition
  
  functions/
    investigations.ts           # CRUD for investigations table
    findings.ts                 # CRUD for findings table
    monitor.ts                  # Agent monitor read/write functions
    routes.ts                   # Supply routes read/write functions
    cases.ts                    # Case file read/write functions
    chat.ts                     # Chat message queries + send mutation
  
  lib/
    tinyfish.ts                 # TinyFish SSE stream processor utility
    geocoding.ts                # Country name to lat/lng mapping
    riskScoring.ts              # Risk signal weights and scoring logic
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

  // Data from Convex Agent - UIMessage extends AI SDK's UIMessage
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
          <PromptInputTextarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Describe your investigation..." />
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
  "url": "https://www.lazada.sg",
  "goal": "Search for semaglutide Ozempic...",
  "proxy_config": { "enabled": true }
}
```

### Specific TinyFish Goals by Step

**Step 1: Marketplace Search**
```
Goal: Search for "{drugName}". Navigate to the search results page.
Extract ALL listings visible on the first 2 pages. For each listing,
extract: product title, price (as a number), currency, seller/merchant
name, listing URL. Also note: is there a pharmacy badge or verification
icon next to the seller name? Does the listing mention "prescription
required" or "Rx only"? Are product images professional pharmaceutical
packaging photos or generic/stock images? Return all results as a
JSON array.
```

**Step 2: Listing Inspection**
```
Goal: Open this product listing page. Extract: full product title,
current price, seller name, seller storefront URL if available,
all product images, product description text, and any shipping/delivery
information. Specifically look for: batch number or LOT number anywhere
on the page, expiration date, any pharmacy license number, any
"verified seller" or "authorized reseller" badge, whether the listing
states a prescription is required. Return as JSON.
```

**Step 3: Seller Credential Verification**
```
Goal: Visit this seller's profile/storefront page. Extract: seller
display name, "member since" or account creation date, seller rating
and total number of reviews, total number of products listed, what
product categories they sell in, whether any pharmacy license or
health product certification badge is displayed. If there is a
separate "About" or "Certifications" section, navigate to it and
extract any license numbers. Return as JSON.
```

**Step 4: Shipping & Prescription Check**
```
Goal: On this product listing, look for shipping/delivery options.
Identify where the product ships FROM (origin country). Check which
countries or regions it ships TO. If possible, check whether adding
to cart or proceeding toward checkout triggers any prescription
verification step or medical questionnaire. Do NOT complete any
purchase or provide personal information. Report: ships_from,
ships_to (list), prescription_check_in_flow (true/false),
checkout_requires_verification (true/false). Return as JSON.
```

**Step 5: Storefront Crawl**
```
Goal: This is a seller's storefront page. Find and extract all
listings from this seller that are pharmaceutical or health-related
products. For each listing extract: title, price, currency, URL.
Also extract the seller's display name, overall rating, and
total number of products. Note how many of their products appear
to be prescription medications. Return as JSON.
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

Ozempic (semaglutide), a GLP-1 weight loss drug, is being sold by suspicious sellers on Southeast Asian marketplaces. The FDA has issued multiple warnings about counterfeit semaglutide products. A pharmaceutical safety investigator needs to quickly assess the landscape.

### Why Ozempic is the Perfect Demo Drug

- **Instantly recognizable.** Every judge in the room has heard of Ozempic.
- **Real, ongoing crisis.** FDA warnings about counterfeit Ozempic are in the news right now.
- **Visceral stakes.** People inject this drug. Counterfeits can contain harmful substances.
- **Strong price signal.** Legitimate Ozempic is expensive ($800-1,000+/month in the US). Counterfeits often appear at 50-80% discounts.
- **Cross-border angle.** Much counterfeit supply originates from Southeast Asian markets, which is relevant to a Singapore-based hackathon.
- **Multiple marketplace fragmentation.** Found on Amazon, Lazada, Shopee, Telegram, and standalone sites.

### Demo Script (2-3 minutes)

**[0:00-0:15] Setup**
User types in chat: "Investigate potential counterfeit Ozempic (semaglutide) listings. Check Amazon US, Lazada Singapore, and Shopee Singapore. Legitimate price is approximately USD 900 for a monthly supply. This is a prescription-only injectable medication."

**[0:15-0:45] Launch**
Three TinyFish agent cards appear in the bottom bar. Screenshots show browsers launching. Map is empty but ready. Chat narrates: "Starting pharmaceutical safety investigation across 3 marketplaces..."

**[0:45-1:15] Discovery**
Markers drop onto the map as listings are found. Chat: "Found 8 listings on Amazon, 14 on Lazada, 9 on Shopee. Running risk signal assessment... 6 listings flagged as high-risk based on pricing and credential signals."

**[1:15-1:45] Deep Investigation**
TinyFish monitor shows one agent clicking into a high-risk Lazada listing priced at SGD 120 (roughly USD 90, over 90% below legitimate price). Agent checks the seller profile. Chat: "WARNING: Seller 'HealthDirect_SG' on Lazada has this product at 90% below legitimate market price. No pharmacy credentials visible on seller profile. Account is 3 months old with 12 reviews. Investigating further..."

**[1:45-2:15] Credential & Prescription Check**
Agent navigates to checkout flow. Chat: "CRITICAL FINDING: This listing for an injectable prescription medication has NO prescription verification in the checkout flow. Any buyer can purchase without medical oversight. Shipping origin appears to be Shenzhen, China." A solid red route line draws from China to Singapore on the map.

**[2:15-2:45] Network Identification**
Chat: "Found 4 additional pharmaceutical listings from this seller, including other prescription medications. A second account on Shopee ('Health_Direct_Official') has matching listing patterns and identical product images. 82% confidence these are the same operator." Seller network overlay appears on the map.

**[2:45-3:00] Case Delivery**
Right panel switches to Case tab. Chat: "Investigation complete. 6 high-risk listings identified, 1 seller network uncovered. Evidence pack ready for regulatory review." Case file shows executive summary with public health risk framing, findings with risk scores, seller network dossier, and recommended actions: "Report to Singapore HSA (High Priority)", "File takedown with Lazada Trust & Safety (High Priority)", "Escalate to FDA for cross-border counterfeit tracking (Medium Priority)".

### Backup Plan

If live TinyFish calls fail:
1. Use cached results from pre-run calls
2. The monitor shows a "replay" of the pre-recorded screenshots
3. All other logic (risk assessment, case generation, map visualization) runs live

---

## 12. Tiered Scope and Fallback Plans

### Tier 1: "We Win Something" (must complete by 2:30 PM)

- [ ] Single marketplace search via TinyFish returning structured listing data
- [ ] Risk signal assessment by GPT-5.4-mini (price anomaly, missing credentials, no Rx check)
- [ ] Deep investigation on one listing: open it, extract seller info, check for pharmacy badge
- [ ] Basic map with country markers (static dots, color-coded by risk level)
- [ ] Agent chat panel with AI Elements (markdown rendering, tool display, auto-scroll)
- [ ] GPT-5.4 generated case summary with public health risk framing
- [ ] TinyFish monitor with at least status labels (screenshots stretch)
- [ ] Clean dark-themed UI with Shadcn components

### Tier 2: "Strong Contender" (target by 3:30 PM)

Everything in Tier 1, plus:
- [ ] Parallel multi-marketplace runs (2-3 regions)
- [ ] Shipping origin detection and prescription flow verification
- [ ] Animated map with supply route arcs
- [ ] TinyFish monitor with live screenshots
- [ ] Seller storefront crawl with related pharmaceutical listings
- [ ] Seller network clustering with expanded signals (shared shipping origin)
- [ ] Seller dossier panel in Evidence tab
- [ ] Streaming agent messages via Convex deltas

### Tier 3: "Clear Winner" (only if Tier 2 solid by 3:00 PM)

Everything in Tier 2, plus:
- [ ] Interactive chat: user sends follow-ups, agent adapts mid-investigation
- [ ] Seller network mini-graph (force-directed visualization)
- [ ] Composite risk scoring with weighted signals displayed as radar chart
- [ ] "Investigation replay" mode on the map (animated sequence of discoveries)
- [ ] Multi-drug investigation (expand from one SKU to full seller catalog)
- [ ] Exportable case file (PDF/JSON)

### Panic MVP (if everything breaks by 3 PM)

If TinyFish is down, APIs are flaky, and nothing works:
- [ ] Hard-coded demo data loaded from JSON fixtures
- [ ] Map shows pre-placed markers and one pre-drawn supply route
- [ ] Agent chat replays pre-written messages with smooth streaming
- [ ] Case file renders from static data
- [ ] Pitch emphasizes architecture, public health mission, and vision over live functionality

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
4. Build the inspectListing and verifySellerCredentials tools
5. Build the checkShippingAvailability tool
6. Wire up the investigation workflow with parallel steps
7. Implement the agent monitor mutations (screenshots, status updates)
8. Test end-to-end: user message triggers workflow, data flows to DB

**AI agent focus:** Boilerplate Convex functions, TinyFish API integration code, error handling

**Human focus:** TinyFish goal prompt engineering, investigation logic, workflow orchestration

### Builder C: Intelligence Layer + Demo Prep

**Owns:** GPT-5.4 prompts, risk signal assessment, seller clustering, case generation, evidence assembly, demo data, pitch

**Hackathon day tasks:**
1. Build the assessRiskSignals tool (risk signal evaluation via GPT-5.4-mini)
2. Build the clusterSellers tool (seller network comparison via GPT-5.4-mini)
3. Build the generateCaseFile tool (GPT-5.4 structured output with public health framing)
4. Define Zod schemas for all data contracts
5. Create fallback demo data (cached TinyFish results, pre-built case)
6. Build the chat interaction handler (user sends follow-ups)
7. Write and rehearse the demo pitch
8. QA the full end-to-end flow and fix edge cases

**AI agent focus:** Zod schema generation, case file template code, prompt drafting

**Human focus:** Risk signal weight calibration, case quality tuning, pitch delivery

### Critical Coordination Points (Before Hacking Starts)

By 10:30 AM, all three builders must agree on:

1. **Convex schema** (section 6 of this doc): lock the table shapes
2. **Zod schemas** (section 6): lock the data contracts
3. **Risk signal taxonomy**: the list of signals, their labels, and their weights
4. **Monitor update format**: agentIndex, status enum, statusLabel string
5. **Map data format**: { latitude, longitude, riskLevel, type } for markers; { from, to, verified } for arcs
6. **Target demo marketplaces**: exact URLs and search terms for the Ozempic investigation

---

## 14. Build Timeline

| Time | Builder A (Frontend) | Builder B (Backend) | Builder C (Intelligence) |
|------|---------------------|--------------------|-----------------------|
| 09:45-10:30 | Workshop + setup: clone repo, install deps, verify Mapbox token | Workshop + setup: init Convex project, deploy schema, verify TinyFish API key | Workshop + setup: verify OpenAI key, lock demo scenario, pre-run TinyFish on target marketplaces for cached fallback |
| 10:30-11:00 | Scaffold Next.js app, Convex provider, dark theme, layout shell | Implement TinyFish SSE processor utility | Define all Zod schemas, define risk signal taxonomy, create seed data fixtures |
| 11:00-12:00 | Build investigation map (deck.gl markers) + TinyFish monitor bottom bar | Build searchMarketplace tool + agent monitor mutations | Build assessRiskSignals tool + risk scoring logic |
| 12:00-12:30 | Wire map to Convex queries (markers appear on new findings) | Build inspectListing + verifySellerCredentials tools | Build generateCaseFile tool + case output schema with public health framing |
| **12:30** | **CHECKPOINT: Map shows markers from live TinyFish data** | **CHECKPOINT: One marketplace search works end-to-end** | **CHECKPOINT: Risk assessment + case generation produce valid output from test data** |
| 12:30-13:30 | Build tabbed right panel (Chat with AI Elements + useUIMessages, Evidence table with risk signal display) | Build checkShippingAvailability tool + supply route mutations | Refine case generation prompts, build clusterSellers tool, build chat response handler |
| 13:30-14:30 | Add map arc layer for supply routes, animate on verification | Wire up investigation workflow (parallel marketplace runs) | Build seller dossier display, wire clustering to evidence panel |
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
| Technical complexity | Multi-step agent workflow, parallel live browsing, seller credential verification, prescription flow checking, risk signal assessment, seller network clustering, structured case generation | The TinyFish monitor makes complexity visible. Judges watch the agent navigate, click into seller profiles, and check pharmacy credentials. |
| Utility | Replaces hours of manual analyst work. Real pharmaceutical safety use case with life-or-death stakes. Current FDA crisis makes this immediately relevant. | Demo the full loop: input drug name, get enforcement-ready case with regulatory recommendations. Emphasize "counterfeit drugs kill 500,000 people a year." |
| Agentic web fit | The web is not just a data source; it is the operating environment. The agent browses, checks credentials, tests checkout flows, and verifies shipping origins. | Credential verification and prescription flow checking are the hero moments. Traditional scrapers cannot navigate seller profiles and test checkout flows. |

### Spot Prizes We Target

| Prize | Why We Fit | How to Position |
|-------|-----------|----------------|
| Deep Sea Architect (technical elegance + positive impact) | Credential verification through seller profile navigation is the "aha" moment. Public health impact is unambiguous: this literally saves lives. | In the pitch: "The magic moment is when the agent navigates to a seller's profile, finds no pharmacy credentials, then checks the checkout flow and confirms you can buy injectable prescription medication with zero medical verification. That is something only an autonomous browser agent can do." |
| Most Likely to Be the Next Unicorn (PMF + product vision) | Pharmaceutical supply chain integrity is a multi-billion dollar problem. WHO, FDA, pharmaceutical companies, and marketplace platforms all need this. Clear wedge (GLP-1 drugs), clear expansion path (all pharmaceuticals, then all regulated products). | End the demo: "We start with GLP-1 drugs on 3 marketplaces. The architecture scales to any regulated product category and any geography. Pharmaceutical counterfeiting is a $4.4 trillion problem. The WHO calls it a global health crisis." |
| Most Likely to Go Viral (for the Wrong Reasons) | "We found you can buy injectable drugs on Lazada with no prescription check and no pharmacy license" is genuinely alarming in a way that lands as viral social media content. Not "unhinged Black Mirror" but "investigative journalism fuel." | This is a secondary target. Do not lean into it during the pitch, but if judges are evaluating for it, our findings are inherently newsworthy. |

### Prizes We Probably Do Not Target

| Prize | Why Not |
|-------|---------|
| Rube Goldberg | We are optimizing for elegance, not over-engineering |
| WTF (What the Fish) | Our use case is serious and commercially viable, not bizarre |

---

## 16. Risk Management

### Risk 1: TinyFish API Fails During Demo

**Likelihood:** Medium (live APIs are unpredictable)
**Impact:** High (core functionality breaks)
**Mitigation:**
- Pre-run all TinyFish calls the night before on target marketplaces
- Cache structured outputs as JSON fixtures in the Convex DB
- Tool functions check for cached results and fall back gracefully
- Monitor panel can replay pre-recorded screenshots
- Mark which parts of the demo are "live" vs "cached" in case judges ask

### Risk 2: No Suspicious Listings Found on Demo Day

**Likelihood:** Low-Medium (marketplace listings change daily)
**Impact:** High (nothing to investigate means no demo)
**Mitigation:**
- Pre-scout marketplaces the night before and confirm suspicious listings exist
- Have 2-3 backup marketplace/drug combinations ready
- Cached fallback data guarantees the demo works regardless
- If live results are clean, the agent can narrate "No high-risk listings found on this marketplace" and pivot to the cached marketplace that does have findings

### Risk 3: Demo Looks Too Dashboard-Like

**Likelihood:** Low (our UX is designed against this)
**Impact:** Medium (judges think "just another scraping tool")
**Mitigation:**
- TinyFish monitor is the antidote: watching the agent browse is inherently agentic
- Chat narration makes the agent's reasoning visible
- Credential verification and prescription flow checking are clearly beyond scraping
- Seller network clustering demonstrates multi-step reasoning, not just data collection
- Public health framing immediately separates this from generic ecommerce monitoring

### Risk 4: Map Visualization Is Half-Baked

**Likelihood:** Medium (deck.gl setup can be time-consuming)
**Impact:** Medium (map is a central visual element)
**Mitigation:**
- Tier 1 map is just colored dots on a dark basemap (achievable in 1 hour)
- Arc layer is Tier 2 (only add if dots work by 1 PM)
- If deck.gl proves difficult, fall back to a simpler Mapbox GL JS implementation
- Worst case: static map image with overlaid markers using absolute positioning

### Risk 5: Convex Agent/Workflow Complexity

**Likelihood:** Low-Medium (team may not have deep Convex experience)
**Impact:** High (backend is the core)
**Mitigation:**
- Convex has excellent documentation and an AI-friendly llms.txt
- The agent component has working example code we can reference
- Fallback: skip the Workflow component entirely, use simple scheduled actions instead
- The database and reactive queries work regardless of agent framework

### Risk 6: Scope Creep

**Likelihood:** High (hackathon excitement + AI coding speed)
**Impact:** Medium (half-built features hurt more than missing features)
**Mitigation:**
- Tier system is explicitly defined with checkpoints
- "If it is not in the current tier, it does not exist"
- Builder C is responsible for scope enforcement and demo quality
- At 2:30 PM, all three builders stop building new features and shift to hardening

### Risk 7: Team Merge Conflicts / Integration Failures

**Likelihood:** Medium (3 people building in parallel)
**Impact:** High (wasted time debugging integration)
**Mitigation:**
- Schema and data contracts locked by 10:30 AM
- Each builder works on separate files/directories
- Convex's reactive model means frontend and backend can be developed independently (frontend subscribes to queries, backend writes to tables)
- Integration test at each checkpoint (12:30, 14:30)

### Risk 8: Ethical/Legal Sensitivity of Drug Counterfeiting Demo

**Likelihood:** Low (we are detecting counterfeits, not selling them)
**Impact:** Low (but worth pre-empting)
**Mitigation:**
- Frame clearly as a detection and enforcement tool, not a sourcing tool
- Emphasize public health mission in every part of the pitch
- Do not display actual counterfeit purchasing flows; stop before any purchase
- Case file recommends regulatory reporting, not vigilante action
- If a judge raises concerns, respond: "We are building what the WHO and FDA are asking for: tools to find and report these sellers before someone gets hurt."

---

## 17. Pitch Script

### 30-Second Elevator Pitch

"Counterfeit drugs kill half a million people every year. And right now, you can go on Lazada or Shopee, search for Ozempic, and find sellers with no pharmacy license, no prescription requirement, shipping injectable medication from unknown origins at 90% discounts. Nobody is checking. Meridian does that checking autonomously. You give it a drug name and target markets. It launches parallel agents across live marketplaces, identifies high-risk listings, verifies seller credentials, checks whether prescription drugs are being sold without prescriptions, maps distribution networks, and delivers an enforcement-ready case file. What takes a pharmaceutical investigator a week, Meridian does in minutes."

### 2-Minute Demo Script

**[Open]** "Let me show you what Meridian finds in 3 minutes."

**[Input]** "We are investigating potential counterfeit Ozempic on Amazon, Lazada Singapore, and Shopee Singapore. Legitimate price is about USD 900 per month. This is prescription-only."

*[Type the investigation prompt into the chat panel]*

**[Watch]** "Watch the bottom bar. Three TinyFish agents just launched, each browsing a different marketplace. You can see the actual browsers in real time."

*[Point to TinyFish monitor]*

**[Discover]** "Listings are dropping onto the map. See these red markers? Those are high-risk. This one on Lazada is selling Ozempic at SGD 120. That is a 90% discount on a prescription injectable."

*[Point to map markers]*

**[Verify]** "Now the agent is doing something a scraper cannot. It is navigating to this seller's profile and checking for pharmacy credentials..."

*[Point to TinyFish monitor showing seller profile navigation]*

"No pharmacy badge. Account is 3 months old. And the agent just checked the checkout flow: you can buy this injectable drug with zero prescription verification."

**[Trace]** "The agent traced the shipping origin to Shenzhen. That red line on the map is a confirmed supply route for an unverified injectable medication."

*[Point to animated arc on map]*

**[Network]** "The agent found this same seller operating on Shopee under a slightly different name, with identical product images. 82% confidence it is the same distribution network."

*[Point to seller dossier in Evidence tab]*

**[Deliver]** "And here is the case file: public health risk assessment, evidence with risk scores, seller network dossier, and recommended actions, including 'Report to Singapore HSA' and 'File takedown with Lazada Trust & Safety.' Ready for regulators."

*[Switch to Case tab]*

**[Close]** "Counterfeit drugs are a $4.4 trillion problem that the WHO calls a global health crisis. Meridian turns weeks of manual investigation into minutes. We start with GLP-1 drugs on 3 marketplaces. The architecture scales to any drug, any marketplace, any country."

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
  "United States": { lat: 37.0902, lng: -95.7129 },
  "Germany": { lat: 51.1657, lng: 10.4515 },
  "France": { lat: 46.2276, lng: 2.2137 },
  "Japan": { lat: 36.2048, lng: 138.2529 },
  "United Kingdom": { lat: 55.3781, lng: -3.4360 },
  "Australia": { lat: -25.2744, lng: 133.7751 },
  "South Korea": { lat: 35.9078, lng: 127.7669 },
  "Thailand": { lat: 15.8700, lng: 100.9925 },
  "Malaysia": { lat: 4.2105, lng: 101.9758 },
  "China": { lat: 35.8617, lng: 104.1954 },
  "India": { lat: 20.5937, lng: 78.9629 },
  "Vietnam": { lat: 14.0583, lng: 108.2772 },
  "Indonesia": { lat: -0.7893, lng: 113.9213 },
  "Philippines": { lat: 12.8797, lng: 121.7740 },
};

export const MARKETPLACE_URLS: Record<string, string> = {
  "Amazon US": "https://www.amazon.com",
  "Amazon Germany": "https://www.amazon.de",
  "Amazon Japan": "https://www.amazon.co.jp",
  "Lazada Singapore": "https://www.lazada.sg",
  "Lazada Thailand": "https://www.lazada.co.th",
  "Lazada Malaysia": "https://www.lazada.com.my",
  "Shopee Singapore": "https://shopee.sg",
  "Shopee Malaysia": "https://shopee.com.my",
  "Shopee Philippines": "https://shopee.ph",
};

// Risk signal definitions and weights
export const RISK_SIGNALS = {
  extreme_price_discount: {
    label: "Extreme price discount",
    description: "Listed price is more than 50% below legitimate market price",
    weight: 0.25,
    threshold: 0.50,  // 50% below legitimate price
  },
  significant_price_discount: {
    label: "Significant price discount",
    description: "Listed price is 30-50% below legitimate market price",
    weight: 0.15,
    threshold: 0.30,
  },
  no_pharmacy_credentials: {
    label: "No pharmacy credentials",
    description: "Seller has no visible pharmacy license or verification badge",
    weight: 0.20,
  },
  no_prescription_requirement: {
    label: "No prescription requirement",
    description: "Prescription-only drug sold without any Rx verification",
    weight: 0.20,
  },
  new_seller_account: {
    label: "New seller account",
    description: "Seller account is less than 6 months old",
    weight: 0.05,
  },
  suspicious_shipping_origin: {
    label: "Suspicious shipping origin",
    description: "Product ships from a region not associated with the drug manufacturer",
    weight: 0.10,
  },
  missing_batch_info: {
    label: "Missing batch/expiry information",
    description: "No batch number or expiration date visible in listing",
    weight: 0.05,
  },
  stock_images: {
    label: "Stock or generic images",
    description: "Product images appear to be stock photos rather than real product photography",
    weight: 0.05,
  },
  templated_description: {
    label: "Templated description",
    description: "Product description appears copied or template-generated",
    weight: 0.05,
  },
};

// Risk level thresholds (composite score)
export const RISK_LEVEL_THRESHOLDS = {
  low: 0.20,       // Below 20% composite score
  medium: 0.40,    // 20-40%
  high: 0.60,      // 40-60%
  critical: 0.60,  // Above 60%
};
```

## Appendix C: Seller Network Clustering Heuristic

Sellers are clustered using simple, explainable signals. No ML or graph algorithms.

| Signal | Weight | Detection Method |
|--------|--------|-----------------|
| Name overlap | 0.25 | GPT-5.4-mini scores similarity of seller display names |
| Image reuse | 0.25 | Compare product image URLs across listings (exact match) |
| Description similarity | 0.15 | GPT-5.4-mini scores template similarity of listing descriptions |
| Catalog overlap | 0.15 | Same drug SKUs listed across storefronts |
| Shared shipping origin | 0.20 | Products ship from the same origin region/city |

**Clustering rule:** Sum weighted signals. Score >= 0.5 = "likely related" (same network). This is simple, explainable to judges, and does not require ML infrastructure.

**Network risk escalation:** When multiple sellers are linked into a network, the network risk level is the maximum risk level of any individual seller in the cluster, elevated by one tier if the network spans 3+ marketplaces. This captures the intuition that organized multi-platform distribution networks are inherently higher risk than isolated sellers.

## Appendix D: Regulatory Escalation Framework

The case file's recommended actions map to specific regulatory bodies and escalation paths:

| Finding Type | Target Entity | Action Type |
|-------------|--------------|-------------|
| Counterfeit drug listing (any marketplace) | Marketplace Trust & Safety team | Takedown request with evidence pack |
| Prescription drug sold without Rx verification | Singapore HSA (Health Sciences Authority) | Regulatory report |
| Prescription drug sold without Rx verification | FDA (if US-facing) | MedWatch report |
| Cross-border shipping of controlled substances | Interpol Pharmaceutical Crime Unit | Intelligence referral |
| Organized seller network (3+ marketplaces) | WHO Rapid Alert System | Surveillance alert |
| Individual high-risk listing | Brand's legal/compliance team | Cease and desist preparation |

This framework makes the case file immediately actionable. Instead of generic "report this," the case tells the investigator exactly who to contact and what type of report to file. This is a small detail that dramatically increases perceived product maturity during the demo.
