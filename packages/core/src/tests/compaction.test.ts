import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { SessionManager, type SessionMessage } from "../session";
import { OpenAIMessageConverter } from "../common/openai-message-converter";
import { getCompactPrompt, frameCompactSummary } from "../prompt";
import {
  compactBudget,
  compactPrefixes as selectPrefixes,
  estimateRequestBytes,
  estimateRequestTokens,
  imageOffloadCount,
  isContextOverflow,
  MAX_REQUEST_BODY_BYTES,
} from "../common/compaction";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const directories: string[] = [];
afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function message(id: string, role: SessionMessage["role"] = "user", content = "history ".repeat(1000)): SessionMessage {
  return {
    id,
    sessionId: "compact-test",
    role,
    content,
    contentParams: null,
    messageParams: null,
    visible: true,
    compacted: false,
    createTime: "2026-01-01T00:00:00Z",
    updateTime: "2026-01-01T00:00:00Z",
  };
}

function answer(content = "## Current Work\n- Continue the requested implementation.", finish_reason = "stop") {
  return {
    choices: [{ message: { content }, finish_reason }],
    usage: { prompt_tokens: 4000, completion_tokens: 20, total_tokens: 4020 },
  };
}

function fixture(history: SessionMessage[], respond: (request: any, call: number) => unknown = () => answer()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-compaction-"));
  directories.push(root);
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  const requests: any[] = [];
  const notices: SessionMessage[] = [];
  const settings = {
    model: "test-vision",
    contextWindow: 256 * 1024,
    autoCompactWindow: 190000,
    retainTokens: undefined as number | undefined,
  };
  const manager = new SessionManager({
    projectRoot: root,
    createOpenAIClient: () => ({
      model: settings.model,
      thinkingEnabled: true,
      client: {
        chat: {
          completions: {
            create: async (request: any) => {
              requests.push(request);
              return await respond(request, requests.length);
            },
          },
        },
      } as any,
    }),
    getResolvedSettings: () => settings,
    renderMarkdown: (text) => text,
    onAssistantMessage: (message) => notices.push(message),
  });
  const internal = manager as any;
  internal.saveSessionMessages("compact-test", history);
  return {
    manager,
    internal,
    requests,
    notices,
    settings,
    root,
    read: () => manager.listSessionMessages("compact-test"),
    compact: (signal?: AbortSignal) => manager.compactSession("compact-test", signal),
    run: () => internal.requestSessionCompletion("compact-test", new AbortController().signal, 0),
  };
}

function compactPrefixes(history: SessionMessage[], prices: number[], retain: number) {
  const selection = selectPrefixes(history, prices, retain);
  return selection.ends.map((end) => selection.history.slice(0, end));
}

test("manual compaction reports whether it changed history", async () => {
  const empty = fixture([]);
  assert.equal(await empty.compact(), false);
  assert.equal(empty.requests.length, 0);
  assert.deepEqual(
    empty.notices.map((item) => item.content),
    ["Compacting conversation..."]
  );
  const short = fixture([message("only")]);
  assert.equal(await short.compact(), false);
  assert.equal(short.requests.length, 0);
  const history = [message("older"), message("reply", "assistant"), message("tail")];
  const ready = fixture(history);
  assert.equal(await ready.compact(), true);
  assert.equal(ready.requests.length, 1);
  assert.deepEqual(
    ready.notices.map((item) => [item.role, item.content]),
    [
      ["assistant", "Compacting conversation..."],
      ["user", "Conversation compacted."],
    ]
  );
  assert.ok(ready.notices.every((notice) => !ready.read().some((item) => item.id === notice.id)));
  assert.deepEqual(
    ready
      .read()
      .filter((item) => item.visible)
      .map((item) => item.id),
    history.map((item) => item.id)
  );
  assert.equal(ready.read().find((item) => item.meta?.isSummary)?.visible, false);
});

test("request estimates include reasoning and tools without charging image base64 as text", () => {
  const request = (data: string) => [
    {
      role: "user" as const,
      content: [{ type: "image_url" as const, image_url: { url: `data:image/png;base64,${data}` } }],
    },
  ];
  assert.equal(estimateRequestTokens(request("AA")), estimateRequestTokens(request("A".repeat(1000000))));
  assert.ok(estimateRequestTokens(request("AA")) > 1000);
  assert.ok(
    estimateRequestTokens([{ role: "assistant", content: "", reasoning_content: "x".repeat(10000) } as any]) > 3000
  );
  assert.ok(estimateRequestTokens([], [{ function: { description: "x".repeat(10000) } }]) > 3000);
  assert.equal(compactBudget(262144).threshold, 196608);
  assert.equal(compactBudget(1048576).threshold, Math.floor(1048576 * 0.8));
  assert.equal(compactBudget(262144, 50000).threshold, 50000);
});

