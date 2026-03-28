### INT-1: End-to-End Workflow Smoke Test
- **Tier:** 1
- **Est. time:** 30 min
- **Depends on:** B-2, B-4, B-8, C-4
- **Blocks:** INT-3
- **Owner:** Builder B + Builder C (pair)
- **Files:** No file changes — manual testing + bug fixing
- **Output contract:** A full investigation triggered from the UI completes all 6 workflow steps:
  1. Search regions (parallel TinyFish calls)
  2. Update status to "searching"
  3. Deep investigate high-risk listings
  4. Cluster sellers
  5. Generate case file
  6. Mark investigation as "completed"
- **Acceptance criteria:**
  - Investigation status transitions: pending → searching → investigating → generating_case → completed
  - At least 1 finding visible in Evidence panel with `riskScore`, `riskLevel`, and `riskSignals` populated
  - At least 1 supply route visible on map (from `supplyRoutes` table) with `riskLevel` and `concern` populated
  - Case file appears in Case panel with executive summary and `publicHealthRiskAssessment`
  - TinyFish monitor shows status updates during execution
  - No unhandled errors in Convex dashboard logs
- **Gotchas:**
  - Full workflow may take 3-5 minutes due to TinyFish latency — be patient during testing
  - If any step fails, check the Convex dashboard "Functions" tab for error logs
  - Common failure points:
    - TinyFish timeout (>2 min per call) — reduce number of regions
    - OpenAI rate limit — add retry logic or wait
    - Missing env vars — double-check Convex dashboard
    - Schema mismatch — findings.create missing required fields
  - If TinyFish itself is down, immediately activate Panic path: use A-1/A-2 demo data
  - Test with a SIMPLE prompt first: one region, one marketplace (e.g., just Amazon.com for Ozempic)
  - Check that the workflow retry logic works — if step 3 fails, does it retry?
