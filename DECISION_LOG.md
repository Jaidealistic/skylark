# Decision Log — Skylark BI Agent

## Local cache and dynamic monday.com sync

The app does not call monday.com for every question. A local in-memory cache is populated only through authenticated GraphQL calls to the configured live boards, then reused for the current operating session. This avoids unnecessary rate-limit pressure, keeps cross-board joins deterministic, and gives the UI a truthful cached fallback when a refresh fails. The dashboard displays whether the current records are live, cached, or demo data. A production iteration would persist the normalized cache and sync timestamp in the project database.

## Planner → aggregate → narrate

The query path is intentionally split into three responsibilities. The server-side LLM receives the question and field schema and returns a structured plan; it is not given raw rows and is not allowed to calculate metrics. The deterministic aggregation engine applies the plan to normalized records and returns the metric, contributing records, source fields, and caveats. The final response is rendered as a sourced insight card. This separation makes the answer auditable and keeps language generation from becoming a source of truth.

## Clarification and data quality

Ambiguity is a real branch: relative periods such as “this quarter” return a clarification asking which fiscal calendar applies rather than guessing. The cleaning pass normalizes dates and canonical sector labels, counts invalid dates, reports missing fields, and flags likely duplicates without auto-merging them. The result surfaces caveats such as missing close dates directly beside the answer, so a clean-looking number cannot hide incomplete source data.

## Leadership updates

A leadership update is treated as a standing structured brief, not a transcript export. The download uses the same deterministic aggregation engine for pipeline, stage distribution, completion, conversion, and data caveats. The current deliverable is Markdown because it is portable, reviewable, and easy to paste into a board update; PDF export is a follow-on improvement.

## Scope cuts

Within the timed prototype scope, the critical trust path was prioritized over infrastructure breadth. Deferred items include persistent normalized tables, configurable column mappings, pagination beyond the first monday.com page, fuzzy duplicate similarity, and PDF export. With more time, the next improvements would be persisted sync history, explicit board-schema configuration, background refresh with job status, richer source-field lineage, and a hosted private evaluator link with an automated health check.
