import { connectToMainServer, type MainServerSocket } from "@cmux/shared/socket";

const DEFAULT_MAIN_SERVER_ORIGIN = "http://localhost:9776";
const CONNECT_TIMEOUT_MS = 15_000;

export interface ConnectMainServerInput {
  serverOrigin?: string;
  authToken: string;
  teamSlugOrId: string;
  authJson?: unknown;
  timeoutMs?: number;
}

export async function connectMainServer({
  serverOrigin,
  authToken,
  teamSlugOrId,
  authJson,
  timeoutMs = CONNECT_TIMEOUT_MS,
}: ConnectMainServerInput): Promise<MainServerSocket> {
  const socket = connectToMainServer({
    url: serverOrigin ?? DEFAULT_MAIN_SERVER_ORIGIN,
    authToken,
    teamSlugOrId,
    authJson,
  });

  try {
    await waitForSocketConnect(socket, timeoutMs);
    return socket;
  } catch (error) {
    socket.disconnect();
    throw error;
  }
}

async function waitForSocketConnect(
  socket: MainServerSocket,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error("Timed out connecting to main server"));
    }, timeoutMs);

    const handleConnect = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };

    const handleError = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      const message = error instanceof Error ? error.message : String(error);
      reject(new Error(`Main server connection failed: ${message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleError);
    };

    socket.on("connect", handleConnect);
    socket.on("connect_error", handleError);
  });
}