test("prefixes preserve complete parallel tool groups, include old summaries and retain the newest unit", () => {
  const summary = { ...message("summary", "system"), meta: { isSummary: true } };
  const call = { ...message("call", "assistant"), messageParams: { tool_calls: [{ id: "a" }, { id: "b" }] } };
  const results = ["a", "b"].map((id) => ({ ...message(id, "tool"), messageParams: { tool_call_id: id } }));
  const history = [message("system", "system"), summary, message("older"), call, ...results];
  assert.deepEqual(
    compactPrefixes(
      history,
      history.map(() => 10),
      0
    ).map((prefix) => prefix.map((m) => m.id)),
    [["summary", "older"], ["summary"]]
  );
  assert.deepEqual(compactPrefixes([message("huge")], [1000000], 0), []);
  assert.deepEqual(
    compactPrefixes([call, results[0], message("tail")], [10, 10, 10], 0).map((prefix) => prefix.map((m) => m.id)),
    [["call", "a"]]
  );
  assert.deepEqual(compactPrefixes([call, results[0]], [10, 10], 0), []);
  const tail = [...history, message("tail")];
  assert.equal(
    compactPrefixes(
      tail,
      tail.map(() => 10),
      0
    )[0].at(-1)?.id,
    "b"
  );
});

test("historical interrupted calls can compact, but unfinished trailing tool batches stay intact", () => {
  const call = {
    ...message("call", "assistant"),
    messageParams: { tool_calls: [{ id: "missing", type: "function", function: { name: "Bash", arguments: "{}" } }] },
  };
  const resumed = [call, message("resume", "user", "Continue"), message("work", "assistant"), message("tail")];
  const selected = compactPrefixes(resumed, [10, 10, 10, 10], 0)[0];
  assert.deepEqual(
    selected?.map((m) => m.id),
    ["call", "resume", "work"]
  );
  const replay = new OpenAIMessageConverter().buildMessages(selected, false, "test-model");
  assert.equal(replay[1].role, "tool");
  assert.match(String(replay[1].content), /Previous tool call did not complete/);
  assert.deepEqual(compactPrefixes([call], [10], 0), []);

  const parallel = { ...call, messageParams: { tool_calls: [{ id: "missing" }, { id: "done" }] } };
  const result = { ...message("result", "tool"), messageParams: { tool_call_id: "done" } };
  assert.deepEqual(compactPrefixes([parallel, result, message("system", "system")], [10, 10, 10], 0), []);
});

test("compaction follows the converter's preferred result when a real result replaces an interrupted placeholder", () => {
  const call = { ...message("call", "assistant"), messageParams: { tool_calls: [{ id: "a" }] } };
  const placeholder = {
    ...message("placeholder", "tool", JSON.stringify({ metadata: { interrupted: true } })),
    messageParams: { tool_call_id: "a" },
  };
  const result = { ...message("result", "tool", "real result"), messageParams: { tool_call_id: "a" } };
  const history = [call, placeholder, message("resume"), result, message("tail")];
  assert.deepEqual(compactPrefixes(history, [10, 10, 10, 10, 10], 30), []);
  const selected = compactPrefixes(history, [10, 10, 10, 10, 10], 0)[0];
  assert.deepEqual(
    selected.map((m) => m.id),
    ["call", "placeholder", "resume", "result"]
  );
  const replay = new OpenAIMessageConverter().buildMessages(selected, false, "test-model");
  assert.equal(replay.find((m) => m.role === "tool")?.content, "real result");
});

test("automatic compaction resumes after an interrupted parallel tool batch", async () => {
  const call = {
    ...message("interrupted", "assistant", "old work ".repeat(7000)),
    messageParams: {
      tool_calls: ["done", "missing"].map((id) => ({
        id,
        type: "function",
        function: { name: "Bash", arguments: "{}" },
      })),
    },
  };
  const result = { ...message("result", "tool", "finished result"), messageParams: { tool_call_id: "done" } };
  const f = fixture([call, result, message("resume", "user", "continue ".repeat(6000))]);
  f.settings.contextWindow = 100000;
  const context = await f.internal.prepareContext(f.read(), f.settings.model, true);
  f.settings.autoCompactWindow =
    f.internal.measureRequest("compact-test", context.messages, f.settings.model).tokens - 10000;
  await f.run();

  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].tool_choice, "none");
  const toolResults = f.requests[0].messages.filter((m: any) => m.role === "tool");
  assert.equal(toolResults.find((m: any) => m.tool_call_id === "done")?.content, "finished result");
  assert.match(
    toolResults.find((m: any) => m.tool_call_id === "missing")?.content,
    /Previous tool call did not complete/
  );
  assert.equal(f.read().find((m) => m.id === "interrupted")?.compacted, true);
  assert.equal(f.read().find((m) => m.id === "result")?.compacted, true);
  assert.equal(f.read().find((m) => m.id === "resume")?.compacted, false);
  assert.equal(
    f.requests[1].messages.some((m: any) => m.role === "tool"),
    false
  );
});

test("only explicit context and image capacity errors enable recovery", () => {
  assert.equal(isContextOverflow({ status: 400, error: { code: "context_length_exceeded" } }), true);
  assert.equal(isContextOverflow({ status: 400, message: "maximum context length is 10000 tokens" }), true);
  assert.equal(isContextOverflow({ status: 401, message: "maximum context length" }), false);
  assert.equal(imageOffloadCount({ code: "IMAGE_OFFLOAD_REQUIRED", offloadImages: 3 }), 3);
  assert.equal(imageOffloadCount({ status: 400, message: "Too many images" }), 1);
  assert.equal(imageOffloadCount({ status: 400, message: "Invalid image data" }), 0);
  assert.equal(imageOffloadCount({ status: 413, message: "Request body too large" }), 0);
});

