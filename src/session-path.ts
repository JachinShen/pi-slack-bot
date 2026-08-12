/**
 * Shared utility for encoding cwd paths into pi session directory names.
 *
 * Pi stores sessions under ~/.pi/agent/sessions/--<encoded-cwd>--/
 * where the encoding strips the leading slash and replaces path separators
 * with dashes.
 */

/** Encode cwd the same way pi does for session directory names. */
export function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}
