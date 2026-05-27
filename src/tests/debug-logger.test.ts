import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getDebugLogPath, logOpenAIChatCompletionDebug } from "../common/debug-logger";

test("debug logger appends full entries without rotation", () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-debug-log-home-"));
  process.env.HOME = home;
  if (process.platform === "win32") {
    process.env.USERPROFILE = home;
  }
  try {
    for (let index = 0; index < 25; index += 1) {
      logOpenAIChatCompletionDebug({
        timestamp: "2026-01-01T00:00:00.000Z",
        location: "test.location",
        requestId: `request-${index}`,
        model: "test-model",
        request: {
          model: "test-model",
          messages: [{ role: "user", content: `full request content ${index}` }],
        },
        response: {
          choices: [{ message: { content: `full response content ${index}` } }],
        },
      });
    }

    const raw = fs.readFileSync(getDebugLogPath(), "utf8");
    const lines = raw.trim().split("\n");
    assert.equal(lines.length, 25);

    const first = JSON.parse(lines[0]) as Record<string, any>;
    const last = JSON.parse(lines[24]) as Record<string, any>;
    assert.equal(first.requestId, "request-0");
    assert.equal(first.request.messages[0].content, "full request content 0");
    assert.equal(last.requestId, "request-24");
    assert.equal(last.response.choices[0].message.content, "full response content 24");
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
});
