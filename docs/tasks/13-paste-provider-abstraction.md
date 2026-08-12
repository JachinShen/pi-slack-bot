# Abstract Paste Provider (Remove Amazon Internal Coupling)

## Priority: Low

## Problem
`diff-reviewer.ts` is hardcoded to `paste.amazon.com` with Midway cookie auth. This makes the diff review feature unusable for anyone outside Amazon and couples an otherwise generic project to internal infrastructure.

## Current Behavior
- `createPaste()` uses curl with Midway cookies to POST to paste.amazon.com
- Falls back to Slack file upload on failure
- No way to configure an alternative paste service

## Proposed Solution
1. Define a `PasteProvider` interface:
   ```ts
   interface PasteProvider {
     create(content: string, title: string, language?: string): Promise<PasteResult | null>;
   }
   ```
2. Implement providers:
   - `AmazonPasteProvider` — current paste.amazon.com logic (moved out)
   - `GistPasteProvider` — GitHub Gists via API
   - `NullPasteProvider` — always returns null (Slack file fallback only)
3. Configure via `PASTE_PROVIDER` env var: `amazon`, `gist`, `none` (default: `none`)
4. `GistPasteProvider` uses `GITHUB_TOKEN` for auth
5. Keep Slack file upload as universal fallback

## Files to Change
- `src/paste-provider.ts` — new module with interface + implementations
- `src/paste-provider.test.ts` — new tests
- `src/diff-reviewer.ts` — use injected provider instead of hardcoded `createPaste`
- `src/diff-reviewer.test.ts` — update tests
- `src/config.ts` — add `pasteProvider` config
- `.env.example` — document new vars

## Risks
- GitHub Gist rate limits (60/hr unauthenticated, 5000/hr with token)
- Gists are public by default — ensure we create secret gists
