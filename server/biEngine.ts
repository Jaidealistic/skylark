import { invokeLLM } from "./_core/llm";

export type BoardKind = "deals" | "workOrders";
export type SourceRef = { board: BoardKind; itemId: string; itemName: string; field?: string; url: string };
export type RecordRow = { id: string; name: string; board: BoardKind; sector?: string; status?: string; stage?: string; value?: number; closeDate?: string; dueDate?: string; completedDate?: string; sourceUrl: string; raw: Record<string, string> };
export type BoardQuality = { board: BoardKind; total: number; missing: Record<string, number>; invalidDates: number; notes: string[] };
export type QualityReport = { totalRows: number; deals: BoardQuality; workOrders: BoardQuality; missing: Record<string, number>; invalidDates: number; duplicateFlags: number; normalizedLabels: number; notes: string[] };
export type CacheState = { rows: RecordRow[]; quality: QualityReport; fetchedAt: string; mode: "live" | "demo" | "cached"; error?: string };
class MondaySyncError extends Error { constructor(public userMessage: string) { super(userMessage); } }

export const BOARD_IDS = { deals: "5030963379", workOrders: "5030963548" } as const;
let cache: CacheState | null = null;

const demoRows: RecordRow[] = [
  { id: "demo-deal-1", name: "Atlas Energy Expansion", board: "deals", sector: "Energy", stage: "Proposal", value: 18500000, closeDate: "2026-09-12", sourceUrl: "https://monday.com/boards/5030963379/pulses/demo-deal-1", raw: {} },
  { id: "demo-deal-2", name: "Northstar Grid Program", board: "deals", sector: "Energy", stage: "Negotiation", value: 32000000, closeDate: "2026-10-05", sourceUrl: "https://monday.com/boards/5030963379/pulses/demo-deal-2", raw: {} },
  { id: "demo-deal-3", name: "Harbor Survey Fleet", board: "deals", sector: "Infrastructure", stage: "Discovery", value: 9500000, sourceUrl: "https://monday.com/boards/5030963379/pulses/demo-deal-3", raw: {} },
  { id: "demo-deal-4", name: "Cedar County Mapping", board: "deals", sector: "Government", stage: "Won", value: 14000000, closeDate: "2026-08-18", sourceUrl: "https://monday.com/boards/5030963379/pulses/demo-deal-4", raw: {} },
  { id: "demo-wo-1", name: "Atlas Energy Expansion", board: "workOrders", sector: "Energy", status: "In Progress", value: 25000000, dueDate: "2026-09-30", sourceUrl: "https://monday.com/boards/5030963548/pulses/demo-wo-1", raw: {} },
  { id: "demo-wo-2", name: "Cedar County Mapping", board: "workOrders", sector: "Government", status: "Complete", value: 14000000, dueDate: "2026-08-20", completedDate: "2026-08-19", sourceUrl: "https://monday.com/boards/5030963548/pulses/demo-wo-2", raw: {} },
  { id: "demo-wo-3", name: "Northstar Grid Program", board: "workOrders", sector: "Energy", status: "Blocked", value: 0, dueDate: "2026-08-28", sourceUrl: "https://monday.com/boards/5030963548/pulses/demo-wo-3", raw: {} },
];

