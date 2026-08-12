# Structured Logging

## Priority: Medium

## Problem
Logging is ad-hoc `console.log`/`console.error` with inconsistent context. Hard to filter, search, or aggregate in production.

## Current Behavior
- Manual string formatting: `[ThreadSession ${this.threadTs}] Task error:`
- No log levels besides log vs error
- No structured fields for filtering

## Proposed Solution
1. Create `src/logger.ts` with a thin structured logger:
   ```ts
   export function createLogger(module: string) {
     return {
       info(msg: string, ctx?: Record<string, unknown>) { ... },
       warn(msg: string, ctx?: Record<string, unknown>) { ... },
       error(msg: string, ctx?: Record<string, unknown>) { ... },
       debug(msg: string, ctx?: Record<string, unknown>) { ... },
     };
   }
   ```
2. Output as JSON lines: `{"ts":"...","level":"info","module":"streaming-updater","threadTs":"...","msg":"..."}`
3. Support `LOG_LEVEL` env var (default: `info`)
4. Replace all `console.log`/`console.error` calls across the codebase
5. No external dependencies — just `JSON.stringify` to stdout/stderr

## Files to Change
- `src/logger.ts` — new module
- `src/logger.test.ts` — new tests
- `src/config.ts` — add `logLevel` config
- Every module that uses `console.log`/`console.error`

## Risks
- JSON logs are harder to read in development — add a `LOG_FORMAT=pretty` option
- Ensure no secrets leak into structured log fields
