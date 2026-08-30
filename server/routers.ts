import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { aggregate, answerQuestion, getData, leadershipUpdate, refreshData } from "./biEngine";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  bi: router({
    snapshot: publicProcedure.query(async () => {
      const state = await getData();
      return {
        state,
        pipeline: aggregate({ board: "deals", metric: "pipelineValue" }, state),
        stageBreakdown: aggregate({ board: "deals", metric: "stageBreakdown" }, state),
        completion: aggregate({ board: "workOrders", metric: "completionRate" }, state),
        conversion: aggregate({ board: "both", metric: "conversion" }, state),
      };
    }),
    refresh: publicProcedure.mutation(async () => {
      const state = await refreshData();
      return { state };
    }),
    ask: publicProcedure.input(z.object({ question: z.string().min(2).max(600) })).mutation(async ({ input }) => answerQuestion(input.question)),
    leadershipUpdate: publicProcedure.query(async () => {
      const state = await getData();
      return { markdown: leadershipUpdate(state), state };
    }),
  }),
});

export type AppRouter = typeof appRouter;