function parseDate(value?: string) {
  if (!value) return undefined;
  const trimmed = value.trim();
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

/**
 * Canonical sector mapping — covers both legacy demo sectors AND
 * every sector value found in the live monday.com boards:
 * Mining, Powerline, Renewables, DSP, Railways,
 * Security and Surveillance, Tender, Construction, Energy, Government, Infrastructure
 */
function canonical(value?: string) {
  if (!value) return undefined;
  const clean = value.trim().toLowerCase();
  if (clean.includes("energy")) return "Energy";
  if (clean.includes("gov")) return "Government";
  if (clean.includes("infra")) return "Infrastructure";
  if (clean.includes("mining")) return "Mining";
  if (clean.includes("power")) return "Powerline";
  if (clean.includes("renew")) return "Renewables";
  if (clean.includes("dsp")) return "DSP";
  if (clean.includes("rail")) return "Railways";
  if (clean.includes("security") || clean.includes("surveillance")) return "Security & Surveillance";
  if (clean.includes("tender")) return "Tender";
  if (clean.includes("construct")) return "Construction";
  return value.trim().replace(/\b\w/g, c => c.toUpperCase());
}

/** Format a number as INR with ₹ prefix — en-US grouping. */
function fmtINR(n: number): string {
  return "₹" + n.toLocaleString("en-US");
}

function boardQuality(board: BoardKind, rows: RecordRow[]): BoardQuality {
  const boardRows = rows.filter(r => r.board === board);
  // Deals have: sector, value, closeDate, stage
  // Work orders have: sector, value, status, dueDate, completedDate
  const dealFields = ["sector", "value", "closeDate", "stage"] as const;
  // completedDate excluded: no such column exists on the Work Orders board
  const woFields = ["sector", "value", "status", "dueDate"] as const;
  const fields = board === "deals" ? dealFields : woFields;
  const missing: Record<string, number> = {};
  for (const key of fields) missing[key] = boardRows.filter(r => r[key as keyof RecordRow] === undefined).length;
  const invalidDates = boardRows.filter(r => r.raw.__invalidDate === "1").length;
  const notes: string[] = [];
  if (missing.closeDate) notes.push(`${missing.closeDate} of ${boardRows.length} deals lack a close date.`);
  if (missing.status) notes.push(`${missing.status} of ${boardRows.length} work orders lack a status.`);
  if (missing.dueDate) notes.push(`${missing.dueDate} of ${boardRows.length} work orders lack a due date.`);
  if (board === "deals" && !missing.closeDate) notes.push("Close-date coverage is complete for all deals.");
  if (board === "workOrders" && !missing.status) notes.push("Status coverage is complete for all work orders.");
  if (board === "workOrders" && !missing.dueDate) notes.push("Due-date coverage is complete for all work orders.");
  return { board, total: boardRows.length, missing, invalidDates, notes };
}

export function quality(rows: RecordRow[]): QualityReport {
  const deals = boardQuality("deals", rows);
  const workOrders = boardQuality("workOrders", rows);
  // Pooled missing for fields that exist on both boards
  const missing: Record<string, number> = {};
  for (const key of ["sector", "value"]) missing[key] = rows.filter(r => r[key as keyof RecordRow] === undefined).length;
  const byName = new Map<string, number>();
  rows.forEach(r => byName.set(`${r.board}:${r.name.toLowerCase()}`, (byName.get(`${r.board}:${r.name.toLowerCase()}`) ?? 0) + 1));
  const duplicateFlags = Array.from(byName.values()).filter(v => v > 1).reduce((a, v) => a + v - 1, 0);
  const invalidDates = rows.filter(r => r.raw.__invalidDate === "1").length;
  const notes: string[] = [...deals.notes, ...workOrders.notes];
  if (duplicateFlags) notes.push(`${duplicateFlags} likely duplicate item(s) flagged for review.`);
  else notes.push("No likely duplicate items detected.");
  return { totalRows: rows.length, deals, workOrders, missing, invalidDates, duplicateFlags, normalizedLabels: rows.filter(r => Object.values(r.raw).some(Boolean)).length, notes };
}
export function normalize(rows: RecordRow[]) { return rows.map(r => ({ ...r, sector: canonical(r.sector), closeDate: parseDate(r.closeDate), dueDate: parseDate(r.dueDate), completedDate: parseDate(r.completedDate) })); }

async function mondayBoard(board: BoardKind): Promise<RecordRow[]> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token || token === "your_monday_api_token_here") throw new Error("MONDAY_API_TOKEN is not configured");
  const boardId = BOARD_IDS[board];
  const query = `query { boards(ids: ${boardId}) { items_page(limit: 500) { items { id name column_values { id text value } } } } }`;
  let response: Response; try { response = await fetch("https://api.monday.com/v2", { method: "POST", headers: { "Content-Type": "application/json", Authorization: token }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(12000) }); } catch (error) { throw new MondaySyncError(error instanceof Error && error.name === "TimeoutError" ? "monday.com refresh timed out; showing the latest available snapshot." : "monday.com could not be reached; showing the latest available snapshot."); }
  if (!response.ok) { if (response.status === 401 || response.status === 403) throw new MondaySyncError("Live sync needs a valid read-only monday.com token."); if (response.status === 429) throw new MondaySyncError("monday.com rate limit reached; showing the latest available snapshot."); throw new MondaySyncError(`monday.com could not refresh this board (HTTP ${response.status}).`); }
  const json = await response.json() as { data?: { boards?: Array<{ items_page?: { items?: Array<{ id: string; name: string; column_values: Array<{ id: string; text: string; value: string }> }> } }> }; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors[0].message);
  const items = json.data?.boards?.[0]?.items_page?.items ?? [];
  const rows: RecordRow[] = [];
  for (const item of items) {
    const raw: Record<string, string> = {};
    item.column_values.forEach(c => { raw[c.id] = c.text || c.value || ""; });
    const values = Object.values(raw);

    // Explicit column-ID mappings from Monday.com board schemas
    // Deals: text_mm6q2zdt=Sector/service, text_mm6qagbn=Masked Deal value,
    //        text_mm6qx4zr=Tentative Close Date, text_mm6q3fkn=Close Date (A),
    //        text_mm6qg8av=Deal Stage, text_mm6qa2rw=Deal Status
    // Work Orders: text_mm6qqzcg=Sector, text_mm6qdhxz=Amount in Rupees (Excl GST),
    //              text_mm6qc8bd=Execution Status, text_mm6qn8sc=Probable End Date,
    //              text_mm6q9sts=Probable Start Date, text_mm6qhtpj=Data Delivery Date
    const col = (id: string) => raw[id] || undefined;

    let sector: string | undefined;
    let stage: string | undefined;
    let status: string | undefined;
    let value: number | undefined;
    let closeDate: string | undefined;
    let dueDate: string | undefined;
    let completedDate: string | undefined;

    if (board === "deals") {
      sector = col("text_mm6q2zdt");
      stage = col("text_mm6qg8av");
      status = col("text_mm6qa2rw");
      closeDate = col("text_mm6qx4zr") || col("text_mm6q3fkn");
      const rawVal = col("text_mm6qagbn");
      value = rawVal ? Number(rawVal.replace(/[^\d.-]/g, "")) : undefined;
      if (value !== undefined && !Number.isFinite(value)) value = undefined;
    } else {
      // Work orders
      sector = col("text_mm6qqzcg");
      status = col("text_mm6qc8bd");
      dueDate = col("text_mm6qn8sc") || col("text_mm6qhtpj");
      // No completedDate column exists on this board — 100% missing is genuine
      const rawVal = col("text_mm6qdhxz");
      value = rawVal ? Number(rawVal.replace(/[^\d.-]/g, "")) : undefined;
      if (value !== undefined && !Number.isFinite(value)) value = undefined;
    }

    // Validate dates
    const datesToCheck = [closeDate, dueDate, completedDate].filter(Boolean);
    raw.__invalidDate = datesToCheck.some(v => Number.isNaN(new Date(v as string).getTime())) ? "1" : "0";

    // Detect template/header rows where cells contain their own column titles
    // e.g., text_mm6q2zdt = "Sector/service" instead of an actual sector value
    const dealTitleMap: Record<string, string> = { text_mm6qa2rw: "Deal Status", text_mm6q3fkn: "Close Date (A)", text_mm6qj23v: "Closure Probability", text_mm6qx4zr: "Tentative Close Date", text_mm6qg8av: "Deal Stage", text_mm6q66h3: "Product deal", text_mm6q2zdt: "Sector/service", text_mm6qaa12: "Created Date" };
    const woTitleMap: Record<string, string> = { text_mm6qc8bd: "Execution Status", text_mm6qhtpj: "Data Delivery Date", text_mm6q1k83: "Date of PO/LOI", text_mm6q15ew: "Document Type", text_mm6q9sts: "Probable Start Date", text_mm6qn8sc: "Probable End Date", text_mm6qqzcg: "Sector", text_mm6qg590: "Type of Work", text_mm6qdhxz: "Amount in Rupees (Excl of GST) (Masked)" };
    const titleMap = board === "deals" ? dealTitleMap : woTitleMap;
    const titleMatches = Object.entries(titleMap).filter(([colId, title]) => (raw[colId] || "").toLowerCase() === title.toLowerCase()).length;
    if (titleMatches >= 3) continue; // skip template/header rows

    rows.push({
      id: item.id,
      name: item.name,
      board,
      sector: canonical(sector),
      status,
      stage: canonical(stage),
      value,
      closeDate,
      dueDate,
      completedDate,
      sourceUrl: `https://monday.com/boards/${boardId}/pulses/${item.id}`,
      raw,
    });
  }
  return rows;
}

