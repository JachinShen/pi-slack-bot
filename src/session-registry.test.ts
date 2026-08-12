import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import fs from "fs/promises";
import { existsSync, writeFileSync } from "fs";
import path from "path";
import os from "os";
import { SessionRegistry, type SessionEntry } from "./session-registry.js";

let tmpDir: string;

function entry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    threadTs: overrides.threadTs ?? "ts1",
    channelId: overrides.channelId ?? "C1",
    cwd: overrides.cwd ?? "/tmp/project",
    sessionPath: overrides.sessionPath ?? path.join(tmpDir, "session.jsonl"),
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "registry-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("SessionRegistry", () => {
  describe("save + load round-trip", () => {
    it("persists and restores entries", async () => {
      const registry = new SessionRegistry(tmpDir);
      // Create a real file so existsSync passes
      const sessionFile = path.join(tmpDir, "session.jsonl");
      writeFileSync(sessionFile, "", "utf-8");

      const entries = [entry({ sessionPath: sessionFile })];
      await registry.save(entries);

      const loaded = await registry.load();
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].threadTs, "ts1");
      assert.equal(loaded[0].channelId, "C1");
      assert.equal(loaded[0].cwd, "/tmp/project");
      assert.equal(loaded[0].sessionPath, sessionFile);
    });

    it("handles multiple entries", async () => {
      const registry = new SessionRegistry(tmpDir);
      const f1 = path.join(tmpDir, "s1.jsonl");
      const f2 = path.join(tmpDir, "s2.jsonl");
      writeFileSync(f1, "", "utf-8");
      writeFileSync(f2, "", "utf-8");

      const entries = [
        entry({ threadTs: "ts1", sessionPath: f1 }),
        entry({ threadTs: "ts2", sessionPath: f2 }),
      ];
      await registry.save(entries);

      const loaded = await registry.load();
      assert.equal(loaded.length, 2);
    });
  });

  describe("load", () => {
    it("returns empty array when file does not exist", async () => {
      const registry = new SessionRegistry(tmpDir);
      const loaded = await registry.load();
      assert.deepEqual(loaded, []);
    });

    it("returns empty array on corrupt JSON", async () => {
      const registry = new SessionRegistry(tmpDir);
      const filePath = path.join(tmpDir, "active-sessions.json");
      writeFileSync(filePath, "not json{{{", "utf-8");

      const loaded = await registry.load();
      assert.deepEqual(loaded, []);
    });

    it("returns empty array when sessions field is missing", async () => {
      const registry = new SessionRegistry(tmpDir);
      const filePath = path.join(tmpDir, "active-sessions.json");
      writeFileSync(filePath, JSON.stringify({ other: "data" }), "utf-8");

      const loaded = await registry.load();
      assert.deepEqual(loaded, []);
    });

    it("filters out entries with missing session files", async () => {
      const registry = new SessionRegistry(tmpDir);
      const existingFile = path.join(tmpDir, "exists.jsonl");
      const missingFile = path.join(tmpDir, "missing.jsonl");
      writeFileSync(existingFile, "", "utf-8");

      const entries = [
        entry({ threadTs: "ts1", sessionPath: existingFile }),
        entry({ threadTs: "ts2", sessionPath: missingFile }),
      ];
      await registry.save(entries);

      const loaded = await registry.load();
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].threadTs, "ts1");
    });

    it("filters out entries with invalid fields", async () => {
      const registry = new SessionRegistry(tmpDir);
      const filePath = path.join(tmpDir, "active-sessions.json");
      const sessionFile = path.join(tmpDir, "s.jsonl");
      writeFileSync(sessionFile, "", "utf-8");

      const data = {
        sessions: [
          { threadTs: "ts1", channelId: "C1", cwd: "/tmp", sessionPath: sessionFile },
          { threadTs: 123, channelId: "C1", cwd: "/tmp", sessionPath: sessionFile }, // bad threadTs type
          { channelId: "C1", cwd: "/tmp", sessionPath: sessionFile }, // missing threadTs
        ],
      };
      writeFileSync(filePath, JSON.stringify(data), "utf-8");

      const loaded = await registry.load();
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].threadTs, "ts1");
    });
  });

  describe("save", () => {
    it("creates the directory if it does not exist", async () => {
      const nestedDir = path.join(tmpDir, "nested", "dir");
      const registry = new SessionRegistry(nestedDir);

      await registry.save([]);
      assert.ok(existsSync(path.join(nestedDir, "active-sessions.json")));
    });

    it("cleans up temp file on write error", async () => {
      // Use a path that's a file, not a directory, to cause mkdir to fail
      const badDir = path.join(tmpDir, "file-not-dir");
      writeFileSync(badDir, "block", "utf-8");

      const registry = new SessionRegistry(badDir);
      // Should not throw
      await registry.save([entry()]);

      // Temp file should not linger
      const tmpFile = badDir + "/active-sessions.json.tmp";
      assert.ok(!existsSync(tmpFile));
    });
  });

  describe("scheduleSave (debounce)", () => {
    it("coalesces rapid saves into one write", async () => {
      const registry = new SessionRegistry(tmpDir, 50);
      const f1 = path.join(tmpDir, "s1.jsonl");
      writeFileSync(f1, "", "utf-8");

      // Schedule multiple saves rapidly — only the last should persist
      registry.scheduleSave([entry({ threadTs: "first", sessionPath: f1 })]);
      registry.scheduleSave([entry({ threadTs: "second", sessionPath: f1 })]);
      registry.scheduleSave([entry({ threadTs: "third", sessionPath: f1 })]);

      // Wait for debounce to fire
      await new Promise((r) => setTimeout(r, 100));

      const loaded = await registry.load();
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].threadTs, "third");

      registry.dispose();
    });

    it("flush writes immediately and cancels pending timer", async () => {
      const registry = new SessionRegistry(tmpDir, 10_000); // very long debounce
      const f1 = path.join(tmpDir, "s1.jsonl");
      writeFileSync(f1, "", "utf-8");

      registry.scheduleSave([entry({ threadTs: "flushed", sessionPath: f1 })]);

      // Flush should write immediately, not wait 10s
      await registry.flush();

      const loaded = await registry.load();
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].threadTs, "flushed");

      registry.dispose();
    });

    it("flush is a no-op when nothing is pending", async () => {
      const registry = new SessionRegistry(tmpDir);
      // Should not throw or write
      await registry.flush();

      const loaded = await registry.load();
      assert.deepEqual(loaded, []);

      registry.dispose();
    });
  });

  describe("dispose", () => {
    it("cancels pending debounced save", async () => {
      const registry = new SessionRegistry(tmpDir, 10_000);
      const f1 = path.join(tmpDir, "s1.jsonl");
      writeFileSync(f1, "", "utf-8");

      registry.scheduleSave([entry({ threadTs: "cancelled", sessionPath: f1 })]);
      registry.dispose();

      // Wait past when debounce would have fired
      await new Promise((r) => setTimeout(r, 50));

      // Nothing should have been written
      const loaded = await registry.load();
      assert.deepEqual(loaded, []);
    });
  });
});
