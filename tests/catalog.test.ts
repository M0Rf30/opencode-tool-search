import { describe, expect, it } from 'vitest';
import { Catalog } from '../src/catalog.js';

describe('Catalog', () => {
  it('starts empty', () => {
    const catalog = new Catalog();
    expect(catalog.size).toBe(0);
  });

  it('registers and retrieves entries', () => {
    const catalog = new Catalog();
    catalog.register('read', 'Read a file', { type: 'object' });
    expect(catalog.size).toBe(1);
    const entry = catalog.get('read');
    expect(entry).toBeDefined();
    expect(entry?.id).toBe('read');
    expect(entry?.description).toBe('Read a file');
  });

  it('overwrites entry when description changes', () => {
    const catalog = new Catalog();
    catalog.register('read', 'Read a file', {});
    catalog.register('read', 'Read a file from disk', {});
    expect(catalog.size).toBe(1);
    expect(catalog.get('read')?.description).toBe('Read a file from disk');
  });

  it('does not re-index when description is identical', () => {
    const catalog = new Catalog();
    catalog.register('read', 'Read a file', {});
    catalog.search('file', 5);
    catalog.register('read', 'Read a file', {});
    const results = catalog.search('file', 5);
    expect(results.length).toBe(1);
  });

  it('returns undefined for unknown ID', () => {
    const catalog = new Catalog();
    expect(catalog.get('nonexistent')).toBeUndefined();
  });

  describe('search (BM25)', () => {
    it('finds registered tools by keyword', () => {
      const catalog = new Catalog();
      catalog.register('read', 'Read a file from the filesystem', {});
      catalog.register('bash', 'Execute a bash command', {});
      const results = catalog.search('file', 5);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('read');
    });

    it('returns empty for no matches', () => {
      const catalog = new Catalog();
      catalog.register('read', 'Read a file', {});
      const results = catalog.search('zzzznothing', 5);
      expect(results).toEqual([]);
    });

    it('respects limit', () => {
      const catalog = new Catalog();
      for (let i = 0; i < 10; i++) {
        catalog.register(`tool${i}`, `Tool that does file operations ${i}`, {});
      }
      const results = catalog.search('file', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('uses custom BM25 config', () => {
      const catalog = new Catalog({ k1: 1.5, b: 0.75 });
      catalog.register('read', 'Read a file', {});
      const results = catalog.search('file', 5);
      expect(results.length).toBe(1);
    });
  });

  describe('searchRegex', () => {
    it('matches against tool ID', () => {
      const catalog = new Catalog();
      catalog.register('github_create_issue', 'Create a GitHub issue', {});
      catalog.register('read', 'Read a file', {});
      const results = catalog.searchRegex('github.*issue', 5);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('github_create_issue');
    });

    it('matches against description', () => {
      const catalog = new Catalog();
      catalog.register('bash', 'Execute a bash command in a shell', {});
      const results = catalog.searchRegex('shell', 5);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('bash');
    });

    it('is case-insensitive', () => {
      const catalog = new Catalog();
      catalog.register('read', 'Read a FILE', {});
      const results = catalog.searchRegex('file', 5);
      expect(results.length).toBe(1);
    });

    it('returns empty for no matches', () => {
      const catalog = new Catalog();
      catalog.register('read', 'Read a file', {});
      const results = catalog.searchRegex('^zzz', 5);
      expect(results).toEqual([]);
    });

    it('respects limit', () => {
      const catalog = new Catalog();
      for (let i = 0; i < 10; i++) {
        catalog.register(`tool_${i}`, `Tool ${i}`, {});
      }
      const results = catalog.searchRegex('tool', 3);
      expect(results.length).toBe(3);
    });

    it('throws on invalid regex', () => {
      const catalog = new Catalog();
      expect(() => catalog.searchRegex('[invalid', 5)).toThrow();
    });
  });
});
