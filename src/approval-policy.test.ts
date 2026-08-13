import { describe, expect, it } from "vitest";
import { classifyDangerousCommand } from "./approval-policy.js";

describe("classifyDangerousCommand", () => {
  it("allows ordinary read-only commands", () => {
    expect(classifyDangerousCommand("git status && npm test")).toBeNull();
  });

  it("requires critical approval for recursive deletion", () => {
    expect(classifyDangerousCommand("rm -rf ./build")?.risk).toBe("critical");
  });

  it("requires high approval for selected permission commands", () => {
    expect(classifyDangerousCommand("sudo launchctl kickstart service")?.risk).toBe("high");
    expect(classifyDangerousCommand("chmod 600 secret")?.risk).toBe("high");
    expect(classifyDangerousCommand("chown root secret")?.risk).toBe("high");
  });
});
