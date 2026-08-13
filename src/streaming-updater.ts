import type { WebClient } from "@slack/web-api";
import { markdownToMrkdwn, splitMrkdwn, formatToolStart, formatToolLog, formatToolCompleted, type ToolCallRecord } from "./formatter.js";
import { retrySlackCall } from "./slack-retry.js";
import { createLogger } from "./logger.js";

const log = createLogger("streaming-updater");

export interface StreamingState {
  channelId: string;
  threadTs: string;
  initialMessageTs: string;
  currentMessageTs: string;
  rawMarkdown: string;
  toolLines: string[];
  toolRecords: ToolCallRecord[];
  completedToolLines: string[];
  completedCount: number;
  failedCount: number;
  postedMessageTs: string[];
  /** Throttled flush timer (for text deltas). */
  timer: ReturnType<typeof setTimeout> | null;
  retryCount: number;
  /** Coalesce timer for tool events (batches rapid start/end into one flush). */
  coalesceTimer: ReturnType<typeof setTimeout> | null;
  /** Whether a flush is currently in-flight. */
  flushInFlight: boolean;
  /** Whether another flush was requested while one was in-flight. */
  needsReflush: boolean;
}

export class StreamingUpdater {
  private _client: WebClient;
  private _throttleMs: number;
  private _msgLimit: number;
  private _coalesceMs: number;

  constructor(client: WebClient, throttleMs = 3000, msgLimit = 3000, coalesceMs = 300) {
    this._client = client;
    this._throttleMs = throttleMs;
    this._msgLimit = msgLimit;
    this._coalesceMs = coalesceMs;
  }

