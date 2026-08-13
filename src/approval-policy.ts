import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { requestSlackApproval } from "./approval-relay.js";

const dangerous = [
  /\brm\s+(-[^\n]*r|--recursive)/i,
  /\bsudo\b/i,
  /\b(chmod|chown)\b/i,
];

export function classifyDangerousCommand(command: string): { risk: "high" | "critical"; rationale: string } | null {
  if (/\brm\s+(-[^\n]*r|--recursive)/i.test(command)) {
    return { risk: "critical", rationale: "可能递归删除文件，造成不可逆数据丢失" };
  }
  if (dangerous.some((pattern) => pattern.test(command))) {
    return { risk: "high", rationale: "命令可能影响系统权限" };
  }
  return null;
}

export function createSlackApprovalExtension(context?: { channelId: string; threadTs: string }): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", async (event) => {
      if (event.toolName !== "bash") return;
      const rawCommand = event.input.command;
      const command = typeof rawCommand === "string" ? rawCommand : "";
      const classification = classifyDangerousCommand(command);
      if (!classification) return;
      const action = await requestSlackApproval({
        requestId: `${Date.now()}-${event.toolCallId}`,
        sourceLabel: "pi-slack-bot",
        toolName: event.toolName,
        preview: command,
        risk: classification.risk,
        rationale: classification.rationale,
        channelId: context?.channelId,
        threadTs: context?.threadTs,
      });
      if (action !== "allow") {
        return { block: true, terminate: true, reason: `Slack 审批未通过：${action}` };
      }
    });
  };
}
