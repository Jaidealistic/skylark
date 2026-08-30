# BUILD BRIEF — Monday.com Business Intelligence Agent
### For: Skylark Drones Full Stack Developer Assignment (Placement Round)
### Feed this entire document to your AI coding agent as the master instruction set.

---

## 0. CONTEXT FOR THE AGENT

You are building a submission for a competitive placement assignment (2400+ applicants). The evaluators are grading **problem-solving approach, technical decision-making, and how ambiguity is handled** — not feature-count. Build a smaller number of things that genuinely work end-to-end over a long list of half-working features. Every design decision below has a reason attached — preserve the reasoning in the Decision Log, don't just implement blindly.

**Time budget: 5 hours total.** Priorities are tagged P0 (must work, submission fails without it), P1 (the differentiator, build if P0 is solid), P2 (cut first if behind schedule).

---

## 1. PRODUCT THESIS — WHY THIS BUILD IS DIFFERENT

Most competing submissions will be: chatbot UI → dumps monday.com data into an LLM prompt → LLM free-associates an answer in text. This has two failure modes evaluators will notice immediately:
1. **No verifiability.** A founder asking "how's our pipeline for energy sector" cannot trust a number they can't trace back to source rows. This is the single biggest reason real founders don't trust AI-BI tools today.
2. **Silent data-quality failure.** Messy real-world data (which this assignment explicitly provides) causes LLMs to either hallucinate over gaps or silently drop them. Founders need to be told "3 of 40 deals in this sector have no close date, so this is a partial answer" — not a clean-looking but wrong number.

**This build's differentiator: every answer is (a) computed deterministically, not guessed by the LLM, and (b) cited back to specific monday.com items, with data-quality caveats surfaced inline.** This is the thing to hammer in the Decision Log and any demo/README — it's the actual "gap in current tools" the assignment is implicitly asking you to notice.

Secondary differentiator (P1): a "Generate Leadership Update" action that produces a structured, exportable one-pager — not just another chat answer — addressing the optional requirement directly and visibly.

---

## 2. ARCHITECTURE OVERVIEW

```
┌─────────────────┐      ┌──────────────────────┐      ┌────────────────┐
│  Frontend (Web)  │─────▶│  Backend API          │─────▶│  monday.com    │
│  Chat + Insight  │◀─────│  (FastAPI, Python)     │◀─────│  GraphQL API   │
│  Cards + Update  │      │                        │      │  (read-only)   │
│  Generator       │      │  ┌──────────────────┐  │      └────────────────┘
└─────────────────┘      │  │ Sync Layer        │  │
                          │  │ (poll + cache)    │  │
                          │  └──────────────────┘  │
                          │  ┌──────────────────┐  │
                          │  │ Cleaning Pipeline │  │
                          │  │ (pandas)          │  │
                          │  └──────────────────┘  │
                          │  ┌──────────────────┐  │
                          │  │ Local Cache DB    │  │
                          │  │ (SQLite/Postgres) │  │
                          │  └──────────────────┘  │
                          │  ┌──────────────────┐  │
                          │  │ Query Planner LLM │  │
                          │  │ → structured calls│  │
                          │  └──────────────────┘  │
                          │  ┌──────────────────┐  │
                          │  │ Deterministic     │  │
                          │  │ Aggregation Engine│  │
                          │  └──────────────────┘  │
                          │  ┌──────────────────┐  │
                          │  │ Narration LLM     │  │
                          │  │ (with citations)  │  │
                          │  └──────────────────┘  │
                          └──────────────────────┘
```

**Why a local cache instead of live-querying monday.com per question (P0 decision):**
- monday.com GraphQL API has per-minute complexity-point rate limits; a conversational agent that hits the API on every message will throttle mid-demo, which is fatal for a hosted-prototype evaluation.
- Cross-board joins (deals × work orders) and aggregations are far easier and more reliable in pandas/SQL over a normalized local table than in GraphQL query composition.
- **This must be explicitly justified in the Decision Log** — the assignment says "must query monday.com dynamically, don't hardcode CSV." Satisfy this by: the cache is populated *only* from live monday.com API calls (never from the original CSVs directly), refreshed on a timer (e.g. every 5 min) and via a manual "Refresh Data" button in the UI. This is dynamic querying with a caching layer, not hardcoding — state that distinction clearly.

