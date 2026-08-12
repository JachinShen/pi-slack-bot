import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { handleReaction, REACTION_MAP } from "./reactions.js";
import { PinStore } from "./pin-store.js";

function makeClient(overrides: Record<string, any> = {}) {
  return {
    chat: {
      postMessage: vi.fn(async () => ({ ok: true })),
      getPermalink: vi.fn(async () => ({ permalink: "https://slack.com/archives/C1/p123" })),
      ...overrides.chat,
    },
    conversations: {
      replies: vi.fn(async () => ({
        messages: [
          { ts: "msg1", user: "U_BOT", text: "Here is my response" },
          { ts: "msg2", user: "U_USER", text: "thanks" },
        ],
      })),
      ...overrides.conversations,
    },
  } as any;
}

function makePinStore(): PinStore {
  const dir = join(tmpdir(), `pin-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return new PinStore(dir);
}

function makeSession(overrides: Record<string, any> = {}) {
  return {
    cwd: "/workspace/project",
    isStreaming: false,
    lastUserPrompt: null as string | null,
    abort: vi.fn(),
    enqueue: vi.fn((fn: () => Promise<void>) => fn()),
    prompt: vi.fn(async () => {}),
    pasteProvider: { create: async () => null },
    getContextUsage: vi.fn(() => ({ tokens: 45000, contextWindow: 200000, percent: 23 })),
    compact: vi.fn(async () => ({ summary: "compacted", firstKeptEntryId: "1", tokensBefore: 180000 })),
    ...overrides,
  } as any;
}

function getPosted(client: any): string[] {
  return client.chat.postMessage.mock.calls.map((c: any) => c[0].text);
}

describe("REACTION_MAP", () => {
  it("maps x to cancel", () => {
    assert.equal(REACTION_MAP.x, "cancel");
  });

  it("maps arrows_counterclockwise to retry", () => {
    assert.equal(REACTION_MAP.arrows_counterclockwise, "retry");
  });

  it("maps clipboard to diff", () => {
    assert.equal(REACTION_MAP.clipboard, "diff");
  });

  it("maps clamp to compact", () => {
    assert.equal(REACTION_MAP.clamp, "compact");
  });

  it("maps pushpin to pin", () => {
    assert.equal(REACTION_MAP.pushpin, "pin");
  });
});

describe("handleReaction", () => {
  it("returns false for unknown emoji", async () => {
    const client = makeClient();
    const session = makeSession();
    const result = await handleReaction("thumbsup", session, client, "C1", "ts1", "msg1");
    assert.equal(result, false);
    assert.equal(client.chat.postMessage.mock.calls.length, 0);
  });

  it("cancel: aborts session and posts message", async () => {
    const client = makeClient();
    const session = makeSession();
    const result = await handleReaction("x", session, client, "C1", "ts1", "msg1");
    assert.equal(result, true);
    assert.equal(session.abort.mock.calls.length, 1);
    assert.ok(getPosted(client)[0].includes("Cancelled"));
  });

  it("retry: retries last prompt", async () => {
    const client = makeClient();
    const session = makeSession({ lastUserPrompt: "explain this code" });
    const result = await handleReaction("arrows_counterclockwise", session, client, "C1", "ts1", "msg1");
    assert.equal(result, true);
    assert.ok(getPosted(client)[0].includes("Retrying"));
    assert.ok(getPosted(client)[0].includes("explain this code"));
    assert.equal(session.enqueue.mock.calls.length, 1);
  });

  it("retry: posts message when no previous prompt", async () => {
    const client = makeClient();
    const session = makeSession({ lastUserPrompt: null });
    const result = await handleReaction("arrows_counterclockwise", session, client, "C1", "ts1", "msg1");
    assert.equal(result, true);
    assert.ok(getPosted(client)[0].includes("No previous prompt"));
    assert.equal(session.enqueue.mock.calls.length, 0);
  });

  it("retry: truncates long prompts in confirmation message", async () => {
    const client = makeClient();
    const longPrompt = "x".repeat(200);
    const session = makeSession({ lastUserPrompt: longPrompt });
    await handleReaction("arrows_counterclockwise", session, client, "C1", "ts1", "msg1");
    const msg = getPosted(client)[0];
    assert.ok(msg.length < 200, "confirmation should be truncated");
    assert.ok(msg.includes("…"), "should have ellipsis");
  });

  it("compact: compacts and reports tokens", async () => {
    const client = makeClient();
    const session = makeSession();
    const result = await handleReaction("clamp", session, client, "C1", "ts1", "msg1");
    assert.equal(result, true);
    const msgs = getPosted(client);
    assert.equal(msgs.length, 2);
    assert.ok(msgs[0].includes("Compacting"));
    assert.ok(msgs[1].includes("180K"));
    assert.ok(msgs[1].includes("45K"));
  });

  it("compact: rejects while streaming", async () => {
    const client = makeClient();
    const session = makeSession({ isStreaming: true });
    const result = await handleReaction("clamp", session, client, "C1", "ts1", "msg1");
    assert.equal(result, true);
    assert.ok(getPosted(client)[0].includes("Can't compact while streaming"));
    assert.equal(session.compact.mock.calls.length, 0);
  });

  it("compact: handles failure", async () => {
    const client = makeClient();
    const session = makeSession({
      compact: vi.fn(async () => { throw new Error("compaction failed"); }),
    });
    const result = await handleReaction("clamp", session, client, "C1", "ts1", "msg1");
    assert.equal(result, true);
    const msgs = getPosted(client);
    assert.ok(msgs[1].includes("Compaction failed"));
  });

  it("diff: posts no changes message when no diff", async () => {
    const client = makeClient();
    const session = makeSession({ cwd: "/tmp/nonexistent-repo-" + Date.now() });
    const result = await handleReaction("clipboard", session, client, "C1", "ts1", "msg1");
    assert.equal(result, true);
    assert.ok(getPosted(client)[0].includes("No uncommitted changes"));
  });

  // ── Pin reaction tests ──────────────────────────────────────────

  it("pin: pins the reacted message and confirms", async () => {
    const client = makeClient();
    const session = makeSession();
    const pinStore = makePinStore();
    const result = await handleReaction("pushpin", session, client, "C1", "ts1", "msg1", pinStore);
    assert.equal(result, true);
    assert.equal(pinStore.all.length, 1);
    const pin = pinStore.all[0];
    assert.equal(pin.preview, "Here is my response");
    assert.equal(pin.permalink, "https://slack.com/archives/C1/p123");
    assert.ok(pin.timestamp);
    assert.equal(pin.channelId, "C1");
    assert.equal(pin.threadTs, "ts1");
    assert.ok(getPosted(client)[0].includes("📌 Pinned"));
    assert.ok(getPosted(client)[0].includes("Here is my response"));
  });

  it("pin: truncates long messages to 150 chars", async () => {
    const longText = "a".repeat(200);
    const client = makeClient({
      conversations: {
        replies: vi.fn(async () => ({
          messages: [{ ts: "msg1", user: "U_BOT", text: longText }],
        })),
      },
    });
    const session = makeSession();
    const pinStore = makePinStore();
    await handleReaction("pushpin", session, client, "C1", "ts1", "msg1", pinStore);
    const pin = pinStore.all[0];
    assert.equal(pin.preview.length, 151); // 150 chars + "…"
    assert.ok(pin.preview.endsWith("…"));
  });

  it("pin: reports error when message not found", async () => {
    const client = makeClient({
      conversations: {
        replies: vi.fn(async () => ({ messages: [] })),
      },
    });
    const session = makeSession();
    const pinStore = makePinStore();
    const result = await handleReaction("pushpin", session, client, "C1", "ts1", "msg_missing", pinStore);
    assert.equal(result, true);
    assert.equal(pinStore.all.length, 0);
    assert.ok(getPosted(client)[0].includes("Couldn't find"));
  });

  it("pin: handles API errors gracefully", async () => {
    const client = makeClient({
      conversations: {
        replies: vi.fn(async () => { throw new Error("api_error"); }),
      },
    });
    const session = makeSession();
    const pinStore = makePinStore();
    const result = await handleReaction("pushpin", session, client, "C1", "ts1", "msg1", pinStore);
    assert.equal(result, true);
    assert.equal(pinStore.all.length, 0);
    assert.ok(getPosted(client)[0].includes("Failed to pin"));
  });
});
