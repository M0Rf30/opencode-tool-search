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

/**
 * MCP server connection config. `local` spawns a stdio child process,
 * `remote` connects to a Streamable HTTP endpoint with optional auth
 * headers.
 */
export type MCPServerConfig =
  | {
      type: 'local';
      command: string[];
      env?: Record<string, string>;
    }
  | {
      type: 'remote';
      url: string;
      headers?: Record<string, string>;
    };

/**
 * Configuration for the in-plugin MCP integration. When `servers` is
 * present, the plugin connects to each MCP server at startup, lists
 * its tools, and registers each as a native plugin tool. The standard
 * tool.definition deferral logic then applies — including alwaysLoad
 * exemption — without requiring a separate adapter plugin.
 */
export interface MCPConfig {
  /** Map of server name → connection config. */
  servers?: Record<string, MCPServerConfig>;
  /** Optional prefix prepended to every tool name. Default `""`. */
  toolPrefix?: string;
  /** Separator between server name and tool name. Default `"_"`. */
  separator?: string;
  /**
   * If true (default), replace dashes with underscores in generated tool
   * names so server names like `mcp-gateway` become `mcp_gateway`.
   * Required for OpenAI Responses API compatibility (tool names must
   * match `^[a-zA-Z0-9_-]+$` but some runtimes are stricter).
   */
  dashesToUnderscores?: boolean;
}

export interface ToolSearchConfig {
  alwaysLoad?: string[];
  bm25?: Partial<BM25Config>;
  searchLimit?: number;
  deferDescription?: string;
  /**
   * Optional MCP server integration. When set, MCP tools are wrapped as
   * native plugin tools so they pass through tool.definition deferral.
   */
  mcp?: MCPConfig;
}
