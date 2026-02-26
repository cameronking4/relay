import type { StartTask, TaskError } from "@cmux/shared";
import { env } from "@/lib/utils/www-env";
import { connectMainServer } from "./connect-main-server";

const START_TASK_ACK_TIMEOUT_MS = 20_000;

export interface StartTaskInvocationInput {
  invocationId: string;
  authToken: string;
  authJson?: unknown;
  teamSlugOrId: string;
  payload: StartTask;
}

export interface StartTaskInvocationResult {
  ackError?: string;
}

export async function startTaskInvocation({
  invocationId,
  authToken,
  authJson,
  teamSlugOrId,
  payload,
}: StartTaskInvocationInput): Promise<StartTaskInvocationResult> {
  const socket = await connectMainServer({
    serverOrigin: env.NEXT_PUBLIC_SERVER_ORIGIN,
    authToken,
    teamSlugOrId,
    authJson,
  });

  try {
    const ack = await emitStartTask(socket, payload);

    if (isTaskError(ack)) {
      return { ackError: ack.error };
    }

    return {};
  } catch (error) {
    console.error("[task-invocations.start] Failed to emit start-task", {
      invocationId,
      error,
    });
    const message =
      error instanceof Error ? error.message : "Unknown start-task error";
    return { ackError: message };
  } finally {
    socket.disconnect();
    console.info("[task-invocations.start] Socket disconnected", {
      invocationId,
    });
  }
}

async function emitStartTask(
  socket: Awaited<ReturnType<typeof connectMainServer>>,
  payload: StartTask,
): Promise<unknown> {
  return await new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error("Timed out waiting for start-task acknowledgement"));
    }, START_TASK_ACK_TIMEOUT_MS);

    socket.emit("start-task", payload, (ack: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(ack);
    });
  });
}

function isTaskError(value: unknown): value is TaskError {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const taskId = Reflect.get(value, "taskId");
  const error = Reflect.get(value, "error");
  return typeof taskId === "string" && typeof error === "string";
}
