"use node";

import {
  StackAdminApp,
  type ServerTeam,
  type ServerTeamUser,
  type ServerUser,
} from "@stackframe/js";
import { v } from "convex/values";
import { env } from "../_shared/convex-env";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

type BackfillArgs = {
  users?: boolean;
  teams?: boolean;
  memberships?: boolean;
  pageSize?: number;
  includeAnonymous?: boolean;
  dryRun?: boolean;
};

function requireEnv(name: keyof typeof env): string {
  const val = env[name];
  if (!val) throw new Error(`Missing required env: ${String(name)}`);
  return String(val);
}

export const backfillFromStack = internalAction({
  args: {
    users: v.optional(v.boolean()),
    teams: v.optional(v.boolean()),
    memberships: v.optional(v.boolean()),
    pageSize: v.optional(v.number()),
    includeAnonymous: v.optional(v.boolean()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args: BackfillArgs) => {
    const doUsers = args.users ?? true;
    const doTeams = args.teams ?? true;
    const doMemberships = args.memberships ?? true;
    const pageSize = Math.max(1, Math.min(args.pageSize ?? 200, 500));
    const includeAnonymous = args.includeAnonymous ?? false;
    const dryRun = args.dryRun ?? false;

    const projectId = requireEnv("NEXT_PUBLIC_STACK_PROJECT_ID");
    const publishableClientKey = requireEnv(
      "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY",
    );
    const secretServerKey = requireEnv("STACK_SECRET_SERVER_KEY");
    const superSecretAdminKey = requireEnv("STACK_SUPER_SECRET_ADMIN_KEY");

    const admin = new StackAdminApp({
      tokenStore: "memory",
      projectId,
      publishableClientKey,
      secretServerKey,
      superSecretAdminKey,
    });

    const out = {
      usersProcessed: 0,
      teamsProcessed: 0,
      membershipsProcessed: 0,
    };

    // Backfill users
    if (doUsers) {
      let cursor: string | undefined = undefined;
      for (;;) {
        const page = (await admin.listUsers({
          cursor,
          limit: pageSize,
          includeAnonymous,
        })) as ServerUser[] & { nextCursor: string | null };

        for (const u of page) {
          out.usersProcessed += 1;
          if (dryRun) continue;
          // Map SDK user -> Convex upsert args
          await ctx.runMutation(internal.stack.upsertUser, {
            id: u.id,
            primaryEmail: u.primaryEmail ?? undefined,
            primaryEmailVerified: u.primaryEmailVerified,
            // SDK exposes deprecated emailAuthEnabled; use that.
            primaryEmailAuthEnabled:
              (u as unknown as { emailAuthEnabled?: boolean })
                .emailAuthEnabled ?? false,
            displayName: u.displayName ?? undefined,
            selectedTeamId: u.selectedTeam?.id ?? undefined,
            selectedTeamDisplayName: u.selectedTeam?.displayName ?? undefined,
            selectedTeamProfileImageUrl:
              u.selectedTeam?.profileImageUrl ?? undefined,
            profileImageUrl: u.profileImageUrl ?? undefined,
            signedUpAtMillis: u.signedUpAt.getTime(),
            lastActiveAtMillis: u.lastActiveAt.getTime(),
            hasPassword: u.hasPassword,
            otpAuthEnabled: u.otpAuthEnabled,
            passkeyAuthEnabled: u.passkeyAuthEnabled,
            clientMetadata: u.clientMetadata,
            clientReadOnlyMetadata: u.clientReadOnlyMetadata,
            serverMetadata: (u as unknown as { serverMetadata?: unknown })
              .serverMetadata,
            isAnonymous: u.isAnonymous,
            // oauthProviders in SDK lacks accountId/email on list; skip
          });
        }

        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
    }

    // Backfill teams
    let teams: ServerTeam[] = [];
    if (doTeams || doMemberships) {
      const list = await admin.listTeams();
      teams = list as ServerTeam[];
    }
    if (doTeams) {
      for (const t of teams) {
        out.teamsProcessed += 1;
        if (dryRun) continue;
        await ctx.runMutation(internal.stack.upsertTeam, {
          id: t.id,
          displayName: t.displayName ?? undefined,
          profileImageUrl: t.profileImageUrl ?? undefined,
          clientMetadata: t.clientMetadata,
          clientReadOnlyMetadata: t.clientReadOnlyMetadata,
          serverMetadata: (t as unknown as { serverMetadata?: unknown })
            .serverMetadata,
          createdAtMillis: t.createdAt.getTime(),
        });
      }
    }

    // Backfill memberships
    if (doMemberships) {
      for (const t of teams) {
        const members = (await t.listUsers()) as ServerTeamUser[];
        for (const m of members) {
          out.membershipsProcessed += 1;
          if (dryRun) continue;
          await ctx.runMutation(internal.stack.ensureMembership, {
            teamId: t.id,
            userId: m.id,
          });
        }
      }
    }

    return out;
  },
});

// runStackBackfill mutation moved to backfillMutations.ts (Convex mutations cannot live in "use node" files).
