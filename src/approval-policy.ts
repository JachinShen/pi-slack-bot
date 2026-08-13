import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { requestSlackApproval } from "./approval-relay.js";

const dangerous = [
  /\bgit\s+push\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\b/i,
  /\brm\s+(-[^\n]*r|--recursive)/i,
  /\bsudo\b/i,
  /\b(chmod|chown)\b/i,
  /\b(kill|pkill|killall)\b/i,
  /\b(drop|truncate)\s+(database|table)\b/i,
  /(^|\s)(\.env(?:\.[^\s]+)?|id_rsa|[^\s/]+\.(?:pem|key))(\s|$)/i,
];

export function classifyDangerousCommand(command: string): { risk: "high" | "critical"; rationale: string } | null {
  if (/git\s+push\s+.*--force|git\s+reset\s+--hard|rm\s+(-[^\n]*r|--recursive)/i.test(command)) {
    return { risk: "critical", rationale: "可能破坏远程历史、删除数据或不可逆修改文件" };
  }
  if (dangerous.some((pattern) => pattern.test(command))) {
    return { risk: "high", rationale: "命令可能影响系统、仓库、数据库或敏感文件" };
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
