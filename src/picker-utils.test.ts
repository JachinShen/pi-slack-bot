import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { truncLabel, chunk, safeSections, MAX_SECTION_TEXT } from "./picker-utils.js";

describe("truncLabel", () => {
  it("returns short strings unchanged", () => {
    assert.equal(truncLabel("hello"), "hello");
  });

  it("truncates strings exceeding max", () => {
    const long = "a".repeat(70);
    const result = truncLabel(long, 60);
    assert.equal(result.length, 60);
    assert.ok(result.endsWith("…"));
  });

  it("uses default max of 60", () => {
    const exactly60 = "a".repeat(60);
    assert.equal(truncLabel(exactly60), exactly60);
    assert.ok(truncLabel("a".repeat(61)).endsWith("…"));
  });
});

describe("chunk", () => {
  it("splits array into chunks of given size", () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });

  it("returns single chunk for small arrays", () => {
    assert.deepEqual(chunk([1, 2], 5), [[1, 2]]);
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(chunk([], 3), []);
  });
});

describe("safeSections", () => {
  it("returns a single section for short text", () => {
    const blocks = safeSections("hello world");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "section");
    assert.equal((blocks[0] as { text: { text: string } }).text.text, "hello world");
  });

  it("splits text exceeding the limit into multiple sections", () => {
    // Build text with 100-char lines, enough to exceed 3000
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}: ${"x".repeat(90)}`);
    const text = lines.join("\n");
    assert.ok(text.length > MAX_SECTION_TEXT, "test text should exceed limit");

    const blocks = safeSections(text);
    assert.ok(blocks.length > 1, "should produce multiple blocks");
    for (const block of blocks) {
      assert.equal(block.type, "section");
      const len = (block as { text: { text: string } }).text.text.length;
      assert.ok(len <= MAX_SECTION_TEXT, `block text ${len} should be ≤ ${MAX_SECTION_TEXT}`);
    }
  });

  it("hard-truncates a single line exceeding the limit", () => {
    const longLine = "x".repeat(4000);
    const blocks = safeSections(longLine);
    assert.equal(blocks.length, 1);
    const len = (blocks[0] as { text: { text: string } }).text.text.length;
    assert.ok(len <= MAX_SECTION_TEXT);
    assert.ok((blocks[0] as { text: { text: string } }).text.text.endsWith("…"));
  });
});
