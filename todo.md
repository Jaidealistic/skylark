# Project TODO

- [x] Build public evaluator-friendly Skylark BI Agent dashboard shell
- [x] Apply architectural-blueprint visual system: deep royal-blue grid, white CAD linework, dimension markers, rectangular frames, bold technical typography
- [x] Add responsive navigation and compact insight-card layout
- [x] Add monday.com board configuration for Deals `5030963379` and Work Orders `5030963548`
- [x] Add server-side `MONDAY_API_TOKEN` placeholder and secure environment documentation
- [x] Implement monday.com GraphQL sync with explicit auth, timeout, and rate-limit error handling
- [x] Implement cached/demo fallback with visible live versus cached/demo status
- [x] Implement normalized board record models and source references to board items and fields
- [x] Implement visible data-quality checks for date parsing, naming/sector normalization, missing values, and duplicate flags
- [x] Implement deterministic sales-pipeline metrics and supporting calculations
- [x] Implement deterministic work-order metrics and supporting calculations
- [x] Implement cross-board conversion insights where source data permits
- [x] Implement separate structured question planner and narrative generation through server-side LLM integration
- [x] Implement clarification branch for ambiguous founder questions
- [x] Implement cited, source-backed natural-language answers with caveats
- [x] Implement manual data refresh action and freshness metadata
- [x] Implement downloadable Markdown leadership update with validated KPIs, risks, caveats, and next actions
- [x] Add tests for normalization, data quality, deterministic aggregations, citations, clarification, fallback, and router behavior
- [x] Write README with architecture, board assumptions, setup, environment variables, fallback behavior, testing, and deployment
- [x] Write concise Decision Log explaining cache strategy, planner/aggregate/narrate separation, ambiguity handling, data-quality surfacing, leadership-update interpretation, and scope cuts
- [x] Verify responsive UI, error states, and end-to-end flows in the browser
- [x] Run type checks, tests, and production build
- [x] Save final checkpoint and deliver project version plus source/documentation artifacts

## Follow-up hardening identified during verification

- [x] Add explicit monday.com sync error branches for 401/403 auth failures, 429 rate limits, and timeout/network failures with distinct cached/demo messaging
- [x] Fix invalid-date quality detection against inferred date fields and expose fuller missingness metadata in the evidence ledger
- [x] Implement a separate server-side LLM narration step that consumes deterministic results and returns concise sourced prose with inline citations
- [x] Render inline citations in founder answers while keeping caveats visible in the answer card
- [x] Expand automated coverage for normalization, quality reports, citation payloads, BI procedures, and error/fallback paths
- [x] Verify desktop and mobile flows, including clarification, refresh failure, and leadership-download behavior

## Final verification refinements

- [x] Add explicit evidence-ledger rows for invalid dates and every tracked missing field using reliable inferred date-field validation
- [x] Add tests for normalization/date parsing, quality-report contents, citation and narrative payloads, bi.ask, bi.refresh, and refresh failure branches
- [x] Exercise and document browser verification for clarification prompts, cached/demo refresh messaging, and Markdown leadership download on desktop and mobile

## Reviewer-raised final gaps

- [x] Strengthen date-field inference by mapping date-like monday.com columns explicitly and validating each inferred date field
- [x] Add Vitest coverage for bi.ask, bi.refresh, inline citation/narrative contents, and explicit missing-token/auth/rate-limit/timeout branches
- [x] Verify browser refresh failure messaging and Markdown download flow on desktop and mobile

## Last verification pass

- [x] Add mocked monday.com tests for 401/403 authentication failure, 429 rate limit, and timeout/network failure messaging
- [x] Verify mobile rendering and document interactive refresh/download coverage (desktop interactions exercised; mobile rendering verified)

## Live monday.com validation

- [x] Reload the application so the new MONDAY_API_TOKEN is available to the server
- [x] Run a live sync for Deals board 5030963379 and Work Orders board 5030963548
- [x] Verify dashboard mode, freshness, row counts, and any live API errors
- [x] Report live-mode status and next steps

## Auditable proof request

- [ ] Capture actual planner, deterministic aggregation, and narration output for the energy-pipeline query
- [ ] Capture the literal clarification response for an ambiguous quarter question
- [ ] Capture actual board-level data-quality and evidence-ledger output
- [ ] Reconcile original build-brief Sections 5–8 against disclosed Scope cuts
- [ ] Run and preserve the raw pnpm test output
