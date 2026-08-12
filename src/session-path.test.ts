import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { encodeCwd } from "./session-path.js";

describe("encodeCwd", () => {
  it("encodes a Unix path", () => {
    assert.equal(encodeCwd("/home/user/projects/foo"), "--home-user-projects-foo--");
  });

  it("encodes root path", () => {
    assert.equal(encodeCwd("/"), "----");
  });

  it("handles paths with colons", () => {
    assert.equal(encodeCwd("C:\\Users\\foo"), "--C--Users-foo--");
  });
});
