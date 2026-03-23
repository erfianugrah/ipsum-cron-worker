# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.

## Docs

- https://developers.cloudflare.com/workers/
- MCP: `https://docs.mcp.cloudflare.com/mcp`

For all limits and quotas, retrieve from the product's `/platform/limits/` page. eg. `/workers/platform/limits`

## Build / Dev / Deploy Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local dev server with `--test-scheduled` flag |
| `npm run deploy` | Deploy to Cloudflare (`wrangler deploy`) |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` (`wrangler types`) |

Run `npm run cf-typegen` after changing bindings in `wrangler.jsonc`.

### Testing the Scheduled Handler Locally

```sh
npm run dev
# In another terminal:
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

### Testing

Vitest with `@cloudflare/vitest-pool-workers` is configured. Config is in `vitest.config.mts` (ESM).

```sh
npm test                                    # run all tests once
npm run test:watch                          # run all tests (watch mode)
npx vitest run test/ipsum.test.ts           # single test file
npx vitest run -t "test name pattern"       # single test by name
```

### Type Checking

```sh
npx tsc --noEmit
```

TypeScript is configured with `strict: true` in `tsconfig.json`. Target is `es2024`.

## Node.js Compatibility

The `nodejs_compat` compatibility flag is enabled. See:
https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: https://developers.cloudflare.com/workers/observability/errors/

## Product Docs

Retrieve API references and limits from:
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`

---

## Code Style

### Formatter

Prettier is the sole formatter. No linter (ESLint/Biome) is configured. Settings (`.prettierrc`):

- Tabs for indentation (not spaces)
- Single quotes
- Semicolons always
- Print width: 140
- Trailing commas: all (Prettier v3 default)
- LF line endings

### Imports

- Use ES module `import`/`export` syntax (the project targets `es2022` modules).
- Cloudflare Workers runtime globals (`Response`, `Request`, `fetch`, `URL`, `crypto`, etc.) and the `Env` interface are available as ambient types — do not import them.
- `worker-configuration.d.ts` is auto-generated. Never edit it manually; run `npm run cf-typegen` to regenerate.

### Types and Type Annotations

- Prefer letting TypeScript infer types. Add explicit annotations only when inference is insufficient or for function return types that are non-obvious.
- Use the `satisfies` operator on the default export to type-check against `ExportedHandler<Env>` without widening.
- Use `interface` for object shapes (not `type` aliases) unless a union or mapped type is needed.
- Define shared types in dedicated `.d.ts` files or a `types.ts` module — not inline in handler files.
- The `Env` interface is declared in `worker-configuration.d.ts`. Add bindings in `wrangler.jsonc`, then run `npm run cf-typegen`.

### Naming Conventions

| Element | Convention | Examples |
|---------|-----------|----------|
| Variables / parameters | camelCase | `wasSuccessful`, `resp` |
| Functions / methods | camelCase | `handleRequest`, `scheduled` |
| Types / Interfaces | PascalCase | `Env`, `ExportedHandler` |
| Files | kebab-case | `my-handler.ts`, `api-client.ts` |
| Constants | camelCase or UPPER_SNAKE_CASE | `maxRetries`, `MAX_RETRIES` |

Short parameter names are acceptable for well-known patterns: `req`, `resp`, `env`, `ctx`, `err`.

### Variable Declarations

- Prefer `const` for variables that are not reassigned.
- Use `let` when reassignment is needed. Never use `var`.

### Functions

- Use async method shorthand on the exported handler object:
  ```ts
  export default {
      async fetch(req) { ... },
      async scheduled(event, env, ctx): Promise<void> { ... },
  } satisfies ExportedHandler<Env>;
  ```
- For standalone utility functions, prefer arrow functions:
  ```ts
  const parseBody = async (req: Request): Promise<SomeType> => { ... };
  ```

### Exports

- The entry point (`src/index.ts`) must have a single `export default` conforming to `ExportedHandler<Env>`.
- Utility modules should use named exports.

### Error Handling

- Wrap `fetch` calls and external I/O in `try/catch`.
- Use `ctx.waitUntil()` for background work that must survive the response.
- Log errors with `console.error()`. The worker has observability enabled.
- For scheduled handlers, catch and log errors so the cron trigger doesn't silently fail:
  ```ts
  async scheduled(event, env, ctx): Promise<void> {
      try {
          // ... handler logic
      } catch (err) {
          console.error('Scheduled handler failed:', err);
      }
  }
  ```

### Comments

- Use `/** ... */` JSDoc blocks for file-level documentation.
- Use `//` single-line comments for inline explanations.
- Keep comments minimal — explain *why*, not *what*.

### Project Structure

```
src/
  index.ts              # Entry point — exports the ExportedHandler
  (additional modules)  # Add as needed: utils, handlers, types
worker-configuration.d.ts  # Auto-generated (do not edit)
wrangler.jsonc             # Worker config, bindings, cron triggers
tsconfig.json
.prettierrc
```

### Pre-commit Hook

A git pre-commit hook checks for unencrypted secrets in `.env`, `.tfvars`, `.tfstate`, `.yaml`, and `.json` files. To bypass for non-sensitive files, add paths to `.allow-unencrypted-paths`.

### Key Constraints

- **CPU time limit**: 10ms (free) / 30s (paid) for scheduled workers. Retrieve current limits from `/workers/platform/limits/`.
- **No `node_modules` bundling**: Wrangler bundles the worker. Use `npm` dependencies normally.
- **Compatibility date**: `2026-03-17` — set in `wrangler.jsonc`. Do not change without reviewing breaking changes.
