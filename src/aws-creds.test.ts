import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { isExpiredTokenError } from "./aws-creds.js";

describe("isExpiredTokenError", () => {
  it("matches 'security token expired' message", () => {
    assert.ok(isExpiredTokenError(new Error("The security token included in the request is expired")));
  });

  it("matches ExpiredTokenException", () => {
    assert.ok(isExpiredTokenError(new Error("ExpiredTokenException: token has expired")));
  });

  it("matches ExpiredToken", () => {
    assert.ok(isExpiredTokenError("ExpiredToken"));
  });

  it("matches UnrecognizedClientException", () => {
    assert.ok(isExpiredTokenError(new Error("UnrecognizedClientException")));
  });

  it("matches case-insensitively", () => {
    assert.ok(isExpiredTokenError(new Error("SECURITY TOKEN INCLUDED IN THE REQUEST IS EXPIRED")));
  });

  it("does not match unrelated errors", () => {
    assert.ok(!isExpiredTokenError(new Error("rate limit exceeded")));
    assert.ok(!isExpiredTokenError(new Error("connection timeout")));
  });

  it("handles null/undefined", () => {
    assert.ok(!isExpiredTokenError(null));
    assert.ok(!isExpiredTokenError(undefined));
  });

  it("handles string input", () => {
    assert.ok(isExpiredTokenError("The security token included in the request is expired"));
    assert.ok(!isExpiredTokenError("some other error"));
  });
});
