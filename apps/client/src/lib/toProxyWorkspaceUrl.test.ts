import { describe, expect, it } from "vitest";
import { toMorphXtermBaseUrl } from "./toProxyWorkspaceUrl";

describe("toMorphXtermBaseUrl", () => {
  it("rewrites direct Morph URLs to cmux proxy URLs", () => {
    const input =
      "https://port-39378-morphvm-v2j67ci0.http.cloud.morph.so/?folder=/root/workspace";

    const output = toMorphXtermBaseUrl(input);

    expect(output).toBe("https://cmux-v2j67ci0-base-39383.cmux.app/");
  });

  it("returns null for non-Morph URLs", () => {
    const output = toMorphXtermBaseUrl("https://relay-client-taupe.vercel.app");
    expect(output).toBeNull();
  });
});
