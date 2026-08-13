# pi-slack-bot

A Slack bot that exposes [pi](https://github.com/earendil-works/pi) as a conversational coding agent. It supports Slack Agent View, channel `@mentions`, persistent one-session-per-thread conversations, streaming responses, tool execution, model/thinking controls, and AI-generated Slack thread titles.

## Features

- **Threaded sessions** — each Slack thread gets its own pi agent session with full conversation history
- **Streaming responses** — real-time updates with tool execution indicators, auto-split for long messages
- **Default working directory** — starts every new session in `DEFAULT_CWD` without a project picker
- **Interactive file picker** — browse and select files via Slack buttons when the agent needs user input
- **Commands** — `!model`, `!thinking`, `!title`, `!cwd`, `!cancel`, `!new`, `!sessions`, and more
- **Prompt templates** — run file-based prompt templates via `!prompt` with a picker UI
- **Attach server** — external processes can connect via WebSocket and stream to Slack threads
- **Session management** — configurable limits, idle timeout, automatic cleanup
- **AI tool approval** — pi-menshen reviews risky tool calls with `openai-codex/gpt-5.3-codex-spark`; uncertain calls pause and appear as Slack approval buttons

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- A Slack app with Socket Mode enabled (see [Slack App Setup](#slack-app-setup))
- [pi](https://github.com/mariozechner/pi-coding-agent) installed and configured
- An LLM provider (Anthropic, AWS Bedrock, etc.) with credentials configured

## Installation

```bash
git clone https://github.com/JachinShen/pi-slack-bot.git
cd pi-slack-bot
npm install
```

## Configuration

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | ✅ | — | Bot token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | ✅ | — | App-level token (`xapp-...`) for Socket Mode |
| `SLACK_USER_ID` | ✅ | — | Your Slack user ID (bot only responds to you) |
| `PROVIDER` | | `anthropic` | LLM provider name |
| `MODEL` | | `claude-sonnet-4-5` | Model ID |
| `THINKING_LEVEL` | | `off` | Thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `MAX_SESSIONS` | | `10` | Max concurrent sessions |
| `SESSION_IDLE_TIMEOUT` | | `3600` | Idle session timeout in seconds |
| `SESSION_DIR` | | `~/.pi/agent/sessions` | Shared native Pi session directory |
| `STREAM_THROTTLE_MS` | | `3000` | Min interval between Slack message updates |
| `SLACK_MSG_LIMIT` | | `3900` | Max chars per Slack message before splitting |
| `DEFAULT_CWD` | | `~` | Working directory for every new session |
| `WORKSPACE_DIRS` | | `~/projects` | Legacy project discovery directories |
| `ATTACH_PORT` | | `3001` | WebSocket port for the attach server |

### AI approval configuration

Install the permission extension once:

```bash
pi install npm:@shinynito/pi-menshen
```

The bot uses `~/.pi/pi-menshen.json` with the dedicated reviewer model `openai-codex/gpt-5.3-codex-spark`. AI-safe calls are auto-approved. Calls requiring human review are sent to the operator's Slack DM with allow, deny, and deny-and-remember buttons. Expired, failed, or unauthorized approvals fail closed.

### Project Discovery

The bot discovers projects by scanning `WORKSPACE_DIRS` one level deep. For finer control, create `~/.pi-slack-bot/projects.json`:

```json
{
  "scanDirs": ["~/projects", "~/work"],
  "pin": ["~/dotfiles"],
  "exclude": ["node_modules", "CR-*"],
  "labels": {
    "my-app": "🚀 My App",
    "dotfiles": "⚙️ Dotfiles"
  }
}
```

## Usage

```bash
npm start
```

Then open the App Home Messages tab or mention the bot in a configured channel. Each new Slack Agent thread creates an independent persistent Pi session:

- **With a path:** `~/projects/my-app fix the login bug` → starts in that directory
- **With a fuzzy name:** `my-app fix the login bug` → matches against known projects
- **Plain message:** `hello` → starts directly in `DEFAULT_CWD`

In a channel:

```text
@Pi investigate the failing login tests
```

Follow-up messages in that Slack thread continue the same Pi session. A new `@Pi` root message creates a separate session.

### Commands

| Command | Description |
|---|---|
| `!help` | Show available commands |
| `!new` | Start a fresh session (same thread) |
| `!cancel` | Cancel the current stream |
| `!status` | Show session info (model, cwd, message count) |
| `!model <name>` | Switch model |
| `!thinking <level>` | Set thinking level |
| `!title [direction]` | Ask Pi to regenerate the title from the full conversation and sync it to Slack Agent thread history |
| `!sessions` | List all active sessions |
| `!cwd <path>` | Change working directory (creates a new session) |
| `!reload` | Reload extensions and prompt templates |
| `!plan <idea>` | Start a PDD planning session |
| `!prompt [name]` | Run a prompt template |

Any unrecognized `!command` is forwarded to pi as `/command` (for extensions and prompt templates).

## Slack App Setup

A ready-to-paste Agent View manifest is included at [`manifest.json`](./manifest.json). Paste it into Slack under **App Manifest → JSON**, save it, and reinstall the app to the workspace. The manifest includes `assistant:write`, `app_mentions:read`, `chat:write`, Socket Mode, Agent View, and the events needed for channel mentions and thread reactions.

Slack Assistant thread titles require the Agent/Assistant experience and `assistant:write`. Ordinary Slack message threads do not have a standard editable title field.


1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Enable **Socket Mode** under Settings → Socket Mode and generate an app-level token (`xapp-...`)
3. Under **OAuth & Permissions**, add these bot token scopes:
   - `chat:write`
   - `im:history`
   - `im:read`
   - `im:write`
   - `reactions:read`
   - `reactions:write`
4. Under **Event Subscriptions**, enable events and subscribe to:
   - `message.im`
5. Install the app to your workspace and copy the bot token (`xoxb-...`)
6. Find your Slack user ID (click your profile → "..." → "Copy member ID")

## Deployment (Linux / systemd)

Use `run.sh` as the process entry point — it handles `NODE_PATH` resolution for pi packages and auto-restarts on exit code 75 (issued by `!restart`).

```bash
./run.sh
# or in tmux:
tmux new -d -s bot './run.sh'
```

**Heap sizing under cgroup memory limits.** Node 22 auto-sizes `--max-old-space-size` to roughly half the cgroup `MemoryMax`. Under a 1 GB systemd limit this gives V8 only ~380 MB of old-gen — not enough for several active sessions. `run.sh` applies a safe default (`NODE_OPTIONS=--max-old-space-size=768`) unless you've already set it.

If you run under systemd, add `MemoryHigh` generously above the heap ceiling so the kernel doesn't OOM-kill before V8 can GC:

```ini
[Service]
ExecStart=/path/to/pi-slack-bot/run.sh
Restart=on-failure
RestartSec=10
StartLimitBurst=5
StartLimitIntervalSec=300
Environment=NODE_OPTIONS=--max-old-space-size=768
MemoryHigh=1200M
MemoryMax=1500M
```

Adjust `--max-old-space-size` based on how many concurrent sessions you expect (`MAX_SESSIONS` × ~100–150 MB/session is a reasonable estimate).

## Development

```bash
# Run tests
npm test

# Type check
npm run typecheck

# Test coverage
npm run coverage

# Check code duplication
npm run duplication
```

## Architecture

```
src/
├── index.ts              # Entry point — boots Slack app + attach server
├── config.ts             # Environment variable parsing
├── slack.ts              # Slack Bolt app, event routing, project picker, approval actions
├── session-manager.ts    # Session lifecycle, limits, idle reaping
├── thread-session.ts     # Per-thread pi AgentSession wrapper
├── streaming-updater.ts  # Streams agent output to Slack with throttling
├── formatter.ts          # Markdown → Slack mrkdwn conversion, splitting
├── parser.ts             # Message parsing, project discovery, fuzzy match
├── commands.ts           # !command dispatch
├── command-picker.ts     # Prompt template button picker
├── file-picker.ts        # Interactive file browser via Slack buttons
├── approval-relay.ts      # pi-menshen headless relay → Slack Block Kit approval
└── attach-server.ts      # WebSocket server for external session attachment
```

## License

[MIT](LICENSE)
