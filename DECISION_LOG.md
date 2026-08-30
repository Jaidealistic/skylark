# Decision Log — Skylark BI Agent

## 1. The Core Bet

Most BI-agent submissions let an LLM read raw data and guess at numbers. This build does the opposite: the LLM plans queries and narrates results, but **never touches a number**. Aggregation is deterministic TypeScript on normalized rows. A founder can't use an answer they can't verify — so every answer carries citations to monday.com item IDs, and every caveat is computed, not invented.

## 2. Tech Stack

- **Backend:** TypeScript / Node.js / Express / tRPC — monday.com's GraphQL returns nested JSON needing type-safe extraction; TypeScript's structural typing caught field-mapping errors at build time that would have been silent runtime bugs.
- **Frontend:** React + Tailwind (shadcn/ui) — fast iteration on insight cards and evidence ledger within the time limit.
- **monday.com integration:** GraphQL API v2, explicit column-ID mapping — chosen over MCP for predictability, and over heuristic detection after testing found heuristics silently mis-detecting fields (e.g. `text_mm6qx4zr` didn't match `/date|due|close/i`).
- **LLM usage:** Scoped to planning and narration only, never computing numbers — the load-bearing choice. An LLM computing "won deals" from raw rows would have returned 27 (stage "G. Project Won") instead of 163 (status "Won") and been unable to tell the difference.

## 3. Key Assumptions

- **"Won" = Deal Status (163 deals), not Deal Stage "G. Project Won" (27).** Two independent fields; 6× difference.
- **Completion = "Completed" + "Partial Completed."** Only "Completed" would give 68% → ~60%.
- **Conversion = name-based join** (deal name exists on Work Orders board). Stage-based filter ("H. Work Order Received") would give a different, lower figure.
- **All currency is INR.** Source labels say "Amount in Rupees." Template rows excluded (every cell = column header = junk). Fiscal quarter not assumed — system asks which calendar. Column IDs treated as stable; re-mapping needed if boards are recreated.

## 4. Key Trade-offs

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| LLM role | Plans + narrates | Reads raw data, computes answers | Deterministic aggregation → every number traceable to a source row |
| Field detection | Explicit column-ID mapping | Heuristic keyword matching | Heuristic silently mis-detected fields in testing |
| Entity validation | Fuzzy match → clarification | Return zero for unknowns | Confident ₹0 for "energy" is worse than asking |
| Quality reporting | Per-board | Pooled | Work-order status N/A for deals; pooling = misleading 69% |
| Currency | INR (₹) | USD ($) | Source data says "Amount in Rupees" |
| Temporal queries | Ask which calendar | Assume Jan–Mar = Q1 | Wrong calendar silently gives wrong quarterly figures |

## 5. What Manual Testing Found

Verified question-by-question against raw data. Six bugs caught:

| Bug | Before | After |
|---|---|---|
| "Won" matched Stage (27) not Status (163) | 27 | 163 |
| "Work order value" returned Deals board | ₹2.3B | ₹210M |
| "Energy sector" → confident ₹0 | 0 deals | Clarification with 11 real sectors |
| Leadership update used % as count | 68 of 175 | 119 of 175 |
| 2 template rows inflated counts | 519 rows | 517 |
| USD instead of INR | $2.3B | ₹2.3B |

An LLM-only system would have produced every one of these fluently and confidently, with no way to catch them.

## 6. Ambiguity Handling

- **"How's this quarter looking?"** → *"Which fiscal calendar?"* (not assumed)
- **"How's the energy sector doing?"** → *"I don't see 'Energy' — did you mean: Mining, Renewables, Powerline…?"* (11 real sectors listed)

Both triggered by `findClosestEntity()` checking the planner's output against live data before aggregation runs.

## 7. Data Resilience

| Board | Field | Missing | % |
|---|---|---|---|
| Deals (342) | value | 177 | 51.7% |
| Deals | closeDate | 71 | 20.8% |
| Work Orders (175) | dueDate | 19 | 10.9% |
| Work Orders | status | 4 | 2.3% |
| Both | name duplicates | 305 | — |

Per-board, not pooled — "status" exists on Work Orders but not Deals, so pooling produces a misleading 69%.

## 8. Leadership Update

Deterministic on-demand brief, not a chat-log export. Readout computes real counts from raw data ("119 of 175 work orders are marked complete") rather than pulling from pre-computed percentages. Caveats list all 6 completeness issues across both boards.

## 9. Honest Scope Cuts

Deliberately deprioritized to verify core correctness:

- **Session context** — not implemented. Each query independent; follow-ups don't inherit prior filters.
- **PDF export** — not built. Markdown only.
- **Duplicate disambiguation** — 305 items share names (e.g. 27 deals named "Sakura"); flagged, not resolved.

## 10. What I'd Do With More Time

Session memory, persistent cache (SQLite/Redis), PDF export, fuzzy duplicate detection, background sync.
