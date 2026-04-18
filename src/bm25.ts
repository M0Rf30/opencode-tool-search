import type { BM25Config } from './types.js';

interface Document {
  terms: string[];
  termFrequency: Map<string, number>;
  length: number;
}

export interface SearchResult<T> {
  item: T;
  score: number;
}

export interface Index<T> {
  documents: Document[];
  items: T[];
  documentFrequency: Map<string, number>;
  averageDocumentLength: number;
  documentCount: number;
  config: BM25Config;
}

const DEFAULT_CONFIG: BM25Config = {
  k1: 0.9,
  b: 0.4,
};

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function buildTermFrequency(terms: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const term of terms) {
    tf.set(term, (tf.get(term) ?? 0) + 1);
  }
  return tf;
}

// IDF: log((N - df + 0.5) / (df + 0.5) + 1)
function calculateIDF(documentCount: number, df: number): number {
  return Math.log((documentCount - df + 0.5) / (df + 0.5) + 1);
}

function scoreDocument(doc: Document, queryTerms: string[], index: Index<unknown>): number {
  const { k1, b } = index.config;
  let score = 0;

  for (const term of queryTerms) {
    const df = index.documentFrequency.get(term) ?? 0;
    if (df === 0) continue;

    const tf = doc.termFrequency.get(term) ?? 0;
    if (tf === 0) continue;

    const idf = calculateIDF(index.documentCount, df);
    // BM25 term score: idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl/avgdl))
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (doc.length / index.averageDocumentLength));
    score += idf * (numerator / denominator);
  }

  return score;
}

export function createIndex<T>(
  items: T[],
  getFields: (item: T) => string[],
  config: Partial<BM25Config> = {},
): Index<T> {
  const finalConfig: BM25Config = { ...DEFAULT_CONFIG, ...config };
  const documents: Document[] = [];
  const documentFrequency = new Map<string, number>();

  for (const item of items) {
    const terms = getFields(item).flatMap(tokenize);
    const termFrequency = buildTermFrequency(terms);

    for (const term of termFrequency.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }

    documents.push({ terms, termFrequency, length: terms.length });
  }

  const totalLength = documents.reduce((sum, d) => sum + d.length, 0);
  const averageDocumentLength = documents.length > 0 ? totalLength / documents.length : 0;

  return {
    documents,
    items,
    documentFrequency,
    averageDocumentLength,
    documentCount: documents.length,
    config: finalConfig,
  };
}

export function search<T>(index: Index<T>, query: string, limit = 10): SearchResult<T>[] {
  if (index.documentCount === 0) return [];

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const results: SearchResult<T>[] = [];

  for (let i = 0; i < index.documents.length; i++) {
    const score = scoreDocument(index.documents[i], queryTerms, index);
    if (score > 0) {
      results.push({ item: index.items[i], score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
