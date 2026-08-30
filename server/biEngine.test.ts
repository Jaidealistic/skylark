import { describe, expect, it, beforeEach, vi } from "vitest";
import { aggregate, answerQuestion, getData, heuristicPlan, normalize, quality, refreshData } from "./biEngine";

describe("Skylark BI engine", () => {
  beforeEach(() => { delete process.env.MONDAY_API_TOKEN; });

  it("returns a visible demo fallback when monday credentials are absent", async () => {
    const state = await refreshData();
    expect(state.mode).toBe("demo");
    expect(state.rows.length).toBeGreaterThan(0);
    expect(state.error).toContain("MONDAY_API_TOKEN");
  });

  it("computes pipeline value deterministically and cites contributing items", async () => {
    const state = await getData();
    const result = aggregate({ board: "deals", metric: "pipelineValue", sector: "energy sector" }, state);
    expect(result.value).toBe(50500000);
    expect(result.sources.length).toBe(2);
    expect(result.sources.every(source => source.field === "value")).toBe(true);
  });

  it("uses a clarification branch for undefined quarter semantics", () => {
    expect(heuristicPlan("How did we do this quarter?").clarification_needed).toContain("fiscal calendar");
  });

  it("supports cross-board conversion deterministically", async () => {
    const state = await getData();
    const result = aggregate({ board: "both", metric: "conversion" }, state);
    expect(result.value).toBe(75);
    expect(result.insight).toContain("matching work order");
  });

  it("returns an answer envelope with a narrative and evidence", async () => {
    const response = await answerQuestion("How healthy are work orders?");
    expect(response.result?.headline).toContain("complete");
    expect(response.result?.narrative).toBeTruthy();
    expect(response.result?.sources.length).toBeGreaterThan(0);
  });

  it("canonicalizes sector labels and preserves ISO dates", () => {
    const rows = [{ id: "x", name: "X", board: "deals" as const, sector: " energy sector ", closeDate: "2026-08-30", sourceUrl: "https://monday.com/x", raw: {} }];
    const normalized = normalize(rows);
    expect(normalized[0]?.sector).toBe("Energy");
    expect(normalized[0]?.closeDate).toBe("2026-08-30");
  });

  it("reports field-level quality counts without filling missing values", async () => {
    const state = await getData();
    const report = quality(state.rows);
    expect(report.missing).toHaveProperty("value");
    expect(report.notes.length).toBeGreaterThan(0);
  });

  it.each([
    [401, "valid read-only monday.com token"],
    [403, "valid read-only monday.com token"],
    [429, "rate limit reached"],
  ])("classifies monday.com HTTP %s failures", async (status, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
    process.env.MONDAY_API_TOKEN = "test-token";
    const state = await refreshData();
    expect(state.error).toContain(expected);
    vi.unstubAllGlobals();
  });

  it("classifies network timeouts without crashing", async () => {
    const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));
    process.env.MONDAY_API_TOKEN = "test-token";
    const state = await refreshData();
    expect(state.error).toContain("timed out");
    vi.unstubAllGlobals();
  });
});
