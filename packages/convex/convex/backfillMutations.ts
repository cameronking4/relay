/**
 * Run Stack → Convex backfill (users, teams, memberships). Call via:
 *   cd packages/convex && bunx convex run backfillMutations:runStackBackfill
 * Use when team picker shows "Not a member" or "Timed out while syncing" — syncs
 * existing Stack Auth data into Convex so membership checks pass.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation } from "./_generated/server";

export const runStackBackfill = mutation({
  args: {
    users: v.optional(v.boolean()),
    teams: v.optional(v.boolean()),
    memberships: v.optional(v.boolean()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.backfill.backfillFromStack, {
      users: args.users ?? true,
      teams: args.teams ?? true,
      memberships: args.memberships ?? true,
      dryRun: args.dryRun ?? false,
    });
    return { scheduled: true };
  },
});
