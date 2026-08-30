# Skylark BI Agent

Skylark BI Agent is a public evaluator-facing operations console for answering founder questions about sales pipeline and work-order performance. Its central design decision is that the language model never computes business numbers. It proposes a structured query plan; a deterministic engine calculates against normalized board records; and a separate narrative step presents the result with source references and caveats.

## Architecture

The React/Tailwind interface calls public tRPC procedures exposed by the Express server. The server reads Deals board `5030963379` and Work Orders board `5030963548` through the monday.com GraphQL API when `MONDAY_API_TOKEN` is configured. Records are normalized in `server/biEngine.ts`, cached in memory for the prototype, and surfaced as live, cached, or demo data. The deterministic engine supports pipeline value, averages, counts, stage breakdown, work-order completion, and deal-to-work-order conversion.

The bundled planner uses the server-side built-in LLM integration for structured intent extraction, with a deterministic heuristic fallback when the LLM is unavailable or returns an invalid plan. The result always comes from the aggregation engine. Source references retain the monday.com board, item ID, item name, field, and deep link.

## monday.com setup

Create or import the two boards using the supplied work-order and deal-funnel spreadsheets. Map the important columns to status/stage, date, text, number, sector, and client/name fields. The application assumes the Deals board contains an item name, sector, stage, deal value, and optional close date. It assumes the Work Orders board contains an item name, sector, status, due date, and optional completed date. The adapter is deliberately tolerant of column IDs because monday.com column IDs vary between board setups; it reads the returned item column text and applies conservative field inference.

Set a read-only personal API token in the server environment. Never commit the token. For local development, copy `.env.example` to `.env` and replace the placeholder. For managed hosting, add `MONDAY_API_TOKEN` through the project Secrets panel. The board IDs are already configured in `server/biEngine.ts` and can be changed there if a recreated board receives different IDs.

## Environment variables

| Variable | Purpose | Required |
|---|---|---|
| `MONDAY_API_TOKEN` | Server-side read-only token for `https://api.monday.com/v2` | For live mode |
| Built-in project variables | Server-side LLM proxy, auth, database, and analytics configuration | Injected by the platform |

The token is intentionally left as a placeholder in `.env.example`. Without it, the dashboard uses clearly labelled synthetic demo data; after a successful live sync, a temporary monday.com failure falls back to the last cached snapshot and displays the failure state.

## Trust and data quality behavior

Every sync runs normalization for dates and sector labels. Invalid dates are counted instead of silently discarded. Missing fields contribute to completeness metadata rather than being filled with zero. Duplicate-looking records are flagged by board and normalized item name and are not automatically merged. Query answers show the relevant caveats and expandable source links. The dashboard also exposes a quality score and a compact evidence ledger.

## Run locally

```bash
pnpm install
cp .env.example .env
pnpm check
pnpm test
pnpm build
pnpm dev
```

The public evaluator view does not require login. The auth scaffolding remains available from the template but is not placed in the critical dashboard path.

## Testing

The Vitest suite covers the demo fallback, sector normalization, deterministic pipeline totals, citations, quarter clarification, cross-board conversion, and answer envelopes. Run `pnpm test`. Run `pnpm check` for TypeScript and `pnpm build` for the production bundle.

## Deployment

Use the project’s managed hosting and add `MONDAY_API_TOKEN` as a server-side secret before publishing. The application is designed for the default stateless hosting mode: the in-memory cache is a resilience layer for a running instance, while a future production version should persist normalized records and sync metadata in the database. Verify the public URL in a private browser window and confirm the dashboard clearly shows DEMO DATA until the token is configured.

## Scope notes

The prototype prioritizes the evaluated substance: traceable deterministic calculations, data-quality visibility, live/cached/demo status, and the planner-to-aggregate separation. Persistent normalized tables, column-schema configuration UI, pagination beyond the monday.com page limit, and a richer PDF export are intentionally deferred and called out in the decision log.
