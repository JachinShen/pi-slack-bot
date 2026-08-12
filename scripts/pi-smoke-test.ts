import { config as loadDotenv } from "dotenv";
loadDotenv();

import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import type { WebClient } from "@slack/web-api";
import { loadConfig } from "../src/config.js";
import { ThreadSession } from "../src/thread-session.js";
import { checkPiCompatibility } from "../src/pi-compatibility.js";

const config = loadConfig();
const runPrompt = process.argv.includes("--prompt");
const cwd = config.workspaceDirs[0] || os.homedir();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-slack-smoke-"));
const messages: string[] = [];

// The smoke test must not send anything to Slack. These methods capture the
// updater calls while exercising the real Pi session and model runtime.
let messageSequence = 0;
const fakeClient = {
  chat: {
    postMessage: async (args: { text?: string }) => {
      if (args.text) messages.push(args.text);
      messageSequence++;
      return { ok: true, ts: `smoke-${messageSequence}` };
    },
    update: async (args: { text?: string }) => {
      if (args.text) messages.push(args.text);
      return { ok: true };
    },
  },
  reactions: {
    add: async () => ({ ok: true }),
    remove: async () => ({ ok: true }),
  },
  files: {
    uploadV2: async () => ({ ok: true }),
  },
} as unknown as WebClient;

let session: ThreadSession | undefined;
try {
  await checkPiCompatibility({ ...config, sessionDir: tempDir });

  if (runPrompt) {
    session = await ThreadSession.create({
      threadTs: "smoke-thread",
      channelId: "smoke-channel",
      cwd,
      config: { ...config, sessionDir: tempDir },
      client: fakeClient,
      sessionDir: tempDir,
    });
    await session.prompt("Reply with exactly: PI_SMOKE_OK");
    if (session.messageCount < 2) {
      throw new Error(`Smoke prompt completed without assistant output (messageCount=${session.messageCount})`);
    }
    console.log(JSON.stringify({ ok: true, mode: "prompt", messageCount: session.messageCount, capturedMessages: messages.length }));
  } else {
    console.log(JSON.stringify({ ok: true, mode: "session", note: "Pass --prompt to make one live model request" }));
  }
} finally {
  await session?.dispose();
  await rm(tempDir, { recursive: true, force: true });
}
// Pi extensions may leave process-wide watchers alive; a smoke test is a
// bounded command, so terminate explicitly after cleanup.
process.exit(0);