test("compaction instruction and checkpoint framing match the DSH source text", () => {
  // Digest of COMPACTION_INSTRUCTION from the reference DSH summarizer.ts.
  assert.equal(
    createHash("sha256").update(getCompactPrompt()).digest("hex"),
    "3b7aa71f525b9a82afc2f1747c4434ceb7b3bc1fadf8b64c37c4e97db70d074b"
  );
  assert.match(
    frameCompactSummary("checkpoint"),
    /without acknowledging this checkpoint\.\n\n<compacted-summary>\ncheckpoint\n<\/compacted-summary>$/
  );
});

test("native replay preserves multimodal observations and consolidates legacy system summaries", async () => {
  const image = {
    ...message("image", "user", "Slide 3: the title overlaps the chart. " + "details ".repeat(1000)),
    contentParams: [{ type: "image_url", image_url: { url: "data:image/png;base64," + "A".repeat(100000) } }],
  };
  const legacy = { ...message("legacy", "system"), meta: { isSummary: true } };
  const catalog = { ...message("catalog", "system", "Available skills"), meta: { skillCatalog: [] } };
  const archived = { ...message("archived"), compacted: true };
  const f = fixture([
    archived,
    message("system", "system", "System instruction"),
    legacy,
    catalog,
    image,
    message("tail", "user", "continue"),
  ]);
  await f.compact();
  const request = f.requests[0];
  assert.equal(request.messages.at(-1).content, getCompactPrompt());
  assert.equal(request.tool_choice, "none");
  assert.equal(request.max_tokens, 32768);
  assert.ok(request.tools.length > 0);
  assert.ok(
    request.messages.some(
      (m: any) => m.role === "user" && typeof m.content === "string" && m.content.includes("<compacted-summary>")
    )
  );
  const replayedImage = request.messages.find((m: any) => Array.isArray(m.content));
  assert.match(replayedImage.content[0].text, /title overlaps/);
  assert.equal(replayedImage.content[1].type, "image_url");
  assert.ok(!request.messages.some((m: any) => typeof m.content === "string" && m.content.includes("AAAA")));
  const saved = f.read();
  assert.equal(saved.find((m) => m.id === "archived")?.content, archived.content);
  assert.equal(saved.find((m) => m.id === "legacy")?.compacted, true);
  assert.equal(saved.find((m) => m.id === "catalog")?.compacted, false);
  assert.equal(saved.filter((m) => m.meta?.isSummary && !m.compacted).length, 1);
  f.internal.appendSessionMessage("compact-test", message("next", "user", "Continue again"));
  // Make this second region large enough for an honest shrink comparison.
  f.internal.appendSessionMessage("compact-test", message("more"));
  f.internal.appendSessionMessage("compact-test", message("last", "user", "next"));
  await f.compact();
  assert.equal(f.read().filter((m) => m.meta?.isSummary && !m.compacted).length, 1);
  assert.match(JSON.stringify(f.requests[1].messages), /compacted-summary/);
});

test("undo lists original user prompts after compaction without exposing hidden messages or summaries", async () => {
  const f = fixture([
    message("system", "system", "System instruction"),
    message("first"),
    { ...message("hidden"), visible: false },
    message("reply", "assistant"),
    message("latest", "user", "continue"),
  ]);
  await f.compact();
  const saved = f.read();
  assert.equal(saved.find((m) => m.id === "first")?.compacted, true);
  // Even a visible summary must not become an undo target.
  f.internal.appendSessionMessage("compact-test", {
    ...message("visible-summary"),
    meta: { isSummary: true },
  });
  const targets = f.manager.listUndoTargets("compact-test");
  assert.deepEqual(
    targets.map((target) => target.message.id),
    ["first", "latest"]
  );
  assert.deepEqual(
    targets.map((target) => target.index),
    [saved.findIndex((m) => m.id === "first"), saved.findIndex((m) => m.id === "latest")]
  );
  assert.ok(targets.every((target) => !target.canRestoreCode));
});

