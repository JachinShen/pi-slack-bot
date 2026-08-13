export interface SlackApprovalRequest {
  requestId: string;
  channelId?: string;
  threadTs?: string;
  sourceLabel: string;
  toolName: string;
  preview: string;
  risk?: "low" | "medium" | "high" | "critical";
  rationale?: string;
}
export type SlackApprovalDecision = "allow" | "deny" | "deny-remember";
const APPROVAL_REQUESTER_KEY = "__pi_slack_approval_requester_v1__";

import type { WebClient } from "@slack/web-api";
interface RelayManualRequest {
  requestId: string;
  channelId?: string;
  threadTs?: string;
  sourceLabel: string;
  toolName: string;
  preview: string;
  risk?: "low" | "medium" | "high" | "critical";
  authorization?: "unknown" | "low" | "medium" | "high";
  rationale?: string;
  note?: string;
  suggestedRule?: string;
}

interface RelayBus {
  on(channel: string, handler: (payload: unknown) => void): () => void;
  emit(channel: string, payload: unknown): void;
  claimRequest(requestId: string): boolean;
  releaseRequest(requestId: string): void;
}

const RELAY_BUS_KEY = "__pi_menshen_relay_bus_v1__";
const RELAY_CHANNEL_ACK = "menshen:manual-ack";
const RELAY_CHANNEL_REQUEST = "menshen:manual-request";
const RELAY_CHANNEL_RESPONSE = "menshen:manual-response";

