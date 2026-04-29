import type { tool } from '@opencode-ai/plugin';
import type { MCPConfig } from '../types.js';
import { MCPServerClient } from './client.js';
import { wrapMcpTool } from './wrap.js';

type ToolEntry = ReturnType<typeof tool>;
type Logger = (msg: string, err?: unknown) => void;

export interface MCPRegistration {
  tools: Record<string, ToolEntry>;
  close: () => Promise<void>;
}

const DEFAULT_LOGGER: Logger = (msg, err) => {
  if (err === undefined) {
    console.warn(msg);
  } else {
    console.warn(msg, err instanceof Error ? err.message : err);
  }
};

/**
 * Connect to every configured MCP server in parallel and return a map
 * of plugin-native tools wrapping every discovered MCP tool, keyed by
 * `${prefix}${serverName}${separator}${toolName}` (with dashes converted
 * to underscores by default).
 *
 * Connection failures are isolated — a single bad server doesn't prevent
 * other servers' tools from being registered.
 */
export async function connectAll(
  config: MCPConfig | undefined,
  log: Logger = DEFAULT_LOGGER,
): Promise<MCPRegistration> {
  const tools: Record<string, ToolEntry> = {};
  const clients: MCPServerClient[] = [];

  if (!config?.servers) {
    return { tools, close: async () => {} };
  }

  const separator = config.separator ?? '_';
  const prefix = config.toolPrefix ?? '';
  const dashesToUnderscores = config.dashesToUnderscores !== false;

  const entries = Object.entries(config.servers);

  await Promise.allSettled(
    entries.map(async ([name, serverConfig]) => {
      const client = new MCPServerClient(name, serverConfig);
      try {
        await client.connect();
        const mcpTools = await client.listTools();
        clients.push(client);
        for (const mcpTool of mcpTools) {
          let toolName = `${prefix}${name}${separator}${mcpTool.name}`;
          if (dashesToUnderscores) toolName = toolName.replace(/-/g, '_');
          tools[toolName] = wrapMcpTool(client, mcpTool);
        }
        log(`[tool-search/mcp] connected to ${name} (${mcpTools.length} tools)`);
      } catch (err) {
        log(`[tool-search/mcp] failed to connect to ${name}`, err);
      }
    }),
  );

  return {
    tools,
    close: async () => {
      await Promise.allSettled(clients.map((c) => c.close()));
    },
  };
}
