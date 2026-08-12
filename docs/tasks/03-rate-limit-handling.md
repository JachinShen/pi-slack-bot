# Graceful Slack Rate Limit Handling

## Priority: High

## Problem
`StreamingUpdater` calls `chat.update` on every flush (throttled to `STREAM_THROTTLE_MS`, default 3s). Slack rate-limits `chat.update` to ~50/min per channel. During tool-heavy turns with immediate flushes, we can exceed this and lose updates silently.

## Current Behavior
- `_immediateFlush` bypasses the throttle timer (used for tool start/end)
- No retry logic on 429 responses
- `_postChunked` only retries on `msg_too_long`, not rate limits

## Proposed Solution
1. Wrap Slack API calls in a retry helper that respects `Retry-After` headers
2. Use exponential backoff: 1s, 2s, 4s with max 3 retries
3. Coalesce rapid tool start/end flushes — batch within a 500ms window instead of flushing per-event
4. Add a `_pendingFlush` flag so multiple immediate flush requests collapse into one
5. Log rate limit hits for monitoring

## Files to Change
- `src/streaming-updater.ts` — add retry wrapper, coalesce flushes
- `src/streaming-updater.test.ts` — test retry and coalescing behavior

## Risks
- Retry delays could make streaming feel laggy — cap total retry time
- Coalescing tool events might briefly show stale tool status
