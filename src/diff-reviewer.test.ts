import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { execSync } from "child_process";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import {
  extractModifiedFiles,
  hasFileModifications,
  generateDiff,
  computeDiffStats,
  generateSyntheticDiff,
  getHeadRef,
  isGitRepo,
} from "./diff-reviewer.js";
import type { ToolCallRecord } from "./formatter.js";

describe("extractModifiedFiles", () => {
  it("returns empty array when no records", () => {
    assert.deepEqual(extractModifiedFiles([]), []);
  });

  it("extracts paths from edit and write tools", () => {
    const records: ToolCallRecord[] = [
      { toolName: "read", args: { path: "src/foo.ts" }, startTime: 0 },
      { toolName: "edit", args: { path: "src/bar.ts", oldText: "a", newText: "b" }, startTime: 1 },
      { toolName: "write", args: { path: "src/new.ts", content: "hello" }, startTime: 2 },
      { toolName: "bash", args: { command: "npm test" }, startTime: 3 },
    ];
    assert.deepEqual(extractModifiedFiles(records), ["src/bar.ts", "src/new.ts"]);
  });

  it("deduplicates paths", () => {
    const records: ToolCallRecord[] = [
      { toolName: "edit", args: { path: "src/foo.ts" }, startTime: 0 },
      { toolName: "edit", args: { path: "src/foo.ts" }, startTime: 1 },
      { toolName: "write", args: { path: "src/foo.ts" }, startTime: 2 },
    ];
    assert.deepEqual(extractModifiedFiles(records), ["src/foo.ts"]);
  });

  it("handles missing path gracefully", () => {
    const records: ToolCallRecord[] = [
      { toolName: "edit", args: null, startTime: 0 },
      { toolName: "write", args: { content: "no path" }, startTime: 1 },
    ];
    assert.deepEqual(extractModifiedFiles(records), []);
  });
});

describe("hasFileModifications", () => {
  it("returns false for empty records", () => {
    assert.equal(hasFileModifications([]), false);
  });

  it("returns false when only read/bash tools", () => {
    const records: ToolCallRecord[] = [
      { toolName: "read", args: { path: "src/foo.ts" }, startTime: 0 },
      { toolName: "bash", args: { command: "ls" }, startTime: 1 },
    ];
    assert.equal(hasFileModifications(records), false);
  });

  it("returns true when edit tool present", () => {
    const records: ToolCallRecord[] = [
      { toolName: "read", args: { path: "src/foo.ts" }, startTime: 0 },
      { toolName: "edit", args: { path: "src/foo.ts" }, startTime: 1 },
    ];
    assert.equal(hasFileModifications(records), true);
  });

  it("returns true when write tool present", () => {
    const records: ToolCallRecord[] = [
      { toolName: "write", args: { path: "src/new.ts" }, startTime: 0 },
    ];
    assert.equal(hasFileModifications(records), true);
  });
});

