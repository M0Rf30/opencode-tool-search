import { build } from 'esbuild';

await build({
  entryPoints: ['dist/index.js'],
  bundle: true,
  outfile: 'dist/index.js',
  allowOverwrite: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['@opencode-ai/plugin', 'zod', 'effect'],
});
