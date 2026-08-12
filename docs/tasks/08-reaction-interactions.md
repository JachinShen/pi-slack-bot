# Reaction-Based Interactions

## Priority: Medium

## Problem
Interacting with the bot requires typing commands. Slack reactions (emoji) are a more natural, lower-friction interaction model.

## Current Behavior
- All interaction is text-based (`!commands`) or button-based (pickers)
- No `reaction_added` event handling

## Proposed Solution
1. Register `app.event("reaction_added")` handler
2. Supported reactions on bot messages:
   - 🔄 (`:arrows_counterclockwise:`) → Retry the last prompt
   - ❌ (`:x:`) → Cancel current stream (`!cancel`)
   - 📋 (`:clipboard:`) → Show full diff (`!diff`)
   - 🆕 (`:new:`) → New session (`!new`)
   - 👀 (`:eyes:`) → Show status (`!status`)
3. Only respond to reactions from allowed users
4. Only respond to reactions on bot messages (not user messages)
5. Remove the reaction after processing to indicate it was handled

## Files to Change
- `src/slack.ts` — add reaction event handler
- `src/slack.test.ts` — test reaction routing
- `src/commands.ts` — may need to refactor handlers to be callable from both text and reaction paths

## Risks
- Accidental triggers — users might react casually without intent
- Need to verify the reaction target is a bot message
- "Retry last prompt" needs access to the previous user message