for (const targetId of ["first", "second", "third"]) {
  test(`undo to ${targetId} after repeated compaction restores only preceding original messages`, async () => {
    const originals = [
      message("system", "system", "System instruction"),
      message("first", "user", "FIRST_PROMPT " + "history ".repeat(1000)),
      message("first-answer", "assistant", "FIRST_ANSWER " + "history ".repeat(1000)),
      message("second", "user", "SECOND_PROMPT " + "history ".repeat(1000)),
      message("second-answer", "assistant", "SECOND_ANSWER " + "history ".repeat(1000)),
      message("third", "user", "THIRD_PROMPT " + "history ".repeat(1000)),
    ];
    const f = fixture(originals, () => answer("SUMMARY_INCLUDING_LATER_CONTENT"));
    await f.compact();
    f.internal.appendSessionMessage("compact-test", message("third-answer", "assistant"));
    f.internal.appendSessionMessage("compact-test", message("fourth", "user", "FOURTH_PROMPT"));
    await f.compact();
    assert.equal(f.read().filter((m) => m.meta?.isSummary).length, 2);
    assert.equal(f.read().find((m) => m.id === targetId)?.compacted, true);
    await f.run();
    assert.equal(f.internal.requestUsageAnchors.has("compact-test"), true);

    const restored = f.manager.restoreSessionConversation("compact-test", targetId);
    const expected = originals.slice(
      0,
      originals.findIndex((m) => m.id === targetId)
    );
    assert.deepEqual(
      restored.map((m) => m.id),
      expected.map((m) => m.id)
    );
    assert.ok(restored.every((m) => !m.compacted && !m.meta?.isSummary));
    assert.deepEqual(f.read(), restored);
    assert.equal(f.internal.requestUsageAnchors.has("compact-test"), false);

    await f.run();
    const request = JSON.stringify(f.requests.at(-1).messages);
    for (const original of originals) {
      assert.equal(request.includes(original.content!), expected.includes(original));
    }
    assert.doesNotMatch(request, /SUMMARY_INCLUDING_LATER_CONTENT|FOURTH_PROMPT/);

    if (targetId === "third") {
      await f.compact();
      assert.equal(f.read().filter((m) => m.meta?.isSummary && !m.compacted).length, 1);
      const summaryInput = JSON.stringify(f.requests.at(-1).messages);
      assert.match(summaryInput, /FIRST_PROMPT/);
      assert.doesNotMatch(summaryInput, /THIRD_PROMPT|FOURTH_PROMPT|SUMMARY_INCLUDING_LATER_CONTENT/);
      await f.run();
    }
  });
}

test("undo to an uncompacted prompt preserves valid summaries and clears the usage anchor", async () => {
  const f = fixture([message("first"), message("reply", "assistant"), message("latest", "user", "continue")]);
  await f.compact();
  await f.run();
  const before = f.read();
  assert.ok(before.some((m) => m.meta?.isSummary && !m.compacted));
  const restored = f.manager.restoreSessionConversation("compact-test", "latest");
  assert.deepEqual(
    restored,
    before.slice(
      0,
      before.findIndex((m) => m.id === "latest")
    )
  );
  assert.equal(f.internal.requestUsageAnchors.has("compact-test"), false);
  await f.run();
  assert.match(JSON.stringify(f.requests.at(-1).messages), /compacted-summary/);
  assert.doesNotMatch(JSON.stringify(f.requests.at(-1).messages), /history history/);
});

test("undo reloads legacy and current summaries from disk and restores original history", async () => {
  const first = { ...message("first", "user", "Original first prompt"), compacted: true };
  const target = { ...message("target", "user", "Discard this prompt"), compacted: true };
  const f = fixture([
    message("system", "system", "System instruction"),
    { ...message("current-summary", "user", "Future information"), visible: false, meta: { isSummary: true } },
    first,
    { ...message("legacy-summary", "system", "Legacy information"), compacted: true, meta: { isSummary: true } },
    target,
    message("latest", "user", "Later input"),
  ]);
  const reloaded = new SessionManager({
    projectRoot: f.root,
    createOpenAIClient: () => ({ client: null, model: f.settings.model, thinkingEnabled: true }),
    getResolvedSettings: () => f.settings,
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
  assert.deepEqual(
    reloaded.listUndoTargets("compact-test").map((item) => item.message.id),
    ["first", "target", "latest"]
  );
  const restored = reloaded.restoreSessionConversation("compact-test", "target");
  assert.deepEqual(
    restored.map((m) => m.id),
    ["system", "first"]
  );
  assert.ok(restored.every((m) => !m.compacted));
  await f.run();
  const request = JSON.stringify(f.requests.at(-1).messages);
  assert.match(request, /Original first prompt/);
  assert.doesNotMatch(request, /Future information|Legacy information|Discard this prompt|Later input/);
});

test("invalid summaries and cancellation leave original history intact", async () => {
  const responses = [
    answer(""),
    answer("partial", "length"),
    answer("x".repeat(100000)),
    { choices: [{ message: { content: "refused", refusal: "no" }, finish_reason: "stop" }] },
    { choices: [{ message: { content: "tool", tool_calls: [{ id: "a" }] }, finish_reason: "tool_calls" }] },
  ];
  for (const response of responses) {
    const history = [message("old"), message("tail", "user", "continue")];
    const f = fixture(history, () => response);
    await assert.rejects(f.compact(), /complete text summary|did not reduce/);
    assert.deepEqual(f.read(), history);
    assert.equal(f.requests.length, 1);
  }
  const history = [message("old"), message("tail")];
  const controller = new AbortController();
  const f = fixture(history, () => {
    controller.abort();
    return answer();
  });
  await assert.rejects(f.compact(controller.signal));
  assert.deepEqual(f.read(), history);
});

test("streamed length finish is retained and rejects a truncated checkpoint", async () => {
  const f = fixture([message("old"), message("tail")], async function* () {
    yield { choices: [{ delta: { content: "partial checkpoint" }, finish_reason: "length" }] };
  });
  await assert.rejects(f.compact(), /complete text summary/);
  assert.ok(f.read().every((m) => !m.compacted));
});

test("summary overflow retries a smaller balanced prefix once", async () => {
  const history = Array.from({ length: 7 }, (_, index) => message(String(index)));
  const f = fixture(history, (_, call) => {
    if (call === 1) throw { status: 400, code: "context_length_exceeded" };
    return answer();
  });
  await f.compact();
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests[1].messages.length < f.requests[0].messages.length);
  const failing = fixture(history, () => {
    throw { status: 400, code: "context_length_exceeded" };
  });
  await assert.rejects(failing.compact());
  assert.equal(failing.requests.length, 2);
  assert.deepEqual(failing.read(), history);
});

test("over-budget summary input is reduced before sending and huge indivisible input fails closed", async () => {
  const f = fixture([message("a"), message("b", "user", "x".repeat(1000000)), message("tail")]);
  await f.compact();
  assert.equal(f.requests.length, 1);
  assert.ok(!JSON.stringify(f.requests[0].messages).includes("x".repeat(100)));
  const huge = fixture([message("huge", "user", "x".repeat(1000000)), message("tail")]);
  await assert.rejects(huge.compact(), /too large/);
  assert.equal(huge.requests.length, 0);
  assert.ok(huge.read().every((m) => !m.compacted));
});

test("image capacity recovery persists omission without deleting the original attachment", async () => {
  const image = {
    ...message("image"),
    contentParams: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }],
  };
  const f = fixture([image, message("tail")], (_, call) => {
    if (call === 1) throw { status: 400, code: "too_many_images" };
    throw { status: 401, message: "unauthorized" };
  });
  await assert.rejects(f.compact());
  assert.equal(f.requests.length, 2);
  assert.ok(JSON.stringify(f.requests[1].messages).includes("Image omitted:"));
  assert.ok(!JSON.stringify(f.requests[1].messages).includes("base64"));
  assert.deepEqual(f.read()[0].contentParams, image.contentParams);
  assert.deepEqual(f.read()[0].meta?.omittedImages, ["content:0"]);
  assert.ok(f.read().every((m) => !m.compacted));
  const replay = await f.internal.prepareContext(f.read(), f.settings.model, true);
  assert.match(JSON.stringify(replay.messages), /Image omitted:/);
});

