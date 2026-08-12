/**
 * Reaction-based interactions — map emoji reactions to bot commands.
 *
 * Users can react to messages in a bot thread to trigger actions
 * without typing commands. The reaction is removed after handling
 * to provide visual feedback.
 */
import type { WebClient } from "@slack/web-api";
import type { ThreadSession } from "./thread-session.js";
import type { Pin, PinStore } from "./pin-store.js";
import { cancelSession, showDiff, compactSession } from "./session-actions.js";
import { createLogger } from "./logger.js";

const log = createLogger("reactions");

/** Map of Slack emoji names to action identifiers. */
export const REACTION_MAP: Record<string, string> = {
  x: "cancel",
  arrows_counterclockwise: "retry",
  clipboard: "diff",
  clamp: "compact",
  pushpin: "pin",
};

/**
 * Handle a reaction on a message in a bot thread.
 *
 * @param messageTs - The ts of the specific message that was reacted to.
 * @returns true if the reaction was handled, false if the emoji is not mapped.
 */
export async function handleReaction(
  emoji: string,
  session: ThreadSession,
  client: WebClient,
  channel: string,
  threadTs: string,
  messageTs: string,
  pinStore?: PinStore,
): Promise<boolean> {
  const action = REACTION_MAP[emoji];
  if (!action) return false;

  log.info("Handling reaction", { emoji, action, threadTs });

  const reply = async (text: string) => {
    await client.chat.postMessage({ channel, thread_ts: threadTs, text });
  };

  switch (action) {
    case "cancel":
      await cancelSession(session, reply);
      break;

    case "retry": {
      const lastPrompt = session.lastUserPrompt;
      if (!lastPrompt) {
        await reply("No previous prompt to retry.");
        return true;
      }
      await reply(`🔄 Retrying: ${lastPrompt.length > 100 ? lastPrompt.slice(0, 100) + "…" : lastPrompt}`);
      session.enqueue(() => session.prompt(lastPrompt));
      break;
    }

    case "diff":
      await showDiff(session, reply, client, channel, threadTs);
      break;

    case "compact":
      await compactSession(session, reply);
      break;

    case "pin": {
      try {
        // Fetch the reacted message to get its content
        const replies = await client.conversations.replies({
          channel,
          ts: threadTs,
          limit: 200,
          inclusive: true,
        });
        const msg = (replies.messages ?? []).find((m) => m.ts === messageTs);
        if (!msg) {
          await reply("Couldn't find the message to pin.");
          return true;
        }

        const permalinkResult = await client.chat.getPermalink({
          channel,
          message_ts: messageTs,
        });

        const text = msg.text ?? "";
        const preview = text.length > 150 ? text.slice(0, 150) + "…" : text;
        const pin: Pin = {
          timestamp: new Date().toISOString(),
          preview,
          permalink: permalinkResult.permalink ?? "",
          channelId: channel,
          threadTs,
        };
        pinStore?.add(pin);
        await reply(`📌 Pinned: "${preview}"`);
      } catch (err) {
        await reply(`❌ Failed to pin: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }
  }

  return true;
}