describe("isGitRepo", () => {
  it("returns false for non-git directory", () => {
    assert.equal(isGitRepo("/tmp"), false);
  });

  it("returns true for a git repo", () => {
    const dir = `/tmp/diff-test-repo-${Date.now()}`;
    mkdirSync(dir, { recursive: true });
    try {
      execSync("git init", { cwd: dir, stdio: "pipe" });
      assert.equal(isGitRepo(dir), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("getHeadRef", () => {
  it("returns null for non-git directory", () => {
    assert.equal(getHeadRef("/tmp"), null);
  });

  it("returns null for git repo with no commits", () => {
    const dir = `/tmp/diff-test-nocommit-${Date.now()}`;
    mkdirSync(dir, { recursive: true });
    try {
      execSync("git init", { cwd: dir, stdio: "pipe" });
      assert.equal(getHeadRef(dir), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns SHA for git repo with commits", () => {
    const dir = `/tmp/diff-test-ref-${Date.now()}`;
    mkdirSync(dir, { recursive: true });
    try {
      execSync("git init && git commit --allow-empty -m init", { cwd: dir, stdio: "pipe" });
      const ref = getHeadRef(dir);
      assert.ok(ref);
      assert.match(ref, /^[0-9a-f]{40}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("generateDiff", () => {
  it("returns null for non-git directory", () => {
    const result = generateDiff("/tmp");
    assert.equal(result, null);
  });

  it("returns null when no changes", () => {
    const dir = `/tmp/diff-test-clean-${Date.now()}`;
    mkdirSync(dir, { recursive: true });
    try {
      execSync("git init && git commit --allow-empty -m init", { cwd: dir, stdio: "pipe" });
      assert.equal(generateDiff(dir), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects uncommitted changes", () => {
    const dir = `/tmp/diff-test-uncommitted-${Date.now()}`;
    mkdirSync(dir, { recursive: true });
    try {
      execSync("git init", { cwd: dir, stdio: "pipe" });
      writeFileSync(join(dir, "file.txt"), "original\n");
      execSync("git add -A && git commit -m init", { cwd: dir, stdio: "pipe" });
      writeFileSync(join(dir, "file.txt"), "modified\n");

      const result = generateDiff(dir);
      assert.ok(result);
      assert.equal(result.fileCount, 1);
      assert.ok(result.diff.includes("-original"));
      assert.ok(result.diff.includes("+modified"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects untracked new files", () => {
    const dir = `/tmp/diff-test-untracked-${Date.now()}`;
    mkdirSync(dir, { recursive: true });
    try {
      execSync("git init && git commit --allow-empty -m init", { cwd: dir, stdio: "pipe" });
      writeFileSync(join(dir, "NOTES.md"), "# Collaboration notes\n");

      const result = generateDiff(dir);
      assert.ok(result);
      assert.equal(result.fileCount, 1);
      assert.ok(result.diff.includes("NOTES.md"));
      assert.ok(result.diff.includes("+# Collaboration notes"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects committed changes when baseRef is provided", () => {
    const dir = `/tmp/diff-test-committed-${Date.now()}`;
    mkdirSync(dir, { recursive: true });
    try {
      execSync("git init", { cwd: dir, stdio: "pipe" });
      writeFileSync(join(dir, "file.txt"), "original\n");
      execSync("git add -A && git commit -m init", { cwd: dir, stdio: "pipe" });

      // Snapshot the base ref
      const baseRef = getHeadRef(dir);
      assert.ok(baseRef);

      // Simulate agent making changes and committing
      writeFileSync(join(dir, "file.txt"), "agent changed this\n");
      writeFileSync(join(dir, "new-doc.md"), "# New document\n");
      execSync("git add -A && git commit -m 'agent commit'", { cwd: dir, stdio: "pipe" });

      // Without baseRef → no changes (everything is committed)
      assert.equal(generateDiff(dir), null);

      // With baseRef → sees all committed changes
      const result = generateDiff(dir, { baseRef });
      assert.ok(result);
      assert.equal(result.fileCount, 2);
      assert.ok(result.diff.includes("-original"));
      assert.ok(result.diff.includes("+agent changed this"));
      assert.ok(result.diff.includes("new-doc.md"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes both committed and uncommitted changes with baseRef", () => {
    const dir = `/tmp/diff-test-mixed-${Date.now()}`;
    mkdirSync(dir, { recursive: true });
    try {
      execSync("git init", { cwd: dir, stdio: "pipe" });
      writeFileSync(join(dir, "a.txt"), "aaa\n");
      execSync("git add -A && git commit -m init", { cwd: dir, stdio: "pipe" });

      const baseRef = getHeadRef(dir);
      assert.ok(baseRef);

      // Committed change
      writeFileSync(join(dir, "a.txt"), "bbb\n");
      execSync("git add -A && git commit -m 'agent edit'", { cwd: dir, stdio: "pipe" });

      // Uncommitted change
      writeFileSync(join(dir, "a.txt"), "ccc\n");

      const result = generateDiff(dir, { baseRef });
      assert.ok(result);
      // Should show the full change from aaa → ccc (not just bbb → ccc)
      assert.ok(result.diff.includes("-aaa"));
      assert.ok(result.diff.includes("+ccc"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("computeDiffStats", () => {
  it("counts files, insertions, and deletions from tracked changes", () => {
    const diff = `diff --git a/src/foo.ts b/src/foo.ts
index abc123..def456 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 import { bar } from "./bar.js";
 
-export function foo(): string {
+export function foo(): number {
+  // new comment
`;
    const stats = computeDiffStats(diff);
    assert.equal(stats.fileCount, 1);
    assert.equal(stats.insertions, 2);
    assert.equal(stats.deletions, 1);
  });

  it("counts untracked new files (diff --no-index)", () => {
    const diff = `diff --no-index a/dev/null b/NOTES.md
new file mode 100644
--- /dev/null
+++ b/NOTES.md
@@ -0,0 +1,3 @@
+# Notes
+
+Some collaboration notes here
`;
    const stats = computeDiffStats(diff);
    assert.equal(stats.fileCount, 1);
    assert.equal(stats.insertions, 3);
    assert.equal(stats.deletions, 0);
  });

  it("counts multiple files including both tracked and untracked", () => {
    const diff = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,2 @@
-old line
+new line
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -5,3 +5,4 @@
 existing
-removed
+added
+extra
diff --no-index a/dev/null b/new-file.md
--- /dev/null
+++ b/new-file.md
@@ -0,0 +1 @@
+brand new file
`;
    const stats = computeDiffStats(diff);
    assert.equal(stats.fileCount, 3);
    assert.equal(stats.insertions, 4);
    assert.equal(stats.deletions, 2);
  });

  it("returns zeros for empty diff", () => {
    const stats = computeDiffStats("");
    assert.equal(stats.fileCount, 0);
    assert.equal(stats.insertions, 0);
    assert.equal(stats.deletions, 0);
  });
});

describe("generateSyntheticDiff", () => {
  it("returns null for empty records", () => {
    assert.equal(generateSyntheticDiff([], "/tmp"), null);
  });

  it("returns null when no edit/write records", () => {
    const records: ToolCallRecord[] = [
      { toolName: "read", args: { path: "foo.ts" }, startTime: 0 },
    ];
    assert.equal(generateSyntheticDiff(records, "/tmp"), null);
  });

  it("generates diff from edit tool args", () => {
    const records: ToolCallRecord[] = [
      {
        toolName: "edit",
        args: { path: "src/foo.ts", oldText: "return 'old';", newText: "return 'new';" },
        startTime: 0,
      },
    ];
    const result = generateSyntheticDiff(records, "/tmp");
    assert.ok(result);
    assert.equal(result.fileCount, 1);
    assert.ok(result.diff.includes("-return 'old';"));
    assert.ok(result.diff.includes("+return 'new';"));
    assert.ok(result.diff.includes("src/foo.ts"));
  });

  it("generates diff from write tool args", () => {
    const records: ToolCallRecord[] = [
      {
        toolName: "write",
        args: { path: "NOTES.md", content: "# Notes\n\nCollaboration doc" },
        startTime: 0,
      },
    ];
    const result = generateSyntheticDiff(records, "/tmp");
    assert.ok(result);
    assert.equal(result.fileCount, 1);
    assert.ok(result.diff.includes("NOTES.md"));
    assert.ok(result.diff.includes("+# Notes"));
    assert.ok(result.diff.includes("+Collaboration doc"));
  });

  it("deduplicates multiple writes to the same file (keeps last)", () => {
    const records: ToolCallRecord[] = [
      { toolName: "write", args: { path: "doc.md", content: "v1" }, startTime: 0 },
      { toolName: "write", args: { path: "doc.md", content: "v2" }, startTime: 1 },
    ];
    const result = generateSyntheticDiff(records, "/tmp");
    assert.ok(result);
    assert.equal(result.fileCount, 1);
    assert.ok(result.diff.includes("+v2"));
    assert.ok(!result.diff.includes("+v1"));
  });

  it("combines edit and write tool diffs", () => {
    const records: ToolCallRecord[] = [
      { toolName: "edit", args: { path: "a.ts", oldText: "old", newText: "new" }, startTime: 0 },
      { toolName: "write", args: { path: "b.md", content: "hello" }, startTime: 1 },
    ];
    const result = generateSyntheticDiff(records, "/tmp");
    assert.ok(result);
    assert.equal(result.fileCount, 2);
  });
});

import { AmazonPasteProvider, NullPasteProvider, GistPasteProvider, parsePasteProviderType, createPasteProvider } from "./paste-provider.js";

describe("PasteProvider", () => {
  it("NullPasteProvider always returns null", async () => {
    const provider = new NullPasteProvider();
    const result = await provider.create("content", "title");
    assert.equal(result, null);
  });

  it("AmazonPasteProvider returns null when curl fails", async () => {
    const origHome = process.env.HOME;
    process.env.HOME = "/tmp/nonexistent-home-" + Date.now();
    try {
      const provider = new AmazonPasteProvider();
      const result = await provider.create("test content", "test title");
      assert.ok(result === null || typeof result?.url === "string");
    } finally {
      process.env.HOME = origHome;
    }
  });

  it("GistPasteProvider returns null with no token", async () => {
    const provider = new GistPasteProvider("");
    const result = await provider.create("content", "title");
    assert.equal(result, null);
  });

  it("parsePasteProviderType accepts valid types", () => {
    assert.equal(parsePasteProviderType("amazon"), "amazon");
    assert.equal(parsePasteProviderType("gist"), "gist");
    assert.equal(parsePasteProviderType("none"), "none");
  });

  it("parsePasteProviderType rejects invalid types", () => {
    assert.throws(() => parsePasteProviderType("invalid"), /Invalid PASTE_PROVIDER/);
  });

  it("createPasteProvider returns correct provider types", () => {
    assert.ok(createPasteProvider("amazon") instanceof AmazonPasteProvider);
    assert.ok(createPasteProvider("gist") instanceof GistPasteProvider);
    assert.ok(createPasteProvider("none") instanceof NullPasteProvider);
  });
});
