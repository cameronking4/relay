import { getConvex } from "@/lib/utils/get-convex";
import { getUserFromRequest } from "@/lib/utils/auth";
import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { env } from "@/lib/utils/www-env";
import {
  computeTaskInvocationStatus,
  type TaskInvocationRun,
  type TaskInvocationStatusResponse,
} from "@/lib/services/task-invocations/compute-task-invocation-status";
import { startTaskInvocation } from "@/lib/services/task-invocations/start-task-invocation";
import { waitTaskInvocationStatus } from "@/lib/services/task-invocations/wait-task-invocation-status";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { AGENT_CONFIGS, normalizeOrigin, type StartTask } from "@cmux/shared";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createHash, randomUUID } from "node:crypto";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

export const taskInvocationsRouter = new OpenAPIHono();

const RepoTargetSchema = z
  .object({
    repoUrl: z.string().url(),
    projectFullName: z.string().trim().min(3),
    branch: z.string().trim().min(1).optional(),
  })
  .openapi("TaskInvocationRepoTarget");

const EnvironmentTargetSchema = z
  .object({
    environmentId: z.string().trim().min(1),
  })
  .openapi("TaskInvocationEnvironmentTarget");

const StartTaskInvocationBodySchema = z
  .object({
    prompt: z.string().trim().min(1),
    clis: z.array(z.string().trim().min(1)).min(1),
    target: z.union([RepoTargetSchema, EnvironmentTargetSchema]),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .openapi("StartTaskInvocationBody");

const RunCountsSchema = z.object({
  pending: z.number(),
  running: z.number(),
  completed: z.number(),
  failed: z.number(),
  skipped: z.number(),
});

const TaskInvocationErrorSchema = z.object({
  taskRunId: z.string(),
  agentName: z.string().optional(),
  message: z.string(),
});

const TaskInvocationLinksSchema = z.object({
  task: z.string(),
  firstRun: z.string().optional(),
  status: z.string(),
  wait: z.string(),
});

const TaskInvocationStatusSchema = z
  .object({
    invocationId: z.string(),
    taskId: z.string(),
    taskRunIds: z.array(z.string()),
    phase: z.enum(["starting", "failed", "commit_complete", "pr_complete"]),
    phaseReason: z.string().optional(),
    runCounts: RunCountsSchema,
    prState: z.enum(["none", "draft", "open", "merged", "closed", "unknown"]),
    errors: z.array(TaskInvocationErrorSchema),
    links: TaskInvocationLinksSchema,
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .openapi("TaskInvocationStatus");

const WaitTaskInvocationQuerySchema = z
  .object({
    until: z.enum(["commit_complete", "pr_complete"]).optional().default("commit_complete"),
    timeoutSeconds: z.coerce.number().int().min(1).max(55).optional().default(30),
    pollMs: z.coerce.number().int().min(500).max(5000).optional().default(2000),
  })
  .openapi("WaitTaskInvocationQuery");

const WaitTaskInvocationResponseSchema = TaskInvocationStatusSchema.extend({
  timedOut: z.boolean(),
}).openapi("WaitTaskInvocationResponse");

const TaskInvocationParamsSchema = z.object({
  teamSlugOrId: z.string(),
  invocationId: z.string(),
});

const StartTaskInvocationParamsSchema = z.object({
  teamSlugOrId: z.string(),
});

const ErrorResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
});

taskInvocationsRouter.openapi(
  createRoute({
    method: "post",
    path: "/teams/{teamSlugOrId}/task-invocations",
    tags: ["Tasks"],
    summary: "Start a task programmatically",
    request: {
      params: StartTaskInvocationParamsSchema,
      body: {
        content: {
          "application/json": {
            schema: StartTaskInvocationBodySchema,
          },
        },
        required: true,
      },
    },
    responses: {
      202: {
        description: "Task invocation accepted",
        content: {
          "application/json": {
            schema: TaskInvocationStatusSchema,
          },
        },
      },
      400: {
        description: "Invalid request",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
      401: { description: "Unauthorized" },
      409: {
        description: "Idempotency conflict",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
      500: { description: "Failed to start invocation" },
    },
  }),
  async (c) => {
    const user = await getUserFromRequest(c.req.raw);
    if (!user) {
      return c.json({ code: 401, message: "Unauthorized" }, 401);
    }

    const authJson = await user.getAuthJson();
    const accessToken = authJson.accessToken;
    if (!accessToken) {
      return c.json({ code: 401, message: "Unauthorized" }, 401);
    }

    const { teamSlugOrId } = c.req.valid("param");
    const body = c.req.valid("json");

    await verifyTeamAccess({
      req: c.req.raw,
      accessToken,
      teamSlugOrId,
    });

    const allowedClis = new Set(AGENT_CONFIGS.map((agent) => agent.name));
    const invalidCli = body.clis.find((cli) => !allowedClis.has(cli));
    if (invalidCli) {
      return c.json(
        {
          code: 400,
          message: `Unknown cli "${invalidCli}". Must match configured agent names.`,
        },
        400,
      );
    }

    const idempotencyKeyHeader = c.req.header("Idempotency-Key");
    const idempotencyKey =
      idempotencyKeyHeader && idempotencyKeyHeader.trim().length > 0
        ? idempotencyKeyHeader.trim()
        : body.idempotencyKey;

    const invocationId = randomUUID();
    const requestHash = hashInvocationRequest({
      prompt: body.prompt,
      clis: body.clis,
      target: body.target,
    });

    const convex = getConvex({ accessToken });

    let createOrReuseResult: {
      invocationId: string;
      reused: boolean;
      taskId?: Id<"tasks">;
      taskRunIds?: Id<"taskRuns">[];
      startError?: string;
      createdAt: number;
      updatedAt: number;
    };

    try {
      createOrReuseResult = await convex.mutation(api.taskInvocations.createOrReuse, {
        teamSlugOrId,
        invocationId,
        idempotencyKey,
        requestHash,
      });
    } catch (error) {
      console.error("[task-invocations] createOrReuse failed", {
        invocationId,
        teamSlugOrId,
        error,
      });
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message.includes("Idempotency key already used")) {
        return c.json({ code: 409, message }, 409);
      }
      throw error;
    }

    const resolvedInvocationId = createOrReuseResult.invocationId;
    const wwwOrigin = resolveWwwOrigin(c.req.raw);

    if (createOrReuseResult.reused && createOrReuseResult.taskId) {
      const status = await getTaskInvocationStatus({
        convex,
        teamSlugOrId,
        invocationId: resolvedInvocationId,
        wwwOrigin,
      });
      return c.json(status, 202);
    }

    let createdTaskId: Id<"tasks"> | undefined;
    let createdTaskRunIds: Id<"taskRuns">[] = [];

    try {
      const isEnvironmentTarget = "environmentId" in body.target;
      const environmentId = isEnvironmentTarget
        ? typedZid("environments").parse(body.target.environmentId)
        : undefined;

      const createdTask = await convex.mutation(api.tasks.create, {
        teamSlugOrId,
        text: body.prompt,
        ...(isEnvironmentTarget
          ? { environmentId }
          : {
              projectFullName: body.target.projectFullName,
              baseBranch: body.target.branch,
            }),
        selectedAgents: body.clis,
      });

      createdTaskId = createdTask.taskId;
      createdTaskRunIds = createdTask.taskRunIds ?? [];

      await convex.mutation(api.taskInvocations.attachTask, {
        teamSlugOrId,
        invocationId: resolvedInvocationId,
        taskId: createdTask.taskId,
        taskRunIds: createdTaskRunIds,
      });

      const startPayload = buildStartTaskPayload({
        taskId: createdTask.taskId,
        taskRunIds: createdTaskRunIds,
        clis: body.clis,
        prompt: body.prompt,
        target: body.target,
      });

      const startResult = await startTaskInvocation({
        invocationId: resolvedInvocationId,
        authToken: accessToken,
        authJson,
        teamSlugOrId,
        payload: startPayload,
      });

      if (startResult.ackError) {
        await convex.mutation(api.taskInvocations.markStartError, {
          teamSlugOrId,
          invocationId: resolvedInvocationId,
          error: startResult.ackError,
        });
      } else {
        await convex.mutation(api.taskInvocations.markStartAcked, {
          teamSlugOrId,
          invocationId: resolvedInvocationId,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown start error";
      await convex
        .mutation(api.taskInvocations.markStartError, {
          teamSlugOrId,
          invocationId: resolvedInvocationId,
          error: message,
        })
        .catch((markError) => {
          console.error("[task-invocations] Failed to record start error", {
            invocationId: resolvedInvocationId,
            error: markError,
          });
        });

      console.error("[task-invocations] Start failed", {
        invocationId: resolvedInvocationId,
        taskId: createdTaskId,
        taskRunCount: createdTaskRunIds.length,
        error,
      });
    }

    const status = await getTaskInvocationStatus({
      convex,
      teamSlugOrId,
      invocationId: resolvedInvocationId,
      wwwOrigin,
    });

    return c.json(status, 202);
  },
);

taskInvocationsRouter.openapi(
  createRoute({
    method: "get",
    path: "/teams/{teamSlugOrId}/task-invocations/{invocationId}",
    tags: ["Tasks"],
    summary: "Get task invocation status",
    request: {
      params: TaskInvocationParamsSchema,
    },
    responses: {
      200: {
        description: "Task invocation status",
        content: {
          "application/json": {
            schema: TaskInvocationStatusSchema,
          },
        },
      },
      401: { description: "Unauthorized" },
      404: {
        description: "Invocation not found",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  }),
  async (c) => {
    const user = await getUserFromRequest(c.req.raw);
    if (!user) {
      return c.json({ code: 401, message: "Unauthorized" }, 401);
    }

    const authJson = await user.getAuthJson();
    const accessToken = authJson.accessToken;
    if (!accessToken) {
      return c.json({ code: 401, message: "Unauthorized" }, 401);
    }

    const { teamSlugOrId, invocationId } = c.req.valid("param");
    await verifyTeamAccess({
      req: c.req.raw,
      accessToken,
      teamSlugOrId,
    });

    const convex = getConvex({ accessToken });
    const wwwOrigin = resolveWwwOrigin(c.req.raw);

    try {
      const status = await getTaskInvocationStatus({
        convex,
        teamSlugOrId,
        invocationId,
        wwwOrigin,
      });
      return c.json(status, 200);
    } catch (error) {
      console.error("[task-invocations] status lookup failed", {
        invocationId,
        teamSlugOrId,
        error,
      });
      if (error instanceof HTTPException && error.status === 404) {
        return c.json({ code: 404, message: "Invocation not found" }, 404);
      }
      throw error;
    }
  },
);

taskInvocationsRouter.openapi(
  createRoute({
    method: "get",
    path: "/teams/{teamSlugOrId}/task-invocations/{invocationId}/wait",
    tags: ["Tasks"],
    summary: "Wait for task invocation status",
    request: {
      params: TaskInvocationParamsSchema,
      query: WaitTaskInvocationQuerySchema,
    },
    responses: {
      200: {
        description: "Task invocation status after waiting",
        content: {
          "application/json": {
            schema: WaitTaskInvocationResponseSchema,
          },
        },
      },
      401: { description: "Unauthorized" },
      404: {
        description: "Invocation not found",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  }),
  async (c) => {
    const user = await getUserFromRequest(c.req.raw);
    if (!user) {
      return c.json({ code: 401, message: "Unauthorized" }, 401);
    }

    const authJson = await user.getAuthJson();
    const accessToken = authJson.accessToken;
    if (!accessToken) {
      return c.json({ code: 401, message: "Unauthorized" }, 401);
    }

    const { teamSlugOrId, invocationId } = c.req.valid("param");
    const query = c.req.valid("query");
    await verifyTeamAccess({
      req: c.req.raw,
      accessToken,
      teamSlugOrId,
    });

    const convex = getConvex({ accessToken });
    const wwwOrigin = resolveWwwOrigin(c.req.raw);

    try {
      const waitResult = await waitTaskInvocationStatus({
        until: query.until,
        timeoutSeconds: query.timeoutSeconds,
        pollMs: query.pollMs,
        fetchStatus: async () =>
          await getTaskInvocationStatus({
            convex,
            teamSlugOrId,
            invocationId,
            wwwOrigin,
          }),
      });
      return c.json(
        {
          ...waitResult.status,
          timedOut: waitResult.timedOut,
        },
        200,
      );
    } catch (error) {
      console.error("[task-invocations] wait lookup failed", {
        invocationId,
        teamSlugOrId,
        error,
      });
      if (error instanceof HTTPException && error.status === 404) {
        return c.json({ code: 404, message: "Invocation not found" }, 404);
      }
      throw error;
    }
  },
);

function buildStartTaskPayload({
  taskId,
  taskRunIds,
  clis,
  prompt,
  target,
}: {
  taskId: Id<"tasks">;
  taskRunIds: Id<"taskRuns">[];
  clis: string[];
  prompt: string;
  target: z.infer<typeof StartTaskInvocationBodySchema>["target"];
}): StartTask {
  const isEnvironmentTarget = "environmentId" in target;
  const environmentId = isEnvironmentTarget
    ? typedZid("environments").parse(target.environmentId)
    : undefined;

  const basePayload: StartTask = {
    taskId,
    taskRunIds,
    selectedAgents: clis,
    taskDescription: prompt,
    projectFullName: isEnvironmentTarget
      ? `env:${target.environmentId}`
      : target.projectFullName,
    isCloudMode: true,
    ...(isEnvironmentTarget ? { environmentId } : {}),
    ...(!isEnvironmentTarget ? { repoUrl: target.repoUrl } : {}),
    ...(!isEnvironmentTarget && target.branch ? { branch: target.branch } : {}),
  };

  return basePayload;
}

async function getTaskInvocationStatus({
  convex,
  teamSlugOrId,
  invocationId,
  wwwOrigin,
}: {
  convex: ReturnType<typeof getConvex>;
  teamSlugOrId: string;
  invocationId: string;
  wwwOrigin: string;
}): Promise<TaskInvocationStatusResponse> {
  const invocation = await convex.query(api.taskInvocations.getByInvocationId, {
    teamSlugOrId,
    invocationId,
  });

  if (!invocation) {
    throw new HTTPException(404, { message: "Invocation not found" });
  }

  let runs: TaskInvocationRun[] = [];
  if (invocation.taskId) {
    const runTree = await convex.query(api.taskRuns.getByTask, {
      teamSlugOrId,
      taskId: invocation.taskId,
      includeArchived: true,
    });
    runs = flattenTaskRuns(runTree);
  }

  return computeTaskInvocationStatus({
    invocationId: invocation.invocationId,
    teamSlugOrId,
    taskId: invocation.taskId,
    taskRunIds: invocation.taskRunIds,
    startError: invocation.startError,
    runs,
    wwwOrigin,
    createdAt: invocation.createdAt,
    updatedAt: invocation.updatedAt,
  });
}

function flattenTaskRuns(
  runTree: Array<TaskInvocationRun & { children?: Array<TaskInvocationRun & { children?: unknown[] }> }>,
): TaskInvocationRun[] {
  const flattened: TaskInvocationRun[] = [];
  const stack: Array<TaskInvocationRun & { children?: Array<TaskInvocationRun & { children?: unknown[] }> }> = [...runTree];

  while (stack.length > 0) {
    const run = stack.pop();
    if (!run) {
      continue;
    }
    flattened.push(run);

    if (run.children && run.children.length > 0) {
      stack.push(...run.children);
    }
  }

  return flattened;
}

function hashInvocationRequest(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
    )
    .join(",")}}`;
}

function resolveWwwOrigin(req: Request): string {
  const requestOrigin = new URL(req.url).origin;
  return normalizeOrigin(env.NEXT_PUBLIC_WWW_ORIGIN ?? requestOrigin);
}
