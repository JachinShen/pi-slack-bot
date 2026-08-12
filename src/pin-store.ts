/**
 * Global pin store — persists pinned messages to a single JSON file
 * shared across all threads and sessions.
 *
 * Pins survive session resets (!new), cwd changes (!cwd), and bot restarts.
 */
import fs from "fs/promises";
import { readFileSync } from "fs";
import path from "path";
import { createLogger } from "./logger.js";

const log = createLogger("pin-store");

export interface Pin {
  /** ISO timestamp of when the message was pinned. */
  timestamp: string;
  /** First 150 characters of the message (with "…" if truncated). */
  preview: string;
  /** Slack permalink to the pinned message. */
  permalink: string;
  /** Channel where the pin was created. */
  channelId: string;
  /** Thread where the pin was created. */
  threadTs: string;
}

export class PinStore {
  private _pins: Pin[];
  private _filePath: string;

  constructor(sessionDir: string) {
    this._filePath = path.join(sessionDir, "pins.json");
    this._pins = PinStore._load(this._filePath);
  }

  /** All pins, most recent first. */
  get all(): ReadonlyArray<Pin> {
    return this._pins;
  }

  /** Pins for a specific thread. */
  forThread(threadTs: string): ReadonlyArray<Pin> {
    return this._pins.filter((p) => p.threadTs === threadTs);
  }

  /** Add a pin and persist to disk. */
  add(pin: Pin): void {
    this._pins.push(pin);
    this._save();
  }

  /** Remove a pin by index and persist. Returns the removed pin, or undefined. */
  remove(index: number): Pin | undefined {
    if (index < 0 || index >= this._pins.length) return undefined;
    const [removed] = this._pins.splice(index, 1);
    this._save();
    return removed;
  }

  /** Number of pins. */
  get length(): number {
    return this._pins.length;
  }

  /** Load pins from disk. Returns [] on any error. */
  private static _load(filePath: string): Pin[] {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data;
      return [];
    } catch {
      return [];
    }
  }

  /** Pending save promise for serialization. */
  private _savePromise: Promise<void> = Promise.resolve();

  /** Persist pins to disk (async, best-effort, serialized). */
  private _save(): void {
    const data = JSON.stringify(this._pins, null, 2);
    this._savePromise = this._savePromise
      .then(() => fs.writeFile(this._filePath, data, "utf-8"))
      .catch((err) => log.error("Failed to save pins", { error: err, path: this._filePath }));
  }
}
