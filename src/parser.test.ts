import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { tmpdir } from "os";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { loadProjects } from "./parser.js";

describe("loadProjects", () => {
  let tmpBase: string;

  it("scans directories one level deep from scanDirs", () => {
    tmpBase = join(tmpdir(), `parser-test-${Date.now()}`);
    mkdirSync(join(tmpBase, "proj-a"), { recursive: true });
    mkdirSync(join(tmpBase, "proj-b"), { recursive: true });

    try {
      const results = loadProjects([tmpBase], "/nonexistent/config.json");
      assert.ok(results.some((p) => p.path.endsWith("proj-a")));
      assert.ok(results.some((p) => p.path.endsWith("proj-b")));
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it("skips non-existent workspace dirs without throwing", () => {
    assert.doesNotThrow(() => loadProjects(["/nonexistent/path/xyz"], "/nonexistent/config.json"));
  });

  it("returns empty array for empty workspace dir", () => {
    tmpBase = join(tmpdir(), `parser-empty-${Date.now()}`);
    mkdirSync(tmpBase, { recursive: true });
    try {
      const results = loadProjects([tmpBase], "/nonexistent/config.json");
      assert.deepEqual(results, []);
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it("uses labels from config", () => {
    tmpBase = join(tmpdir(), `parser-labels-${Date.now()}`);
    const configDir = join(tmpBase, "config");
    const scanDir = join(tmpBase, "projects");
    mkdirSync(join(scanDir, "my-project"), { recursive: true });
    mkdirSync(configDir, { recursive: true });

    const configPath = join(configDir, "projects.json");
    writeFileSync(configPath, JSON.stringify({
      scanDirs: [scanDir],
      labels: { "my-project": "🚀 My Project" },
    }));

    try {
      const results = loadProjects([], configPath);
      const proj = results.find((p) => p.path.endsWith("my-project"));
      assert.ok(proj);
      assert.equal(proj.label, "🚀 My Project");
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it("applies exclude patterns", () => {
    tmpBase = join(tmpdir(), `parser-exclude-${Date.now()}`);
    const configDir = join(tmpBase, "config");
    const scanDir = join(tmpBase, "projects");
    mkdirSync(join(scanDir, "keep-me"), { recursive: true });
    mkdirSync(join(scanDir, "CR-12345"), { recursive: true });
    mkdirSync(configDir, { recursive: true });

    const configPath = join(configDir, "projects.json");
    writeFileSync(configPath, JSON.stringify({
      scanDirs: [scanDir],
      exclude: ["CR-*"],
    }));

    try {
      const results = loadProjects([], configPath);
      assert.ok(results.some((p) => p.path.endsWith("keep-me")));
      assert.ok(!results.some((p) => basename(p.path).startsWith("CR-")));
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});
