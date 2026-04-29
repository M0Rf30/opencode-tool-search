import { tool } from '@opencode-ai/plugin';
import { z } from 'zod';
import type { MCPServerClient } from './client.js';

type ZodSchema = z.ZodTypeAny;

/**
 * Naive JSON Schema → Zod conversion sufficient for typical MCP tool
 * input schemas (object root with primitive properties, enums, arrays,
 * nested objects). Falls back to z.any() for unknown shapes.
 *
 * Mirrors opencode-mcp-adapter's behavior for compatibility with MCP
 * servers that already work there.
 */
export function jsonSchemaToZod(schema: unknown): ZodSchema {
  if (!schema || typeof schema !== 'object') return z.any();

  const s = schema as Record<string, unknown>;

  if (s.type === 'string') {
    if (
      Array.isArray(s.enum) &&
      s.enum.length > 0 &&
      s.enum.every((v): v is string => typeof v === 'string')
    ) {
      return z.enum(s.enum as [string, ...string[]]);
    }
    return z.string();
  }
  if (s.type === 'number' || s.type === 'integer') return z.number();
  if (s.type === 'boolean') return z.boolean();
  if (s.type === 'array') return z.array(jsonSchemaToZod(s.items));

  if (s.type === 'object') {
    const shape: Record<string, ZodSchema> = {};
    const required = new Set<string>(Array.isArray(s.required) ? (s.required as string[]) : []);
    const properties = (s.properties as Record<string, unknown>) ?? {};
    for (const [key, prop] of Object.entries(properties)) {
      let zodType = jsonSchemaToZod(prop);
      if (!required.has(key)) zodType = zodType.optional();
      shape[key] = zodType;
    }
    return z.object(shape);
  }

  return z.any();
}

export interface MCPToolDef {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * Wrap an MCP tool descriptor as a plugin-native tool. The resulting
 * tool delegates execution to the MCP client and concatenates any
 * text content blocks from the result.
 */
export function wrapMcpTool(client: MCPServerClient, mcpTool: MCPToolDef): ReturnType<typeof tool> {
  const zodSchema = mcpTool.inputSchema ? jsonSchemaToZod(mcpTool.inputSchema) : z.object({});
  const args =
    zodSchema instanceof z.ZodObject
      ? (zodSchema.shape as Record<string, ZodSchema>)
      : ({} as Record<string, ZodSchema>);

  return tool({
    description: mcpTool.description ?? '',
    args,
    async execute(callArgs: Record<string, unknown>) {
      const result = (await client.callTool(mcpTool.name, callArgs)) as {
        content?: unknown[];
        isError?: boolean;
      };

      const textParts: string[] = [];
      if (Array.isArray(result?.content)) {
        for (const content of result.content) {
          if (
            content &&
            typeof content === 'object' &&
            'type' in content &&
            (content as { type: unknown }).type === 'text' &&
            'text' in content
          ) {
            textParts.push(String((content as { text: unknown }).text));
          }
        }
      }

      const text = textParts.join('\n\n') || 'No output';
      if (result?.isError) return `[MCP error] ${text}`;
      return text;
    },
  });
}
