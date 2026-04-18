import { createIndex, search as bm25Search, type Index, type SearchResult } from './bm25.js';
import type { BM25Config, CatalogEntry } from './types.js';

// Populated lazily via tool.definition hook — all tools are captured before LLM sees them.
export class Catalog {
  private entries = new Map<string, CatalogEntry>();
  private bm25Config: BM25Config;
  private indexDirty = true;
  private cachedIndex: Index<CatalogEntry> | null = null;

  constructor(config: Partial<BM25Config> = {}) {
    this.bm25Config = {
      k1: config.k1 ?? 0.9,
      b: config.b ?? 0.4,
    };
  }

  register(id: string, description: string, parameters: unknown): void {
    const existing = this.entries.get(id);
    if (!existing || existing.description !== description) {
      this.entries.set(id, { id, description, parameters });
      this.indexDirty = true;
    }
  }

  search(query: string, limit: number): CatalogEntry[] {
    const index = this.getIndex();
    return bm25Search(index, query, limit).map((r: SearchResult<CatalogEntry>) => r.item);
  }

  searchRegex(pattern: string, limit: number): CatalogEntry[] {
    const regex = new RegExp(pattern, 'i');
    const items = Array.from(this.entries.values());
    return items
      .filter((e) => regex.test(e.id) || regex.test(e.description))
      .slice(0, limit);
  }

  get(id: string): CatalogEntry | undefined {
    return this.entries.get(id);
  }

  get size(): number {
    return this.entries.size;
  }

  private getIndex(): Index<CatalogEntry> {
    if (this.indexDirty || !this.cachedIndex) {
      const items = Array.from(this.entries.values());
      this.cachedIndex = createIndex(
        items,
        (entry) => [entry.id, entry.description],
        this.bm25Config,
      );
      this.indexDirty = false;
    }
    return this.cachedIndex;
  }
}
