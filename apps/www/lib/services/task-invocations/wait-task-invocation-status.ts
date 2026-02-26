import type {
  TaskInvocationPhase,
  TaskInvocationStatusResponse,
} from "./compute-task-invocation-status";

export interface WaitTaskInvocationStatusInput {
  until: Extract<TaskInvocationPhase, "commit_complete" | "pr_complete">;
  timeoutSeconds: number;
  pollMs: number;
  fetchStatus: () => Promise<TaskInvocationStatusResponse>;
}

export interface WaitTaskInvocationStatusResult {
  status: TaskInvocationStatusResponse;
  timedOut: boolean;
}

export async function waitTaskInvocationStatus({
  until,
  timeoutSeconds,
  pollMs,
  fetchStatus,
}: WaitTaskInvocationStatusInput): Promise<WaitTaskInvocationStatusResult> {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  let latestStatus = await fetchStatus();

  while (Date.now() < deadline) {
    if (hasReachedPhase(latestStatus.phase, until)) {
      return { status: latestStatus, timedOut: false };
    }

    await delay(pollMs);
    latestStatus = await fetchStatus();
  }

  return {
    status: latestStatus,
    timedOut: !hasReachedPhase(latestStatus.phase, until),
  };
}

function hasReachedPhase(
  current: TaskInvocationPhase,
  target: Extract<TaskInvocationPhase, "commit_complete" | "pr_complete">,
): boolean {
  if (target === "commit_complete") {
    return (
      current === "commit_complete" || current === "pr_complete" || current === "failed"
    );
  }

  return current === "pr_complete" || current === "failed";
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
