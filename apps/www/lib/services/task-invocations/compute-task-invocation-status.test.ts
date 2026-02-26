import { describe, expect, it } from "vitest";
import type { Id } from "@cmux/convex/dataModel";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import {
  computeTaskInvocationStatus,
  type TaskInvocationRun,
} from "./compute-task-invocation-status";

function makeRun({
  id,
  status,
  pullRequestState,
  errorMessage,
}: {
  id: string;
  status: TaskInvocationRun["status"];
  pullRequestState?: TaskInvocationRun["pullRequestState"];
  errorMessage?: string;
}): TaskInvocationRun {
  return {
    _id: typedZid("taskRuns").parse(id),
    status,
    ...(pullRequestState ? { pullRequestState } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  };
}

describe("computeTaskInvocationStatus", () => {
  const baseInput: {
    invocationId: string;
    teamSlugOrId: string;
    taskId: Id<"tasks">;
    taskRunIds: Id<"taskRuns">[];
    runs: TaskInvocationRun[];
    wwwOrigin: string;
    createdAt: number;
    updatedAt: number;
  } = {
    invocationId: "inv-1",
    teamSlugOrId: "team-alpha",
    taskId: typedZid("tasks").parse("task_1"),
    taskRunIds: [typedZid("taskRuns").parse("run_1")],
    runs: [],
    wwwOrigin: "https://cmux.example",
    createdAt: 100,
    updatedAt: 200,
  };

  it("returns starting when runs are pending/running and none completed", () => {
    const status = computeTaskInvocationStatus({
      ...baseInput,
      runs: [makeRun({ id: "run_1", status: "pending" })],
    });

    expect(status.phase).toBe("starting");
    expect(status.runCounts.pending).toBe(1);
    expect(status.prState).toBe("none");
  });

  it("returns commit_complete when at least one run completed and no PR exists", () => {
    const status = computeTaskInvocationStatus({
      ...baseInput,
      runs: [
        makeRun({ id: "run_1", status: "completed" }),
        makeRun({ id: "run_2", status: "running" }),
      ],
      taskRunIds: [
        typedZid("taskRuns").parse("run_1"),
        typedZid("taskRuns").parse("run_2"),
      ],
    });

    expect(status.phase).toBe("commit_complete");
    expect(status.runCounts.completed).toBe(1);
    expect(status.prState).toBe("none");
  });

  it("returns pr_complete when PR state is present", () => {
    const status = computeTaskInvocationStatus({
      ...baseInput,
      runs: [
        makeRun({
          id: "run_1",
          status: "completed",
          pullRequestState: "open",
        }),
      ],
    });

    expect(status.phase).toBe("pr_complete");
    expect(status.prState).toBe("open");
  });

  it("returns failed when all runs are terminal and none completed", () => {
    const status = computeTaskInvocationStatus({
      ...baseInput,
      runs: [
        makeRun({
          id: "run_1",
          status: "failed",
          errorMessage: "Build failed",
        }),
        makeRun({ id: "run_2", status: "skipped" }),
      ],
      taskRunIds: [
        typedZid("taskRuns").parse("run_1"),
        typedZid("taskRuns").parse("run_2"),
      ],
    });

    expect(status.phase).toBe("failed");
    expect(status.phaseReason).toContain("without a successful completion");
    expect(status.errors).toHaveLength(2);
  });

  it("returns failed with startError reason when start acknowledgement fails", () => {
    const status = computeTaskInvocationStatus({
      ...baseInput,
      startError: "Timed out waiting for start-task acknowledgement",
      runs: [],
    });

    expect(status.phase).toBe("failed");
    expect(status.phaseReason).toBe("Timed out waiting for start-task acknowledgement");
  });
});
