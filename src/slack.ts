import { App } from "@slack/bolt";
import type { Config } from "./config.js";
import { BotSessionManager, SessionLimitError } from "./session-manager.js";
import { parseCommand, dispatchCommand } from "./commands.js";
import { handleFileSelect, handleFileNav, handleFilePickCancel } from "./file-picker.js";
import {
  handlePromptSelect,
} from "./command-picker.js";
import { handleModelSelect } from "./model-picker.js";
import {
  handleResumeProjectSelect,
  handleResumeSessionSelect,
} from "./session-picker.js";
import {
  enrichPromptWithFiles,
  type SlackFile,
} from "./file-sharing.js";
import { handleReaction, REACTION_MAP } from "./reactions.js";
import { PinStore } from "./pin-store.js";
import { createLogger } from "./logger.js";

const log = createLogger("slack");
export interface SlackApp {
  app: App;
  sessionManager: BotSessionManager;
}

export function createApp(config: Config): SlackApp {
  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
  });

  const sessionManager = new BotSessionManager(config, app.client);
  const pinStore = new PinStore(config.sessionDir);

  function cleanMention(text: string): string {
    return text.replace(/<@[^>]+>/g, "").replace(/\s+/g, " ").trim();
  }

  function titleFromPrompt(text: string): string {
    const clean = cleanMention(text).replace(/^!\w+\s*/, "").trim();
    if (!clean) return "Pi task";
    return clean.length > 80 ? `${clean.slice(0, 77)}...` : clean;
  }

  async function setThreadTitle(channel: string, threadTs: string, title: string, client: typeof app.client): Promise<void> {
    try {
      await client.assistant.threads.setTitle({
        channel_id: channel,
        thread_ts: threadTs,
        title,
      });
      log.info("Slack thread title set", { channel, threadTs, title });
    } catch (err) {
      // Standard Slack threads do not expose a title field. This succeeds for
      // Slack Assistant threads when assistant:write is granted, and is a
      // harmless best-effort call otherwise.
      log.warn("Could not set Slack thread title", {
        channel,
        threadTs,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleChannelMention(event: { channel: string; ts: string; thread_ts?: string; text?: string; user?: string }, client: typeof app.client): Promise<void> {
    if (event.user !== config.slackUserId) return;
    const text = cleanMention(event.text ?? "");
    if (!text) return;
    const threadTs = event.thread_ts ?? event.ts;

    try {
      const existing = sessionManager.get(threadTs);
      const session = await sessionManager.getOrCreate({
        threadTs,
        channelId: event.channel,
        cwd: config.defaultCwd,
      });
      // Slack's assistant title API is best effort; replies still work when
      // the workspace treats this as an ordinary channel thread.
      if (!existing) await setThreadTitle(event.channel, threadTs, titleFromPrompt(text), client);
      if (existing) {
        void session.submit(text).catch((err) => {
          log.error("Failed to submit steered channel message", { threadTs, error: err });
        });
      } else {
        session.enqueue(() => session.prompt(text).then(async () => {
          const generated = session.sessionName;
          if (generated) await setThreadTitle(event.channel, threadTs, generated, client);
        }));
      }
    } catch (err) {
      log.error("Failed to handle channel mention", { threadTs, error: err instanceof Error ? { message: err.message, stack: err.stack } : err });
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: threadTs,
        text: `❌ Failed to start session: ${err instanceof Error ? err.message : String(err)}`,
      }).catch(() => {});
    }
  }

  // Hermes-style channel entrypoint: only explicit @mentions create work.
  app.event("app_mention", async ({ event, client }) => {
    await handleChannelMention(event, client);
  });

  app.event("message", async ({ event, client }) => {
    if (!("user" in event) || !("text" in event)) return;
    // Allow file_share subtype through — user uploaded a file.
    // bot_message is filtered out by the subtype check (it's not "file_share").
    if (event.subtype && event.subtype !== "file_share") return;
    if (event.user !== config.slackUserId) return;

    const channel = event.channel;
    const threadTs = ("thread_ts" in event ? event.thread_ts : undefined) ?? event.ts;
    const text = event.text ?? "";

    // Extract any files attached to this message
    const slackFiles: SlackFile[] = [];
    // Slack's type for file_share events doesn't include `files` — use interface
    interface SlackEventFile { id: string; name?: string; mimetype?: string; size?: number; url_private_download?: string; url_private?: string }
    const eventFiles = "files" in event ? (event as unknown as { files?: SlackEventFile[] }).files : undefined;
    if (Array.isArray(eventFiles)) {
      for (const f of eventFiles) {
        slackFiles.push({
          id: f.id,
          name: f.name ?? "unknown",
          mimetype: f.mimetype,
          size: f.size ?? 0,
          urlPrivateDownload: f.url_private_download,
          urlPrivate: f.url_private,
        });
      }
    }

    // Command detection — handle !commands before cwd parsing
    const cmd = parseCommand(text);
    if (cmd) {
      let session = sessionManager.get(threadTs);
      // A bot restart can receive a command before restoreAll has rebuilt the
      // in-memory map. Re-open the native JSONL session for title updates.
      if (!session && cmd.name === "title") {
        try {
          session = await sessionManager.getOrCreate({
            threadTs,
            channelId: channel,
            cwd: config.defaultCwd,
          });
        } catch (err) {
          log.error("Failed to reopen session for title command", { threadTs, error: err });
        }
      }
      await dispatchCommand(cmd.name, cmd.args, {
        channel,
        threadTs,
        userId: event.user,
        client,
        sessionManager,
        session,
        pinStore,
        modelAllowlist: config.modelAllowlist,
        setThreadTitle: async (title) => setThreadTitle(channel, threadTs, title, client),
      });
      return;
    }

    // Thread replies skip cwd parsing — session already exists
    const isThreadReply = "thread_ts" in event && event.thread_ts !== undefined;
    if (isThreadReply) {
      const existing = sessionManager.get(threadTs);
      if (existing) {
        const { text: prompt, images } = await enrichPromptWithFiles(slackFiles, text, existing.cwd, config.slackBotToken);
        void existing.submit(prompt, { images }).catch((err) => {
          log.error("Failed to submit steered Slack message", { threadTs, error: err });
        });
        return;
      }
      // Thread reply but no session — fall through to create with cwd picker
    }

    try {
      // Start directly in the configured home directory. Each Slack thread
      // still gets its own session; the cwd picker is intentionally bypassed.
      const session = await sessionManager.getOrCreate({
        threadTs,
        channelId: channel,
        cwd: config.defaultCwd,
      });
      const { text: prompt, images } = await enrichPromptWithFiles(
        slackFiles,
        text,
        session.cwd,
        config.slackBotToken,
      );
      // Assistant threads support a real title. For ordinary DM threads this
      // is best-effort; the root prompt remains the visible fallback title.
      await setThreadTitle(channel, threadTs, titleFromPrompt(prompt), client);
      session.enqueue(async () => {
        await session.prompt(prompt, { images });
        // pi-topic-title generates a name after the first completed turn.
        const generated = session.sessionName;
        if (generated) await setThreadTitle(channel, threadTs, generated, client);
      });
    } catch (err) {
      if (err instanceof SessionLimitError) {
        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: "⚠️ Too many active sessions. Try again later.",
        });
        return;
      }
      log.error("Failed to start direct session", {
        threadTs,
        error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `❌ Failed to start session: ${err instanceof Error ? err.message : String(err)}`,
      }).catch((postErr) => {
        log.warn("Failed to post session-start failure notification", { threadTs, error: postErr });
      });
    }
  });

  /* ── Reaction handler ─────────────────────────────────────────── */

  app.event("reaction_added", async ({ event, client }) => {
    // Only handle reactions on messages
    if (event.item.type !== "message") return;
    // Only respond to the allowed user
    if (event.user !== config.slackUserId) return;

    const channel = event.item.channel;
    const messageTs = event.item.ts;
    const emoji = event.reaction;

    // Only handle mapped reactions
    if (!(emoji in REACTION_MAP)) return;

    // Find the thread this message belongs to. The reaction event gives us
    // the message ts but not the thread_ts. We need to look up the message
    // to find its thread. For simplicity, check if any session matches.
    // The message could be the thread parent or a reply — either way,
    // we need the thread_ts.
    let threadTs: string | undefined;
    try {
      const msgInfo = await client.conversations.replies({
        channel,
        ts: messageTs,
        limit: 1,
        inclusive: true,
      });
      const msg = msgInfo.messages?.[0];
      threadTs = msg?.thread_ts ?? msg?.ts;
    } catch {
      // Can't determine thread — ignore
      return;
    }

    if (!threadTs) return;
    const session = sessionManager.get(threadTs);
    if (!session) return;

    const handled = await handleReaction(emoji, session, client, channel, threadTs, messageTs, pinStore);
    if (handled) {
      // Remove the reaction to indicate it was processed
      try {
        await client.reactions.remove({
          channel,
          timestamp: messageTs,
          name: emoji,
        });
      } catch {
        // Reaction may already be removed or we lack permission
      }
    }
  });

  /* ── Action handler helper ─────────────────────────────────────── */

  /** Register a Slack button action handler with standard boilerplate. */
  function onButtonAction(
    actionId: string | RegExp,
    handler: (messageTs: string, value: string) => Promise<void>,
    opts?: { noValue?: boolean },
  ): void {
    app.action(actionId, async ({ action, body, ack }) => {
      await ack();
      if (!opts?.noValue && (action.type !== "button" || !("value" in action))) return;
      if (body.type !== "block_actions") return;
      const messageTs = body.message?.ts;
      if (!messageTs) return;
      const value = action.type === "button" && "value" in action ? action.value! : "";
      await handler(messageTs, value);
    });
  }

  /* ── CWD picker ──────────────────────────────────────────────────── */
  /* ── File picker ─────────────────────────────────────────────────── */
  onButtonAction(/^file_pick_select_/, handleFileSelect);
  onButtonAction(/^file_pick_nav_/, handleFileNav);
  onButtonAction("file_pick_nav_parent", handleFileNav);
  onButtonAction("file_pick_cancel", (ts) => handleFilePickCancel(ts), { noValue: true });

  /* ── Prompt template picker ──────────────────────────────────────── */
  onButtonAction(/^prompt_pick_/, handlePromptSelect);

  /* ── Model picker ────────────────────────────────────────────────── */
  onButtonAction(/^model_pick_/, handleModelSelect);

  /* ── Session resume picker ──────────────────────────────────────── */
  onButtonAction(/^resume_project_/, handleResumeProjectSelect);
  onButtonAction(/^resume_session_/, handleResumeSessionSelect);

  app.error(async (error) => {
    log.error("Bolt app error", { error });
  });

  return {
    app,
    sessionManager,
  };
}
