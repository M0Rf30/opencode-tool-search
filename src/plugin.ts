import type { Hooks, Plugin, PluginInput, PluginOptions } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { Catalog } from './catalog.js';
import type { CatalogEntry, ToolSearchConfig } from './types.js';

const SEARCH_TOOL_IDS = new Set(['tool_search', 'tool_search_regex']);

const DEFAULT_DEFER_MSG = '[d]';

export function summarizeParameters(params: unknown): string {
  if (!params || typeof params !== 'object') return '(none)';

  const schema = params as Record<string, unknown>;
  const props = schema.properties;
  if (!props || typeof props !== 'object') return '(none)';

  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);

  const lines: string[] = [];
  for (const [name, def] of Object.entries(props as Record<string, unknown>)) {
    if (!def || typeof def !== 'object') continue;
    const d = def as Record<string, unknown>;
    const type = typeof d.type === 'string' ? d.type : 'unknown';
    const desc = typeof d.description === 'string' ? d.description : '';
    const req = required.has(name) ? ' (required)' : '';
    lines.push(`  - ${name}: ${type}${req}${desc ? ` — ${desc}` : ''}`);
  }

  return lines.length > 0 ? lines.join('\n') : '(none)';
}

function showToast(
  ctx: PluginInput,
  title: string,
  message: string,
  variant: 'info' | 'success' | 'error' = 'info',
  duration = 3000,
): void {
  // Schedule outside the current execution context (Effect-ts runtime / hook pipeline)
  // so the in-process fetch to /tui/show-toast doesn't conflict with the active request.
  setTimeout(() => {
    ctx.client.tui.showToast({ body: { title, message, variant, duration } }).catch(() => {});
  }, 100);
}

export const ToolSearchPlugin: Plugin = async (ctx, options?: PluginOptions): Promise<Hooks> => {
  const config = (options ?? {}) as ToolSearchConfig;

  const alwaysLoad = new Set([...SEARCH_TOOL_IDS, ...(config.alwaysLoad ?? [])]);

  const searchLimit = config.searchLimit ?? 5;
  const deferDescription = config.deferDescription ?? DEFAULT_DEFER_MSG;

  const catalog = new Catalog({
    k1: config.bm25?.k1,
    b: config.bm25?.b,
  });

  let deferredCount = 0;
  let totalCount = 0;
  let toastShown = false;

  setTimeout(() => {
    showToast(ctx, 'Tool Search', 'Active — tools will be deferred on first prompt.', 'info', 4000);
  }, 3000);

  return {
    tool: {
      tool_search: tool({
        description: [
          'Search for available tools by keyword.',
          'Use this whenever you need a capability but the tool has a [d] description.',
          '',
          'Examples:',
          '  tool_search({ query: "file" })        → tools for reading/writing files',
          '  tool_search({ query: "search code" })  → grep, ast-grep tools',
          '  tool_search({ query: "github issue" }) → GitHub issue tools',
          '',
          'Returns full descriptions and parameters of matching tools.',
        ].join('\n'),
        args: {
          query: tool.schema
            .string()
            .describe('Search keywords describing the capability you need'),
        },
        async execute(args) {
          const results = catalog.search(args.query, searchLimit);

          if (results.length === 0) {
            return `No tools found matching "${args.query}". Try broader keywords.`;
          }

          const formatted = results
            .map(
              (r) =>
                `### ${r.id}\n${r.description}\n\nParameters:\n${summarizeParameters(r.parameters)}`,
            )
            .join('\n\n---\n\n');

          return `Found ${results.length} tool(s):\n\n${formatted}`;
        },
      }),

      tool_search_regex: tool({
        description: [
          'Search for tools using a regex pattern (case-insensitive).',
          'Matches against tool names and descriptions.',
          '',
          'Examples:',
          '  tool_search_regex({ pattern: "github.*issue" }) → GitHub issue tools',
          '  tool_search_regex({ pattern: "^read" })         → tools starting with "read"',
          '  tool_search_regex({ pattern: "file|directory" }) → file/directory tools',
        ].join('\n'),
        args: {
          pattern: tool.schema
            .string()
            .describe('Regex pattern to match against tool names and descriptions'),
        },
        async execute(args) {
          let results: CatalogEntry[];
          try {
            results = catalog.searchRegex(args.pattern, searchLimit);
          } catch {
            return `Invalid regex: "${args.pattern}". Provide a valid regex pattern.`;
          }

          if (results.length === 0) {
            return `No tools matched pattern "${args.pattern}". Try a different regex.`;
          }

          const formatted = results
            .map(
              (r) =>
                `### ${r.id}\n${r.description}\n\nParameters:\n${summarizeParameters(r.parameters)}`,
            )
            .join('\n\n---\n\n');

          return `Found ${results.length} tool(s):\n\n${formatted}`;
        },
      }),
    },

    'tool.definition': async (input, output) => {
      // Search tools are meta — skip cataloging them as discoverable tools
      if (SEARCH_TOOL_IDS.has(input.toolID)) return;

      catalog.register(input.toolID, output.description, output.parameters);

      if (!alwaysLoad.has(input.toolID)) {
        output.description = deferDescription;
        // Keep original parameters — empty schemas break OpenAI Responses API
        // (Missing required parameter: 'input[N].arguments'). See issue #7.
      }
    },

    'experimental.chat.system.transform': async (input, output) => {
      totalCount = catalog.size;
      deferredCount = totalCount - (alwaysLoad.size - SEARCH_TOOL_IDS.size);
      if (deferredCount < 0) deferredCount = 0;

      if (deferredCount > 0) {
        const isAnthropic = input.model?.providerID === 'anthropic';

        const lines = [
          `[Tool Search] You have access to ${totalCount} tools total. ${deferredCount} of them have deferred descriptions ([d]) to save context.`,
          'When you see a tool with "[d]" in its description, call tool_search("<keywords>") to discover its full capabilities before using it.',
          'Always search before concluding you lack a capability.',
        ];

        if (!isAnthropic) {
          lines.push(
            'IMPORTANT: Do NOT call any tool whose description is just "[d]". You MUST call tool_search first to get the full description and parameters, then call the tool.',
          );
        }

        output.system.push(lines.join(' '));

        if (!toastShown) {
          toastShown = true;
          showToast(
            ctx,
            'Tool Search',
            `${deferredCount}/${totalCount} tools deferred.`,
            'info',
            4000,
          );
        }
      }
    },
  };
};
