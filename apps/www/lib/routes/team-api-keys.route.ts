import { getUserFromRequest } from "@/lib/utils/auth";
import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

export const teamApiKeysRouter = new OpenAPIHono();

const TeamParamsSchema = z.object({
  teamSlugOrId: z.string().trim().min(1),
});

const TeamApiKeyParamsSchema = TeamParamsSchema.extend({
  keyId: z.string().trim().min(1),
});

const TeamApiKeyMetadataSchema = z
  .object({
    id: z.string(),
    description: z.string(),
    lastFour: z.string(),
    createdAt: z.string(),
    expiresAt: z.string().nullable(),
    status: z.enum(["active", "revoked", "expired"]),
  })
  .openapi("TeamApiKeyMetadata");

const ListTeamApiKeysResponseSchema = z
  .object({
    keys: z.array(TeamApiKeyMetadataSchema),
  })
  .openapi("ListTeamApiKeysResponse");

const CreateTeamApiKeyBodySchema = z
  .object({
    description: z.string().trim().min(1).max(120),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .openapi("CreateTeamApiKeyBody");

const CreateTeamApiKeyResponseSchema = z
  .object({
    key: TeamApiKeyMetadataSchema.extend({
      value: z.string(),
    }),
  })
  .openapi("CreateTeamApiKeyResponse");

const RevokeTeamApiKeyResponseSchema = z
  .object({
    revoked: z.boolean(),
    keyId: z.string(),
  })
  .openapi("RevokeTeamApiKeyResponse");

const ErrorResponseSchema = z
  .object({
    code: z.number(),
    message: z.string(),
  })
  .openapi("TeamApiKeyError");

teamApiKeysRouter.openapi(
  createRoute({
    method: "get",
    path: "/teams/{teamSlugOrId}/auth/team-api-keys",
    tags: ["Teams"],
    summary: "List team API keys",
    request: {
      params: TeamParamsSchema,
    },
    responses: {
      200: {
        description: "Team API keys",
        content: {
          "application/json": {
            schema: ListTeamApiKeysResponseSchema,
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
      403: {
        description: "Forbidden",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  }),
  async (c) => {
    const { teamSlugOrId } = c.req.valid("param");
    let context: Awaited<ReturnType<typeof resolveTeamApiKeyContext>>;
    try {
      context = await resolveTeamApiKeyContext(c.req.raw, teamSlugOrId);
    } catch (error) {
      if (error instanceof HTTPException) {
        const message = error.message || "Unauthorized";
        if (error.status === 401) {
          return c.json({ code: 401, message }, 401);
        }
        if (error.status === 403 || error.status === 404) {
          return c.json({ code: 403, message }, 403);
        }
      }
      throw error;
    }

    const keys = await context.team.listApiKeys();

    return c.json(
      {
        keys: keys.map((key) => ({
          ...toTeamApiKeyMetadata({
            id: key.id,
            description: key.description,
            createdAt: key.createdAt,
            expiresAt: key.expiresAt,
            lastFour: key.value.lastFour,
            status: resolveApiKeyStatus(key.whyInvalid()),
          }),
        })),
      },
      200,
    );
  },
);

teamApiKeysRouter.openapi(
  createRoute({
    method: "post",
    path: "/teams/{teamSlugOrId}/auth/team-api-keys",
    tags: ["Teams"],
    summary: "Create a team API key",
    request: {
      params: TeamParamsSchema,
      body: {
        content: {
          "application/json": {
            schema: CreateTeamApiKeyBodySchema,
          },
        },
        required: true,
      },
    },
    responses: {
      201: {
        description: "Created team API key",
        content: {
          "application/json": {
            schema: CreateTeamApiKeyResponseSchema,
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
      403: {
        description: "Forbidden",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  }),
  async (c) => {
    const { teamSlugOrId } = c.req.valid("param");
    const body = c.req.valid("json");
    let context: Awaited<ReturnType<typeof resolveTeamApiKeyContext>>;
    try {
      context = await resolveTeamApiKeyContext(c.req.raw, teamSlugOrId);
    } catch (error) {
      if (error instanceof HTTPException) {
        const message = error.message || "Unauthorized";
        if (error.status === 401) {
          return c.json({ code: 401, message }, 401);
        }
        if (error.status === 403 || error.status === 404) {
          return c.json({ code: 403, message }, 403);
        }
      }
      throw error;
    }

    const createdKey = await context.team.createApiKey({
      description: body.description,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    });

    return c.json(
      {
        key: {
          ...toTeamApiKeyMetadata({
            id: createdKey.id,
            description: createdKey.description,
            createdAt: createdKey.createdAt,
            expiresAt: createdKey.expiresAt,
            lastFour: createdKey.value.slice(-4),
            status: resolveApiKeyStatus(createdKey.whyInvalid()),
          }),
          value: createdKey.value,
        },
      },
      201,
    );
  },
);

teamApiKeysRouter.openapi(
  createRoute({
    method: "delete",
    path: "/teams/{teamSlugOrId}/auth/team-api-keys/{keyId}",
    tags: ["Teams"],
    summary: "Revoke a team API key",
    request: {
      params: TeamApiKeyParamsSchema,
    },
    responses: {
      200: {
        description: "Team API key revoked",
        content: {
          "application/json": {
            schema: RevokeTeamApiKeyResponseSchema,
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
      403: {
        description: "Forbidden",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
      404: {
        description: "API key not found",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  }),
  async (c) => {
    const { teamSlugOrId, keyId } = c.req.valid("param");
    let context: Awaited<ReturnType<typeof resolveTeamApiKeyContext>>;
    try {
      context = await resolveTeamApiKeyContext(c.req.raw, teamSlugOrId);
    } catch (error) {
      if (error instanceof HTTPException) {
        const message = error.message || "Unauthorized";
        if (error.status === 401) {
          return c.json({ code: 401, message }, 401);
        }
        if (error.status === 403 || error.status === 404) {
          return c.json({ code: 403, message }, 403);
        }
      }
      throw error;
    }

    const keys = await context.team.listApiKeys();
    const key = keys.find((candidate) => candidate.id === keyId);
    if (!key) {
      return c.json({ code: 404, message: "API key not found" }, 404);
    }

    await key.revoke();

    return c.json(
      {
        revoked: true,
        keyId,
      },
      200,
    );
  },
);

async function resolveTeamApiKeyContext(req: Request, teamSlugOrId: string) {
  const user = await getUserFromRequest(req);
  if (!user) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const authJson = await user.getAuthJson();
  const accessToken = authJson.accessToken;
  if (!accessToken) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const verifiedTeam = await verifyTeamAccess({
    accessToken,
    teamSlugOrId,
  });

  const userTeams = await user.listTeams();
  const team = userTeams.find((candidate) => candidate.id === verifiedTeam.uuid);
  if (!team) {
    throw new HTTPException(403, {
      message: "Forbidden: Not a member of this team",
    });
  }

  return { team };
}

function toTeamApiKeyMetadata({
  id,
  description,
  lastFour,
  createdAt,
  expiresAt,
  status,
}: {
  id: string;
  description: string;
  lastFour: string;
  createdAt: Date;
  expiresAt?: Date;
  status: "active" | "revoked" | "expired";
}) {
  return {
    id,
    description,
    lastFour,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    status,
  };
}

function resolveApiKeyStatus(
  reason: "manually-revoked" | "expired" | null,
): "active" | "revoked" | "expired" {
  if (reason === "manually-revoked") {
    return "revoked";
  }
  if (reason === "expired") {
    return "expired";
  }
  return "active";
}
