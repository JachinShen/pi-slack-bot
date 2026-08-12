# Health Check / Monitoring Endpoint

## Priority: Medium

## Problem
No way to know if the bot is healthy without checking Slack manually. Can't integrate with uptime monitors or alerting.

## Current Behavior
- No HTTP server (uses Socket Mode only)
- No health metrics exposed
- Only indication of life is responding in Slack

## Proposed Solution
1. Add an optional HTTP server on `HEALTH_PORT` (default: 3002)
2. Endpoints:
   - `GET /health` → `200 {"status":"ok","uptime":1234,"sessions":3}`
   - `GET /sessions` → list of active sessions with last activity timestamps
   - `GET /metrics` → Prometheus-compatible metrics (optional, stretch)
3. Track and expose:
   - Uptime
   - Active session count
   - Messages processed (counter)
   - Last message timestamp
   - Slack connection status (Socket Mode connected/disconnected)
4. Use Node.js built-in `http` module — no new dependencies

## Files to Change
- `src/health.ts` — new module with HTTP server
- `src/health.test.ts` — new tests
- `src/config.ts` — add `healthPort` config
- `src/index.ts` — start health server

## Risks
- Port conflicts — make it optional (only start if HEALTH_PORT is set)
- Don't expose sensitive info on the health endpoint