test("omitted prompt images are not reloaded from disk", async () => {
  const f = fixture([]);
  const input = {
    ...message("prompt"),
    meta: {
      omittedImages: ["prompt:0"],
      userPrompt: { imageUrls: [pathToFileURL(path.join(f.root, "missing.png")).href] },
    },
  };
  const replay = await f.internal.prepareContext([input], f.settings.model, true);
  assert.match(JSON.stringify(replay.messages), /Image omitted:.*missing.png/);
});

test("normal request overflow forces one useful reduction, then retries without tool execution", async () => {
  const f = fixture([message("old"), message("tail", "user", "continue")], (_, call) => {
    if (call === 1) throw { status: 400, code: "context_length_exceeded" };
    return answer();
  });
  await f.run();
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests[1].messages.at(-1).content, getCompactPrompt());
  assert.ok(f.read().some((m) => m.compacted));
  const failing = fixture([message("old"), message("tail")], (request) => {
    if (request.tool_choice === "none") return answer();
    throw { status: 400, code: "context_length_exceeded" };
  });
  await assert.rejects(failing.run());
  assert.equal(failing.requests.length, 3);
});

test("fresh large input triggers compaction before the next normal request", async () => {
  const f = fixture([message("old", "user", "a".repeat(60000)), message("tail", "user", "b".repeat(50000))]);
  f.settings.contextWindow = 100000;
  const context = await f.internal.prepareContext(f.read(), f.settings.model, true);
  const measured = f.internal.measureRequest("compact-test", context.messages, f.settings.model);
  f.settings.autoCompactWindow = measured.tokens - 10000;
  await f.run();
  assert.equal(f.requests[0].tool_choice, "none");
  assert.equal(f.requests.length, 2);
});

test("usage anchors include new input and invalidate when history or model changes", async () => {
  const f = fixture([message("old")], () => ({ ...answer(), usage: { prompt_tokens: 100000 } }));
  await f.run();
  const context = await f.internal.prepareContext(f.read(), f.settings.model, true);
  const same = f.internal.measureRequest("compact-test", context.messages, f.settings.model);
  assert.equal(same.tokens, 100000);
  const added = [...context.messages, { role: "user", content: "x".repeat(10000) }];
  assert.ok(f.internal.measureRequest("compact-test", added, f.settings.model).tokens > 103000);
  const changed = f.internal.measureRequest("compact-test", added, "different-model");
  assert.equal(changed.tokens, changed.estimate);
  const rewritten = f.internal.measureRequest("compact-test", [{ role: "user", content: "changed" }], f.settings.model);
  assert.equal(rewritten.tokens, rewritten.estimate);
});

