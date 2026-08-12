import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  formatTokenCount,
  formatContextUsage,
  formatContextBar,
  getContextWarningThreshold,
  CONTEXT_WARNING_THRESHOLDS,
} from "./context-format.js";

describe("formatTokenCount", () => {
  it("formats small numbers as-is", () => {
    assert.equal(formatTokenCount(0), "0");
    assert.equal(formatTokenCount(500), "500");
    assert.equal(formatTokenCount(999), "999");
  });

  it("formats thousands with K suffix", () => {
    assert.equal(formatTokenCount(1000), "1.0K");
    assert.equal(formatTokenCount(1500), "1.5K");
    assert.equal(formatTokenCount(9999), "10K");
    assert.equal(formatTokenCount(45200), "45K");
    assert.equal(formatTokenCount(100000), "100K");
    assert.equal(formatTokenCount(999999), "1000K");
  });

  it("formats millions with M suffix", () => {
    assert.equal(formatTokenCount(1_000_000), "1.0M");
    assert.equal(formatTokenCount(1_500_000), "1.5M");
    assert.equal(formatTokenCount(10_000_000), "10M");
    assert.equal(formatTokenCount(200_000_000), "200M");
  });
});

describe("formatContextUsage", () => {
  it("formats usage with known tokens", () => {
    const result = formatContextUsage({ tokens: 45200, contextWindow: 200000, percent: 23 });
    assert.equal(result, "45K / 200K tokens (23%)");
  });

  it("formats usage with null tokens", () => {
    const result = formatContextUsage({ tokens: null, contextWindow: 200000, percent: null });
    assert.equal(result, "unknown / 200K tokens");
  });

  it("rounds percentage", () => {
    const result = formatContextUsage({ tokens: 164000, contextWindow: 200000, percent: 82.3 });
    assert.equal(result, "164K / 200K tokens (82%)");
  });

  it("handles small token counts", () => {
    const result = formatContextUsage({ tokens: 500, contextWindow: 200000, percent: 0.25 });
    assert.equal(result, "500 / 200K tokens (0%)");
  });
});

describe("formatContextBar", () => {
  it("renders 0%", () => {
    const result = formatContextBar(0);
    assert.equal(result, "[░░░░░░░░░░░░░░░░] 0%");
  });

  it("renders 50%", () => {
    const result = formatContextBar(50);
    assert.equal(result, "[████████░░░░░░░░] 50%");
  });

  it("renders 100%", () => {
    const result = formatContextBar(100);
    assert.equal(result, "[████████████████] 100%");
  });

  it("clamps negative values to 0", () => {
    const result = formatContextBar(-10);
    assert.equal(result, "[░░░░░░░░░░░░░░░░] 0%");
  });

  it("clamps values over 100", () => {
    const result = formatContextBar(150);
    assert.equal(result, "[████████████████] 100%");
  });

  it("respects custom width", () => {
    const result = formatContextBar(50, 10);
    assert.equal(result, "[█████░░░░░] 50%");
  });

  it("rounds percentage in display", () => {
    const result = formatContextBar(33.7);
    assert.ok(result.includes("34%"));
  });
});

describe("getContextWarningThreshold", () => {
  it("returns null below 80%", () => {
    assert.equal(getContextWarningThreshold(79, 0), null);
    assert.equal(getContextWarningThreshold(50, 0), null);
    assert.equal(getContextWarningThreshold(0, 0), null);
  });

  it("returns 80 when crossing 80% threshold", () => {
    assert.equal(getContextWarningThreshold(80, 0), 80);
    assert.equal(getContextWarningThreshold(85, 0), 80);
  });

  it("returns 90 when crossing 90% threshold", () => {
    assert.equal(getContextWarningThreshold(90, 0), 90);
    assert.equal(getContextWarningThreshold(95, 0), 90);
  });

  it("returns 90 when crossing 90% from below 80%", () => {
    // Jump from 0 to 92 — should return 90 (highest crossed)
    assert.equal(getContextWarningThreshold(92, 0), 90);
  });

  it("returns null when already warned at that threshold", () => {
    assert.equal(getContextWarningThreshold(85, 80), null);
    assert.equal(getContextWarningThreshold(95, 90), null);
  });

  it("returns 90 when warned at 80 but now crossing 90", () => {
    assert.equal(getContextWarningThreshold(92, 80), 90);
  });

  it("exports thresholds array", () => {
    assert.deepEqual([...CONTEXT_WARNING_THRESHOLDS], [80, 90]);
  });
});
