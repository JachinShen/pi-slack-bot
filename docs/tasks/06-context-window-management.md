# Conversation Context Window Management

## Priority: Medium

## Problem
Long conversations will eventually exceed the model's context limit, causing errors or silent truncation. Users have no visibility into how much context they've consumed.

## Current Behavior
- No token tracking or context usage reporting
- No warning when approaching limits
- The only escape valve is `!new` to start fresh

## Proposed Solution
1. Track token usage from agent session events (pi likely exposes `usage` in message events)
2. Show context usage in `!status`:
   ```
   *Context:* 45,200 / 200,000 tokens (23%)
   ```
3. Post a warning when context exceeds 80%:
   ```
   ⚠️ Context is 80% full (160K/200K tokens). Consider `!new` to start fresh.
   ```
4. Optionally: auto-summarize older messages when context hits 90% (stretch goal)
5. Model context limits should come from pi's model registry if available, with fallback hardcoded values

## Files to Change
- `src/thread-session.ts` — track token usage from events
- `src/commands.ts` — enhance `!status` output
- `src/streaming-updater.ts` — post context warnings after finalize

## Risks
- Token counts may not be available from all providers
- Auto-summarization could lose important context
- Different models have wildly different limits
