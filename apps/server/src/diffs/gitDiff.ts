import type { ReplaceDiffEntry } from "@cmux/shared/diff-types";

import { gitDiff as nativeGitDiff } from "../native/git";
import { RepositoryManager } from "../repositoryManager";
import { getGitHubOAuthToken } from "../utils/getGitHubToken";
import { serverLogger } from "../utils/fileLogger";
import { getProjectPaths } from "../workspace";
import { computeEntriesBetweenRefs } from "./parseGitDiff";

export interface GitDiffRequest {
  headRef: string;
  baseRef?: string;
  repoFullName?: string;
  repoUrl?: string;
  teamSlugOrId?: string;
  originPathOverride?: string;
  includeContents?: boolean;
  maxBytes?: number;
  lastKnownBaseSha?: string;
  lastKnownMergeCommitSha?: string;
}

/**
 * Construct an authenticated GitHub URL by embedding the OAuth token.
 * This allows the native git operations to access private repositories.
 */
function buildAuthenticatedGitHubUrl(
  repoFullName: string,
  token: string
): string {
  return `https://oauth:${token}@github.com/${repoFullName}.git`;
}

const GIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const SPECIAL_GIT_REFS = new Set([
  "HEAD",
  "FETCH_HEAD",
  "MERGE_HEAD",
  "ORIG_HEAD",
]);

function stripUrlCredentials(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function refToBranch(ref: string | undefined): string | undefined {
  if (!ref) {
    return undefined;
  }
  const trimmed = ref.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("refs/heads/")) {
    return trimmed.slice("refs/heads/".length);
  }
  if (trimmed.startsWith("refs/remotes/origin/")) {
    return trimmed.slice("refs/remotes/origin/".length);
  }
  if (trimmed.startsWith("origin/")) {
    return trimmed.slice("origin/".length);
  }
  if (
    trimmed.startsWith("refs/") ||
    SPECIAL_GIT_REFS.has(trimmed) ||
    GIT_SHA_PATTERN.test(trimmed) ||
    trimmed.includes("@{")
  ) {
    return undefined;
  }
  return trimmed;
}

async function resolveFallbackRepoPath(args: {
  request: GitDiffRequest;
  effectiveRepoUrl?: string;
  headRef: string;
  baseRef: string;
}): Promise<string | null> {
  const { request, effectiveRepoUrl, headRef, baseRef } = args;
  if (request.originPathOverride) {
    return request.originPathOverride;
  }
  if (!effectiveRepoUrl || !request.teamSlugOrId) {
    return null;
  }

  const cleanRepoUrl = request.repoFullName
    ? `https://github.com/${request.repoFullName}.git`
    : stripUrlCredentials(effectiveRepoUrl);

  const projectPaths = await getProjectPaths(cleanRepoUrl, request.teamSlugOrId);
  const repoManager = RepositoryManager.getInstance();
  const headBranch = refToBranch(headRef);
  const baseBranch = refToBranch(baseRef);

  await repoManager.ensureRepository(
    effectiveRepoUrl,
    projectPaths.originPath,
    headBranch,
    cleanRepoUrl
  );

  if (baseBranch && baseBranch !== headBranch) {
    await repoManager.ensureRepository(
      effectiveRepoUrl,
      projectPaths.originPath,
      baseBranch,
      cleanRepoUrl
    );
  }

  return projectPaths.originPath;
}

export async function getGitDiff(
  request: GitDiffRequest
): Promise<ReplaceDiffEntry[]> {
  const headRef = request.headRef.trim();
  if (!headRef) {
    return [];
  }

  const baseRef = request.baseRef?.trim();

  // Determine the final repoUrl to use
  let effectiveRepoUrl = request.repoUrl;
  let effectiveRepoFullName = request.repoFullName;

  // If we have repoFullName but no originPathOverride or explicit repoUrl,
  // try to inject GitHub OAuth credentials for private repo access.
  // This is especially important in web mode where repos need to be cloned.
  if (
    request.repoFullName &&
    !request.originPathOverride &&
    !request.repoUrl
  ) {
    try {
      const token = await getGitHubOAuthToken();
      if (token) {
        effectiveRepoUrl = buildAuthenticatedGitHubUrl(
          request.repoFullName,
          token
        );
        // Clear repoFullName since we're using repoUrl with embedded credentials
        effectiveRepoFullName = undefined;
      }
    } catch (error) {
      console.error(
        `[getGitDiff] Failed to get GitHub OAuth token for ${request.repoFullName}:`,
        error
      );
      // Non-fatal: if token fetch fails, fall back to unauthenticated access
      // This will work for public repos
      serverLogger.warn(
        `[getGitDiff] Failed to get GitHub OAuth token for ${request.repoFullName}: ${String(error)}`
      );
    }
  }

  const nativeRequest = {
    headRef,
    baseRef: baseRef ? baseRef : undefined,
    repoFullName: effectiveRepoFullName,
    repoUrl: effectiveRepoUrl,
    teamSlugOrId: request.teamSlugOrId,
    originPathOverride: request.originPathOverride,
    includeContents: request.includeContents,
    maxBytes: request.maxBytes,
    lastKnownBaseSha: request.lastKnownBaseSha,
    lastKnownMergeCommitSha: request.lastKnownMergeCommitSha,
  };

  try {
    return await nativeGitDiff(nativeRequest);
  } catch (nativeError) {
    console.error("[getGitDiff] Native gitDiff failed:", nativeError);
    serverLogger.warn(
      `[getGitDiff] Native gitDiff failed, attempting JS fallback: ${String(nativeError)}`
    );

    if (!baseRef) {
      throw nativeError;
    }

    const fallbackRepoUrl =
      effectiveRepoUrl ||
      (request.repoFullName
        ? `https://github.com/${request.repoFullName}.git`
        : undefined);

    try {
      const repoPath = await resolveFallbackRepoPath({
        request,
        effectiveRepoUrl: fallbackRepoUrl,
        headRef,
        baseRef,
      });

      if (!repoPath) {
        throw nativeError;
      }

      const fallbackEntries = await computeEntriesBetweenRefs({
        repoPath,
        ref1: baseRef,
        ref2: headRef,
        includeContents: request.includeContents,
        maxBytes: request.maxBytes,
      });

      serverLogger.info(
        `[getGitDiff] JS fallback succeeded for ${baseRef}..${headRef} at ${repoPath}`
      );
      return fallbackEntries;
    } catch (fallbackError) {
      console.error("[getGitDiff] JS fallback failed:", fallbackError);
      throw fallbackError;
    }
  }
}
