export interface CatalogEntry {
  id: string;
  description: string;
  parameters: unknown;
}

/**
 * BM25 tuning: k1 controls term frequency saturation (0.5–2.0),
 * b controls document length normalization (0–1).
 * Defaults tuned for SLMs with vague queries; increase k1 for capable models.
 */
export interface BM25Config {
  k1: number;
  b: number;
}

export interface ToolSearchConfig {
  alwaysLoad?: string[];
  bm25?: Partial<BM25Config>;
  searchLimit?: number;
  deferDescription?: string;
}
