export function composeTaskPrompt(
  taskPrompt: string,
  customInstructions?: string
): string {
  const trimmedCustomInstructions = customInstructions?.trim();
  if (!trimmedCustomInstructions) {
    return taskPrompt;
  }
  return `${taskPrompt}\n\n${trimmedCustomInstructions}`;
}
