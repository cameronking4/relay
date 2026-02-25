import type {
  EnvironmentContext,
  EnvironmentResult,
} from "../common/environment-result";

export async function getCursorEnvironment(
  _ctx: EnvironmentContext
): Promise<EnvironmentResult> {
  // These must be lazy since configs are imported into the browser
  const { existsSync } = await import("node:fs");
  const { readFile } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const { Buffer } = await import("node:buffer");
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);

  const files: EnvironmentResult["files"] = [];
  const env: Record<string, string> = {};
  const startupCommands: string[] = [];

  const homeDir = homedir();
  const cursorCliConfigPath = join(homeDir, ".cursor", "cli-config.json");
  const cursorAuthPath = join(homeDir, ".config", "cursor", "auth.json");

  // Copy cursor CLI config if exists
  if (existsSync(cursorCliConfigPath)) {
    try {
      const content = await readFile(cursorCliConfigPath, "utf-8");
      files.push({
        destinationPath: "/root/.cursor/cli-config.json",
        contentBase64: Buffer.from(content).toString("base64"),
        mode: "644",
      });
    } catch (error) {
      console.warn("Failed to read cursor CLI config:", error);
    }
  }

  // Try to copy cursor auth if exists, otherwise fallback to keychain
  let authAdded = false;
  if (existsSync(cursorAuthPath)) {
    try {
      const content = await readFile(cursorAuthPath, "utf-8");
      files.push({
        destinationPath: "/root/.config/cursor/auth.json",
        contentBase64: Buffer.from(content).toString("base64"),
        mode: "600",
      });
      authAdded = true;
    } catch (error) {
      console.warn("Failed to read cursor auth:", error);
    }
  }

  // If no auth file exists, try to get tokens from keychain
  if (!authAdded) {
    try {
      // Try to get both access token and refresh token from keychain
      const [accessTokenResult, refreshTokenResult] = await Promise.all([
        execAsync(
          "security find-generic-password -w -s 'cursor-access-token'"
        ).catch(() => null),
        execAsync(
          "security find-generic-password -w -s 'cursor-refresh-token'"
        ).catch(() => null),
      ]);

      if (accessTokenResult && refreshTokenResult) {
        const accessToken = accessTokenResult.stdout.trim();
        const refreshToken = refreshTokenResult.stdout.trim();

        // Create auth.json with tokens from keychain
        const authJson = {
          accessToken,
          refreshToken,
        };

        files.push({
          destinationPath: "/root/.config/cursor/auth.json",
          contentBase64: Buffer.from(
            JSON.stringify(authJson, null, 2)
          ).toString("base64"),
          mode: "600",
        });
        authAdded = true;
      }
    } catch (error) {
      console.warn("Failed to get Cursor tokens from keychain:", error);
    }
  }

  // If still no auth, check for CURSOR_API_KEY environment variable
  if (!authAdded && process.env.CURSOR_API_KEY) {
    env.CURSOR_API_KEY = process.env.CURSOR_API_KEY;

    // Add startup command to persist the API key in .bashrc
    startupCommands.push(
      `grep -q "export CURSOR_API_KEY=" ~/.bashrc || echo 'export CURSOR_API_KEY="${process.env.CURSOR_API_KEY}"' >> ~/.bashrc`
    );
  }

  // Ensure directories exist
  startupCommands.push("mkdir -p ~/.cursor");
  startupCommands.push("mkdir -p ~/.config/cursor");

  // Disable workspace trust for Cursor
  const settingsJson = {
    "security.workspace.trust.enabled": false,
  };
  const settingsBase64 = Buffer.from(JSON.stringify(settingsJson, null, 2)).toString("base64");

  files.push({
    destinationPath: "$HOME/.cursor/settings.json",
    contentBase64: settingsBase64,
    mode: "644",
  });
  files.push({
    destinationPath: "$HOME/.config/cursor/settings.json",
    contentBase64: settingsBase64,
    mode: "644",
  });

  // Also pre-configure cli-config.json to skip dialogs if possible
  const cliConfig = {
    projects: {
      "/root/workspace": {
        hasTrustDialogAccepted: true,
      }
    }
  };
  files.push({
    destinationPath: "$HOME/.cursor/cli-config.json",
    contentBase64: Buffer.from(JSON.stringify(cliConfig, null, 2)).toString("base64"),
    mode: "644",
  });

  return { files, env, startupCommands };
}
