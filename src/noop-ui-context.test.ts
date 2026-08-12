import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createNoopUiContext } from "./noop-ui-context.js";

describe("createNoopUiContext", () => {
  it("returns an object with all standard UI methods", () => {
    const ctx = createNoopUiContext();

    // Verify key methods exist and are callable
    assert.equal(typeof ctx.select, "function");
    assert.equal(typeof ctx.confirm, "function");
    assert.equal(typeof ctx.input, "function");
    assert.equal(typeof ctx.notify, "function");
    assert.equal(typeof ctx.onTerminalInput, "function");
    assert.equal(typeof ctx.setStatus, "function");
    assert.equal(typeof ctx.setWorkingMessage, "function");
    assert.equal(typeof ctx.setWidget, "function");
    assert.equal(typeof ctx.setFooter, "function");
    assert.equal(typeof ctx.setHeader, "function");
    assert.equal(typeof ctx.setTitle, "function");
    assert.equal(typeof ctx.custom, "function");
    assert.equal(typeof ctx.pasteToEditor, "function");
    assert.equal(typeof ctx.setEditorText, "function");
    assert.equal(typeof ctx.getEditorText, "function");
    assert.equal(typeof ctx.editor, "function");
    assert.equal(typeof ctx.setEditorComponent, "function");
    assert.equal(typeof ctx.getAllThemes, "function");
    assert.equal(typeof ctx.getTheme, "function");
    assert.equal(typeof ctx.setTheme, "function");
    assert.equal(typeof ctx.getToolsExpanded, "function");
    assert.equal(typeof ctx.setToolsExpanded, "function");
  });

  it("async methods return expected defaults", async () => {
    const ctx = createNoopUiContext();

    assert.equal(await ctx.select("title", ["a", "b"]), undefined);
    assert.equal(await ctx.confirm("title", "msg"), false);
    assert.equal(await ctx.input("title"), undefined);
    assert.equal(await ctx.editor("title"), undefined);
    assert.equal(await ctx.custom(() => ({} as any)), undefined);
  });

  it("sync methods return expected defaults", () => {
    const ctx = createNoopUiContext();

    assert.equal(ctx.getEditorText(), "");
    assert.equal(ctx.getToolsExpanded(), false);
    assert.deepEqual(ctx.getAllThemes(), []);
    assert.equal(ctx.getTheme("any"), undefined);
  });

  it("theme passes text through unchanged", () => {
    const ctx = createNoopUiContext();

    assert.equal(ctx.theme.bold("hello"), "hello");
    assert.equal(ctx.theme.fg("red" as any, "text"), "text");
    assert.equal(ctx.theme.bg("blue" as any, "text"), "text");
    assert.equal(ctx.theme.italic("text"), "text");
    assert.equal(ctx.theme.underline("text"), "text");
    assert.equal(ctx.theme.inverse("text"), "text");
    assert.equal(ctx.theme.strikethrough("text"), "text");
  });

  it("allows overriding specific methods", () => {
    const messages: string[] = [];
    const ctx = createNoopUiContext({
      notify: (msg: string) => { messages.push(msg); },
    });

    ctx.notify("hello");
    assert.deepEqual(messages, ["hello"]);
  });

  it("unknown methods return no-op via proxy", () => {
    const ctx = createNoopUiContext();
    // Access a method that doesn't exist yet — Proxy should return a function
    const unknownMethod = (ctx as any).someNewFutureMethod;
    assert.equal(typeof unknownMethod, "function");
    // Calling it should not throw
    unknownMethod("arg1", "arg2");
  });

  it("onTerminalInput returns an unsubscribe function", () => {
    const ctx = createNoopUiContext();
    const unsub = ctx.onTerminalInput(() => undefined);
    assert.equal(typeof unsub, "function");
    // Calling unsub should not throw
    unsub();
  });
});
