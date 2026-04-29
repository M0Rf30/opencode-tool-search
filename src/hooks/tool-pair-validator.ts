/**
 * Proactive `tool_use` ↔ `tool_result` pair validator.
 *
 * Walks `output.messages` from `experimental.chat.messages.transform`
 * and synthesizes placeholder `tool_result` blocks for any `tool_use`
 * (Anthropic-shape) or `tool` (OpenCode-internal shape) parts that
 * lack a matching `tool_result`. This prevents two distinct provider
 * rejections that otherwise corrupt sessions permanently:
 *
 * - Anthropic 400: "tool_use ids were found without tool_result blocks
 *   immediately after"
 * - Bedrock InvokeModelWithResponseStream ValidationException with
 *   the same root cause
 *
 * Once an orphan `tool_use` enters the message history (interrupted
 * tool call, mid-stream provider error, aborted shell command on
 * Windows, etc. — see anomalyco/opencode #21326, #21489, #16749), the
 * session is unrecoverable from the user's side without `/undo`. This
 * hook heals the history in-flight on every request, so corrupted
 * sessions become recoverable: the next turn ships a synthetic
 * placeholder result for the orphan and the conversation continues.
 *
 * Adapted from oh-my-openagent (`src/hooks/tool-pair-validator/hook.ts`,
 * MIT-licensed) by code-yeongyu. Logging shim swapped to console.warn.
 */

import type { Message, Part } from '@opencode-ai/sdk';

const TOOL_RESULT_PLACEHOLDER = 'Tool output unavailable (context compacted)';

type ToolUsePart = {
  type: 'tool_use';
  id: string;
  [key: string]: unknown;
};

type ToolResultPart = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  [key: string]: unknown;
};

type TransformPart = Part | ToolUsePart | ToolResultPart;

type TransformMessageInfo =
  | Message
  | {
      role: 'user';
      sessionID?: string;
    };

interface MessageWithParts {
  info: TransformMessageInfo;
  parts: TransformPart[];
}

export type MessagesTransformHandler = (
  input: Record<string, never>,
  output: { messages: MessageWithParts[] },
) => Promise<void>;

let debugLog: (msg: string, meta?: unknown) => void = () => {};

/**
 * Override the debug logger (default: no-op). Useful for tests and
 * for users who want to surface repair events in their own logs.
 */
export function setToolPairValidatorLogger(fn: (msg: string, meta?: unknown) => void): void {
  debugLog = fn;
}

function getToolUseID(part: TransformPart): string | null {
  const candidate = part as { type?: unknown; id?: unknown; callID?: unknown };

  if (
    candidate.type === 'tool_use' &&
    typeof candidate.id === 'string' &&
    candidate.id.length > 0
  ) {
    return candidate.id;
  }

  if (
    candidate.type === 'tool' &&
    typeof candidate.callID === 'string' &&
    candidate.callID.length > 0
  ) {
    return candidate.callID;
  }

  return null;
}

function getToolResultID(part: TransformPart): string | null {
  const candidate = part as { type?: unknown; tool_use_id?: unknown };

  if (
    candidate.type === 'tool_result' &&
    typeof candidate.tool_use_id === 'string' &&
    candidate.tool_use_id.length > 0
  ) {
    return candidate.tool_use_id;
  }

  return null;
}

function extractUniqueToolUseIDs(parts: TransformPart[]): string[] {
  const seen = new Set<string>();
  const toolUseIDs: string[] = [];

  for (const part of parts) {
    const toolUseID = getToolUseID(part);
    if (!toolUseID || seen.has(toolUseID)) continue;
    seen.add(toolUseID);
    toolUseIDs.push(toolUseID);
  }

  return toolUseIDs;
}

function extractToolResultIDs(parts: TransformPart[]): Set<string> {
  const toolResultIDs = new Set<string>();

  for (const part of parts) {
    const toolResultID = getToolResultID(part);
    if (toolResultID) toolResultIDs.add(toolResultID);
  }

  return toolResultIDs;
}

function createToolResultPart(toolUseID: string): ToolResultPart {
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: TOOL_RESULT_PLACEHOLDER,
  };
}

function findToolResultInsertIndex(parts: TransformPart[]): number {
  // Insert new tool_result parts after any existing tool_results so
  // the user's text/image content stays at the end of the message.
  let lastToolResultIndex = -1;
  for (let i = 0; i < parts.length; i++) {
    if (getToolResultID(parts[i] as TransformPart)) lastToolResultIndex = i;
  }
  return lastToolResultIndex === -1 ? 0 : lastToolResultIndex + 1;
}

function insertMissingToolResults(message: MessageWithParts, missingToolUseIDs: string[]): void {
  const toolResultParts = missingToolUseIDs.map((id) => createToolResultPart(id));
  const insertIndex = findToolResultInsertIndex(message.parts);
  message.parts.splice(insertIndex, 0, ...toolResultParts);
}

function createSyntheticUserMessage(
  assistantMessage: MessageWithParts,
  missingToolUseIDs: string[],
): MessageWithParts {
  const assistantInfo = assistantMessage.info as { sessionID?: unknown };
  const sessionID =
    typeof assistantInfo.sessionID === 'string' ? assistantInfo.sessionID : undefined;

  return {
    info: {
      role: 'user',
      ...(sessionID ? { sessionID } : {}),
    },
    parts: missingToolUseIDs.map((id) => createToolResultPart(id)),
  };
}

function getMessageID(message: TransformMessageInfo): string | undefined {
  const candidate = message as { id?: unknown };
  return typeof candidate.id === 'string' ? candidate.id : undefined;
}

function repairMissingToolResults(messages: MessageWithParts[], assistantIndex: number): void {
  const assistantMessage = messages[assistantIndex];
  if (!assistantMessage) return;

  const toolUseIDs = extractUniqueToolUseIDs(assistantMessage.parts);
  if (toolUseIDs.length === 0) return;

  const nextMessage = messages[assistantIndex + 1];

  if (nextMessage?.info.role !== 'user') {
    // Either no following message or it's another assistant message —
    // splice in a synthetic user message holding placeholder results.
    messages.splice(
      assistantIndex + 1,
      0,
      createSyntheticUserMessage(assistantMessage, toolUseIDs),
    );
    debugLog('[tool-pair-validator] Repaired missing tool_result blocks', {
      assistantMessageID: getMessageID(assistantMessage.info),
      syntheticUserMessageInserted: true,
      repairedToolUseIDs: toolUseIDs,
    });
    return;
  }

  const existingToolResultIDs = extractToolResultIDs(nextMessage.parts);
  const missingToolUseIDs = toolUseIDs.filter((id) => !existingToolResultIDs.has(id));

  if (missingToolUseIDs.length === 0) return;

  insertMissingToolResults(nextMessage, missingToolUseIDs);
  debugLog('[tool-pair-validator] Repaired missing tool_result blocks', {
    assistantMessageID: getMessageID(assistantMessage.info),
    syntheticUserMessageInserted: false,
    repairedToolUseIDs: missingToolUseIDs,
  });
}

/**
 * Construct the `experimental.chat.messages.transform` handler that
 * heals orphan `tool_use` blocks before the request reaches the
 * provider.
 */
export function createToolPairValidator(): MessagesTransformHandler {
  return async (_input, output) => {
    for (let i = 0; i < output.messages.length; i++) {
      if (output.messages[i]?.info.role !== 'assistant') continue;
      repairMissingToolResults(output.messages, i);
    }
  };
}