---

## 3. TECH STACK (with justification to put in Decision Log)

- **Backend:** Python + FastAPI — pandas for data cleaning is non-negotiable given "real-world messy data," and Python has mature monday.com API wrappers.
- **Database:** SQLite for prototype speed (swap for Postgres if the agent has time / if using Railway/Render with a DB add-on). Two normalized tables: `deals`, `work_orders`, both keyed to monday.com item IDs.
- **LLM:** Claude (Sonnet) or GPT-4o via API — used in exactly two narrow roles (Section 5), never as the source of truth for numbers.
- **Frontend:** Next.js (React) + Tailwind — chat interface plus a lightweight dashboard panel. Deploy to Vercel.
- **Backend hosting:** Railway or Render (free tier, supports FastAPI + SQLite/Postgres persistence, no local setup needed to test).
- **Monday.com integration:** GraphQL API v2 (`api.monday.com/v2`) with a read-only personal API token. MCP is acceptable if the agent's environment already has a working monday.com MCP server configured — otherwise use direct GraphQL, it's more predictable for a timed build.

---

## 4. MONDAY.COM SETUP (do this first, before any code)

1. Create a free monday.com account if none exists.
2. Create two boards:
   - **Work Orders** — import `Work_Order_Tracker Data.xlsx`. Map columns to sensible monday.com column types (status, date, text, number, dropdown for sector/region if present). Don't over-engineer the board structure — 15 minutes max.
   - **Deals** — import `Deal funnel Data.xlsx` similarly, with a status/stage column, deal value (number), sector, close date.
3. Generate a **read-only-scoped personal API token** (Admin → API in monday.com). Store as an environment variable (`MONDAY_API_TOKEN`), never hardcode it.
4. Note both board IDs — needed for the sync layer.
5. **Do not delete or bypass this step** — the assignment explicitly penalizes hardcoded CSV data. The agent's database must only ever be populated via authenticated calls to `api.monday.com/v2`.

---

## 5. DATA RESILIENCE / CLEANING PIPELINE (P0)

The provided data is deliberately messy. Build a pandas cleaning pass that runs on every sync:

- **Dates:** normalize inconsistent formats (`DD/MM/YYYY`, `MM-DD-YY`, text dates, blanks) into ISO 8601. Log any date that fails to parse instead of silently dropping it — surface count in a "data quality" summary the agent can reference.
- **Naming/sector normalization:** fuzzy-match variant spellings/casing of sector or client names (e.g. "Energy", "energy sector", "ENERGY ") into canonical categories. Keep a mapping table so this is inspectable, not a black box.
- **Missing values:** never silently `fillna(0)` for financial fields — that fabricates data. Instead, track completeness (`% of rows with a value`) per field and expose it. If a query is answered from a field with significant missingness, the narration layer must say so ("this reflects 34 of 40 deals; 6 have no recorded close date").
- **Deduplication:** flag likely duplicate items (same name + similar date) rather than auto-merging.

This pipeline is the actual technical meat of the assignment's "Data Resilience" requirement — spend real time here, it's more valuable than a fancier chat UI.

---

## 6. QUERY ENGINE (P0/P1 — the core differentiator)

Two-LLM-call pattern per user question, **never one LLM call that both interprets and answers**:

**Call 1 — Query Planner.** LLM receives the user's question + a schema description of available fields (not the data itself). It outputs structured JSON specifying: which board(s) to query, filters (sector, date range, status), the aggregation needed (sum, count, average, group-by), and — critically — a `clarification_needed` field if the question is ambiguous (e.g., "this quarter" without a defined fiscal calendar, or "energy sector" not matching an exact category in the data).
- If `clarification_needed` is set, the backend returns a clarifying question to the user instead of proceeding. This satisfies "ask clarifying questions when needed" — make it a real branch in the flow, not a decorative feature.

**Call 2 (deterministic, no LLM) — Aggregation Engine.** Runs the planned filter/aggregation against the local cache with pandas/SQL. Returns numbers plus the exact monday.com item IDs/links that contributed to the result.

**Call 3 — Narration.** LLM receives the computed numbers + contributing item references + data-quality metadata, and is instructed to produce a founder-readable answer that (a) states the number, (b) gives one line of context/insight, (c) surfaces any data-quality caveat, (d) never invents a number not present in the input. Include inline references (e.g. "[Deal #4821]") that the frontend renders as clickable links back to monday.com.

