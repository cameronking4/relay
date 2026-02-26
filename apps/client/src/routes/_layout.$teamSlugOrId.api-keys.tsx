import { FloatingPane } from "@/components/floating-pane";
import { TitleBar } from "@/components/TitleBar";
import { stackClientApp } from "@/lib/stack";
import { WWW_ORIGIN } from "@/lib/wwwOrigin";
import { AGENT_CONFIGS } from "@cmux/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useUser } from "@stackframe/react";
import { AlertTriangle, Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

const TeamApiKeyMetadataSchema = z.object({
  id: z.string(),
  description: z.string(),
  lastFour: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  status: z.enum(["active", "revoked", "expired"]),
});

const ListTeamApiKeysResponseSchema = z.object({
  keys: z.array(TeamApiKeyMetadataSchema),
});

const TeamApiKeyWithValueSchema = TeamApiKeyMetadataSchema.extend({
  value: z.string(),
});

const CreateTeamApiKeyResponseSchema = z.object({
  key: TeamApiKeyWithValueSchema,
});

type TeamApiKeyWithValue = z.infer<typeof TeamApiKeyWithValueSchema>;
type ListTeamApiKeysResponse = z.infer<typeof ListTeamApiKeysResponseSchema>;
type CreateTeamApiKeyResponse = z.infer<typeof CreateTeamApiKeyResponseSchema>;
type ExpiryPreset = "never" | "1h" | "24h" | "7d" | "30d" | "90d" | "365d";

const EXPIRY_PRESET_OPTIONS: Array<{ value: ExpiryPreset; label: string }> = [
  { value: "never", label: "Never" },
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "365d", label: "1 year" },
];

function isExpiryPreset(value: string): value is ExpiryPreset {
  return EXPIRY_PRESET_OPTIONS.some((option) => option.value === value);
}

export const Route = createFileRoute("/_layout/$teamSlugOrId/api-keys")({
  component: ApiKeysPage,
});