  async begin(channelId: string, threadTs: string): Promise<StreamingState> {
    const res = await retrySlackCall(
      () => this._client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "⏳ Thinking...",
      }),
      "chat.postMessage (begin)",
    );

    await retrySlackCall(
      () => this._client.reactions.add({
        channel: channelId,
        timestamp: res.ts!,
        name: "hourglass_flowing_sand",
      }),
      "reactions.add (hourglass)",
    );

    return {
      channelId,
      threadTs,
      initialMessageTs: res.ts!,
      currentMessageTs: res.ts!,
      rawMarkdown: "",
      toolLines: [],
      toolRecords: [],
      completedToolLines: [],
      completedCount: 0,
      failedCount: 0,
      postedMessageTs: [],
      timer: null,
      retryCount: 0,
      coalesceTimer: null,
      flushInFlight: false,
      needsReflush: false,
    };
  }

  appendText(state: StreamingState, delta: string): void {
    state.rawMarkdown += delta;
    this._scheduleFlush(state);
  }

  appendToolStart(state: StreamingState, toolName: string, args: unknown): void {
    state.toolLines.push(formatToolStart(toolName, args));
    const record: ToolCallRecord = { toolName, args, startTime: Date.now() };
    state.toolRecords.push(record);
    // Tool activity is rendered inside the single streaming message below.
    this._coalescedFlush(state);
  }

  appendToolEnd(state: StreamingState, toolName: string, isError: boolean): void {
    // Update the matching record with end time and status
    const record = [...state.toolRecords].reverse().find(
      (r) => r.toolName === toolName && r.endTime === undefined,
    );
    if (record) {
      record.endTime = Date.now();
      record.isError = isError;
      state.completedToolLines.push(formatToolCompleted(record));
    }

    // Remove the in-progress line and bump the counter
    const idx = state.toolLines.findIndex((l) => l.includes(`\`${toolName}\``) && l.includes("🔧"));
    if (idx !== -1) {
      state.toolLines.splice(idx, 1);
    }
    if (isError) {
      state.failedCount++;
    } else {
      state.completedCount++;
    }
    this._coalescedFlush(state);
  }

  appendRetry(state: StreamingState, attempt: number): void {
    state.retryCount = attempt;
    state.rawMarkdown += `\n_↩️ Retrying (${attempt}/3)..._\n`;
    this._scheduleFlush(state);
  }

  async finalize(state: StreamingState, afterAnswer?: () => Promise<void>): Promise<void> {
    this._cancelTimer(state);
    this._cancelCoalesceTimer(state);

    if (state.toolRecords.length > 0) {
      // Keep the live message as the final answer. Slack appends file uploads
      // after it, which is the least surprising and most stable thread order.
      await this._doFlush(state, false);
      if (afterAnswer) await afterAnswer();
      await this._uploadToolLog(state);
    } else {
      // With no tool log there is no later Slack message, so an in-place final
      // update is sufficient and avoids an unnecessary duplicate message.
      await this._doFlush(state, false);
    }

    await retrySlackCall(
      () => this._client.reactions.remove({
        channel: state.channelId,
        timestamp: state.initialMessageTs,
        name: "hourglass_flowing_sand",
      }),
      "reactions.remove (hourglass)",
    );

    await retrySlackCall(
      () => this._client.reactions.add({
        channel: state.channelId,
        timestamp: state.initialMessageTs,
        name: "white_check_mark",
      }),
      "reactions.add (checkmark)",
    );
  }

  async error(state: StreamingState, err: Error): Promise<void> {
    this._cancelTimer(state);
    this._cancelCoalesceTimer(state);

    // Truncate error message to avoid msg_too_long on the error post itself
    const maxErrLen = this._msgLimit - 20; // room for "❌ Error: " prefix
    const msg = err.message.length > maxErrLen
      ? err.message.slice(0, maxErrLen - 3) + "..."
      : err.message;

    await this._safePost(state.channelId, state.threadTs, `❌ Error: ${msg}`);

    try {
      await retrySlackCall(
        () => this._client.reactions.remove({
          channel: state.channelId,
          timestamp: state.initialMessageTs,
          name: "hourglass_flowing_sand",
        }),
        "reactions.remove (hourglass/error)",
      );
    } catch {
      // reaction may already be removed
    }
  }

  private _scheduleFlush(state: StreamingState): void {
    if (state.timer !== null) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      this._doFlush(state, true).catch((err) => log.error("Flush error", { error: err }));
    }, this._throttleMs);
  }

  /**
   * Coalesced flush for tool events. Instead of flushing immediately on every
   * tool_start/tool_end, we batch rapid events within a short coalesce window.
   * This dramatically reduces API calls during tool-heavy turns.
   */
  private _coalescedFlush(state: StreamingState): void {
    // Cancel any pending throttle timer — tool events take priority
    this._cancelTimer(state);

    // If a coalesce timer is already pending, do nothing (will flush soon)
    if (state.coalesceTimer !== null) return;

    // If a flush is in-flight, mark that we need a re-flush when it completes
    if (state.flushInFlight) {
      state.needsReflush = true;
      return;
    }

    // Schedule a coalesced flush
    state.coalesceTimer = setTimeout(() => {
      state.coalesceTimer = null;
      this._doFlush(state, true).catch((err) => log.error("Coalesced flush error", { error: err }));
    }, this._coalesceMs);
  }

  private _cancelTimer(state: StreamingState): void {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  private _cancelCoalesceTimer(state: StreamingState): void {
    if (state.coalesceTimer !== null) {
      clearTimeout(state.coalesceTimer);
      state.coalesceTimer = null;
    }
  }

  /**
   * Execute a flush with in-flight tracking. If another flush is requested
   * while this one is running, it will be executed after this one completes.
   */
  private async _doFlush(state: StreamingState, partial: boolean): Promise<void> {
    state.flushInFlight = true;
    try {
      await this._flush(state, partial);
    } finally {
      state.flushInFlight = false;
      // If a flush was requested while we were running, do it now
      if (state.needsReflush && partial) {
        state.needsReflush = false;
        this._doFlush(state, true).catch((err) =>
          log.error("Re-flush error", { error: err }),
        );
      }
    }
  }


  /** Upload detailed tool calls as an expandable Slack file snippet. */
  private async _uploadToolLog(state: StreamingState): Promise<void> {
    const content = formatToolLog(state.toolRecords);
    if (!content) return;
    try {
      await retrySlackCall(
        () => this._client.files.uploadV2({
          channel_id: state.channelId,
          thread_ts: state.threadTs,
          content,
          filename: "tool-activity.txt",
          title: `🔧 ${state.toolRecords.length} tool calls`,
        }),
        "files.uploadV2 (tool log)",
      );
    } catch (err) {
      log.error("Failed to upload tool log", { error: err });
    }
  }


  private async _flush(state: StreamingState, partial: boolean): Promise<void> {
    const body = state.rawMarkdown.trim();

    // Build tool status block: during streaming show recent completed + active tools;
    // on finalize (partial=false), show a one-line summary.
    const toolBlock = partial ? (() => {
      const parts: string[] = [];
      const maxVisible = 5;
      const completed = state.completedToolLines;
      if (completed.length > maxVisible) {
        parts.push(`> _…${completed.length - maxVisible} earlier tools_`);
      }
      parts.push(...completed.slice(-maxVisible));
      if (state.toolLines.length > 0) {
        parts.push(...state.toolLines);
      }
      return parts.join("\n");
    })() : "";

    // The final assistant message contains only the answer.
    const combined = toolBlock
      ? (partial ? `${body}\n\n${toolBlock}` : `${toolBlock}\n\n${body}`)
      : body;
    if (!combined) return;

    const mrkdwn = markdownToMrkdwn(combined, partial);
    await this._postChunked(state, mrkdwn, this._msgLimit);
  }

  /**
   * Split mrkdwn into chunks and post/update. Tracks all posted messages in
   * order and updates them in-place on subsequent flushes. Only posts new
   * messages when the chunk count exceeds the number of existing messages.
   * If any Slack call returns msg_too_long, retry with a reduced limit.
   */
  private async _postChunked(state: StreamingState, mrkdwn: string, limit: number): Promise<void> {
    const chunks = splitMrkdwn(mrkdwn, limit);

    // All messages in posting order: earlier continuations + current
    const allMessages = [...state.postedMessageTs, state.currentMessageTs];

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (i < allMessages.length) {
          // Update an existing message in-place
          await retrySlackCall(
            () => this._client.chat.update({
              channel: state.channelId,
              ts: allMessages[i],
              text: chunks[i],
            }),
            "chat.update",
          );
        } else {
          // Need a new continuation message
          const res = await retrySlackCall(
            () => this._client.chat.postMessage({
              channel: state.channelId,
              thread_ts: state.threadTs,
              text: chunks[i],
            }),
            "chat.postMessage (continuation)",
          );
          allMessages.push(res.ts!);
        }
      }

      // Rebuild tracking arrays: everything before the last is "posted",
      // the last one is "current".
      const used = allMessages.slice(0, chunks.length);
      state.postedMessageTs = used.slice(0, -1);
      state.currentMessageTs = used[used.length - 1] ?? state.currentMessageTs;
    } catch (err: unknown) {
      const reduced = Math.floor(limit * 0.6);
      if (this._isMsgTooLong(err) && reduced >= 100) {
        log.warn("msg_too_long, retrying with reduced limit", { limit, reduced });
        return this._postChunked(state, mrkdwn, reduced);
      }
      throw err;
    }
  }

  /**
   * Post a message safely, truncating if it still triggers msg_too_long.
   */
  private async _safePost(channel: string, threadTs: string, text: string): Promise<void> {
    try {
      await retrySlackCall(
        () => this._client.chat.postMessage({ channel, thread_ts: threadTs, text }),
        "chat.postMessage (safe)",
      );
    } catch (err: unknown) {
      if (this._isMsgTooLong(err)) {
        const truncated = text.slice(0, 1500) + "\n…_(truncated)_";
        await retrySlackCall(
          () => this._client.chat.postMessage({ channel, thread_ts: threadTs, text: truncated }),
          "chat.postMessage (truncated)",
        );
      } else {
        throw err;
      }
    }
  }

  private _isMsgTooLong(err: unknown): boolean {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { error?: string } }).data;
      if (data?.error === "msg_too_long") return true;
    }
    // Also check the message string as a fallback
    return err instanceof Error && err.message.includes("msg_too_long");
  }
}
