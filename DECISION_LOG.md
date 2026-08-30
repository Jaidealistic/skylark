# Decision Log — Skylark BI Agent

## 1. The Core Bet

Most BI-agent submissions will let an LLM read raw data and guess at numbers. This build does the opposite: the LLM plans the query and narrates the result, but **never touches a number**. Aggregation is deterministic code operating on normalized rows. A founder cannot use an answer they can't verify, and an unverifiable number is worse than no number — so every answer here carries inline citations back to specific monday.com item IDs, and every caveat is computed, not invented.

## 2. Architecture

Three stages: **Planner** (LLM or heuristic fallback → structured query plan with board, sector, stage, status, metric) → **Aggregation Engine** (deterministic TypeScript operating on normalized `RecordRow[]`) → **Narration** (LLM or deterministic template, constrained to the computed result). Data syncs via monday.com GraphQL with **explicit column-ID mappings** — not generic keyword heuristics. This was a deliberate trade-off: the initial build used column-ID regex patterns and keyword matching to detect fields, which silently mis-detected real columns during testing (e.g. the close-date column `text_mm6qx4zr` didn't match `/date|due|close|complete/i`). Every answer cites specific monday.com item URLs, so a founder can click through and verify any number.

## 3. What Manual Testing Actually Found

The system was verified question-by-question against the raw monday.com source data, not just unit-tested. 16 unit tests pass. The following bugs were caught and fixed through manual testing against the live dataset:

| Bug | Before Fix | After Fix |
|---|---|---|
| "Won" matched Deal **Stage** "G. Project Won" (27 deals) instead of Deal **Status** "Won" (163 deals) | 27 deals, wrong field entirely | 163 deals, correct Status field |
| "Total value of work orders" returned the **Deals** board total (₹2.3B) instead of Work Orders (₹210M) | ₹2,305,518,040 (wrong board) | ₹210,613,555 (correct board) |
| "Energy sector" returned ₹0 with 0 deals instead of clarifying | Confident wrong answer | Clarification listing 11 real sectors |
| Leadership update: "68 of 175 work orders" (percentage used as count) | 68 (the %) of 175 | 119 (the count) of 175 |
| Two junk/template rows (cells contained column headers as values) counted in all metrics | 519 rows (2 fake) | 517 rows (filtered) |
| Currency labeled as USD (₹2.3B shown as $2.3B) | Dollar signs throughout | ₹ throughout |

This is the argument for the architecture: **an LLM-only system would have produced every one of these wrong answers fluently and confidently, with no way to catch them.** The deterministic core is what made these bugs findable and fixable at all.

## 4. Ambiguity Handling

Two real examples from the live system:

- **"How's this quarter looking?"** → No fiscal calendar is defined. Rather than guessing a date range, the system returns: *"Which fiscal calendar should I use for the quarter?"*

- **"How's the energy sector doing?"** → "Energy" is not one of the 11 sectors in the data (Mining, Renewables, Powerline, Railways, DSP, Construction, Tender, Security & Surveillance, Manufacturing, Aviation, Others). Rather than returning a confident ₹0, the system returns: *"I don't see an 'Energy' sector in the data. Did you mean one of: Aviation, Construction, DSP, Manufacturing, Mining, Others, Powerline, Railways, Renewables, Security & Surveillance, Tender?"*

Both clarifications are triggered by deterministic entity validation — the planner sets a sector or stage, and `findClosestEntity()` checks it against the actual values in the cached data before any aggregation runs.

## 5. Data Resilience

The quality engine found real completeness problems in the source data, surfaced as caveats on every answer:

| Board | Field | Missing | Percentage |
|---|---|---|---|
| Deals (342 rows) | value | 177 | 51.7% |
| Deals | closeDate | 71 | 20.8% |
| Deals | sector | 8 | 2.3% |
| Work Orders (175 rows) | dueDate | 19 | 10.9% |
| Work Orders | status | 4 | 2.3% |
| Work Orders | value | 1 | 0.6% |
| Both | duplicates (by name) | 305 | — |

Critical design choice: missingness is reported **per-board**, not pooled. "Work-order status" is N/A for deals (the field doesn't exist on that board), so pooling would produce a misleading 69% "missing status" across 519 rows. The per-board split gives a founder the actual signal: 4 of 175 work orders lack status (2.3%), which is a different problem than "most records are missing status."

## 6. Leadership Update

Built as a deterministic, on-demand structured brief (KPIs + prose readout + caveats), not a chat-log export. A document going in front of leadership needs to be reliable on demand, not dependent on someone asking the right question. The executive readout computes real counts from raw data (e.g. "119 of 175 work orders are marked complete") rather than pulling from pre-computed percentage fields. The caveats section lists all 6 completeness issues found across both boards, plus the duplicate count.

## 7. Honest Scope Cuts

These were deliberately deprioritized in favor of verifying core correctness, which is where the actual bugs were found:

- **Session context for follow-up questions** — not implemented. Each query is independent; "what about last quarter?" after a sector question won't inherit the filter.
- **PDF export** — not built. Leadership update exports as Markdown only.
- **Duplicate disambiguation** — 305 items share names with other items on the same board (e.g. 27 deals all named "Sakura"), and these are flagged but not disambiguated. A founder clicking the source link would see multiple items with the same name.

## 8. What I'd Do With More Time

- **Session memory** for follow-up queries ("what about last quarter?" inheriting the previous sector filter)
- **Persistent normalized cache** (SQLite/Redis) instead of in-memory — survives server restarts, avoids re-fetching on every cold start
- **PDF export** for the leadership update
- **Fuzzy duplicate detection** with similarity scoring on name + sector + value, not just exact name matching
- **Background sync** with job status instead of manual refresh — polling monday.com every N minutes with diff detection