test("concurrent compaction and changed histories cannot commit a stale summary", async () => {
  let release!: (value: unknown) => void;
  const f = fixture(
    [message("old"), message("tail")],
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const pending = f.compact();
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(f.compact(), /already being compacted/);
  f.internal.appendSessionMessage("compact-test", message("new"));
  release(answer());
  await assert.rejects(pending, /changed during compaction/);
  assert.ok(f.read().every((m) => !m.compacted));
  assert.equal(f.read().at(-1)?.id, "new");
});

test("fixed context and an indivisible retained tail cannot cause repeated summary calls", async () => {
  const fixed = fixture([message("system", "system", "x".repeat(1000000)), message("only")]);
  await assert.rejects(fixed.run(), /too large/);
  assert.equal(fixed.requests.length, 0);
  assert.ok(fixed.read().every((m) => !m.compacted));

  const tail = fixture([message("old"), message("tail", "user", "x".repeat(1000000))]);
  await assert.rejects(tail.run(), /too large|did not reduce/);
  assert.ok(tail.requests.length <= 2);
  assert.ok(tail.requests.every((request) => request.tool_choice === "none"));
  assert.equal(tail.read().find((m) => m.id === "tail")?.compacted, false);
});

test("new parallel tool results are measured before requesting another assistant step", async () => {
  const call = {
    ...message("call", "assistant", ""),
    messageParams: {
      tool_calls: [
        { id: "a", type: "function", function: { name: "Read", arguments: "{}" } },
        { id: "b", type: "function", function: { name: "Read", arguments: "{}" } },
      ],
    },
  };
  const results = ["a", "b"].map((id) => ({
    ...message(id, "tool", "x".repeat(30000)),
    messageParams: { tool_call_id: id },
  }));
  const f = fixture([message("old", "user", "y".repeat(60000)), call, ...results]);
  f.settings.contextWindow = 100000;
  const context = await f.internal.prepareContext(f.read(), f.settings.model, true);
  f.settings.autoCompactWindow =
    f.internal.measureRequest("compact-test", context.messages, f.settings.model).tokens - 10000;
  await f.run();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].tool_choice, "none");
  const normal = f.requests[1].messages;
  assert.equal(normal.filter((m: any) => m.role === "tool").length, 2);
  assert.equal(normal.find((m: any) => m.role === "assistant").tool_calls.length, 2);
});

test("image recovery terminates when no retained image remains", async () => {
  const image = {
    ...message("image"),
    contentParams: [0, 1].map((index) => ({
      type: "image_url",
      image_url: { url: `https://example.com/${index}.png` },
    })),
  };
  const f = fixture([image, message("tail")], () => {
    throw { status: 400, code: "too_many_images" };
  });
  await assert.rejects(f.run());
  assert.equal(f.requests.length, 3);
  assert.deepEqual(f.read()[0].meta?.omittedImages, ["content:0", "content:1"]);
  assert.ok(f.read().every((m) => !m.compacted));
});

test("non-capacity errors do not compact or omit images", async () => {
  const image = {
    ...message("image"),
    contentParams: [{ type: "image_url", image_url: { url: "https://example.com/image.png" } }],
  };
  const history = [image, message("tail")];
  const f = fixture(history, () => {
    throw { status: 401, message: "Unauthorized" };
  });
  await assert.rejects(f.run());
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.read(), history);
});

test("summary requests share Files API upload and expired-reference recovery", async () => {
  const image = {
    ...message("image"),
    contentParams: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }],
  };
  const f = fixture([image, message("tail")], (_, call) => {
    if (call === 1) throw Object.assign(new Error("file id expired"), { status: 400 });
    return answer();
  });
  const originalClient = f.internal.createOpenAIClient;
  f.internal.createOpenAIClient = () => ({ ...originalClient(), apiKey: "test-key" });
  Object.assign(f.settings, { filesApiEnabled: true });
  let uploads = 0;
  let invalidations = 0;
  f.internal.deepSeekFiles = {
    ensureUploaded: async () => ({ fileId: `file-${++uploads}`, imageHash: "a".repeat(64), bytes: 3 }),
    invalidate: () => {
      invalidations++;
    },
  };
  await f.compact();
  assert.equal(uploads, 2);
  assert.equal(invalidations, 1);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].messages.at(-1).content, getCompactPrompt());
  assert.match(JSON.stringify(f.requests[1].messages), /file-2/);
  assert.doesNotMatch(JSON.stringify(f.requests[1].messages), /base64/);
});

test("retention budgets use the input window and reject budgets at the effective threshold", () => {
  assert.equal(compactBudget(1048576, 184320).retain, 157286);
  assert.equal(compactBudget(100000, 50000, { retainRatio: 0.2 }).retain, 17500);
  assert.equal(compactBudget(100000, 50000, { retainTokens: 1234 }).retain, 1234);
  assert.equal(compactBudget(100000, 50000, { retainTokens: 0 }).retain, 0);
  for (const retainTokens of [50000, 50001])
    assert.throws(() => compactBudget(100000, 50000, { retainTokens }), /must be less/);
  assert.throws(() => compactBudget(100000, 10000), /must be less/);
  assert.throws(() => compactBudget(100000, 100000, { retainTokens: 75000 }), /must be less/);
});

