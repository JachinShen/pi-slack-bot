/**
 * AWS credential auto-refresh.
 *
 * Detects expired-token errors from Bedrock and runs `ada credentials update`
 * to refresh the credential_process cache before the next retry.
 */

import { execFile } from "node:child_process";
import { createLogger } from "./logger.js";

const log = createLogger("aws-creds");

/** Matches common expired/invalid token error messages from AWS SDK / Bedrock. */
const EXPIRED_TOKEN_RE = /security token.*expired|ExpiredToken|ExpiredTokenException|token.*invalid|UnrecognizedClientException/i;

export function isExpiredTokenError(err: unknown): boolean {
  if (!err) return false;
  const msg = typeof err === "string" ? err : (err as Error).message ?? String(err);
  return EXPIRED_TOKEN_RE.test(msg);
}

/**
 * Parse the ada account/role from the credential_process in ~/.aws/config
 * for the given profile, then run `ada credentials update` to refresh.
 */
export async function refreshAwsCredentials(): Promise<boolean> {
  const profile = process.env.AWS_PROFILE;
  if (!profile) {
    log.warn("No AWS_PROFILE set, cannot auto-refresh credentials");
    return false;
  }

  // Parse credential_process from aws config to extract account + role
  const { account, role } = await parseCredentialProcess(profile);
  if (!account || !role) {
    log.warn("Could not parse credential_process for profile", { profile });
    return false;
  }

  log.info("Refreshing AWS credentials", { profile, account, role });

  return new Promise<boolean>((resolve) => {
    execFile(
      "ada",
      [
        "credentials", "update",
        "--account", account,
        "--provider", "conduit",
        "--role", role,
        "--once",
        "--profile", profile,
      ],
      { timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) {
          log.error("ada credentials update failed", { error: err.message, stderr });
          resolve(false);
        } else {
          log.info("AWS credentials refreshed", { profile, stdout: stdout.trim() });
          resolve(true);
        }
      },
    );
  });
}

async function parseCredentialProcess(profile: string): Promise<{ account?: string; role?: string }> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");

  try {
    const configPath = process.env.AWS_CONFIG_FILE ?? join(homedir(), ".aws", "config");
    const content = await readFile(configPath, "utf-8");

    // Find the [profile <name>] section
    const sectionRe = new RegExp(`\\[profile\\s+${profile}\\]([\\s\\S]*?)(?=\\[|$)`);
    const match = content.match(sectionRe);
    if (!match) return {};

    const section = match[1];
    const cpMatch = section.match(/credential_process\s*=\s*(.+)/);
    if (!cpMatch) return {};

    const cp = cpMatch[1];
    const accountMatch = cp.match(/--account[=\s]+(\S+)/);
    const roleMatch = cp.match(/--role[=\s]+(\S+)/);

    return {
      account: accountMatch?.[1],
      role: roleMatch?.[1],
    };
  } catch {
    return {};
  }
}
