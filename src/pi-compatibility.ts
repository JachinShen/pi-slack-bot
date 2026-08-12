import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createAgentSession, DefaultResourceLoader, SessionManager as PiSessionManager } from "@earendil-works/pi-coding-agent";
import type { Config } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("pi-compatibility");

export interface CompatibilityResult {
  piVersion: string;
  modelRuntime: boolean;
  resourceLoader: boolean;
  sessionCreation: boolean;
  modelConfigured: boolean;
}

function packageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    let current = path.dirname(fileURLToPath(import.meta.url));
    const installedPackage = path.resolve(current, "../node_modules/@earendil-works/pi-coding-agent");
    if (existsSync(path.join(installedPackage, "package.json"))) current = installedPackage;
    else current = path.dirname(require.resolve("@earendil-works/pi-coding-agent"));
    for (;;) {
      const packagePath = path.join(current, "package.json");
      if (existsSync(packagePath)) {
        const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: string; version?: string };
        if (packageJson.name === "@earendil-works/pi-coding-agent") return packageJson.version ?? "unknown";
      }
      const parent = path.dirname(current);
      if (parent === current) return "unknown";
      current = parent;
    }
  } catch {
    return "unknown";
  }
}

/**
 * Fail fast on Pi API drift before opening a Slack socket.
 * This deliberately creates a disposable real AgentSession: shape checks alone
 * would not catch constructor/resource-loader/session-manager incompatibilities.
 */
export async function checkPiCompatibility(config: Config): Promise<CompatibilityResult> {
  const cwd = config.workspaceDirs[0] || os.homedir();
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-slack-compat-"));
  const sessionPath = path.join(tempDir, "compat.jsonl");

  let resourceLoader: DefaultResourceLoader | undefined;
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    resourceLoader = new DefaultResourceLoader({ cwd, agentDir });
    await resourceLoader.reload();

    const piSessionManager = PiSessionManager.open(sessionPath, tempDir);
    const created = await createAgentSession({
      cwd,
      sessionManager: piSessionManager,
      tools: ["read", "bash", "edit", "write"],
      resourceLoader,
    });
    session = created.session;

    if (!session.modelRuntime || typeof session.modelRuntime.getModels !== "function") {
      throw new Error("Pi API mismatch: AgentSession.modelRuntime.getModels() is unavailable");
    }
    const activeTools = session.getActiveToolNames();
    if (!activeTools.includes("bash")) {
      throw new Error(`Pi tool configuration mismatch: bash is not active (active: ${activeTools.join(", ")})`);
    }

    const models = session.modelRuntime.getModels();
    const modelConfigured = models.some((m) => m.provider === config.provider && m.id === config.model)
      || models.some((m) => m.provider === config.provider);
    if (!modelConfigured) {
      throw new Error(`Configured provider/model is unavailable: ${config.provider}/${config.model}`);
    }

    const result: CompatibilityResult = {
      piVersion: packageVersion(),
      modelRuntime: true,
      resourceLoader: true,
      sessionCreation: true,
      modelConfigured,
    };
    log.info("Pi compatibility check passed", { ...result });
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Pi compatibility check failed: ${detail}`, { cause: error });
  } finally {
    session?.dispose();
    await rm(tempDir, { recursive: true, force: true });
  }
}
