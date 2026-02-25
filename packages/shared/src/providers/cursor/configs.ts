import type { AgentConfig } from "../../agentConfig";
import { CURSOR_API_KEY } from "../../apiKeys";
import { checkCursorRequirements } from "./check-requirements";
import { getCursorEnvironment } from "./environment";

export const CURSOR_OPUS_4_1_CONFIG: AgentConfig = {
  name: "cursor/opus-4.1",
  command: "/root/.local/bin/cursor-agent",
  args: ["--force", "--model", "opus-4.1", "$PROMPT"],
  environment: getCursorEnvironment,
  checkRequirements: checkCursorRequirements,
  apiKeys: [CURSOR_API_KEY],
  waitForString: "Ready",
};

export const CURSOR_GPT_5_CONFIG: AgentConfig = {
  name: "cursor/gpt-5",
  command: "/root/.local/bin/cursor-agent",
  args: ["-p", "--force", "--model", "gpt-5", "$PROMPT"],
  environment: getCursorEnvironment,
  checkRequirements: checkCursorRequirements,
  apiKeys: [CURSOR_API_KEY],
  waitForString: "Ready",
};

export const CURSOR_SONNET_4_CONFIG: AgentConfig = {
  name: "cursor/sonnet-4",
  command: "/root/.local/bin/cursor-agent",
  args: ["-p", "--force", "--model", "sonnet-4", "$PROMPT"],
  environment: getCursorEnvironment,
  checkRequirements: checkCursorRequirements,
  apiKeys: [CURSOR_API_KEY],
  waitForString: "Ready",
};

export const CURSOR_SONNET_4_THINKING_CONFIG: AgentConfig = {
  name: "cursor/sonnet-4-thinking",
  command: "/root/.local/bin/cursor-agent",
  args: ["-p", "--force", "--model", "sonnet-4-thinking", "$PROMPT"],
  environment: getCursorEnvironment,
  checkRequirements: checkCursorRequirements,
  apiKeys: [CURSOR_API_KEY],
  waitForString: "Ready",
};
