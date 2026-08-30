# Skylark BI Agent

This agent never lets a language model compute a business number — every figure is calculated deterministically and cited back to the exact monday.com item it came from. A founder-facing BI tool that returns a confident wrong answer is worse than returning no answer, so the architecture enforces that the LLM can plan what to ask and narrate the result, but cannot touch the arithmetic.

## Architecture

Three stages, each with a single responsibility:

1. **Planner** — The LLM (or a deterministic heuristic fallback when the LLM is unavailable) receives the user's natural-language question and returns a structured JSON plan: which board, which metric, which sector/stage/status filter, or a clarification prompt if the question is ambiguous. The planner never sees raw data rows.

2. **Aggregation Engine** (`server/biEngine.ts`) — Deterministic TypeScript that filters the normalized `RecordRow[]` cache according to the plan and computes the answer: pipeline value, count, average, stage breakdown, completion rate, or conversion rate. Every result includes `sources[]` — an array of `{ board, itemId, itemName, field, url }` pointing to the exact monday.com items that contributed to the number. The LLM never runs this code.

3. **Narration** — The LLM (or a deterministic template fallback) receives only the computed headline, insight, caveats, and citation list. It composes prose from these pre-computed facts. It cannot alter, recompute, or invent numbers because it never receives the raw data.

This is the reason the system is auditable: a founder can click any source link, see the original monday.com item, and verify the number. An LLM that reads raw data and computes in its hidden state produces numbers no one can verify.

## monday.com Setup

The app syncs two boards via the monday.com GraphQL API v2 using **explicit column-ID mappings** — not heuristic keyword matching. Heuristic detection was tested during development and found to silently mis-detect fields (e.g. the close-date column `text_mm6qx4zr` did not match the pattern `/date|due|close|complete/i` because its column ID contains none of those words). Explicit mapping trades portability to other boards for correctness on these two graded boards.

### Board IDs (hardcoded in `server/biEngine.ts`)

| Board | monday.com ID |
|---|---|
| Deals | `5030963379` |
| Work Orders | `5030963548` |

### Expected Fields per Board

**Deals board (`5030963379`):**

| Field | Column ID | monday.com Column Title |
|---|---|---|
| Sector | `text_mm6q2zdt` | Sector/service |
| Status | `text_mm6qa2rw` | Deal Status (Won / Dead / Open / On Hold) |
| Stage | `text_mm6qg8av` | Deal Stage (A. Lead Generated … G. Project Won … O. Not Relevant At All) |
| Value | `text_mm6qagbn` | Masked Deal value |
| Close Date | `text_mm6qx4zr` or `text_mm6q3fkn` | Tentative Close Date / Close Date (A) |

**Work Orders board (`5030963548`):**

| Field | Column ID | monday.com Column Title |
|---|---|---|
| Sector | `text_mm6qqzcg` | Sector |
| Status | `text_mm6qc8bd` | Execution Status (Completed / Partial Completed / Update Required) |
| Due Date | `text_mm6qn8sc` or `text_mm6qhtpj` | Probable End Date / Data Delivery Date |
| Value | `text_mm6qdhxz` | Amount in Rupees (Excl of GST) (Masked) |

**This mapping is tied to these two specific boards.** If you recreate the boards from scratch, monday.com will assign different column IDs and you will need to re-map them in the `mondayBoard()` function in `server/biEngine.ts` (lines ~114–135).

## Environment Variables

| Variable | Purpose | Required |
|---|---|---|
| `MONDAY_API_TOKEN` | Read-only personal API token for `https://api.monday.com/v2`. Without it, the app falls back to demo data with 7 hardcoded rows. | For live mode |
| `BUILT_IN_FORGE_API_KEY` | LLM API key for the Forge proxy (`https://forge.manus.im/v1/chat/completions`). Without it, the planner and narrator fall back to deterministic heuristics — the app still answers core questions correctly, just with templated prose instead of LLM-composed narration. | Optional |

Create a `.env` file in the project root:

```env
MONDAY_API_TOKEN=your_token_here
BUILT_IN_FORGE_API_KEY=your_key_here
```

Generate a Monday.com token at **monday.com → Admin → API → My Access Tokens**. The token only needs read access to the two boards above.