function getRelayBus(): RelayBus {
  const globalState = globalThis as Record<string, unknown>;
  const existing = globalState[RELAY_BUS_KEY];
  if (existing && typeof existing === "object") return existing as RelayBus;
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const claimed = new Set<string>();
  const bus: RelayBus = {
    on(channel, handler) {
      const listeners = handlers.get(channel) ?? new Set<(payload: unknown) => void>();
      handlers.set(channel, listeners);
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    emit(channel, payload) {
      for (const handler of [...(handlers.get(channel) ?? [])]) handler(payload);
    },
    claimRequest(requestId) {
      if (claimed.has(requestId)) return false;
      claimed.add(requestId);
      return true;
    },
    releaseRequest(requestId) { claimed.delete(requestId); },
  };
  globalState[RELAY_BUS_KEY] = bus;
  return bus;
}

const ALLOW_ACTION = "slack_approval_allow";
const DENY_ACTION = "slack_approval_deny";
const DENY_REMEMBER_ACTION = "slack_approval_deny_remember";
const REQUEST_TTL_MS = 300_000;

interface PendingApproval extends RelayManualRequest {
  channelId: string;
  messageTs: string;
  expiresAt: number;
}

function text(value: string | undefined): string {
  return (value ?? "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]!);
}

/** Bridges pi-menshen's headless relay to Slack Block Kit buttons. */
export class SlackApprovalRelay {
  private readonly bus = getRelayBus();
  private readonly pending = new Map<string, PendingApproval>();
  private unsubscribe: (() => void) | undefined;
  private dmChannelId: string | undefined;

  constructor(private readonly client: WebClient, private readonly userId: string) {}

  start(): void {
    if (this.unsubscribe) return;
    (globalThis as Record<string, unknown>)[APPROVAL_REQUESTER_KEY] = (request: SlackApprovalRequest) => this.requestDecision(request);
    this.unsubscribe = this.bus.on(RELAY_CHANNEL_REQUEST, (payload) => {
      void this.handleRequest(payload as RelayManualRequest);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.pending.clear();
    delete (globalThis as Record<string, unknown>)[APPROVAL_REQUESTER_KEY];
  }

  private requestDecision(request: SlackApprovalRequest): Promise<SlackApprovalDecision> {
    const requestId = request.requestId;
    return new Promise((resolve) => {
      const unsubscribe = this.bus.on(RELAY_CHANNEL_RESPONSE, (payload) => {
        const response = payload as { requestId?: string; action?: SlackApprovalDecision };
        if (response.requestId !== requestId || !response.action) return;
        unsubscribe();
        resolve(response.action);
      });
      this.bus.emit(RELAY_CHANNEL_REQUEST, request);
      setTimeout(() => { unsubscribe(); resolve("deny"); }, REQUEST_TTL_MS).unref();
    });
  }

  async handleAction(actionId: string, requestId: string, actorId: string): Promise<boolean> {
    if (![ALLOW_ACTION, DENY_ACTION, DENY_REMEMBER_ACTION].includes(actionId)) return false;
    if (actorId !== this.userId) return true;
    const request = this.pending.get(requestId);
    if (!request || request.expiresAt < Date.now()) {
      this.pending.delete(requestId);
      return true;
    }

    this.pending.delete(requestId);
    const action = actionId === ALLOW_ACTION ? "allow" : actionId === DENY_REMEMBER_ACTION ? "deny-remember" : "deny";
    this.bus.emit(RELAY_CHANNEL_RESPONSE, { requestId, action });
    this.bus.releaseRequest(requestId);
    await this.client.chat.update({
      channel: request.channelId,
      ts: request.messageTs,
      text: `审批已处理：${action === "allow" ? "允许一次" : action === "deny-remember" ? "拒绝并记住" : "拒绝"}`,
      blocks: [],
    }).catch(() => {});
    return true;
  }

  private async handleRequest(request: RelayManualRequest): Promise<void> {
    if (!request.requestId || !this.bus.claimRequest(request.requestId)) return;

    try {
      const channel = request.channelId ?? await this.openDm();
      const posted = await this.client.chat.postMessage({
        channel,
        ...(request.threadTs ? { thread_ts: request.threadTs } : {}),
        text: `需要审批：${request.toolName}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*工具调用需要审批*\n*工具：* \`${text(request.toolName)}\`\n*操作：* ${text(request.preview)}\n*风险：* ${text(request.risk ?? "unknown")}\n*原因：* ${text(request.rationale ?? request.note ?? "需要人工确认")}`,
            },
          },
          {
            type: "actions",
            elements: [
              { type: "button", action_id: ALLOW_ACTION, text: { type: "plain_text", text: "✅ 允许一次" }, value: request.requestId, style: "primary" },
              { type: "button", action_id: DENY_ACTION, text: { type: "plain_text", text: "❌ 拒绝" }, value: request.requestId, style: "danger" },
              { type: "button", action_id: DENY_REMEMBER_ACTION, text: { type: "plain_text", text: "🚫 拒绝并记住" }, value: request.requestId },
            ],
          },
        ],
      });

      if (!posted.ok || !posted.ts) throw new Error("Slack approval message was not posted");
      this.pending.set(request.requestId, {
        ...request,
        channelId: channel,
        messageTs: posted.ts,
        expiresAt: Date.now() + REQUEST_TTL_MS,
      });
      setTimeout(() => {
        this.pending.delete(request.requestId);
        this.bus.releaseRequest(request.requestId);
      }, REQUEST_TTL_MS).unref();
      this.bus.emit(RELAY_CHANNEL_ACK, { requestId: request.requestId });
    } catch {
      this.bus.emit(RELAY_CHANNEL_RESPONSE, { requestId: request.requestId, action: "deny" });
      this.bus.releaseRequest(request.requestId);
    }
  }

  private async openDm(): Promise<string> {
    if (this.dmChannelId) return this.dmChannelId;
    const opened = await this.client.conversations.open({ users: this.userId });
    const channelId = opened.channel?.id;
    if (!channelId) throw new Error("Could not open Slack approval DM");
    this.dmChannelId = channelId;
    return channelId;
  }
}

export const slackApprovalActionIds = {
  allow: ALLOW_ACTION,
  deny: DENY_ACTION,
  denyRemember: DENY_REMEMBER_ACTION,
} as const;

export function requestSlackApproval(request: SlackApprovalRequest): Promise<SlackApprovalDecision> {
  const requester = (globalThis as Record<string, unknown>)[APPROVAL_REQUESTER_KEY];
  if (typeof requester !== "function") return Promise.resolve("deny");
  return (requester as (request: SlackApprovalRequest) => Promise<SlackApprovalDecision>)(request);
}
