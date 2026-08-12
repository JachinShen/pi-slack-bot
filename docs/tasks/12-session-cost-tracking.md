# Session Cost Tracking

## Priority: Low

## Problem
No visibility into token usage or cost per session. Users can't tell if a conversation is expensive or if they should start fresh.

## Current Behavior
- No token counting
- No cost estimation
- `!status` shows message count but not token usage

## Proposed Solution
1. Subscribe to agent events that include usage metadata (input/output tokens)
2. Track cumulative tokens per session:
   ```ts
   interface TokenUsage {
     inputTokens: number;
     outputTokens: number;
     cacheReadTokens: number;
     cacheWriteTokens: number;
   }
   ```
3. Estimate cost using per-model pricing tables (hardcoded, updatable):
   ```ts
   const PRICING: Record<string, { input: number; output: number }> = {
     "claude-sonnet-4-5": { input: 3.0, output: 15.0 }, // per 1M tokens
     ...
   };
   ```
4. Show in `!status`:
   ```
   *Tokens:* 45.2K in / 12.1K out (~$0.32)
   ```
5. Show cost summary on session end (in the ✅ reaction message or a follow-up)

## Files to Change
- `src/thread-session.ts` — track token usage from events
- `src/commands.ts` — enhance `!status`
- `src/cost.ts` — new module for pricing tables and estimation
- `src/cost.test.ts` — new tests

## Risks
- Token counts may not be available from all providers/models
- Pricing changes frequently — need easy update path
- Cache tokens complicate cost estimation
