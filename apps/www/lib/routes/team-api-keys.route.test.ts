import { describe, expect, it } from "vitest";
import { honoTestFetch } from "@/lib/utils/hono-test-fetch";

describe("teamApiKeysRouter", () => {
  it("rejects unauthenticated list requests", async () => {
    const response = await honoTestFetch(
      "http://localhost/api/teams/demo/auth/team-api-keys",
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(401);
  });

  it("rejects unauthenticated create requests", async () => {
    const response = await honoTestFetch(
      "http://localhost/api/teams/demo/auth/team-api-keys",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          description: "Automation key",
          expiresAt: null,
        }),
      },
    );

    expect(response.status).toBe(401);
  });

  it("validates malformed create payloads", async () => {
    const response = await honoTestFetch(
      "http://localhost/api/teams/demo/auth/team-api-keys",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          description: "",
        }),
      },
    );

    expect(response.status).toBe(400);
  });

  it("rejects unauthenticated revoke requests", async () => {
    const response = await honoTestFetch(
      "http://localhost/api/teams/demo/auth/team-api-keys/key_123",
      {
        method: "DELETE",
      },
    );

    expect(response.status).toBe(401);
  });
});
