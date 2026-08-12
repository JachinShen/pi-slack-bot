# Strengthen Edge Case Test Coverage

## Priority: Low (Code Quality)

## Problem
Test files exist for every module, but several production-critical edge cases lack coverage.

## Current Coverage Gaps

### StreamingUpdater
- [ ] Slack API returns 429 (rate limit) during flush
- [ ] `chat.update` fails mid-stream (network error)
- [ ] Rapid tool start/end events causing flush storms
- [ ] Message splitting edge cases (code block spanning split boundary)
- [ ] `msg_too_long` retry reducing below minimum limit

### SessionManager
- [ ] Reaper fires during active streaming session
- [ ] `getOrCreate` called concurrently for the same threadTs (race condition)
- [ ] Session limit reached, then one disposes — does the next create succeed?
- [ ] `disposeAll` during active streaming

### FilePicker
- [ ] Picker timeout (user never clicks)
- [ ] Two file pickers open in same thread
- [ ] Directory permissions error during browse

### ThreadSession
- [ ] Two messages arrive for same thread before session is created (double-create race)
- [ ] `prompt()` called while previous prompt still streaming
- [ ] `abort()` called when no stream is active
- [ ] Extension triggers agent turn after session is disposed

### Formatter
- [ ] Markdown with nested code blocks (` ``` ` inside ` ``` `)
- [ ] Tables inside code blocks (should not be converted)
- [ ] Empty table (only header + separator, no data rows)
- [ ] Unicode in tool arguments

## Proposed Solution
- Add focused test cases for each gap above
- Use mock/stub Slack client (already done in existing tests) to simulate failures
- Add a "stress test" for concurrent operations

## Files to Change
- `src/streaming-updater.test.ts`
- `src/session-manager.test.ts`
- `src/file-picker.test.ts`
- `src/thread-session.test.ts`
- `src/formatter.test.ts`
