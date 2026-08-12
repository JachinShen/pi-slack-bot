import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { PinStore, type Pin } from "./pin-store.js";

const cleanupDirs: string[] = [];

function makeTmpDir(): string {
  const dir = path.join(os.tmpdir(), `pin-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}

const samplePin: Pin = {
  timestamp: "2026-03-13T00:00:00.000Z",
  preview: "Hello world",
  permalink: "https://slack.com/archives/C1/p123",
  channelId: "C1",
  threadTs: "ts1",
};

describe("PinStore", () => {
  afterEach(() => {
    for (const dir of cleanupDirs) {
      try { fs.rmSync(dir, { recursive: true }); } catch { /* ignore */ }
    }
    cleanupDirs.length = 0;
  });

  it("starts empty when no file exists", () => {
    const store = new PinStore(makeTmpDir());
    assert.deepEqual(store.all, []);
    assert.equal(store.length, 0);
  });

  it("add persists to disk", async () => {
    const dir = makeTmpDir();
    const store = new PinStore(dir);

    store.add(samplePin);
    assert.equal(store.all.length, 1);
    assert.deepEqual(store.all[0], samplePin);

    // Wait for async write
    await new Promise((r) => setTimeout(r, 50));

    const filePath = path.join(dir, "pins.json");
    assert.ok(fs.existsSync(filePath));
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    assert.deepEqual(data, [samplePin]);
  });

  it("loads pins from disk on construction", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "pins.json"), JSON.stringify([samplePin]), "utf-8");

    const store = new PinStore(dir);
    assert.equal(store.all.length, 1);
    assert.deepEqual(store.all[0], samplePin);
  });

  it("survives missing file gracefully", () => {
    const store = new PinStore(makeTmpDir());
    assert.deepEqual(store.all, []);
  });

  it("survives corrupt file gracefully", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "pins.json"), "not json", "utf-8");

    const store = new PinStore(dir);
    assert.deepEqual(store.all, []);
  });

  it("accumulates multiple pins", async () => {
    const dir = makeTmpDir();
    const store = new PinStore(dir);

    const pin2: Pin = { ...samplePin, preview: "Second", threadTs: "ts2" };
    store.add(samplePin);
    store.add(pin2);

    assert.equal(store.length, 2);
    assert.equal(store.all[0].preview, "Hello world");
    assert.equal(store.all[1].preview, "Second");

    // Wait for async writes
    await new Promise((r) => setTimeout(r, 50));

    const data = JSON.parse(fs.readFileSync(path.join(dir, "pins.json"), "utf-8"));
    assert.equal(data.length, 2);
  });

  it("forThread filters by thread", () => {
    const dir = makeTmpDir();
    const store = new PinStore(dir);

    store.add(samplePin);
    store.add({ ...samplePin, threadTs: "ts2", preview: "Other thread" });
    store.add({ ...samplePin, threadTs: "ts1", preview: "Same thread" });

    const ts1Pins = store.forThread("ts1");
    assert.equal(ts1Pins.length, 2);
    assert.equal(ts1Pins[0].preview, "Hello world");
    assert.equal(ts1Pins[1].preview, "Same thread");

    const ts2Pins = store.forThread("ts2");
    assert.equal(ts2Pins.length, 1);
    assert.equal(ts2Pins[0].preview, "Other thread");
  });

  it("remove deletes by index and persists", async () => {
    const dir = makeTmpDir();
    const store = new PinStore(dir);

    store.add(samplePin);
    store.add({ ...samplePin, preview: "Second" });

    const removed = store.remove(0);
    assert.equal(removed?.preview, "Hello world");
    assert.equal(store.length, 1);
    assert.equal(store.all[0].preview, "Second");

    // Wait for async write
    await new Promise((r) => setTimeout(r, 50));

    const data = JSON.parse(fs.readFileSync(path.join(dir, "pins.json"), "utf-8"));
    assert.equal(data.length, 1);
  });

  it("remove returns undefined for invalid index", () => {
    const store = new PinStore(makeTmpDir());
    assert.equal(store.remove(-1), undefined);
    assert.equal(store.remove(0), undefined);
    assert.equal(store.remove(999), undefined);
  });

  it("shared across multiple PinStore instances on same dir", async () => {
    const dir = makeTmpDir();
    const store1 = new PinStore(dir);
    store1.add(samplePin);

    // Wait for write
    await new Promise((r) => setTimeout(r, 50));

    // Second instance loads from same file
    const store2 = new PinStore(dir);
    assert.equal(store2.all.length, 1);
    assert.equal(store2.all[0].preview, "Hello world");
  });
});
