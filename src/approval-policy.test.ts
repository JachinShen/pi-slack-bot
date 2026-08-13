import { describe, expect, it } from "vitest";
import { classifyDangerousCommand } from "./approval-policy.js";

describe("classifyDangerousCommand", () => {
  it("allows ordinary read-only commands", () => {
    expect(classifyDangerousCommand("git status && npm test")).toBeNull();
  });

  it("requires critical approval for destructive commands", () => {
    expect(classifyDangerousCommand("git reset --hard HEAD~1")?.risk).toBe("critical");
    expect(classifyDangerousCommand("rm -rf ./build")?.risk).toBe("critical");
  });

  it("requires high approval for system and sensitive-file commands", () => {
    expect(classifyDangerousCommand("sudo launchctl kickstart service")?.risk).toBe("high");
    expect(classifyDangerousCommand("cat .env")?.risk).toBe("high");
  });
});