export async function refreshData(): Promise<CacheState> {
  try {
    const rows = normalize([...(await mondayBoard("deals")), ...(await mondayBoard("workOrders"))]);
    cache = { rows, quality: quality(rows), fetchedAt: new Date().toISOString(), mode: "live" };
  } catch (error) {
    const mode = cache ? "cached" : "demo";
    const message = error instanceof MondaySyncError ? error.userMessage : error instanceof Error ? error.message : "Live sync failed; showing available data."; cache = cache ? { ...cache, mode, error: message } : { rows: normalize(demoRows), quality: quality(demoRows), fetchedAt: new Date().toISOString(), mode: "demo", error: message };
  }
  return cache;
}
export async function getData() { return cache ?? refreshData(); }

export type Plan = { board: "deals" | "workOrders" | "both"; sector?: string; stage?: string; status?: string; metric: "pipelineValue" | "count" | "averageValue" | "stageBreakdown" | "completionRate" | "conversion"; clarification_needed?: string };
/** List of all sectors found in live Monday.com data. */
const KNOWN_SECTORS = ["mining", "powerline", "renewables", "dsp", "railways", "security", "surveillance", "tender", "construction", "energy", "government", "infrastructure"];
/** Display-formatted sector names for clarification suggestions. */
const SECTOR_DISPLAY: Record<string, string> = { mining: "Mining", powerline: "Powerline", renewables: "Renewables", dsp: "DSP", railways: "Railways", security: "Security & Surveillance", tender: "Tender", construction: "Construction", energy: "Energy", government: "Government", infrastructure: "Infrastructure" };
/** List of all stages found in live Monday.com data. */
const KNOWN_STAGES = ["lead generated", "sales qualified", "demo done", "feasibility", "proposal", "commercial", "negotiation", "won", "on hold", "closed", "lost"];

