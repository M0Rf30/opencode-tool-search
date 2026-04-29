import { tool } from '@opencode-ai/plugin';
import { z } from 'zod';
import type { MCPServerClient } from './client.js';

type ZodSchema = z.ZodTypeAny;

/**
 * Reserved key injected into empty MCP tool argument schemas so that
 * providers that reject empty `properties: {}` tool definitions
 * (Anthropic strict harness, OpenAI Responses API, Vertex AI Gemini,
 * SGLang, Antigravity, etc.) accept the call. Stripped before
 * forwarding args to the MCP server.
 *
 * See: anomalyco/opencode #9020, #8184, #9233, #9131, #15041, #20637.
 */
const PLACEHOLDER_KEY = '_placeholder';

/**
 * JSON Schema keywords that some providers reject. Specifically,
 * Anthropic rejects `contentEncoding` and `contentMediaType` on tool
 * input schemas (these appear on MCP tools that handle binary/file
 * blobs, e.g., base64-encoded image params). We strip them recursively
 * before Zod conversion so they cannot leak through into the schema
 * sent to the provider.
 *
 * Matches the strip strategy in oh-my-openagent's `sanitizeJsonSchema`.
 * Currently defensive-only since Zod's `toJSONSchema` does not
 * preserve these keywords on output, but futureproof against Zod
 * versions that may propagate them via `.meta()` annotations or
 * direct schema authoring.
 */
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set(['contentEncoding', 'contentMediaType']);

/**
 * Recursively strip provider-incompatible JSON Schema keywords from
 * a schema fragment. The strip skips key matching when descending
 * through a `properties` map (so a property literally named
 * `contentEncoding` survives — the keyword name only matters at
 * schema-keyword positions, never inside `properties` dictionaries).
 */
function stripUnsupportedKeywords(value: unknown, isPropertyName = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripUnsupportedKeywords(item, false));
  }

  if (!value || typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (!isPropertyName && UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) continue;
    const childIsPropertyName = key === 'properties' && !isPropertyName;
    result[key] = stripUnsupportedKeywords(nested, childIsPropertyName);
  }
  return result;
}

/**
 * Naive JSON Schema → Zod conversion sufficient for typical MCP tool
 * input schemas (object root with primitive properties, enums, arrays,
 * nested objects). Falls back to z.any() for unknown shapes.
 *
 * Mirrors opencode-mcp-adapter's behavior for compatibility with MCP
 * servers that already work there. Provider-incompatible keywords
 * (`contentEncoding`, `contentMediaType`) are stripped at the entry
 * point before recursion.
 */
export function jsonSchemaToZod(schema: unknown): ZodSchema {
  if (!schema || typeof schema !== 'object') return z.any();

  const sanitized = stripUnsupportedKeywords(schema) as Record<string, unknown>;
  return jsonSchemaToZodInner(sanitized);
}

function jsonSchemaToZodInner(schema: unknown): ZodSchema {
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
  if (s.type === 'array') return z.array(jsonSchemaToZodInner(s.items));

  if (s.type === 'object') {
    const shape: Record<string, ZodSchema> = {};
    const required = new Set<string>(Array.isArray(s.required) ? (s.required as string[]) : []);
    const properties = (s.properties as Record<string, unknown>) ?? {};
    for (const [key, prop] of Object.entries(properties)) {
      let zodType = jsonSchemaToZodInner(prop);
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
 *
 * Empty-args MCP tools (no `properties` declared, or `properties: {}`)
 * are augmented with an optional `_placeholder` field so the JSON
 * Schema OpenCode emits to providers always has at least one property.
 * This sidesteps provider-side rejections like Anthropic's
 * "content.0.tool_use.input: Field required" and OpenAI Responses'
 * "Missing required parameter: input[N].arguments". The placeholder
 * is stripped from the args object before forwarding to the MCP
 * server, so the server sees `arguments: {}` exactly as it would
 * from a native OpenCode invocation.
 */
export function wrapMcpTool(client: MCPServerClient, mcpTool: MCPToolDef): ReturnType<typeof tool> {
  const zodSchema = mcpTool.inputSchema ? jsonSchemaToZod(mcpTool.inputSchema) : z.object({});
  const args =
    zodSchema instanceof z.ZodObject
      ? (zodSchema.shape as Record<string, ZodSchema>)
      : ({} as Record<string, ZodSchema>);

  // If the schema has no properties, inject an optional placeholder
  // so providers always see at least one property in the rendered
  // tool definition. The placeholder is stripped before MCP forward.
  if (Object.keys(args).length === 0) {
    args[PLACEHOLDER_KEY] = z
      .boolean()
      .optional()
      .describe(
        'Reserved. Pass true or omit. Required by some providers when a tool has no parameters.',
      );
  }

  return tool({
    description: mcpTool.description ?? '',
    args,
    async execute(callArgs: Record<string, unknown> | undefined) {
      // Handle Claude's `undefined` for no-arg tool calls (issue #9020)
      // and strip the placeholder before forwarding to the MCP server.
      const cleanArgs: Record<string, unknown> = { ...(callArgs ?? {}) };
      delete cleanArgs[PLACEHOLDER_KEY];

      const result = (await client.callTool(mcpTool.name, cleanArgs)) as {
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
