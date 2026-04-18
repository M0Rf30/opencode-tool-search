import { describe, expect, it } from 'vitest';
import { createIndex, search, tokenize } from '../src/bm25.js';

describe('tokenize', () => {
  it('lowercases and splits on whitespace', () => {
    expect(tokenize('Hello World')).toEqual(['hello', 'world']);
  });

  it('strips non-alphanumeric characters', () => {
    expect(tokenize('file.read()')).toEqual(['file', 'read']);
  });

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('handles mixed punctuation and numbers', () => {
    expect(tokenize('v2.0-beta_3')).toEqual(['v2', '0', 'beta', '3']);
  });

  it('collapses multiple spaces', () => {
    expect(tokenize('a   b   c')).toEqual(['a', 'b', 'c']);
  });
});

describe('createIndex', () => {
  it('creates an empty index from empty items', () => {
    const index = createIndex([], () => [], {});
    expect(index.documentCount).toBe(0);
    expect(index.averageDocumentLength).toBe(0);
  });

  it('indexes items with correct document count', () => {
    const items = [
      { name: 'read', desc: 'Read a file' },
      { name: 'write', desc: 'Write a file' },
    ];
    const index = createIndex(items, (i) => [i.name, i.desc], {});
    expect(index.documentCount).toBe(2);
    expect(index.items).toBe(items);
  });

  it('computes document frequency correctly', () => {
    const items = [{ text: 'file read' }, { text: 'file write' }, { text: 'search code' }];
    const index = createIndex(items, (i) => [i.text], {});
    expect(index.documentFrequency.get('file')).toBe(2);
    expect(index.documentFrequency.get('read')).toBe(1);
    expect(index.documentFrequency.get('search')).toBe(1);
  });

  it('respects custom BM25 config', () => {
    const index = createIndex([], () => [], { k1: 1.5, b: 0.75 });
    expect(index.config.k1).toBe(1.5);
    expect(index.config.b).toBe(0.75);
  });

  it('falls back to defaults for missing config fields', () => {
    const index = createIndex([], () => [], {});
    expect(index.config.k1).toBe(0.9);
    expect(index.config.b).toBe(0.4);
  });
});

describe('search', () => {
  const tools = [
    { id: 'read', desc: 'Read a file from the local filesystem' },
    { id: 'write', desc: 'Write a file to the local filesystem' },
    { id: 'edit', desc: 'Edit a file with string replacements' },
    { id: 'glob', desc: 'Fast file pattern matching tool' },
    { id: 'grep', desc: 'Search file contents using regular expressions' },
    { id: 'bash', desc: 'Execute a bash command in a shell session' },
  ];

  const index = createIndex(tools, (t) => [t.id, t.desc], {});

  it('returns relevant results for file query', () => {
    const results = search(index, 'file', 5);
    expect(results.length).toBeGreaterThan(0);
    const ids = results.map((r) => r.item.id);
    expect(ids).toContain('read');
    expect(ids).toContain('write');
  });

  it('returns empty for nonsense query', () => {
    const results = search(index, 'zzzznonexistent', 5);
    expect(results).toEqual([]);
  });

  it('returns empty for empty query', () => {
    const results = search(index, '', 5);
    expect(results).toEqual([]);
  });

  it('returns empty when index is empty', () => {
    const emptyIndex = createIndex([], () => [], {});
    const results = search(emptyIndex, 'file', 5);
    expect(results).toEqual([]);
  });

  it('respects limit parameter', () => {
    const results = search(index, 'file', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('results are sorted by score descending', () => {
    const results = search(index, 'file', 10);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('ranks exact ID matches highly', () => {
    const results = search(index, 'bash', 3);
    expect(results[0].item.id).toBe('bash');
  });

  it('finds tools by description keywords', () => {
    const results = search(index, 'regular expressions', 3);
    const ids = results.map((r) => r.item.id);
    expect(ids).toContain('grep');
  });
});
