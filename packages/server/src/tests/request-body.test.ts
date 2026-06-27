import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { readJsonBody } from "../services/request-body";

function requestBody(content?: string): IncomingMessage {
  return Readable.from(content === undefined ? [] : [Buffer.from(content)]) as IncomingMessage;
}

test("readJsonBody returns empty object for empty bodies", async () => {
  assert.deepEqual(await readJsonBody(requestBody()), {});
  assert.deepEqual(await readJsonBody(requestBody("   ")), {});
});

test("readJsonBody parses JSON bodies", async () => {
  assert.deepEqual(await readJsonBody(requestBody('{"text":"hello"}')), { text: "hello" });
});

test("readJsonBody rejects invalid JSON with statusCode 400", async () => {
  await assert.rejects(readJsonBody(requestBody("{")), (error) => {
    assert.equal((error as { statusCode?: number }).statusCode, 400);
    return true;
  });
});

test("readJsonBody rejects bodies over the limit with statusCode 413", async () => {
  const tooLarge = "x".repeat(16 * 1024 * 1024 + 1);
  await assert.rejects(readJsonBody(requestBody(tooLarge)), (error) => {
    assert.equal((error as { statusCode?: number }).statusCode, 413);
    assert.match(String((error as Error).message), /16 MiB/u);
    return true;
  });
});