This three-step separation is the single most important architectural decision in this brief — it's what makes the agent's numbers trustworthy and demoable, and it's a clean thing to explain when evaluators ask "walk me through your architecture."

---

## 7. CONVERSATIONAL INTERFACE (P0)

- Standard chat UI, but maintain session context so follow-ups work ("what about last quarter?" after a pipeline question should inherit the sector filter from the prior turn).
- Every agent response that includes numbers renders as an **Insight Card** (not a bare text bubble): headline number, one-line insight, data-quality badge if relevant, and expandable "sources" list of linked monday.com items. This is a UI differentiator that's cheap to build (a styled component) and immediately signals product thinking to an evaluator scanning many submissions fast.
- Handle at minimum these founder-style query patterns end-to-end: revenue/pipeline value by sector, deal stage breakdown, work order completion status/operational health, cross-board queries (e.g. "which deals converted into active work orders").

---

## 8. LEADERSHIP UPDATE GENERATOR (P1 — the optional requirement)

Interpretation (state this explicitly in the Decision Log): a leadership update is not just an export of chat history — it's a **standing structured brief** a founder could paste into a board update or send to investors. Build a single "Generate Leadership Update" button that:
- Pulls a fixed set of KPIs (total pipeline value, pipeline by stage, sector breakdown, work order completion rate, any flagged risks/data gaps) via the same deterministic aggregation engine.
- Produces a clean markdown/PDF one-pager with headline metrics, 2-3 sentence narrative summary, and a "data caveats" footer.
- This should NOT require the user to ask the right question — it's a deterministic template, which is more reliable for a leadership-facing document than open-ended chat.

---

## 9. ERROR HANDLING (P0)

- monday.com API failures (rate limit, auth failure, timeout): catch explicitly, surface a clear message in the UI ("couldn't refresh live data, showing cached data from [timestamp]"), never crash the chat.
- LLM call failures: retry once, then degrade gracefully with an apologetic message — never show a raw stack trace to the user.

---

## 10. DEPLOYMENT (P0)

- Frontend → Vercel (free tier).
- Backend → Railway or Render (free tier), with `MONDAY_API_TOKEN` and LLM API key as environment secrets, never committed to the repo.
- Confirm the hosted link is testable with zero local setup and zero login required before submitting — evaluators will not debug your deployment.

---

## 11. DELIVERABLES CHECKLIST

1. **Hosted prototype link** — verify it works in an incognito window before submitting.
2. **Decision Log (2 pages max)** — must cover, explicitly:
   - Why local cache + scheduled sync instead of live-per-query (Section 2).
   - The three-step planner/aggregate/narrate architecture and why (Section 6) — this is the centerpiece.
   - How ambiguous queries are clarified (Section 6).
   - How data quality issues are surfaced rather than hidden (Section 5).
   - Interpretation of "leadership updates" (Section 8).
   - What was cut due to the 5-hour limit and what you'd do with more time (be honest — evaluators explicitly reward this).
3. **Source code ZIP** with a README covering: architecture overview, monday.com board setup steps (so a grader could recreate the boards), environment variables needed, and how to run locally as a fallback.
4. Submit via the Google Form link in the assignment — double check all links are public before hitting submit.

---

## 12. PRIORITY ORDER IF TIME RUNS SHORT

- **Cut last:** the three-step query engine with citations (Section 6) and the cleaning pipeline (Section 5) — these are the actual evaluated substance.
- **Cut first if behind:** the Leadership Update Generator (P1, Section 8), dashboard polish beyond the Insight Card, fuzzy dedup logic.
- **Never cut:** the hosted link actually working, and the Decision Log being honest about what's incomplete. A smaller, explainable, working system beats a larger broken one — this is stated directly in the assignment.

---

## 13. WHAT TO EXPLICITLY AVOID

- Do not let the LLM compute or guess any number directly from raw data — this is the failure mode nearly every competing submission will have.
- Do not hardcode the provided CSV/XLSX data into the app — the app's only data source at runtime must be the monday.com API.
- Do not over-invest in visual design at the expense of the query engine and data pipeline — evaluators are graders assessing technical decision-making, not a design portfolio.
