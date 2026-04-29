import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { MCPServerConfig } from '../types.js';

const CLIENT_NAME = 'opencode-tool-search';
const CLIENT_VERSION = '0.5.0-mcp.0';

/**
 * Wraps a single MCP server connection. Supports local stdio transport
 * (with env passthrough) and remote streamable HTTP transport (with
 * arbitrary auth headers).
 */
export class MCPServerClient {
  readonly name: string;
  private readonly config: MCPServerConfig;
  private readonly client: Client;
  private connected = false;

  constructor(name: string, config: MCPServerConfig) {
    this.name = name;
    this.config = config;
    this.client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION }, { capabilities: {} });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    if (this.config.type === 'local') {
      const [command, ...args] = this.config.command;
      if (!command) {
        throw new Error(`MCP server "${this.name}": local command must be non-empty`);
      }

      // Inherit parent env so PATH / HOME / NODE_OPTIONS / etc. are available
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (typeof value === 'string') env[key] = value;
      }
      if (this.config.env) Object.assign(env, this.config.env);

      const transport = new StdioClientTransport({ command, args, env });
      await this.client.connect(transport);
    } else if (this.config.type === 'remote') {
      const transport = new StreamableHTTPClientTransport(new URL(this.config.url), {
        requestInit: {
          headers: this.config.headers ?? {},
        },
      });
      await this.client.connect(transport);
    } else {
      throw new Error(`MCP server "${this.name}": unknown type`);
    }

    this.connected = true;
  }

  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    if (!this.connected) await this.connect();
    const result = await this.client.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) await this.connect();
    return await this.client.callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.client.close();
    } catch {
      // Best-effort; transport may already be closed.
    }
    this.connected = false;
  }
}