test("actual usage calibrates image-heavy history downward while new images and text still count", async () => {
  const images = Array.from({ length: 26 }, (_, i) => ({
    type: "image_url",
    image_url: { url: `data:image/png;base64,${i}` },
  }));
  const f = fixture([{ ...message("images"), contentParams: images }], () => ({
    ...answer(),
    usage: { prompt_tokens: 70106 },
  }));
  await f.run();
  const context = await f.internal.prepareContext(f.read(), f.settings.model, true);
  const measured = f.internal.measureRequest("compact-test", context.messages, f.settings.model);
  assert.ok(measured.estimate > 100000);
  assert.equal(measured.tokens, 70106);
  const added = { ...message("new", "user", "new observations ".repeat(1000)), contentParams: images.slice(0, 1) };
  f.internal.saveSessionMessages("compact-test", [...f.read(), added]);
  const next = await f.internal.prepareContext(f.read(), f.settings.model, true);
  const nextMeasurement = f.internal.measureRequest("compact-test", next.messages, f.settings.model);
  assert.equal(nextMeasurement.tokens, 70106 + nextMeasurement.estimate - measured.estimate);
  assert.ok(nextMeasurement.tokens > 70106 + 4096);
  f.settings.autoCompactWindow = 100000;
  await f.run();
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every((request) => request.tool_choice !== "none"));
});

test("missing or invalid actual usage falls back to estimates, while zero is valid", async () => {
  for (const prompt_tokens of [undefined, NaN, Infinity, -1, "4000", 0]) {
    const f = fixture([message("old")], () => ({ ...answer(), usage: { prompt_tokens } }));
    await f.run();
    const context = await f.internal.prepareContext(f.read(), f.settings.model, true);
    const measured = f.internal.measureRequest("compact-test", context.messages, f.settings.model);
    assert.equal(measured.tokens, prompt_tokens === 0 ? 0 : measured.estimate);
  }
});

test("automatic compaction honors the configured tail budget", async () => {
  const retained: number[] = [];
  for (const retainTokens of [7000, 20000]) {
    const history = Array.from({ length: 10 }, (_, i) => message(`history-${i}`, "user", "x".repeat(20000)));
    const f = fixture(history);
    f.settings.contextWindow = 100000;
    f.settings.autoCompactWindow = 50000;
    f.settings.retainTokens = retainTokens;
    await f.run();
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[0].tool_choice, "none");
    retained.push(f.read().filter((m) => !m.compacted && !m.meta?.isSummary).length);
  }
  assert.deepEqual(retained, [2, 4]);
});

function imageMessage(id: string, bytes: number): SessionMessage {
  return {
    ...message(id, "user", id),
    contentParams: [{ type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(bytes)}` } }],
  };
}

function setByteBudget(f: ReturnType<typeof fixture>, bytes: number, retainTokens = 0) {
  // Exercise the real formula with small payloads instead of allocating 48 MiB per test.
  f.settings.contextWindow = (MAX_REQUEST_BODY_BYTES - bytes) / 2;
  f.settings.retainTokens = retainTokens;
}

test("message byte estimates include UTF-8, JSON escaping and image data", () => {
  const messages = [{ role: "user" as const, content: '中文\n"' }];
  assert.equal(estimateRequestBytes(messages), new TextEncoder().encode(JSON.stringify(messages)).length);
  assert.ok(estimateRequestBytes(messages) > JSON.stringify(messages).length);
  const image = new OpenAIMessageConverter().buildMessages([imageMessage("image", 10000)], true, "test-vision");
  assert.ok(estimateRequestBytes(image) > 10000);
  assert.equal(compactBudget(1024 * 1024).byteThreshold, 46 * 1024 * 1024);
  for (const window of [24 * 1024 * 1024, 25 * 1024 * 1024]) {
    assert.throws(() => compactBudget(window), /request size budget/);
  }
});

for (const delta of [-1, 0, 1]) {
  test(`automatic compaction checks the byte threshold with a ${delta}-byte difference`, async () => {
    const history = [imageMessage("old", 20000), message("tail", "user", "continue ".repeat(1000))];
    const f = fixture(history);
    const context = await f.internal.prepareContext(f.read(), f.settings.model, true);
    const bytes = estimateRequestBytes(context.messages);
    setByteBudget(f, bytes - delta);
    assert.ok(f.internal.measureRequest("compact-test", context.messages, f.settings.model).tokens < 190000);
    await f.run();
    assert.equal(f.requests.length, delta > 0 ? 2 : 1);
    assert.equal(f.requests[0].tool_choice === "none", delta > 0);
    assert.ok(f.requests.every((request) => estimateRequestBytes(request.messages) <= bytes - delta));
    assert.equal(f.read().find((item) => item.id === "tail")?.compacted, false);
  });
}

test("oversized summary candidates shrink to the longest prefix within the byte budget", async () => {
  const f = fixture([
    ...["first", "second", "third", "fourth"].map((id) => imageMessage(id, 11000)),
    message("tail", "user", "continue"),
  ]);
  setByteBudget(f, 30000);
  await f.run();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].tool_choice, "none");
  assert.equal(f.requests[0].messages.at(-1).content, getCompactPrompt());
  assert.deepEqual(
    f
      .read()
      .filter((item) => item.compacted)
      .map((item) => item.id),
    ["first", "second"]
  );
  assert.ok(f.requests.every((request) => estimateRequestBytes(request.messages) <= 30000));
});

for (const retainTokens of [12000, 100000]) {
  test(`byte compaction falls back to no extra retention after a ${retainTokens}-token retention pass`, async () => {
    const f = fixture([
      message("old", "user", "x".repeat(7000)),
      ...["first", "second", "third"].map((id) => imageMessage(id, 15000)),
      message("tail", "user", "continue"),
    ]);
    setByteBudget(f, 40000, retainTokens);
    await f.run();
    assert.equal(f.requests.length, retainTokens === 12000 ? 3 : 2);
    assert.ok(f.requests.slice(0, -1).every((request) => request.tool_choice === "none"));
    assert.notEqual(f.requests.at(-1).tool_choice, "none");
    assert.ok(f.requests.every((request) => estimateRequestBytes(request.messages) <= 40000));
    assert.equal(f.read().find((item) => item.id === "tail")?.compacted, false);
  });
}

test("byte compaction accepts a smaller payload even when its summary uses more tokens", async () => {
  const f = fixture(
    [
      ...["first", "second", "third"].map((id) => ({
        ...message(id, "user", id),
        contentParams: [
          { type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(11000)}`, detail: "low" } },
        ],
      })),
      message("tail", "user", "continue"),
    ],
    () => answer("x".repeat(10000))
  );
  setByteBudget(f, 30000);
  // Compacting two images saves bytes, although the text summary costs more tokens.
  const before = await f.internal.prepareContext(f.read(), f.settings.model, true);
  assert.equal(await f.compact(), true);
  assert.equal(f.read().filter((item) => item.compacted).length, 2);
  const after = await f.internal.prepareContext(f.read(), f.settings.model, true);
  assert.ok(estimateRequestTokens(after.messages) > estimateRequestTokens(before.messages));
  assert.ok(estimateRequestBytes(after.messages) < estimateRequestBytes(before.messages));
});

