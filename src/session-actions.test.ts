import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { cancelSession, compactSession, showDiff } from "./session-actions.js";

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    cwd: "/workspace/project",
    isStreaming: false,
    abort: vi.fn(),
    pasteProvider: { create: async () => null },
    getContextUsage: vi.fn(() => ({ tokens: 45000, contextWindow: 200000, percent: 23 })),
    compact: vi.fn(async () => ({ summary: "compacted", firstKeptEntryId: "1", tokensBefore: 180000 })),
    ...overrides,
  } as any;
}

describe("cancelSession", () => {
  it("aborts and replies", async () => {
    const session = makeSession();
    const replies: string[] = [];
    await cancelSession(session, async (t) => { replies.push(t); });
    assert.equal(session.abort.mock.calls.length, 1);
    assert.ok(replies[0].includes("Cancelled"));
  });
});

describe("compactSession", () => {
  it("compacts and reports token counts", async () => {
    const session = makeSession();
    const replies: string[] = [];
    await compactSession(session, async (t) => { replies.push(t); });
    assert.equal(replies.length, 2);
    assert.ok(replies[0].includes("Compacting"));
    assert.ok(replies[1].includes("180K"));
    assert.ok(replies[1].includes("45K"));
  });

  it("rejects while streaming", async () => {
    const session = makeSession({ isStreaming: true });
    const replies: string[] = [];
    await compactSession(session, async (t) => { replies.push(t); });
    assert.equal(replies.length, 1);
    assert.ok(replies[0].includes("Can't compact"));
    assert.equal(session.compact.mock.calls.length, 0);
  });

  it("handles compact failure", async () => {
    const session = makeSession({
      compact: vi.fn(async () => { throw new Error("boom"); }),
    });
    const replies: string[] = [];
    await compactSession(session, async (t) => { replies.push(t); });
    assert.ok(replies[1].includes("Compaction failed"));
    assert.ok(replies[1].includes("boom"));
  });
});

describe("showDiff", () => {
  it("reports no changes for non-git directory", async () => {
    const session = makeSession({ cwd: "/tmp/nonexistent-repo-" + Date.now() });
    const replies: string[] = [];
    const mockClient = { chat: { postMessage: vi.fn() } } as any;
    await showDiff(session, async (t) => { replies.push(t); }, mockClient, "C1", "ts1");
    assert.ok(replies[0].includes("No uncommitted changes"));
  });
});
