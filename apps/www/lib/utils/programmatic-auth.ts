import { getUserFromRequest } from "@/lib/utils/auth";
import { stackServerAppJs } from "@/lib/utils/stack";
import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { HTTPException } from "hono/http-exception";

const ACTOR_USER_ID_PATTERN = /^[a-zA-Z0-9:_-]{3,128}$/;
const ACTOR_SESSION_TTL_MS = 5 * 60 * 1000;

export type ProgrammaticAuthMode = "user" | "team_api_key";

export interface ProgrammaticAuthContext {
  authMode: ProgrammaticAuthMode;
  accessToken: string;
  authJson: {
    accessToken: string;
    refreshToken: string | null;
  };
  teamId?: string;
  actorUserId?: string;
}

export async function resolveProgrammaticAuth({
  req,
  teamSlugOrId,
}: {
  req: Request;
  teamSlugOrId: string;
}): Promise<ProgrammaticAuthContext> {
  const rawApiKeyHeader = req.headers.get("X-Stack-Api-Key");
  const hasExplicitApiKeyHeader = rawApiKeyHeader !== null;
  const explicitApiKey = rawApiKeyHeader?.trim();

  const user = await getUserFromRequest(req);

  if (user && !hasExplicitApiKeyHeader) {
    const authJson = await user.getAuthJson();
    const accessToken = authJson.accessToken;
    if (!accessToken) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    await verifyTeamAccess({
      accessToken,
      teamSlugOrId,
    });

    return {
      authMode: "user",
      accessToken,
      authJson: {
        accessToken,
        refreshToken: authJson.refreshToken ?? null,
      },
    };
  }

  const bearerToken = getBearerToken(req);

  let teamApiKey: string | undefined;
  if (hasExplicitApiKeyHeader) {
    if (!explicitApiKey) {
      throw new HTTPException(401, { message: "Invalid API key" });
    }
    teamApiKey = explicitApiKey;
  } else if (!user && bearerToken) {
    teamApiKey = bearerToken;
  }

  if (!teamApiKey) {
    if (user) {
      const authJson = await user.getAuthJson();
      const accessToken = authJson.accessToken;
      if (!accessToken) {
        throw new HTTPException(401, { message: "Unauthorized" });
      }

      await verifyTeamAccess({
        accessToken,
        teamSlugOrId,
      });

      return {
        authMode: "user",
        accessToken,
        authJson: {
          accessToken,
          refreshToken: authJson.refreshToken ?? null,
        },
      };
    }

    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const actorUserId = req.headers.get("X-Cmux-Actor-User-Id")?.trim();
  if (!actorUserId) {
    throw new HTTPException(400, {
      message: "Missing required header: X-Cmux-Actor-User-Id",
    });
  }

  if (!ACTOR_USER_ID_PATTERN.test(actorUserId)) {
    throw new HTTPException(400, {
      message: "Invalid X-Cmux-Actor-User-Id format",
    });
  }

  let teamFromApiKey = null;
  try {
    teamFromApiKey = await stackServerAppJs.getTeam({ apiKey: teamApiKey });
  } catch (error) {
    console.error("[programmatic-auth] Team API key validation failed", error);
    throw new HTTPException(401, { message: "Invalid API key" });
  }

  if (!teamFromApiKey) {
    throw new HTTPException(401, { message: "Invalid API key" });
  }

  const teamUsers = await teamFromApiKey.listUsers();
  const actorIsMember = teamUsers.some((member) => member.id === actorUserId);
  if (!actorIsMember) {
    throw new HTTPException(403, {
      message: "Forbidden: Actor user is not a member of this team",
    });
  }

  const actorUser = await stackServerAppJs.getUser(actorUserId);
  if (!actorUser) {
    throw new HTTPException(403, {
      message: "Forbidden: Actor user not found",
    });
  }

  const actorSession = await actorUser.createSession({
    expiresInMillis: ACTOR_SESSION_TTL_MS,
    isImpersonation: true,
  });
  const actorTokens = await actorSession.getTokens();
  if (!actorTokens.accessToken) {
    throw new HTTPException(500, {
      message: "Failed to mint actor access token",
    });
  }

  let resolvedTeam: Awaited<
    ReturnType<typeof verifyTeamAccess>
  > | null = null;
  try {
    resolvedTeam = await verifyTeamAccess({
      accessToken: actorTokens.accessToken,
      teamSlugOrId,
    });
  } catch (error) {
    if (error instanceof HTTPException && error.status === 404) {
      throw new HTTPException(403, {
        message: "Forbidden: Team API key does not match requested team",
      });
    }
    throw error;
  }

  if (!resolvedTeam || resolvedTeam.uuid !== teamFromApiKey.id) {
    throw new HTTPException(403, {
      message: "Forbidden: Team API key does not match requested team",
    });
  }

  return {
    authMode: "team_api_key",
    accessToken: actorTokens.accessToken,
    authJson: {
      accessToken: actorTokens.accessToken,
      refreshToken: actorTokens.refreshToken ?? null,
    },
    teamId: teamFromApiKey.id,
    actorUserId,
  };
}

function getBearerToken(req: Request): string | null {
  const authorization = req.headers.get("Authorization");
  if (!authorization) {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const token = match[1]?.trim();
  return token ? token : null;
}
