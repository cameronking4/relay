import { describe, expect, it } from "vitest";
import { honoTestFetch } from "@/lib/utils/hono-test-fetch";

describe("taskInvocationsRouter", () => {
  it("rejects unauthenticated POST requests", async () => {
    const response = await honoTestFetch(
      "http://localhost/api/teams/demo/task-invocations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: "hello",
          clis: ["codex/gpt-5.3-codex-xhigh"],
          target: {
            repoUrl: "https://github.com/example/repo.git",
            projectFullName: "example/repo",
          },
        }),
      },
    );

    expect(response.status).toBe(401);
  });

  it("rejects unauthenticated status requests", async () => {
    const response = await honoTestFetch(
      "http://localhost/api/teams/demo/task-invocations/invocation-1",
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(401);
  });

  it("rejects unauthenticated wait requests", async () => {
    const response = await honoTestFetch(
      "http://localhost/api/teams/demo/task-invocations/invocation-1/wait",
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(401);
  });
});
