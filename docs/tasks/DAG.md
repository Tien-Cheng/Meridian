# Meridian Hackathon — Task DAG & Summary

**Team:** 3 builders | **Window:** 10:30 AM – 4:00 PM (5.5 hrs) | **Checkpoints:** 12:30, 2:30, 3:30

---

## Dependency Graph

```
                        ┌─── A-1 ──→ A-2 ──→ A-6
                        │
S0-1 ──→ S0-2 ─────────┼─── A-3 ──→ A-5
                        │
                        ├─── A-4
                        │
                        ├─── A-8 (AI Elements install + ChatPanel rewrite)
                        │
                        ├─── B-1 ──┬──→ B-2 ───────────────┐
                        │          │                        │
                        │          ├──→ B-3 ──→ B-4 ────────┤
                        │          │         │              │
                        │          ├──→ B-5  └──→ B-6       │
                        │          │                        │
                        ├─── B-7 ──→ B-8 ──────────────────┤
                        │                                   │
                        ├─── C-1 ──→ C-2 ──→ C-7 ──→ A-7   │
                        │                                   │
                        ├─── C-3 ──→ C-4 ──────────────────→├──→ INT-1 ──→ INT-3
                        │                                   │
                        ├─── C-5 ──────────────────────────→┘
                        │
                        └─── C-6
                                              B-2 + A-3 ──→ INT-2
```

### Critical Path (Tier 1 Demo)
```
S0-1 → S0-2 → B-1 → B-2 → B-4 → C-4 → B-7 → B-8 → INT-1 → INT-3
```
**Estimated time on critical path:** ~5 hours (including TinyFish latency)

### Panic Escape Path (if TinyFish fails by 12:30)
```
S0-2 → A-1 → A-2 → A-6 + C-6 → INT-3
```
**Estimated time:** ~2 hours, completable by 1:00 PM

---

## Task Summary Table

| ID | Title | Builder | Tier | Est | Depends On | Blocks |
|----|-------|---------|------|-----|------------|--------|
| S0-1 | Lock environment variables | All (B leads) | Setup | 10m | none | S0-2 |
| S0-2 | Verify schema deploy & seed | B | Setup | 5m | S0-1 | All |
| A-1 | Hardcoded demo data module | A | Panic | 30m | S0-2 | A-2, A-6 |
| A-2 | Seed demo investigation mutation | A | Panic | 20m | A-1 | A-6 |
| A-3 | Wire map tooltips + auto-fit | A | T1 | 40m | S0-2 | A-5, INT-2 |
| A-4 | Polish RightPanel tab badges | A | T1 | 20m | S0-2 | — |
| A-5 | Animated arc layer | A | T2 | 45m | A-3 | — |
| A-6 | Landing page demo button | A | T1 | 20m | A-2 | — |
| A-7 | EvidencePanel seller dossier cards | A | T2 | 30m | C-7 | — |
| A-8 | Install + theme AI Elements SDK | A | T1 | 45m | S0-2 | — |
| B-1 | Implement searchMarketplace tool | B | T1 | 60m | S0-1 | B-2, B-3, B-5 |
| B-2 | Implement searchRegion action | B | T1 | 45m | B-1 | B-4, INT-1, INT-2 |
| B-3 | Implement inspectListing tool | B | T1 | 45m | B-1 | B-4, B-6 |
| B-4 | Implement deepInvestigate action | B | T1 | 45m | B-3 | INT-1 |
| B-5 | Implement verifyShipping tool | B | T2 | 45m | B-1 | — |
| B-6 | Implement crawlStorefront tool | B | T2 | 40m | B-3 | — |
| B-7 | Parse investigation prompt into structured request | B | T1 | 35m | S0-2 | B-8, INT-1 |
| B-8 | Launch investigation workflow from chat | B | T1 | 30m | B-7 | INT-1 |
| C-1 | Implement clusterSellers tool | C | T1 | 50m | S0-1 | C-2 |
| C-2 | Implement clusterSellersAction | C | T1 | 40m | C-1 | C-7, A-7 |
| C-3 | Implement generateCaseFile tool | C | T1 | 50m | S0-1 | C-4 |
| C-4 | Implement generateCase action | C | T1 | 30m | C-3 | INT-1 |
| C-5 | Write demo script + seed prompts | C | T1 | 30m | none | INT-3 |
| C-6 | Pre-baked agent messages (panic) | C | Panic | 30m | none | — |
| C-7 | sellerDossiers query function | C | T2 | 15m | C-2 | A-7 |
| INT-1 | End-to-end workflow smoke test | B+C | T1 | 30m | B-2, B-4, B-8, C-4 | INT-3 |
| INT-2 | Map data integration verification | A+B | T1 | 15m | B-2, A-3 | — |
| INT-3 | Demo rehearsal | All | T1 | 20m | INT-1, C-5 | — |

