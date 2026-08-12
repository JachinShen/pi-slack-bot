import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { expandHome } from "./paths.js";
import { homedir } from "os";
import { resolve } from "path";

describe("expandHome", () => {
  it("expands ~ to homedir", () => {
    assert.equal(expandHome("~"), homedir());
  });

  it("expands ~/path to absolute path under homedir", () => {
    assert.equal(expandHome("~/projects"), resolve(homedir(), "projects"));
  });

  it("returns non-tilde paths unchanged", () => {
    assert.equal(expandHome("/usr/local"), "/usr/local");
    assert.equal(expandHome("relative/path"), "relative/path");
  });
});
