import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { MCPServerClient } from '../src/mcp/client.js';
import { connectAll } from '../src/mcp/index.js';
import { jsonSchemaToZod, wrapMcpTool } from '../src/mcp/wrap.js';

/**
 * Build a minimal stub MCPServerClient that records callTool invocations
 * so tests can assert the exact args forwarded to the MCP server.
 */
function stubClient(returnValue: unknown = { content: [{ type: 'text', text: 'ok' }] }) {
  const callTool = vi.fn().mockResolvedValue(returnValue);
  return { callTool: callTool as unknown } as unknown as MCPServerClient & {
    callTool: ReturnType<typeof vi.fn>;
  };
}

describe('connectAll', () => {
  it('returns empty registration when config is undefined', async () => {
    const result = await connectAll(undefined);
    expect(result.tools).toEqual({});
    expect(typeof result.close).toBe('function');
    await result.close();
  });

  it('returns empty registration when no servers', async () => {
    const result = await connectAll({});
    expect(result.tools).toEqual({});
    await result.close();
  });

  it('isolates connection failures (bad server does not throw)', async () => {
    const result = await connectAll(
      {
        servers: {
          // Local command that does not exist — connect should fail but be isolated
          missing: { type: 'local', command: ['/nonexistent/command-that-does-not-exist'] },
        },
      },
      () => {}, // suppress logger output in test
    );
    expect(result.tools).toEqual({});
    await result.close();
  });
});

describe('jsonSchemaToZod', () => {
  it('returns z.any() for null/undefined', () => {
    expect(jsonSchemaToZod(null)).toBeDefined();
    expect(jsonSchemaToZod(undefined)).toBeDefined();
  });

  it('converts string schema', () => {
    const schema = jsonSchemaToZod({ type: 'string' });
    expect(schema.parse('hello')).toBe('hello');
  });

  it('converts string enum', () => {
    const schema = jsonSchemaToZod({ type: 'string', enum: ['a', 'b'] });
    expect(schema.parse('a')).toBe('a');
    expect(() => schema.parse('c')).toThrow();
  });

  it('converts number schema', () => {
    const schema = jsonSchemaToZod({ type: 'number' });
    expect(schema.parse(42)).toBe(42);
  });

  it('converts boolean schema', () => {
    const schema = jsonSchemaToZod({ type: 'boolean' });
    expect(schema.parse(true)).toBe(true);
  });

  it('converts object schema with required and optional fields', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    });
    expect(schema.parse({ name: 'x' })).toEqual({ name: 'x' });
    expect(schema.parse({ name: 'x', age: 10 })).toEqual({ name: 'x', age: 10 });
    expect(() => schema.parse({ age: 10 })).toThrow();
  });

  it('converts array schema', () => {
    const schema = jsonSchemaToZod({ type: 'array', items: { type: 'string' } });
    expect(schema.parse(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('strips contentEncoding/contentMediaType at the top level', () => {
    // These keywords are valid JSON Schema but rejected by Anthropic.
    // Zod conversion proceeds without them; parsing still works.
    const schema = jsonSchemaToZod({
      type: 'string',
      contentEncoding: 'base64',
      contentMediaType: 'image/png',
    });
    expect(schema.parse('aGVsbG8=')).toBe('aGVsbG8=');
  });

  it('strips contentEncoding/contentMediaType from nested object properties', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        image: {
          type: 'string',
          contentEncoding: 'base64',
          contentMediaType: 'image/png',
        },
      },
      required: ['image'],
    });
    expect(schema.parse({ image: 'data' })).toEqual({ image: 'data' });
  });

  it('strips contentEncoding/contentMediaType from array item schemas', () => {
    const schema = jsonSchemaToZod({
      type: 'array',
      items: {
        type: 'string',
        contentEncoding: 'base64',
      },
    });
    expect(schema.parse(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('preserves a real property literally named contentEncoding', () => {
    // The strip only applies at schema-keyword positions, not inside
    // a `properties` map. A property with that name survives.
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        contentEncoding: { type: 'string' },
      },
      required: ['contentEncoding'],
    });
    expect(schema.parse({ contentEncoding: 'utf-8' })).toEqual({ contentEncoding: 'utf-8' });
  });
});

describe('wrapMcpTool — empty-args placeholder', () => {
  it('injects optional _placeholder when inputSchema is missing', () => {
    const client = stubClient();
    const wrapped = wrapMcpTool(client, { name: 'noargs', description: 'no args tool' });
    // The plugin tool's args record must contain _placeholder so the
    // rendered JSON Schema has at least one property.
    expect(wrapped.args).toBeDefined();
    expect(wrapped.args._placeholder).toBeDefined();
    expect(wrapped.args._placeholder).toBeInstanceOf(z.ZodOptional);
  });

  it('injects optional _placeholder when inputSchema has empty properties', () => {
    const client = stubClient();
    const wrapped = wrapMcpTool(client, {
      name: 'noargs2',
      inputSchema: { type: 'object', properties: {}, required: [] },
    });
    expect(wrapped.args._placeholder).toBeDefined();
  });

  it('does NOT inject _placeholder when inputSchema has real properties', () => {
    const client = stubClient();
    const wrapped = wrapMcpTool(client, {
      name: 'withargs',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    });
    expect(wrapped.args.query).toBeDefined();
    expect(wrapped.args._placeholder).toBeUndefined();
  });

  it('strips _placeholder from args before forwarding to MCP server', async () => {
    const client = stubClient();
    const wrapped = wrapMcpTool(client, { name: 'noargs', description: '' });
    await wrapped.execute({ _placeholder: true } as never, {} as never);
    expect(client.callTool).toHaveBeenCalledWith('noargs', {});
  });

  it('handles undefined args (Claude no-arg tool calls, issue #9020)', async () => {
    const client = stubClient();
    const wrapped = wrapMcpTool(client, { name: 'noargs', description: '' });
    await wrapped.execute(undefined as never, {} as never);
    expect(client.callTool).toHaveBeenCalledWith('noargs', {});
  });

  it('preserves real args while still stripping _placeholder', async () => {
    const client = stubClient();
    const wrapped = wrapMcpTool(client, {
      name: 'mixed',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
      },
    });
    await wrapped.execute({ query: 'hello', _placeholder: true } as never, {} as never);
    expect(client.callTool).toHaveBeenCalledWith('mixed', { query: 'hello' });
  });

  it('returns concatenated text from MCP result content blocks', async () => {
    const client = stubClient({
      content: [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ],
    });
    const wrapped = wrapMcpTool(client, { name: 'noargs', description: '' });
    const result = await wrapped.execute({} as never, {} as never);
    expect(result).toBe('first\n\nsecond');
  });

  it('returns "No output" placeholder when MCP returns no text content', async () => {
    const client = stubClient({ content: [] });
    const wrapped = wrapMcpTool(client, { name: 'noargs', description: '' });
    const result = await wrapped.execute({} as never, {} as never);
    expect(result).toBe('No output');
  });

  it('prefixes [MCP error] when isError is true', async () => {
    const client = stubClient({
      content: [{ type: 'text', text: 'something failed' }],
      isError: true,
    });
    const wrapped = wrapMcpTool(client, { name: 'noargs', description: '' });
    const result = await wrapped.execute({} as never, {} as never);
    expect(result).toBe('[MCP error] something failed');
  });
});
