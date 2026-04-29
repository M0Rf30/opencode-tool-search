import { describe, expect, it, vi } from 'vitest';
import {
  createToolPairValidator,
  setToolPairValidatorLogger,
} from '../src/hooks/tool-pair-validator.js';

const TOOL_RESULT_PLACEHOLDER = 'Tool output unavailable (context compacted)';

type TestPart = {
  type: string;
  id?: string;
  callID?: string;
  tool_use_id?: string;
  content?: string;
  text?: string;
};

type TestMessage = {
  info: { role: 'assistant' | 'user'; id?: string; sessionID?: string };
  parts: TestPart[];
};

async function runTransform(messages: TestMessage[]): Promise<void> {
  const transform = createToolPairValidator();
  await transform({} as never, { messages: messages as never });
}

describe('createToolPairValidator', () => {
  it('leaves matching tool pairs unchanged (OpenCode internal `tool` shape)', async () => {
    const messages: TestMessage[] = [
      { info: { role: 'assistant' }, parts: [{ type: 'tool', callID: 'call_1' }] },
      {
        info: { role: 'user' },
        parts: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'done' }],
      },
    ];

    await runTransform(messages);

    expect(messages).toEqual([
      { info: { role: 'assistant' }, parts: [{ type: 'tool', callID: 'call_1' }] },
      {
        info: { role: 'user' },
        parts: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'done' }],
      },
    ]);
  });

  it('leaves matching tool pairs unchanged (Anthropic `tool_use` shape)', async () => {
    const messages: TestMessage[] = [
      { info: { role: 'assistant' }, parts: [{ type: 'tool_use', id: 'toolu_1' }] },
      {
        info: { role: 'user' },
        parts: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'done' }],
      },
    ];

    await runTransform(messages);

    expect(messages[1]?.parts).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'done' },
    ]);
  });

  it('injects a missing tool_result into the next user message', async () => {
    const messages: TestMessage[] = [
      { info: { role: 'assistant' }, parts: [{ type: 'tool_use', id: 'toolu_1' }] },
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'continue' }] },
    ];

    await runTransform(messages);

    expect(messages[1]?.parts).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: TOOL_RESULT_PLACEHOLDER },
      { type: 'text', text: 'continue' },
    ]);
  });

  it('injects a synthetic user message when the next message is missing', async () => {
    const messages: TestMessage[] = [
      {
        info: { role: 'assistant' },
        parts: [
          { type: 'tool_use', id: 'toolu_1' },
          { type: 'text', text: 'working' },
          { type: 'tool_use', id: 'toolu_2' },
        ],
      },
    ];

    await runTransform(messages);

    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({
      info: { role: 'user' },
      parts: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: TOOL_RESULT_PLACEHOLDER },
        { type: 'tool_result', tool_use_id: 'toolu_2', content: TOOL_RESULT_PLACEHOLDER },
      ],
    });
  });

  it('injects a synthetic user message before a non-user next message', async () => {
    const messages: TestMessage[] = [
      { info: { role: 'assistant' }, parts: [{ type: 'tool_use', id: 'toolu_1' }] },
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'follow-up' }] },
    ];

    await runTransform(messages);

    expect(messages).toHaveLength(3);
    expect(messages).toEqual([
      { info: { role: 'assistant' }, parts: [{ type: 'tool_use', id: 'toolu_1' }] },
      {
        info: { role: 'user' },
        parts: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: TOOL_RESULT_PLACEHOLDER }],
      },
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'follow-up' }] },
    ]);
  });

  it('injects only the missing tool_results for partial matches', async () => {
    const messages: TestMessage[] = [
      {
        info: { role: 'assistant' },
        parts: [
          { type: 'tool_use', id: 'toolu_1' },
          { type: 'tool', callID: 'call_2' },
        ],
      },
      {
        info: { role: 'user' },
        parts: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'done' },
          { type: 'text', text: 'continue' },
        ],
      },
    ];

    await runTransform(messages);

    expect(messages[1]?.parts).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'done' },
      { type: 'tool_result', tool_use_id: 'call_2', content: TOOL_RESULT_PLACEHOLDER },
      { type: 'text', text: 'continue' },
    ]);
  });

  it('deduplicates repeated tool_use IDs in the same assistant message', async () => {
    const messages: TestMessage[] = [
      {
        info: { role: 'assistant' },
        parts: [
          { type: 'tool_use', id: 'toolu_1' },
          { type: 'tool_use', id: 'toolu_1' }, // duplicate, should be deduped
        ],
      },
    ];

    await runTransform(messages);

    expect(messages).toHaveLength(2);
    expect(messages[1]?.parts).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: TOOL_RESULT_PLACEHOLDER },
    ]);
  });

  it('preserves sessionID on the synthetic user message when present on the assistant', async () => {
    const messages: TestMessage[] = [
      {
        info: { role: 'assistant', sessionID: 'sess_abc' },
        parts: [{ type: 'tool_use', id: 'toolu_1' }],
      },
    ];

    await runTransform(messages);

    expect(messages[1]?.info).toEqual({ role: 'user', sessionID: 'sess_abc' });
  });

  it('does nothing when there are no assistant messages', async () => {
    const messages: TestMessage[] = [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'hello' }] },
    ];

    await runTransform(messages);

    expect(messages).toEqual([
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'hello' }] },
    ]);
  });

  it('does nothing when the assistant has no tool_use parts', async () => {
    const messages: TestMessage[] = [
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'just a reply' }] },
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'thanks' }] },
    ];

    await runTransform(messages);

    expect(messages).toEqual([
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'just a reply' }] },
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'thanks' }] },
    ]);
  });

  it('logs a repair event when the override logger is set', async () => {
    const logSpy = vi.fn();
    setToolPairValidatorLogger(logSpy);

    const messages: TestMessage[] = [
      { info: { role: 'assistant', id: 'msg_1' }, parts: [{ type: 'tool_use', id: 'toolu_1' }] },
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'continue' }] },
    ];

    await runTransform(messages);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      '[tool-pair-validator] Repaired missing tool_result blocks',
      expect.objectContaining({
        assistantMessageID: 'msg_1',
        repairedToolUseIDs: ['toolu_1'],
      }),
    );

    setToolPairValidatorLogger(() => {});
  });
});
