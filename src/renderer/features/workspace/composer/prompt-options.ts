export interface PromptSendOptions {
  /** Prompt sent to the agent when the composer displays a richer invocation. */
  agentPrompt?: string;
  /** Model selected when the user submitted this prompt. */
  model?: string;
  /** Enabled skills selected by the composer for this turn. */
  skills?: readonly string[];
}