export function heuristicPlan(question: string): Plan {
  const q = question.toLowerCase();
  const sector = KNOWN_SECTORS.find(s => q.includes(s));

  // --- Clarification branches for ambiguous temporal references ---
  if (q.includes("this quarter") || q.includes("last quarter"))
    return { board: "deals", metric: "count", clarification_needed: "Which fiscal calendar should I use for the quarter?" };

  // --- Board detection ---
  const wantsWorkOrders = q.includes("work order") || q.includes("work-order") || q.includes("wo ") || q.includes("wo'");
  const wantsDeals = q.includes("deal") || q.includes("pipeline") || q.includes("opportunity");
  const wantsBoth = q.includes("convert") || q.includes("conversion") || q.includes("active work");
  let board: Plan["board"] = wantsBoth ? "both" : wantsWorkOrders ? "workOrders" : "deals";

  // --- Explicit metric intents ---
  // Won / closed deals → filter by Deal Status = "Won"
  if (q.includes("won") || q.includes("closed") || q.includes("successful"))
    return { board, metric: "count", status: "Won", sector };
  // Lost / dead deals → filter by Deal Status = "Dead"
  if (q.includes("lost") || q.includes("lose") || q.includes("losing") || q.includes("dead"))
    return { board, metric: "count", status: "Dead", sector };
  // On hold deals → filter by Deal Status = "On Hold"
  if (q.includes("on hold"))
    return { board, metric: "count", status: "On Hold", sector };
  // Conversion
  if (wantsBoth || q.includes("convert"))
    return { board: "both", metric: "conversion", sector };
  // Stage breakdown
  if (q.includes("stage") || q.includes("breakdown") || q.includes("pipeline by"))
    return { board: "deals", metric: "stageBreakdown", sector };
  // Work-order completion / health
  if (q.includes("complete") || q.includes("completion") || q.includes("health") || q.includes("operational"))
    return { board: "workOrders", metric: "completionRate", sector };
  // Average deal size
  if (q.includes("average") || q.includes("mean") || q.includes("avg"))
    return { board: "deals", metric: "averageValue", sector };
  // Data quality questions
  if (q.includes("data quality") || q.includes("quality issue") || q.includes("missing data") || q.includes("data completeness") || q.includes("evidence ledger"))
    return { board, metric: "count", clarification_needed: "I can show data quality metrics. Did you mean: (1) overall data completeness, (2) missing values by field, or (3) duplicate detection results?" };
  // Leadership update
  if (q.includes("leadership") || q.includes("executive") || q.includes("one-pager") || q.includes("update"))
    return { board: "both", metric: "pipelineValue", clarification_needed: "__LEADERSHIP_UPDATE__" };
  // Work-order count
  if (wantsWorkOrders && (q.includes("how many") || q.includes("count")))
    return { board: "workOrders", metric: "count", sector };
  // Work-order value
  if (wantsWorkOrders && (q.includes("value") || q.includes("total") || q.includes("amount")))
    return { board: "workOrders", metric: "pipelineValue", sector };

  // --- Fallback: if the question doesn't match any known intent, ask ---
  const hasStrongSignal = sector || wantsWorkOrders || wantsDeals || wantsBoth
    || q.includes("how many") || q.includes("how much") || q.includes("what") || q.includes("show") || q.includes("list") || q.includes("generate");
  if (!hasStrongSignal)
    return { board, metric: "pipelineValue", sector, clarification_needed: "I'm not confident I understood that. Could you clarify — are you asking about: (1) deal pipeline value, (2) work order completion, (3) stage breakdown, or (4) something else?" };

  return { board, metric: "pipelineValue", sector };
}
export function aggregate(plan: Plan, state: CacheState) {
  const deals = state.rows.filter(r => r.board === "deals" && (!plan.sector || r.sector === canonical(plan.sector)));
  const workOrders = state.rows.filter(r => r.board === "workOrders" && (!plan.sector || r.sector === canonical(plan.sector)));
  let value = 0; let headline = ""; let insight = ""; let sources: SourceRef[] = [];
  // Apply stage AND status filters to deals
  let filteredDeals = deals;
  if (plan.stage) filteredDeals = filteredDeals.filter(r => r.stage === plan.stage);
  if (plan.status) filteredDeals = filteredDeals.filter(r => r.status === plan.status);
  // For work order queries, use workOrders instead of deals
  const activeRows = plan.board === "workOrders" ? workOrders : filteredDeals;
  if (plan.metric === "pipelineValue") { value = activeRows.reduce((a, r) => a + (r.value ?? 0), 0); const label = plan.board === "workOrders" ? "work order" : "deal"; headline = `${fmtINR(value)} pipeline`; insight = `${activeRows.filter(r => r.value !== undefined).length} ${label} record${activeRows.filter(r => r.value !== undefined).length === 1 ? "" : "s"} contribute to this total.`; sources = activeRows.filter(r => r.value !== undefined).map(r => ({ board: r.board, itemId: r.id, itemName: r.name, field: "value", url: r.sourceUrl })); }
  if (plan.metric === "averageValue") { value = filteredDeals.length ? Math.round(filteredDeals.reduce((a, r) => a + (r.value ?? 0), 0) / filteredDeals.length) : 0;  headline = `${fmtINR(value)} average deal`; insight = `Calculated across ${filteredDeals.length} deal records.`; sources = filteredDeals.map(r => ({ board: r.board, itemId: r.id, itemName: r.name, field: "value", url: r.sourceUrl })); }
  if (plan.metric === "count") { value = activeRows.length; const totalValue = activeRows.reduce((a, r) => a + (r.value ?? 0), 0); const label = plan.board === "workOrders" ? "work order" : "deal"; headline = `${value} ${label}${value === 1 ? "" : "s"}`; insight = plan.stage ? `${fmtINR(totalValue)} total value across ${value} ${label}${value === 1 ? "" : "s"}.` : `Counted from normalized ${label} items.`; sources = activeRows.map(r => ({ board: r.board, itemId: r.id, itemName: r.name, url: r.sourceUrl })); }
  if (plan.metric === "stageBreakdown") { const counts = deals.reduce<Record<string, number>>((a, r) => { const s = r.stage ?? "Unspecified"; a[s] = (a[s] ?? 0) + 1; return a; }, {}); const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]); const top3 = sorted.slice(0, 3); const remaining = sorted.slice(3).reduce((a, [, v]) => a + v, 0); headline = top3.map(([k, v]) => `${k}: ${v}`).join(" · ") + (remaining > 0 ? ` · +${remaining} other` : "") || "No stages available"; insight = `${sorted.length} stages total across ${deals.length} deals. Showing top ${top3.length}.`; sources = deals.map(r => ({ board: r.board, itemId: r.id, itemName: r.name, field: "stage", url: r.sourceUrl })); }
  if (plan.metric === "completionRate") { const complete = workOrders.filter(r => (r.status ?? "").toLowerCase().includes("complete")).length; value = workOrders.length ? Math.round((complete / workOrders.length) * 100) : 0; headline = `${value}% complete`; insight = `${complete} of ${workOrders.length} work orders are marked complete.`; sources = workOrders.map(r => ({ board: r.board, itemId: r.id, itemName: r.name, field: "status", url: r.sourceUrl })); }
  if (plan.metric === "conversion") { const activeNames = new Set(workOrders.map(r => r.name.toLowerCase())); const converted = deals.filter(r => activeNames.has(r.name.toLowerCase())); value = deals.length ? Math.round((converted.length / deals.length) * 100) : 0; headline = `${value}% converted`; insight = `${converted.length} of ${deals.length} deals have a matching work order.`; sources = [...deals, ...converted].map(r => ({ board: r.board, itemId: r.id, itemName: r.name, field: "name", url: r.sourceUrl })); }
  const caveats: string[] = [];
  const dq = state.quality.deals;
  const wq = state.quality.workOrders;      if (dq.missing.closeDate) caveats.push(`${dq.missing.closeDate} of ${dq.total} deals lack a close date.`);
  if (dq.missing.value) caveats.push(`${dq.missing.value} of ${dq.total} deals lack a value.`);
  if (dq.missing.sector) caveats.push(`${dq.missing.sector} of ${dq.total} deals lack a sector.`);
  if (wq.missing.status) caveats.push(`${wq.missing.status} of ${wq.total} work orders lack a status.`);
  if (wq.missing.dueDate) caveats.push(`${wq.missing.dueDate} of ${wq.total} work orders lack a due date.`);
  if (wq.missing.value) caveats.push(`${wq.missing.value} of ${wq.total} work orders lack a value.`);
  if (state.quality.duplicateFlags) caveats.push(`${state.quality.duplicateFlags} likely duplicate item(s) flagged for review.`);
  return { headline, insight, value, sources, caveats, quality: state.quality, mode: state.mode, fetchedAt: state.fetchedAt };
}
async function narrate(question: string, result: ReturnType<typeof aggregate>) { const citations = result.sources.map((s, i) => `[${i + 1}] ${s.itemName} (${s.field ?? "item"})`).join("; "); try { const response = await invokeLLM({ messages: [{ role: "system", content: "Write 2 concise founder-readable sentences using only the supplied computed result. Include inline citations like [1] when sources exist. Never invent or recompute numbers. Mention caveats when present." }, { role: "user", content: JSON.stringify({ question, headline: result.headline, insight: result.insight, caveats: result.caveats, citations }) }] }); const content = response.choices?.[0]?.message?.content; if (typeof content === "string" && content.trim()) return content.trim(); } catch { /* deterministic narration below preserves the trust contract */ } return `${result.headline}. ${result.insight}${result.caveats.length ? ` Caveat: ${result.caveats.join(" ")}` : ""}${result.sources.length ? ` Sources: ${result.sources.slice(0, 3).map((_, i) => `[${i + 1}]`).join(" ")}.` : ""}`; }
/** Check if an entity value (sector, stage) exists in the live data. Returns the closest match or undefined. */
function findClosestEntity(value: string, knownList: string[]): string | undefined {
  const lower = value.toLowerCase();
  return knownList.find(k => {
    const kLow = k.toLowerCase();
    return lower.includes(kLow) || kLow.includes(lower);
  });
}