function ApiKeysPage() {
  const { teamSlugOrId } = Route.useParams();
  const stackUser = useUser({ or: "return-null" });
  const queryClient = useQueryClient();
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [description, setDescription] = useState("");
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>("never");
  const [createdKey, setCreatedKey] = useState<TeamApiKeyWithValue | null>(null);

  const queryKey = useMemo(
    () => ["team-api-keys", teamSlugOrId] as const,
    [teamSlugOrId],
  );

  const teamApiKeysQuery = useQuery({
    queryKey,
    queryFn: async () => await fetchTeamApiKeys(teamSlugOrId),
  });

  const createKeyMutation = useMutation({
    mutationFn: async () => {
      return await createTeamApiKey({
        teamSlugOrId,
        description,
        expiresAt: resolveExpiryIsoDate(expiryPreset),
      });
    },
    onSuccess: async (response) => {
      setCreatedKey(response.key);
      setDescription("");
      setExpiryPreset("never");
      setShowCreatePanel(false);
      toast.success("Team API key created");
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to create API key",
      );
    },
  });

  const revokeKeyMutation = useMutation({
    mutationFn: async (keyId: string) => {
      await revokeTeamApiKey({ teamSlugOrId, keyId });
    },
    onSuccess: async () => {
      toast.success("Team API key revoked");
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to revoke API key",
      );
    },
  });

  const handleCreateKey = async () => {
    if (description.trim().length === 0) {
      toast.error("Description is required");
      return;
    }
    await createKeyMutation.mutateAsync();
  };

  const encodedTeam = encodeURIComponent(teamSlugOrId);
  const invocationBase = `${WWW_ORIGIN}/api/teams/${encodedTeam}/task-invocations`;
  const actorUserId = stackUser?.id ?? "<stack_user_id>";
  const idempotencyKey = useMemo(() => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `cmux-${Date.now()}`;
  }, []);
  const availableClisComment = `# Available clis: ${AGENT_CONFIGS.map((agent) => agent.name).join(", ")}`;
  const idempotencyComment = "# Generate your own idempotency key: uuidgen  (or: node -e \"console.log(crypto.randomUUID())\")";

  const startSnippet = `${availableClisComment}
${idempotencyComment}
curl -X POST '${invocationBase}' \\
  -H 'X-Stack-Api-Key: <team_api_key>' \\
  -H 'X-Cmux-Actor-User-Id: ${actorUserId}' \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: ${idempotencyKey}' \\
  -d '{
    "prompt": "Implement a health check endpoint and tests",
    "clis": ["codex/gpt-5.3-codex-xhigh", "claude/opus-4.6"],
    "target": {
      "repoUrl": "https://github.com/owner/repo.git",
      "projectFullName": "owner/repo",
      "branch": "main"
    }
  }'`;

  const statusSnippet = `curl '${invocationBase}/<invocationId>' \\
  -H 'X-Stack-Api-Key: <team_api_key>' \\
  -H 'X-Cmux-Actor-User-Id: ${actorUserId}'`;

  const waitSnippet = `curl '${invocationBase}/<invocationId>/wait?until=commit_complete&timeoutSeconds=30&pollMs=2000' \\
  -H 'X-Stack-Api-Key: <team_api_key>' \\
  -H 'X-Cmux-Actor-User-Id: ${actorUserId}'`;

  return (
    <FloatingPane header={<TitleBar title="API Keys" />}>
      <div className="max-w-5xl mx-auto w-full p-4 md:p-6 space-y-6">
        <section className="bg-white dark:bg-neutral-950 rounded-lg border border-neutral-200 dark:border-neutral-800">
          <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-neutral-700 dark:text-neutral-300" />
                <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  Team API Keys
                </h2>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                Create and revoke keys used for programmatic task invocation.
              </p>
            </div>
            <button
              onClick={() => setShowCreatePanel((current) => !current)}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Create key
            </button>
          </div>

          {showCreatePanel && (
            <div className="p-4 border-b border-neutral-200 dark:border-neutral-800 space-y-3 bg-neutral-50 dark:bg-neutral-900/50">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                    Description
                  </label>
                  <input
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="CI automation key"
                    className="w-full px-3 py-2 text-sm rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                    Expiry
                  </label>
                  <select
                    value={expiryPreset}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (isExpiryPreset(value)) {
                        setExpiryPreset(value);
                      }
                    }}
                    className="w-full px-3 py-2 text-sm rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100"
                  >
                    {EXPIRY_PRESET_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleCreateKey()}
                  disabled={createKeyMutation.isPending}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 disabled:opacity-50"
                >
                  {createKeyMutation.isPending ? "Creating..." : "Create key"}
                </button>
                <button
                  onClick={() => setShowCreatePanel(false)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {createdKey && (
            <div className="m-4 rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-3">
              <div className="flex items-start gap-2 text-amber-900 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div className="space-y-2 w-full">
                  <p className="text-xs font-medium">
                    Copy this API key now. It is only shown once.
                  </p>
                  <div className="rounded-md border border-amber-300 dark:border-amber-900 bg-white dark:bg-neutral-950 px-3 py-2 flex items-center justify-between gap-2">
                    <code className="text-xs break-all text-neutral-800 dark:text-neutral-200">
                      {createdKey.value}
                    </code>
                    <button
                      onClick={() => void copyText(createdKey.value, "API key copied")}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300"
                    >
                      <Copy className="w-3 h-3" />
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
                  <th className="px-4 py-2.5 font-medium">Description</th>
                  <th className="px-4 py-2.5 font-medium">Last 4</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5 font-medium">Expires</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {teamApiKeysQuery.isLoading && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-4 text-neutral-500 dark:text-neutral-400"
                    >
                      Loading API keys...
                    </td>
                  </tr>
                )}
                {teamApiKeysQuery.isError && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-4 text-red-600 dark:text-red-400"
                    >
                      {teamApiKeysQuery.error instanceof Error
                        ? teamApiKeysQuery.error.message
                        : "Failed to load API keys"}
                    </td>
                  </tr>
                )}
                {!teamApiKeysQuery.isLoading &&
                  !teamApiKeysQuery.isError &&
                  (teamApiKeysQuery.data?.keys.length ?? 0) === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-6 text-neutral-500 dark:text-neutral-400"
                      >
                        No team API keys yet.
                      </td>
                    </tr>
                  )}
                {(teamApiKeysQuery.data?.keys ?? []).map((key) => (
                  <tr
                    key={key.id}
                    className="border-b border-neutral-200 dark:border-neutral-800 last:border-0"
                  >
                    <td className="px-4 py-3 text-neutral-900 dark:text-neutral-100">
                      {key.description}
                    </td>
                    <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">
                      {key.lastFour}
                    </td>
                    <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">
                      {formatDate(key.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">
                      {key.expiresAt ? formatDate(key.expiresAt) : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          key.status === "active"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : key.status === "expired"
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                              : "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                        }`}
                      >
                        {key.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => revokeKeyMutation.mutate(key.id)}
                        disabled={
                          key.status !== "active" || revokeKeyMutation.isPending
                        }
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 disabled:opacity-40"
                      >
                        <Trash2 className="w-3 h-3" />
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-white dark:bg-neutral-950 rounded-lg border border-neutral-200 dark:border-neutral-800">
          <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
            <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              Programmatic Invocation (Recommended)
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
              Preferred and stable for automation.
            </p>
          </div>
          <div className="p-4 space-y-4">
            <div className="inline-flex items-center gap-2 rounded-md border border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-950/30 px-3 py-2 text-xs text-green-800 dark:text-green-300">
              <Check className="w-3.5 h-3.5" />
              Use team API keys with actor attribution headers for programmatic calls.
            </div>
            <SnippetBlock
              label="Start invocation"
              snippet={startSnippet}
            />
            <SnippetBlock
              label="Get status"
              snippet={statusSnippet}
            />
            <SnippetBlock
              label="Wait for completion target"
              snippet={waitSnippet}
            />
          </div>
        </section>

        <section className="bg-white dark:bg-neutral-950 rounded-lg border border-neutral-200 dark:border-neutral-800">
          <details className="group">
            <summary className="list-none cursor-pointer px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
              <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                Legacy compatibility
              </span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400 group-open:hidden">
                Expand
              </span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400 hidden group-open:inline">
                Collapse
              </span>
            </summary>
            <div className="p-4 text-xs text-neutral-600 dark:text-neutral-300 space-y-2">
              <p>Bearer token support remains available for backward compatibility.</p>
              <p>Use Team API keys for all new integrations and automation flows.</p>
            </div>
          </details>
        </section>

        <section className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40 p-4 text-xs text-neutral-600 dark:text-neutral-300">
          Need provider keys for coding models? Configure those in{" "}
          <Link
            to="/$teamSlugOrId/settings"
            params={{ teamSlugOrId }}
            className="text-neutral-900 dark:text-neutral-100 underline underline-offset-2"
          >
            Settings
          </Link>
          .
        </section>
      </div>
    </FloatingPane>
  );
}

function SnippetBlock({ label, snippet }: { label: string; snippet: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
          {label}
        </p>
        <button
          onClick={() => void copyText(snippet, "Snippet copied")}
          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-[11px] text-neutral-700 dark:text-neutral-300"
        >
          <Copy className="w-3 h-3" />
          Copy
        </button>
      </div>
      <pre className="text-[11px] leading-5 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md p-3 overflow-x-auto text-neutral-700 dark:text-neutral-300">
        <code>{snippet}</code>
      </pre>
    </div>
  );
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleString();
}

function resolveExpiryIsoDate(preset: ExpiryPreset): string | null {
  if (preset === "never") {
    return null;
  }

  const now = Date.now();
  const offsetsMs: Record<Exclude<ExpiryPreset, "never">, number> = {
    "1h": 1 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
    "365d": 365 * 24 * 60 * 60 * 1000,
  };

  return new Date(now + offsetsMs[preset]).toISOString();
}

async function copyText(value: string, successMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  } catch (error) {
    console.error("Failed to copy text", error);
    toast.error("Failed to copy");
  }
}

async function fetchTeamApiKeys(
  teamSlugOrId: string,
): Promise<ListTeamApiKeysResponse> {
  const response = await fetchWithUserAuth(
    `${WWW_ORIGIN}/api/teams/${encodeURIComponent(teamSlugOrId)}/auth/team-api-keys`,
    {
      method: "GET",
    },
  );

  return ListTeamApiKeysResponseSchema.parse(await response.json());
}

async function createTeamApiKey({
  teamSlugOrId,
  description,
  expiresAt,
}: {
  teamSlugOrId: string;
  description: string;
  expiresAt: string | null;
}): Promise<CreateTeamApiKeyResponse> {
  const response = await fetchWithUserAuth(
    `${WWW_ORIGIN}/api/teams/${encodeURIComponent(teamSlugOrId)}/auth/team-api-keys`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        description,
        expiresAt,
      }),
    },
  );

  return CreateTeamApiKeyResponseSchema.parse(await response.json());
}

async function revokeTeamApiKey({
  teamSlugOrId,
  keyId,
}: {
  teamSlugOrId: string;
  keyId: string;
}): Promise<void> {
  await fetchWithUserAuth(
    `${WWW_ORIGIN}/api/teams/${encodeURIComponent(teamSlugOrId)}/auth/team-api-keys/${encodeURIComponent(keyId)}`,
    {
      method: "DELETE",
    },
  );
}

async function fetchWithUserAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const user = await stackClientApp.getUser();
  if (!user) {
    throw new Error("Unauthorized");
  }

  const authHeaders = await user.getAuthHeaders();
  const headers = new Headers(authHeaders);
  const initHeaders = new Headers(init?.headers);
  initHeaders.forEach((value, key) => {
    headers.set(key, value);
  });

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const message = await getErrorMessage(response);
    throw new Error(message);
  }

  return response;
}

async function getErrorMessage(response: Response): Promise<string> {
  const fallback = `Request failed (${response.status})`;

  try {
    const data = (await response.json()) as { message?: unknown };
    if (typeof data.message === "string" && data.message.trim().length > 0) {
      return data.message;
    }
  } catch (error) {
    console.error("Failed to parse API error response", error);
  }

  return fallback;
}
