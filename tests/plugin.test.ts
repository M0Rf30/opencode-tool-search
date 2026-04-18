import { describe, expect, it } from 'vitest';
import { summarizeParameters } from '../src/plugin.js';

describe('summarizeParameters', () => {
  it('returns (none) for null', () => {
    expect(summarizeParameters(null)).toBe('(none)');
  });

  it('returns (none) for undefined', () => {
    expect(summarizeParameters(undefined)).toBe('(none)');
  });

  it('returns (none) for non-object', () => {
    expect(summarizeParameters('string')).toBe('(none)');
    expect(summarizeParameters(42)).toBe('(none)');
  });

  it('returns (none) for object without properties', () => {
    expect(summarizeParameters({})).toBe('(none)');
    expect(summarizeParameters({ type: 'object' })).toBe('(none)');
  });

  it('summarizes a simple schema with required field', () => {
    const schema = {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keywords',
        },
      },
      required: ['query'],
    };
    const result = summarizeParameters(schema);
    expect(result).toContain('query');
    expect(result).toContain('string');
    expect(result).toContain('(required)');
    expect(result).toContain('Search keywords');
  });

  it('marks optional fields without (required)', () => {
    const schema = {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max results',
        },
      },
      required: [],
    };
    const result = summarizeParameters(schema);
    expect(result).toContain('limit');
    expect(result).not.toContain('(required)');
  });

  it('handles multiple properties', () => {
    const schema = {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['query'],
    };
    const result = summarizeParameters(schema);
    expect(result).toContain('query');
    expect(result).toContain('limit');
  });

  it('handles property without description', () => {
    const schema = {
      type: 'object',
      properties: {
        flag: { type: 'boolean' },
      },
    };
    const result = summarizeParameters(schema);
    expect(result).toContain('flag');
    expect(result).toContain('boolean');
  });

  it('handles property without type', () => {
    const schema = {
      type: 'object',
      properties: {
        data: { description: 'Some data' },
      },
    };
    const result = summarizeParameters(schema);
    expect(result).toContain('unknown');
  });

  it('skips non-object property definitions', () => {
    const schema = {
      type: 'object',
      properties: {
        good: { type: 'string' },
        bad: null,
        worse: 'not-an-object',
      },
    };
    const result = summarizeParameters(schema);
    expect(result).toContain('good');
    expect(result).not.toContain('bad');
    expect(result).not.toContain('worse');
  });

  it('returns (none) when all properties are non-object', () => {
    const schema = {
      type: 'object',
      properties: {
        bad: null,
      },
    };
    expect(summarizeParameters(schema)).toBe('(none)');
  });
});