/** Get the list of sectors (or stages) present in the current cache. */
function getEntitiesInData(field: "sector" | "stage", state: CacheState): string[] {
  const values = new Set<string>();
  state.rows.forEach(r => { const v = r[field]; if (v) values.add(v); });
  return Array.from(values).sort();
}

export async function answerQuestion(question: string) {
  const state = await getData();
  let plan = heuristicPlan(question);

  // LLM plan override (if available)
  try {
    const response = await invokeLLM({ messages: [{ role: "system", content: "Return only JSON for a BI query plan with keys board, sector, stage, status, metric, clarification_needed. Never compute numbers." }, { role: "user", content: question }], response_format: { type: "json_schema", json_schema: { name: "bi_plan", strict: true, schema: { type: "object", properties: { board: { type: "string" }, sector: { type: ["string", "null"] }, stage: { type: ["string", "null"] }, status: { type: ["string", "null"] }, metric: { type: "string" }, clarification_needed: { type: ["string", "null"] } }, required: ["board", "sector", "stage", "status", "metric", "clarification_needed"], additionalProperties: false } } } });
    const content = response.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      const candidate = JSON.parse(content) as Partial<Plan>;
      const validMetrics = ["pipelineValue", "count", "averageValue", "stageBreakdown", "completionRate", "conversion"];
      const validBoards = ["deals", "workOrders", "both"];
      if (validMetrics.includes(String(candidate.metric)) && validBoards.includes(String(candidate.board)))
        plan = { ...plan, ...candidate } as Plan;
    }
  } catch { /* deterministic heuristic remains available when the LLM is unavailable */ }

  // --- Leadership update shortcut ---
  if (plan.clarification_needed === "__LEADERSHIP_UPDATE__") {
    return { plan: { ...plan, clarification_needed: undefined }, leadershipUpdate: leadershipUpdate(state), state };
  }

  // --- Entity validation: check if the sector exists in the data ---
  if (plan.sector) {
    const matchingSector = findClosestEntity(plan.sector, getEntitiesInData("sector", state));
    if (!matchingSector) {
      const available = getEntitiesInData("sector", state);
      return {
        plan,
        clarificationNeeded: `I don't see a "${plan.sector}" sector in the data. Did you mean one of: ${available.join(", ")}?`,
        state,
      };
    }
    plan.sector = matchingSector; // normalize to the actual value in the data
  }

  // --- Entity validation: check if the stage exists in the data ---
  if (plan.stage) {
    const matchingStage = findClosestEntity(plan.stage, getEntitiesInData("stage", state));
    if (!matchingStage) {
      const available = getEntitiesInData("stage", state);
      return {
        plan,
        clarificationNeeded: `I don't see a "${plan.stage}" stage in the data. Did you mean one of: ${available.join(", ")}?`,
        state,
      };
    }
    plan.stage = matchingStage;
  }

  // --- Clarification from planner ---
  if (plan.clarification_needed)
    return { plan, clarificationNeeded: plan.clarification_needed, state };

  const result = aggregate(plan, state);
  const narrative = await narrate(question, result);
  return { plan, result: { ...result, narrative }, state };
}
export function leadershipUpdate(state: CacheState) {
  const total = aggregate({ board: "deals", metric: "pipelineValue" }, state);
  const stages = aggregate({ board: "deals", metric: "stageBreakdown" }, state);
  const completion = aggregate({ board: "workOrders", metric: "completionRate" }, state);
  const conversion = aggregate({ board: "both", metric: "conversion" }, state);
  const dq = state.quality.deals;
  const wq = state.quality.workOrders;

  // Build clean prose for executive readout from underlying numbers
  const dealCount = state.rows.filter(r => r.board === "deals").length;
  const woCount = state.rows.filter(r => r.board === "workOrders").length;
  const pipelineVal = total.value;
  // Compute actual counts (not percentages) for the readout
  const completeCount = state.rows.filter(r => r.board === "workOrders" && (r.status ?? "").toLowerCase().includes("complete")).length;
  const woWithDeal = new Set(state.rows.filter(r => r.board === "workOrders").map(r => r.name.toLowerCase()));
  const convertedCount = state.rows.filter(r => r.board === "deals" && woWithDeal.has(r.name.toLowerCase())).length;
  const completionPct = woCount ? Math.round((completeCount / woCount) * 100) : 0;
  const conversionPct = dealCount ? Math.round((convertedCount / dealCount) * 100) : 0;

  const readoutLines: string[] = [];
  readoutLines.push(`The current portfolio spans ${dealCount} deals with a total pipeline of ${fmtINR(pipelineVal)}.`);
  readoutLines.push(`${completeCount} of ${woCount} work orders are marked complete (${completionPct}%).`);
  readoutLines.push(`${conversionPct}% of deals have a matching work order (${convertedCount} of ${dealCount}).`);

  // Data caveats — pull from ALL per-board quality (same as chat answers)
  const caveatLines: string[] = [];
  if (dq.missing.closeDate) caveatLines.push(`${dq.missing.closeDate} of ${dq.total} deals lack a close date.`);
  if (dq.missing.value) caveatLines.push(`${dq.missing.value} of ${dq.total} deals lack a value.`);
  if (dq.missing.sector) caveatLines.push(`${dq.missing.sector} of ${dq.total} deals lack a sector.`);
  if (wq.missing.status) caveatLines.push(`${wq.missing.status} of ${wq.total} work orders lack a status.`);
  if (wq.missing.dueDate) caveatLines.push(`${wq.missing.dueDate} of ${wq.total} work orders lack a due date.`);
  if (wq.missing.value) caveatLines.push(`${wq.missing.value} of ${wq.total} work orders lack a value.`);
  if (state.quality.duplicateFlags) caveatLines.push(`${state.quality.duplicateFlags} likely duplicate item(s) flagged for review.`);

  return `# Skylark BI Agent — Leadership Update\n\n_Generated ${new Date().toISOString()} · Source mode: ${state.mode.toUpperCase()} · Data fetched: ${state.fetchedAt}_\n\n## Validated performance\n\n- **Total pipeline:** ${total.headline}\n- **Pipeline by stage:** ${stages.headline}\n- **Work-order completion:** ${completion.headline}\n- **Deal-to-work-order conversion:** ${conversion.headline}\n\n## Executive readout\n\n${readoutLines.join(" ")}\n\n## Risks and next actions\n\n- Review blocked or incomplete work orders before the next operating review.\n- Resolve missing financial and date fields before using the figures for commitment decisions.\n- Use the linked source items in the dashboard to validate any high-value opportunity.\n\n## Data caveats\n\n${caveatLines.map(n => `- ${n}`).join("\n")}\n- This update is deterministic: values are calculated from normalized board records; language does not create or alter metrics.\n`;
}
