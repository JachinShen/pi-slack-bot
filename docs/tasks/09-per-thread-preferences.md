# Per-Thread Model/Thinking Persistence

## Priority: Low

## Problem
When you `!model` or `!thinking` in a thread, the preference is lost when the session is reaped or the bot restarts. Users must re-set preferences every time.

## Current Behavior
- Model and thinking level are set on the `AgentSession` in memory
- Defaults come from `.env` (`PROVIDER`, `MODEL`, `THINKING_LEVEL`)
- No persistence of per-thread overrides

## Proposed Solution
1. Store per-cwd preferences in `~/.pi-slack-bot/preferences.json`:
   ```json
   {
     "/path/to/project": { "model": "claude-sonnet-4-5", "thinkingLevel": "medium" }
   }
   ```
2. When creating a session, check for saved preferences for that cwd
3. When `!model` or `!thinking` is used, update both the session and the persisted file
4. Add `!prefs` command to view/clear saved preferences
5. `.env` values remain the global defaults; per-cwd prefs override them

## Files to Change
- `src/preferences.ts` — new module for read/write
- `src/preferences.test.ts` — new tests
- `src/thread-session.ts` — apply preferences on create
- `src/commands.ts` — persist on `!model`/`!thinking`, add `!prefs`

## Risks
- Stale preferences for deleted projects
- Preferences file corruption if multiple sessions write simultaneously — use atomic writes