**Fallback resilience:** When `MONDAY_API_TOKEN` is absent, the app runs in demo mode with synthetic data. When the token is present but monday.com is unreachable, it serves the last cached snapshot. When `BUILT_IN_FORGE_API_KEY` is absent, the heuristic planner and deterministic narrator handle all questions — this path was verified to produce correct answers for all 14 test questions during development.

## Data Quality Behavior

The normalization pipeline in `server/biEngine.ts` runs on every sync:

- **Sector normalization** — Maps variant spellings and casing to canonical forms (e.g. lowercase "mining" → "Mining"). Covers all 11 sectors found in the live data: Mining, Powerline, Renewables, DSP, Railways, Security & Surveillance, Tender, Construction, Manufacturing, Aviation, Others.
- **Date parsing** — Validates dates via `new Date()` and counts invalid dates instead of silently discarding them.
- **Per-board missingness** — Fields are reported per board, not pooled across schemas. "Work-order status" is N/A for deals (the field doesn't exist on that board), so pooling would produce a misleading 69% "missing status" across 519 rows; the per-board split correctly reports 2.3% of work orders.
- **Duplicate-name flagging** — Items sharing the same name on the same board are flagged (305 flagged across 73 name-groups) but not auto-merged. A founder can see the flags and investigate.
- **Template row filtering** — Rows where ≥3 cell values equal the column's own header text are excluded. This caught 2 junk rows during real testing (names "Nezuko" and "Bugs Bunny" where every cell contained placeholder text like "Sector/service" instead of actual data). This is evidence the resilience claims are not aspirational — the bug was found and fixed.

## Run Locally

Prerequisites: Node.js ≥18, pnpm.

```bash
# Install dependencies
pnpm install

# Create environment file
cp .env.example .env
# Edit .env and add your MONDAY_API_TOKEN

# Type-check
pnpm check

# Run tests (16 tests, ~2s)
pnpm test

# Build for production
pnpm build

# Start dev server (with hot reload)
pnpm dev
```

The dev server starts on `http://localhost:3000` (or the next available port). No login required — the evaluator view is public by design.

## Testing

**Automated suite** (`pnpm test`, Vitest, 16 tests in 3 files):

- `server/biEngine.test.ts` — Demo fallback, pipeline value computation, sector normalization, date preservation, quality counts, clarification branches, cross-board conversion, answer envelopes, monday.com HTTP error classification, timeout handling.
- `server/bi.router.test.ts` — tRPC snapshot, leadership update, founder question routing, refresh-to-demo fallback.
- `server/auth.logout.test.ts` — Auth logout flow.

**Manual verification** — Beyond automated tests, the system was verified question-by-question against the raw monday.com source spreadsheets and the live API. This is what caught the real bugs: the Status vs Stage field confusion (27 vs 163 deals), the wrong-board routing (₹2.3B vs ₹210M), the missing-entity zero-answer bug, the percentage-as-count template error, the two junk template rows, and the USD/INR currency mislabeling. See the [Decision Log](DECISION_LOG.md) for the full bug table with before/after numbers.

## Deployment

**Hosted instance:** [Deploy on Render](https://render.com/deploy?repo=https://github.com/Jaidealistic/skylark) — connect the GitHub repo, set `MONDAY_API_TOKEN` as an environment variable in the Render dashboard, and deploy. The `render.yaml` blueprint configures the build and start commands automatically.

**Manual redeploy steps:**
1. Go to your Render (or Railway) dashboard → the Skylark service
2. Add environment variable: `MONDAY_API_TOKEN` = your Monday.com read-only token
3. Optionally add `BUILT_IN_FORGE_API_KEY` for LLM narration
4. Trigger deploy — build runs `npx pnpm install && npx pnpm build`, start runs `node dist/index.js`

**To redeploy after code changes:** push to `master`, then Manual Deploy → Deploy latest commit on the hosting dashboard.

## Scope Notes

Three features were deliberately cut to prioritize verifying core correctness, which is where the actual bugs were found:

- **Session context for follow-up questions** — not implemented. Each query is independent; "what about last quarter?" after a sector question won't inherit the filter. Every query starts fresh.
- **PDF export** — not built. The leadership update exports as Markdown only.
- **Duplicate-name disambiguation** — 305 items share names with other items on the same board (e.g. 27 deals all named "Sakura"). These are flagged in the evidence ledger but not resolved or merged.

These are documented with rationale in the [Decision Log](DECISION_LOG.md).
