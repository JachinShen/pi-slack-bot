# Robust Ralph Notification Handling

## Priority: Low (Code Quality)

## Problem
Ralph notifications are detected via a long, brittle regex in the `notify` callback. Every time Ralph changes its message format, this regex needs manual updating.

## Current Behavior
```ts
const isRalphMsg = /Ralph loop|ralph loop|[Ll]oop (paused|resumed|auto-resumed|ended|...)/i.test(message);
```
- Pattern is ~200 chars and growing
- Case-insensitive matching is inconsistent (some parts use `[Ll]`, others use `i` flag)
- "ended" detection for `_ralphBackgroundActive` is also regex-based

## Proposed Solution

### Option A: Structured notifications from Ralph
- Propose to Ralph extension: include a structured prefix or metadata:
  ```
  [ralph] Loop ended: task complete
  ```
- Parse the prefix rather than matching free-text patterns

### Option B: Notification tagging in pi SDK
- Propose to pi: `notify(message, { type, source })` where source identifies the extension
- Filter by `source === "ralph"`

### Option C: Improve current approach (short-term)
- Extract regex patterns to named constants
- Add tests for each expected Ralph message format
- Use a single `isRalphNotification(message)` function that's testable

## Files to Change
- `src/thread-session.ts` — extract notification detection
- `src/ralph-notifications.ts` — new module with `isRalphNotification()`, `isRalphEndNotification()`
- `src/ralph-notifications.test.ts` — comprehensive pattern tests

## Risks
- Options A and B require upstream changes
- Option C is still fragile but at least testable
