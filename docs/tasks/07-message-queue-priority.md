# Message Queue Priority Lanes

## Priority: Medium

## Problem
All tasks go through the same FIFO queue in `ThreadSession._drain()`. A `!cancel` command is handled outside the queue (good), but other operations like `!status` or `!model` must wait behind a pending prompt.

## Current Behavior
- `_tasks` is a simple `Array<() => Promise<void>>`
- `_drain` processes sequentially, FIFO
- `!cancel` bypasses the queue via `abort()` directly (already correct)

## Proposed Solution
1. Split into two queues: `_priorityTasks` and `_tasks`
2. `_drain` always processes all priority tasks before normal tasks
3. Priority tasks: status queries, model changes, thinking level changes
4. Normal tasks: prompts, ralph commands
5. Alternative (simpler): just make `!status`, `!model`, `!thinking` bypass the queue entirely since they don't need to wait for the agent — they read/write session state directly

## Files to Change
- `src/thread-session.ts` — add priority queue or bypass
- `src/thread-session.test.ts` — test ordering
- `src/commands.ts` — mark which commands are priority

## Risks
- Complexity vs benefit tradeoff — the simpler bypass approach may be sufficient
- Race conditions if priority tasks modify state while a prompt is running