---

## Checkpoints

### 12:30 PM — "Can we build live?"

| Builder | Must be done | Should be done |
|---------|-------------|----------------|
| A | A-1, A-2, A-8 | A-3 in progress |
| B | B-1 (or pivoted to mocks), B-7 | B-2 started |
| C | C-1 | C-3 in progress, C-5 started |

**Decision gate:** Is TinyFish returning parseable listings? If NO → Builder B hardcodes mock TinyFish responses and the team activates Panic fallback path.

**Demo-able at 12:30:** Landing page with "DEMO" button loads pre-seeded investigation with map markers.

---

### 2:30 PM — "Tier 1 complete?"

| Builder | Must be done | Should be done |
|---------|-------------|----------------|
| A | A-1–A-4, A-6, A-8, INT-2 | — |
| B | B-1–B-4, B-7, B-8, INT-1 | — |
| C | C-1–C-5, INT-1 | — |

**Decision gate:** Does the full workflow run end-to-end? If NO → deploy Panic MVP.

**Demo-able at 2:30:** Full investigation flow — user triggers from chat (AI Elements rendering with markdown + tool display), TinyFish monitors update, map shows markers, evidence panel populates, case file generates.

---

### 3:30 PM — "Feature freeze"

| Builder | Should be done | Working on |
|---------|---------------|------------|
| A | A-5 or A-7 | Bug fixes, polish |
| B | B-5 or B-6 | Bug fixes |
| C | C-7, INT-3 | Demo rehearsal |

**Hard rule:** No new features after 3:30. All builders → bug fixes, polish, demo rehearsal.

**Demo-able at 3:30:** Tier 1 + at least one Tier 2 feature (shipping verification or seller dossiers).

---

## Time Budget by Builder

| Builder | Tier 1 | Tier 2 | Panic | Integration | Total |
|---------|--------|--------|-------|-------------|-------|
| A | 125m | 75m | 50m | 15m | 265m |
| B | 260m | 85m | 0m | 30m | 375m |
| C | 200m | 15m | 30m | 20m | 265m |

**Available time per builder:** 330 min (5.5 hrs)

Builder B is now even tighter on Tier 1 (260m of critical-path work) because prompt parsing and workflow-launch wiring were missing from the original DAG. If TinyFish is slow, B should hardcode mock responses by 12:30 and circle back to live integration as Tier 2.

---

## Risk Fallbacks

| Risk | Trigger | Fallback Task |
|------|---------|---------------|
| TinyFish API down | B-1 not producing results by 12:30 | A-1 + A-2 (demo data) + mock responses in B-1 |
| TinyFish returns garbage | B-2 can't parse results | Use extractorAgent (GPT-5.4-mini) to normalize |
| Cart verification fails | B-5 can't complete checkout flow | Skip B-5, assume shipping based on price deviation in B-4 |
| GPT-5.4 rate limited | C-3/C-4 fail | Pre-generate one case file, store in demo data |
| Map won't render | A-3 fails | Static map image with CSS-positioned markers |
| Full workflow fails at 2:30 | INT-1 fails | Panic MVP: demo data + pre-baked messages |
