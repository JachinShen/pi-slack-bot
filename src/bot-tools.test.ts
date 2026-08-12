import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createRestartBotTool, createSetModelTool, createSetThinkingLevelTool } from "./bot-tools.js";
import type { BotSessionManager } from "./session-manager.js";
import type { ThreadSession } from "./thread-session.js";

// --- restart_bot ---

describe("restart_bot", () => {
  let mockSessionManager: Partial<BotSessionManager>;

  beforeEach(() => {
    mockSessionManager = {
      stopReaper: vi.fn(),
      disposeAll: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      flushRegistry: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      disposeRegistry: vi.fn(),
    };
  });

  it("calls graceful shutdown sequence", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const tool = createRestartBotTool(() => ({ sessionManager: mockSessionManager as BotSessionManager }));

    await tool.execute({});

    assert.equal((mockSessionManager.stopReaper as ReturnType<typeof vi.fn>).mock.calls.length, 1);
    assert.equal((mockSessionManager.disposeAll as ReturnType<typeof vi.fn>).mock.calls.length, 1);
    assert.equal((mockSessionManager.flushRegistry as ReturnType<typeof vi.fn>).mock.calls.length, 1);
    assert.equal((mockSessionManager.disposeRegistry as ReturnType<typeof vi.fn>).mock.calls.length, 1);

    exitSpy.mockRestore();
  });

  it("returns restart message", async () => {
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const tool = createRestartBotTool(() => ({ sessionManager: mockSessionManager as BotSessionManager }));

    const result = await tool.execute({});
    assert.ok(Array.isArray(result.content));
    assert.ok(result.content[0].text.includes("Restarting"));

    vi.restoreAllMocks();
  });
});

// --- set_model ---

describe("set_model", () => {
  let mockSession: Partial<ThreadSession>;

  beforeEach(() => {
    mockSession = {
      setModel: vi.fn<(name: string) => Promise<void>>().mockResolvedValue(undefined),
    };
  });

  it("delegates to session.setModel", async () => {
    const tool = createSetModelTool(() => mockSession as ThreadSession);
    await tool.execute("call-1", { model: "anthropic/claude-sonnet-4-5" });
    assert.equal((mockSession.setModel as ReturnType<typeof vi.fn>).mock.calls[0][0], "anthropic/claude-sonnet-4-5");
  });

  it("returns error on invalid model", async () => {
    mockSession.setModel = vi.fn<(name: string) => Promise<void>>().mockRejectedValue(new Error("Model not found: bad-model"));
    const tool = createSetModelTool(() => mockSession as ThreadSession);
    const result = await tool.execute("call-2", { model: "bad-model" });
    assert.ok(result.content[0].text.includes("Model not found"));
  });
});

// --- set_thinking_level ---

describe("set_thinking_level", () => {
  let mockSession: Partial<ThreadSession>;

  beforeEach(() => {
    mockSession = {
      setThinkingLevel: vi.fn(),
    };
  });

  it("accepts valid levels", async () => {
    const tool = createSetThinkingLevelTool(() => mockSession as ThreadSession);
    for (const level of ["off", "minimal", "low", "medium", "high", "xhigh"]) {
      await tool.execute("call-1", { level });
    }
    assert.equal((mockSession.setThinkingLevel as ReturnType<typeof vi.fn>).mock.calls.length, 6);
  });

  it("normalizes case", async () => {
    const tool = createSetThinkingLevelTool(() => mockSession as ThreadSession);
    await tool.execute("call-2", { level: "HIGH" });
    assert.equal((mockSession.setThinkingLevel as ReturnType<typeof vi.fn>).mock.calls[0][0], "high");
  });

  it("rejects invalid levels", async () => {
    const tool = createSetThinkingLevelTool(() => mockSession as ThreadSession);
    const result = await tool.execute("call-3", { level: "turbo" });
    assert.ok(result.content[0].text.includes("Invalid"));
  });
});
