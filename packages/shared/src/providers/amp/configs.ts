import type { AgentConfig } from "../../agentConfig";
import { AMP_API_KEY } from "../../apiKeys";
import { checkAmpRequirements } from "./check-requirements";
import { getAmpEnvironment } from "./environment";

export const AMP_CONFIG: AgentConfig = {
  name: "amp",
  command: "prompt-wrapper",
  args: [
    "--prompt-env",
    "CMUX_PROMPT",
    "--",
    "npx",
    "-y",
    "@sourcegraph/amp@latest",
    "--dangerously-allow-all",
  ],
  environment: getAmpEnvironment,
  apiKeys: [AMP_API_KEY],
  checkRequirements: checkAmpRequirements,
};

export const AMP_GPT_5_CONFIG: AgentConfig = {
  name: "amp/gpt-5",
  command: "prompt-wrapper",
  args: [
    "--prompt-env",
    "CMUX_PROMPT",
    "--",
    "npx",
    "-y",
    "@sourcegraph/amp@latest",
    "--dangerously-allow-all",
    "--try-gpt5",
  ],
  environment: getAmpEnvironment,
  apiKeys: [AMP_API_KEY],
  checkRequirements: checkAmpRequirements,
  // No completion detector for AMP because it is handled by the proxy, which starts from environment
};
