import { describe, expect, it } from 'vitest';
import { connectAll } from '../src/mcp/index.js';
import { jsonSchemaToZod } from '../src/mcp/wrap.js';

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
});
