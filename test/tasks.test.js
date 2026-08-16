import test from "node:test";
import assert from "node:assert/strict";
import { TaskStore } from "../lib/tasks.js";

test("TaskStore completes an asynchronous task", async () => {
  const store = new TaskStore(async () => ({ id: "session-1", result: Promise.resolve({ stopReason: "completed", output: [{ type: "text", text: "done" }] }), dispose: async () => {} }));
  const task = store.submit({ label: "test", task: "work", timeoutMs: 0 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(store.get(task.id).state, "completed");
  assert.equal(store.get(task.id).result, "done");
});

test("TaskStore cancellation is terminal", async () => {
  const store = new TaskStore(async (_request, signal) => ({ id: "session-2", result: new Promise((resolve) => signal.addEventListener("abort", () => resolve({ stopReason: "aborted", output: [] }))), dispose: async () => {} }));
  const task = store.submit({ label: "test", task: "work", timeoutMs: 0 });
  await new Promise((resolve) => setTimeout(resolve, 2));
  const cancelled = store.cancel(task.id);
  assert.equal(cancelled.state, "cancelled");
});
