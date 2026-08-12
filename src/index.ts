import { config as loadDotenv } from "dotenv";
loadDotenv();

import { loadConfig } from "./config.js";
import { createApp } from "./slack.js";
import { createLogger } from "./logger.js";
import { checkPiCompatibility } from "./pi-compatibility.js";

const log = createLogger("main");
const config = loadConfig();

log.info("pi-slack-bot starting", {
  slackUserId: config.slackUserId,
  provider: config.provider,
  model: config.model,
  thinkingLevel: config.thinkingLevel,
  maxSessions: config.maxSessions,
  sessionIdleTimeoutSecs: config.sessionIdleTimeoutSecs,
  sessionDir: config.sessionDir,
  streamThrottleMs: config.streamThrottleMs,
  slackMsgLimit: config.slackMsgLimit,
  defaultCwd: config.defaultCwd,
  workspaceDirs: config.workspaceDirs,
});

// Validate the Pi SDK before opening a Slack socket. This turns API drift into
// an actionable startup error instead of a failure on the first Slack message.
await checkPiCompatibility(config);

const slackApp = createApp(config);

await slackApp.app.start();
log.info("Bot running");

// Restore sessions from the on-disk registry (non-blocking — failures are logged)
slackApp.sessionManager.restoreAll().then((count) => {
  if (count > 0) log.info("Restored sessions from previous run", { count });
}).catch((err) => {
  log.error("Failed to restore sessions", { error: err });
});

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled promise rejection", { error: reason });
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    log.info(`Shutting down (${sig})`);
    slackApp.sessionManager.stopReaper();
    await slackApp.sessionManager.disposeAll();
    await slackApp.sessionManager.flushRegistry();
    slackApp.sessionManager.disposeRegistry();
    await slackApp.app.stop();
    process.exit(0);
  });
}
