import type { Doc, Id } from "@cmux/convex/dataModel";
import {
  aggregatePullRequestState,
  type RunPullRequestState,
  type StoredPullRequestInfo,
} from "@cmux/shared/pull-request-state";

export type TaskInvocationPhase =
  | "starting"
  | "failed"
  | "commit_complete"
  | "pr_complete";

export interface TaskInvocationStatusResponse {
  invocationId: string;
  taskId: string;
  taskRunIds: string[];
  phase: TaskInvocationPhase;
  phaseReason?: string;
  runCounts: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    skipped: number;
  };
  prState: RunPullRequestState;
  errors: Array<{
    taskRunId: string;
    agentName?: string;
    message: string;
  }>;
  links: {
    task: string;
    firstRun?: string;
    status: string;
    wait: string;
  };
  createdAt: number;
  updatedAt: number;
}

export type TaskInvocationRun = Pick<
  Doc<"taskRuns">,
  | "_id"
  | "status"
  | "agentName"
  | "errorMessage"
  | "environmentError"
  | "pullRequestState"
  | "pullRequests"
>;

export interface ComputeTaskInvocationStatusInput {
  invocationId: string;
  teamSlugOrId: string;
  taskId: Id<"tasks"> | undefined;
  taskRunIds: Id<"taskRuns">[] | undefined;
  startError?: string;
  runs: TaskInvocationRun[];
  wwwOrigin: string;
  createdAt: number;
  updatedAt: number;
}

export function computeTaskInvocationStatus(
  input: ComputeTaskInvocationStatusInput,
): TaskInvocationStatusResponse {
  const runCounts = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  };

  for (const run of input.runs) {
    if (run.status === "pending") {
      runCounts.pending += 1;
      continue;
    }
    if (run.status === "running") {
      runCounts.running += 1;
      continue;
    }
    if (run.status === "completed") {
      runCounts.completed += 1;
      continue;
    }
    if (run.status === "failed") {
      runCounts.failed += 1;
      continue;
    }
    if (run.status === "skipped") {
      runCounts.skipped += 1;
    }
  }

  const prState = derivePullRequestState(input.runs);
  const errors = collectRunErrors(input.runs);
  const phase = derivePhase({
    startError: input.startError,
    runCounts,
    prState,
  });

  const phaseReason = derivePhaseReason({
    phase,
    startError: input.startError,
    runCounts,
  });

  const teamSegment = encodeURIComponent(input.teamSlugOrId);
  const taskId = input.taskId ? String(input.taskId) : "";
  const encodedTaskId = encodeURIComponent(taskId);
  const firstRunId = input.taskRunIds?.[0] ? String(input.taskRunIds[0]) : undefined;
  const encodedFirstRunId = firstRunId ? encodeURIComponent(firstRunId) : undefined;

  const links = {
    task: `${input.wwwOrigin}/${teamSegment}/task/${encodedTaskId}`,
    ...(encodedFirstRunId
      ? {
          firstRun: `${input.wwwOrigin}/${teamSegment}/task/${encodedTaskId}/run/${encodedFirstRunId}`,
        }
      : {}),
    status: `${input.wwwOrigin}/api/teams/${teamSegment}/task-invocations/${encodeURIComponent(
      input.invocationId,
    )}`,
    wait: `${input.wwwOrigin}/api/teams/${teamSegment}/task-invocations/${encodeURIComponent(
      input.invocationId,
    )}/wait`,
  };

  return {
    invocationId: input.invocationId,
    taskId,
    taskRunIds: (input.taskRunIds ?? []).map(String),
    phase,
    ...(phaseReason ? { phaseReason } : {}),
    runCounts,
    prState,
    errors,
    links,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function derivePullRequestState(runs: readonly TaskInvocationRun[]): RunPullRequestState {
  const firstWithPullRequests = runs.find(
    (run) => Boolean(run.pullRequests && run.pullRequests.length > 0),
  );

  if (firstWithPullRequests?.pullRequests && firstWithPullRequests.pullRequests.length > 0) {
    const pullRequests: StoredPullRequestInfo[] = firstWithPullRequests.pullRequests.map(
      (record) => ({
        repoFullName: record.repoFullName,
        url: record.url,
        number: record.number,
        state: record.state,
        isDraft: record.isDraft,
      }),
    );
    const aggregate = aggregatePullRequestState(pullRequests);
    return aggregate.state;
  }

  const firstWithPrState = runs.find(
    (run) =>
      run.pullRequestState !== undefined && run.pullRequestState !== "none",
  );

  return firstWithPrState?.pullRequestState ?? "none";
}

function collectRunErrors(
  runs: readonly TaskInvocationRun[],
): TaskInvocationStatusResponse["errors"] {
  const errors: TaskInvocationStatusResponse["errors"] = [];

  for (const run of runs) {
    if (run.status !== "failed" && run.status !== "skipped") {
      continue;
    }

    const messages: string[] = [];
    if (run.errorMessage) {
      messages.push(run.errorMessage);
    }
    if (run.environmentError?.maintenanceError) {
      messages.push(run.environmentError.maintenanceError);
    }
    if (run.environmentError?.devError) {
      messages.push(run.environmentError.devError);
    }

    const message =
      messages.length > 0
        ? messages.join(" | ")
        : run.status === "skipped"
          ? "Task run skipped"
          : "Task run failed";

    errors.push({
      taskRunId: String(run._id),
      ...(run.agentName ? { agentName: run.agentName } : {}),
      message,
    });
  }

  return errors;
}

function derivePhase({
  startError,
  runCounts,
  prState,
}: {
  startError?: string;
  runCounts: TaskInvocationStatusResponse["runCounts"];
  prState: RunPullRequestState;
}): TaskInvocationPhase {
  if (startError) {
    return "failed";
  }

  if (
    prState === "draft" ||
    prState === "open" ||
    prState === "merged" ||
    prState === "closed"
  ) {
    return "pr_complete";
  }

  if (runCounts.completed > 0) {
    return "commit_complete";
  }

  if (runCounts.pending > 0 || runCounts.running > 0) {
    return "starting";
  }

  return "failed";
}

function derivePhaseReason({
  phase,
  startError,
  runCounts,
}: {
  phase: TaskInvocationPhase;
  startError?: string;
  runCounts: TaskInvocationStatusResponse["runCounts"];
}): string | undefined {
  if (phase !== "failed") {
    return undefined;
  }

  if (startError) {
    return startError;
  }

  if (
    runCounts.pending === 0 &&
    runCounts.running === 0 &&
    runCounts.completed === 0 &&
    (runCounts.failed > 0 || runCounts.skipped > 0)
  ) {
    return "All task runs finished without a successful completion";
  }

  return "Task invocation failed";
}
