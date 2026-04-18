# opencode-tool-search

An [OpenCode](https://opencode.ai) plugin that implements Claude's [Tool Search Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) pattern. Reduces context usage by deferring tool descriptions and letting the model discover tools on demand via BM25 keyword search or regex matching.

Inspired by [famitzsy8/opencode-tool-search-tool](https://github.com/famitzsy8/opencode-tool-search-tool) (a fork of opencode). This project achieves similar results as a **standalone plugin** — no core modifications needed.

## How it works

1. The `tool.definition` hook intercepts every tool before the LLM sees it
2. Tools not in `alwaysLoad` get their descriptions replaced with a short `[deferred]` stub (parameters are kept — see [OpenAI compatibility](#openai-compatibility))
3. Two search tools (`tool_search` and `tool_search_regex`) are always available with full descriptions
4. The system prompt tells the model to use `tool_search` when it encounters deferred tools
5. When the model calls `tool_search("file operations")`, it gets back full descriptions and parameter schemas of matching tools

## Token savings

| Setup | Total tools | Deferred | Savings per turn |
|---|---|---|---|
| Built-in only | ~32 | ~24 | ~8,400 tokens (88%) |
| 3 MCP servers | ~60 | ~52 | ~17,000 tokens (89%) |
| 6+ MCP servers | ~190 | ~182 | ~57,000 tokens (91%) |

## Install

```bash
npm install opencode-tool-search
```

Add to your `opencode.jsonc`:

```jsonc
{
  "plugin": [
    ["opencode-tool-search", {
      "alwaysLoad": ["read", "write", "edit", "bash", "glob", "grep"]
    }]
  ]
}
```

### Local development

For local testing with `file://`:

```jsonc
{
  "plugin": [
    ["file:///path/to/opencode-tool-search/dist/index.js", {
      "alwaysLoad": ["read", "write", "edit", "bash", "glob", "grep"]
    }]
  ]
}
```

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `alwaysLoad` | `string[]` | `[]` | Tool IDs that keep full descriptions (never deferred) |
| `searchLimit` | `number` | `5` | Max results per search query |
| `bm25.k1` | `number` | `0.9` | Term frequency saturation (0.5–2.0) |
| `bm25.b` | `number` | `0.4` | Document length normalization (0–1) |
| `deferDescription` | `string` | `[d]` | Custom stub for deferred tools |

### BM25 tuning

Defaults are optimized for smaller language models that send vague queries. For capable models writing specific queries, increase `k1` toward `1.5`.

```jsonc
["opencode-tool-search", {
  "alwaysLoad": ["read", "write", "edit", "bash"],
  "bm25": { "k1": 1.5, "b": 0.75 },
  "searchLimit": 10
}]
```

## Search tools

### `tool_search`

BM25 keyword search. Best for natural language queries.

```
tool_search({ query: "file" })           // → read, write, edit, glob
tool_search({ query: "search code" })     // → grep, ast_grep_search
tool_search({ query: "github issues" })   // → github_list_issues, github_create_issue
```

### `tool_search_regex`

Regex search (case-insensitive). Best for specific patterns.

```
tool_search_regex({ pattern: "github.*issue" })  // → GitHub issue tools
tool_search_regex({ pattern: "^lsp_" })           // → all LSP tools
tool_search_regex({ pattern: "jenkins|build" })   // → Jenkins/CI tools
```

## How it differs from the fork

The [fork](https://github.com/famitzsy8/opencode-tool-search-tool) modifies opencode's core to fully hide deferred tools from the LLM's tool list. This plugin uses the official plugin API:

- Tools are still listed (with a `[d]` stub description; parameters are preserved)
- The `tool.definition` hook strips descriptions; the system prompt guides the model
- ~90% of the fork's benefit with zero core changes
- Works with any opencode version that supports `tool.definition` hook (v1.4.10+)

### What accounts for the remaining ~10%

Each deferred tool still occupies a slot in the tool list with its name (~5-15 tokens), minimal stub (~5 tokens), and parameter schema (~20-50 tokens). With 180 deferred tools this adds up to ~5,400-12,600 tokens per turn. The fork eliminates these entirely by filtering tools in `resolveTools()` before they reach the LLM.

Fully closing the gap requires upstream changes to opencode's plugin API — see [Scalability](#scalability).

## OpenAI compatibility

Earlier versions replaced deferred tool parameters with an empty schema (`z.object({})`). This breaks OpenAI models: when a ChatGPT model calls a deferred tool directly (ignoring the `[d]` stub), the empty schema can produce `undefined` arguments, which the OpenAI Responses API rejects with `Missing required parameter: 'input[N].arguments'`.

Since v0.4.3, deferred tools keep their original parameter schemas — only descriptions are stripped. Parameter schemas are small relative to descriptions, so the token savings impact is minimal (~3-5%). A provider-aware system prompt also tells non-Anthropic models explicitly not to call `[d]` tools without searching first.

## Compatibility with RTK

This plugin works alongside [RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk) with no conflicts. RTK hooks into `tool.execute.before` to compress bash/shell output; this plugin hooks into `tool.definition` and `experimental.chat.system.transform` to defer tool descriptions. Different hooks, complementary token savings.

## Scalability

The `tool.definition` hook can modify tool descriptions and parameters but cannot remove tools from the list entirely. Two upstream proposals would close the remaining gap:

1. **`hidden` field on `tool.definition` output** ([opencode#23297](https://github.com/anomalyco/opencode/issues/23297)) — let plugins suppress tools from the LLM tool list entirely
2. **`defer_loading` passthrough to Anthropic API** ([opencode#23298](https://github.com/anomalyco/opencode/issues/23298)) — pass Anthropic's native `defer_loading: true` through to the API, enabling server-side tool search with prompt cache preservation

## Build

```bash
npm install
npm run build    # tsc + esbuild bundle
```

## License

MIT
