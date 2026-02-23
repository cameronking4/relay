import { env } from "./www-env";

export function isGitHubAppConfigured(): boolean {
  return !!(env.CMUX_GITHUB_APP_ID && env.CMUX_GITHUB_APP_PRIVATE_KEY);
}

/** Resolved private key; empty when GitHub App is not configured. Only use when isGitHubAppConfigured() is true. */
export const githubPrivateKey =
  env.CMUX_GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n") ?? "";
