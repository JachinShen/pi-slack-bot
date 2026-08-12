/**
 * Shared path utilities.
 */
import { homedir } from "os";
import { resolve } from "path";

/** Expand ~ or ~/ prefix to the user's home directory. */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return p;
}