test("unshrinkable byte-heavy input terminates without sending an oversized request", async () => {
  for (const kind of ["fixed", "latest", "prefix", "many"] as const) {
    const huge = imageMessage("huge", 31000);
    const history =
      kind === "fixed"
        ? [{ ...huge, role: "system" as const }, message("old"), message("tail")]
        : kind === "latest"
          ? [message("old"), huge]
          : kind === "prefix"
            ? [huge, message("tail")]
            : [...Array.from({ length: 10 }, (_, i) => imageMessage(`image-${i}`, 11000)), message("tail")];
    const f = fixture(history);
    setByteBudget(f, 30000);
    await assert.rejects(f.run(), /too large|did not reduce/);
    assert.ok(f.requests.length <= 2);
    assert.ok(
      f.requests.every((request) => request.tool_choice === "none" && estimateRequestBytes(request.messages) <= 30000)
    );
    assert.equal(f.read().at(-1)?.compacted, false);
    assert.ok(f.read().every((item) => !item.meta?.omittedImages));
    if (kind === "fixed" || kind === "prefix") assert.deepEqual(f.read(), history);
  }
});

test("new tool results trigger byte compaction before the next assistant step", async () => {
  const call = {
    ...message("call", "assistant", ""),
    messageParams: { tool_calls: [{ id: "read", type: "function", function: { name: "Read", arguments: "{}" } }] },
  };
  const result = { ...message("result", "tool", "x".repeat(15000)), messageParams: { tool_call_id: "read" } };
  const f = fixture([imageMessage("old", 20000), call, result]);
  setByteBudget(f, 30000);
  await f.run();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].tool_choice, "none");
  assert.equal(f.requests[1].messages.filter((item: any) => item.role === "tool").length, 1);
  assert.equal(f.requests[1].messages.find((item: any) => item.role === "assistant").tool_calls.length, 1);
  assert.ok(f.requests.every((request) => estimateRequestBytes(request.messages) <= 30000));
});

test("context-overflow recovery rechecks bytes when the summary grows the payload", async () => {
  const f = fixture([message("old", "user", "x".repeat(10000)), imageMessage("tail", 18000)], (_, call) => {
    if (call === 1) throw { status: 400, code: "context_length_exceeded" };
    return answer("中".repeat(4500));
  });
  setByteBudget(f, 30000);
  await assert.rejects(f.run(), /too large|did not reduce/);
  assert.equal(f.requests[0].tool_choice, undefined);
  assert.ok(f.read().some((item) => item.meta?.isSummary));
  assert.ok(f.requests.slice(1).every((request) => request.tool_choice === "none"));
  assert.ok(f.requests.every((request) => estimateRequestBytes(request.messages) <= 30000));
});

test("Files API conservatively checks bytes before uploads and sends references after compaction", async () => {
  const f = fixture([
    ...["first", "second", "third"].map((id) => imageMessage(id, 11000)),
    message("tail", "user", "continue"),
  ]);
  setByteBudget(f, 30000);
  const originalClient = f.internal.createOpenAIClient;
  f.internal.createOpenAIClient = () => ({ ...originalClient(), apiKey: "test-key" });
  Object.assign(f.settings, { filesApiEnabled: true });
  f.internal.deepSeekFiles = {
    ensureUploaded: async () => ({ fileId: "file-image", imageHash: "a".repeat(64), bytes: 8250 }),
  };
  await f.run();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].tool_choice, "none");
  for (const request of f.requests) {
    assert.match(JSON.stringify(request.messages), /file-image/);
    assert.doesNotMatch(JSON.stringify(request.messages), /base64/);
  }
});
