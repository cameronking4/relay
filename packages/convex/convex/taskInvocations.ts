import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import type { Id } from "./_generated/dataModel";
import { authMutation, authQuery } from "./users/utils";

export const createOrReuse = authMutation({
  args: {
    teamSlugOrId: v.string(),
    invocationId: v.string(),
    idempotencyKey: v.optional(v.string()),
    requestHash: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const now = Date.now();

    if (args.idempotencyKey) {
      const existingByIdempotency = await ctx.db
        .query("taskInvocations")
        .withIndex("by_team_user_idempotency", (q) =>
          q
            .eq("teamId", teamId)
            .eq("userId", userId)
            .eq("idempotencyKey", args.idempotencyKey),
        )
        .first();

      if (existingByIdempotency) {
        if (existingByIdempotency.requestHash !== args.requestHash) {
          throw new Error(
            "Idempotency key already used with a different request payload",
          );
        }

        return {
          invocationId: existingByIdempotency.invocationId,
          reused: true,
          taskId: existingByIdempotency.taskId,
          taskRunIds: existingByIdempotency.taskRunIds,
          startError: existingByIdempotency.startError,
          createdAt: existingByIdempotency.createdAt,
          updatedAt: existingByIdempotency.updatedAt,
        };
      }
    }

    const existingByInvocationId = await ctx.db
      .query("taskInvocations")
      .withIndex("by_team_invocation", (q) =>
        q.eq("teamId", teamId).eq("invocationId", args.invocationId),
      )
      .first();

    if (existingByInvocationId) {
      if (existingByInvocationId.userId !== userId) {
        throw new Error("Invocation ID already exists");
      }
      if (existingByInvocationId.requestHash !== args.requestHash) {
        throw new Error("Invocation ID already used with different payload");
      }
      return {
        invocationId: existingByInvocationId.invocationId,
        reused: true,
        taskId: existingByInvocationId.taskId,
        taskRunIds: existingByInvocationId.taskRunIds,
        startError: existingByInvocationId.startError,
        createdAt: existingByInvocationId.createdAt,
        updatedAt: existingByInvocationId.updatedAt,
      };
    }

    await ctx.db.insert("taskInvocations", {
      invocationId: args.invocationId,
      teamId,
      userId,
      idempotencyKey: args.idempotencyKey,
      requestHash: args.requestHash,
      createdAt: now,
      updatedAt: now,
    });

    return {
      invocationId: args.invocationId,
      reused: false,
      createdAt: now,
      updatedAt: now,
    };
  },
});

export const attachTask = authMutation({
  args: {
    teamSlugOrId: v.string(),
    invocationId: v.string(),
    taskId: v.id("tasks"),
    taskRunIds: v.array(v.id("taskRuns")),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const invocation = await ctx.db
      .query("taskInvocations")
      .withIndex("by_team_invocation", (q) =>
        q.eq("teamId", teamId).eq("invocationId", args.invocationId),
      )
      .first();

    if (!invocation || invocation.userId !== userId) {
      throw new Error("Invocation not found");
    }

    await ctx.db.patch(invocation._id, {
      taskId: args.taskId,
      taskRunIds: args.taskRunIds,
      updatedAt: Date.now(),
    });
  },
});

export const markStartAcked = authMutation({
  args: {
    teamSlugOrId: v.string(),
    invocationId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const invocation = await ctx.db
      .query("taskInvocations")
      .withIndex("by_team_invocation", (q) =>
        q.eq("teamId", teamId).eq("invocationId", args.invocationId),
      )
      .first();

    if (!invocation || invocation.userId !== userId) {
      throw new Error("Invocation not found");
    }

    await ctx.db.patch(invocation._id, {
      startAckedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const markStartError = authMutation({
  args: {
    teamSlugOrId: v.string(),
    invocationId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const invocation = await ctx.db
      .query("taskInvocations")
      .withIndex("by_team_invocation", (q) =>
        q.eq("teamId", teamId).eq("invocationId", args.invocationId),
      )
      .first();

    if (!invocation || invocation.userId !== userId) {
      throw new Error("Invocation not found");
    }

    await ctx.db.patch(invocation._id, {
      startError: args.error,
      updatedAt: Date.now(),
    });
  },
});

export const getByInvocationId = authQuery({
  args: {
    teamSlugOrId: v.string(),
    invocationId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const invocation = await ctx.db
      .query("taskInvocations")
      .withIndex("by_team_invocation", (q) =>
        q.eq("teamId", teamId).eq("invocationId", args.invocationId),
      )
      .first();

    if (!invocation || invocation.userId !== userId) {
      return null;
    }

    return invocation;
  },
});

export type TaskInvocationId = string;
export type TaskInvocationTaskId = Id<"tasks">;
