# Slack Slash Command Support

## Priority: Low

## Problem
`!` prefix commands are a workaround. Slack natively supports slash commands with autocomplete, ephemeral responses, and better UX.

## Current Behavior
- All commands use `!` prefix parsed from message text
- No slash command registration

## Proposed Solution
1. Register slash commands in the Slack app manifest:
   - `/pi <prompt>` — send a prompt
   - `/pi-model <name>` — switch model
   - `/pi-status` — show session info (ephemeral)
   - `/pi-cancel` — cancel stream
   - `/pi-new` — new session
2. Add Bolt slash command handlers that delegate to existing command logic
3. Use ephemeral responses for status/info commands (only visible to the invoker)
4. Keep `!` prefix support for backward compat
5. Thread context: slash commands include `channel_id` but threading requires posting to the correct thread — may need the user to invoke from within a thread

## Files to Change
- `src/slack.ts` — add `app.command()` handlers
- `src/commands.ts` — refactor to support both text and slash command contexts
- Slack app manifest — register commands

## Risks
- Slash commands don't natively work in threads (they post to channel root)
- Would need to resolve which thread to target — possibly by most-recent session
- Requires Slack app reconfiguration (new scopes, command registration)
