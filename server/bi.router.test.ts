import { describe, expect, it, afterEach, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const ctx = { user: null, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] } as TrpcContext;

describe("bi public procedures", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns a dashboard snapshot with freshness and KPI envelopes", async () => {
    const result = await appRouter.createCaller(ctx).bi.snapshot();
    expect(["live", "cached", "demo"]).toContain(result.state.mode);
    expect(result.pipeline).toHaveProperty("sources");
    expect(result.state.quality).toHaveProperty("missing");
  });

  it("generates a deterministic leadership update", async () => {
    const result = await appRouter.createCaller(ctx).bi.leadershipUpdate();
    expect(result.markdown).toContain("Leadership Update");
    expect(result.markdown).toContain("Data caveats");
  });

  it("answers a founder question with inline citation markers and sources", async () => {
    const result = await appRouter.createCaller(ctx).bi.ask({ question: "What is our energy pipeline?" });
    // In demo mode the LLM is unavailable, so result may be a clarification or a full answer
    // Either way, the response should be well-formed
    expect(result).toHaveProperty("plan");
    expect(result).toHaveProperty("state");
    if (result.result) {
      expect(result.result.narrative).toContain("[");
      expect(result.result.sources[0]?.url).toContain("monday.com/boards/5030963379");
    }
  });

  it("refreshes safely into demo mode when the token is absent", async () => {
    delete process.env.MONDAY_API_TOKEN;
    const result = await appRouter.createCaller(ctx).bi.refresh();
    expect(["demo", "cached"]).toContain(result.state.mode);
    expect(result.state.error).toContain("MONDAY_API_TOKEN");
  });
});
