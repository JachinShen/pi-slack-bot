# Session Resilience (Auto-Restore on Restart)

## Priority: High

## Problem
All sessions are in-memory. When the bot process restarts, users lose their sessions and must manually `!resume`. This is disruptive during deploys or crashes.

## Current Behavior
- `BotSessionManager` stores sessions in a `Map<string, ThreadSession>`
- Session files are persisted to disk (JSONL) by pi's `SessionManager`
- But the mapping of threadTs → {channelId, cwd, sessionPath} is lost on restart

## Proposed Solution
1. Persist an `active-sessions.json` file in `SESSION_DIR`:
   ```json
   {
     "sessions": [
       { "threadTs": "...", "channelId": "...", "cwd": "/path/to/project", "sessionPath": "/path/to/session.jsonl" }
     ]
   }
   ```
2. Write to this file on session create/dispose (debounced)
3. On startup, read this file and auto-restore sessions
4. Post a reconnection message to each thread: "🔄 Session restored after restart"
5. Clean up entries for session files that no longer exist

## Files to Change
- `src/session-manager.ts` — add persist/restore logic
- `src/session-manager.test.ts` — test persist/restore
- `src/index.ts` — call restore on startup
- `src/thread-session.ts` — ensure resume path works for auto-restore

## Risks
- Stale entries if session files are manually deleted
- Race condition: restore happening while new messages arrive
- Large number of sessions at startup could be slow — restore lazily or in parallel
