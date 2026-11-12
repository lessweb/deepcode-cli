import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { test, type TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";
import { stripTerminalControls } from "./terminal-output";
import React from "react";
import { Box, render } from "ink";
import stringWidth from "string-width";
import type { SessionMessage } from "@vegamo/deepcode-core";
import { buildProcessOutputItems, wrapProcessOutputLines, type ProcessOutputItem } from "../ui/core/process-output";
import { ProcessStdoutView } from "../ui/views/ProcessStdoutView";
import { PromptInput } from "../ui/views/PromptInput";
import { StatusLine } from "../ui/components/status-line";

function toolMessage(id: string, command: string, output: string, exitCode: number): SessionMessage {
  return {
    id,
    sessionId: "session",
    role: "tool",
    visible: exitCode === 0,
    compacted: false,
    createTime: "2026-01-01T00:00:00Z",
    updateTime: "2026-01-01T00:00:00Z",
    contentParams: null,
    messageParams: { tool_call_id: id },
    meta: { function: { name: "bash", arguments: JSON.stringify({ command }) } },
    content: JSON.stringify({ output, metadata: { exitCode } }),
  };
}

test("history retains repeated commands and failed outputs, and merges a running background call", () => {
  const first = toolMessage("first", "npm test", "passed", 0);
  const failed = toolMessage("second", "npm test", "failed", 1);
  const background = toolMessage("background", "npm start", "started", 0);
  const items = buildProcessOutputItems(
    [first, failed, background],
    new Map([
      [
        "123",
        {
          command: "npm start",
          startTime: first.createTime,
          toolCallId: "background",
          runInBackground: true,
        },
      ],
    ])
  );
  assert.deepEqual(
    items.map((item) => [item.id, item.output, item.exitCode, item.running]),
    [
      ["first", "passed", 0, false],
      ["second", "failed", 1, false],
      ["background", "", null, true],
    ]
  );
  assert.equal(items[2]?.background, true);
  assert.deepEqual(buildProcessOutputItems([{ ...first, content: "invalid json" }], null), []);
});

test("output tabs align to eight columns with wide characters and ANSI colors", () => {
  assert.deepEqual(wrapProcessOutputLines("ab\t中文\t👩‍💻\tend\n\tlast\n", 120), [
    "ab      中文    👩‍💻      end",
    "        last",
    "",
  ]);
  assert.deepEqual(wrapProcessOutputLines("\u001b[31m中文\u001b[0m\tend", 120), ["\u001b[31m中文\u001b[0m    end"]);
});

test("wrapped output preserves Unicode, blank lines, indentation and ANSI styles", () => {
  const text = "中文👩‍💻".repeat(8);
  const lines = wrapProcessOutputLines(`\u001b[31m${text}\u001b[0m\n\n  end`, 12);
  assert.equal(lines.slice(0, -2).map(stripTerminalControls).join(""), text);
  assert.deepEqual(lines.slice(-2), ["", "  end"]);
  assert.ok(lines.every((line) => stringWidth(line) <= 12));
  assert.ok(lines[1].startsWith("\u001b[31m"));
});

async function terminal(t: TestContext, element: React.ReactElement) {
  let frame = "";
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        const text = stripTerminalControls(chunk.toString());
        if (text.trim()) frame = text;
        done();
      },
    }),
    { isTTY: true, columns: 120, rows: 24 }
  );
  const app = render(element, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  t.after(() => {
    app.unmount();
    app.cleanup();
  });
  async function flush() {
    await setTimeout(30);
    await app.waitUntilRenderFlush();
  }
  await flush();
  return {
    frame: () => frame,
    async send(input: string) {
      stdin.emit("data", input);
      await flush();
    },
    async rerender(next: React.ReactElement) {
      app.rerender(next);
      await flush();
    },
  };
}

test("panel retains the selected result, navigates history and targets timeout adjustments", async (t) => {
  const old = buildProcessOutputItems([toolMessage("old", "old command", "old output", 2)], null)[0]!;
  const running: ProcessOutputItem = {
    id: "live",
    command: "npm test",
    pid: "123",
    background: false,
    running: true,
    output: "",
    exitCode: null,
    timeoutMs: 60000,
  };
  const adjustments: string[] = [];
  let dismissed = 0;
  const props = {
    processStdoutRef: { current: new Map([[123, Array.from({ length: 40 }, (_, i) => `\tline ${i}`).join("\n")]]) },
    onDismiss: () => {
      dismissed++;
    },
    onAdjustTimeout: (_delta: number, pid: string) => {
      adjustments.push(pid);
      return null;
    },
    screenWidth: 120,
    screenHeight: 15,
  };
  const view = (items: ProcessOutputItem[]) => React.createElement(ProcessStdoutView, { ...props, items });
  const h = await terminal(t, view([old, running]));
  assert.match(h.frame(), /── Process 123 \[npm test\] ──/);
  assert.match(h.frame(), /line 39/);
  assert.doesNotMatch(h.frame(), /\t/);
  await h.send("+");
  assert.deepEqual(adjustments, ["123"]);
  await h.send("\u001b[A");
  assert.doesNotMatch(h.frame(), /line 39/);
  await h.send("\u001b[D");
  assert.match(h.frame(), /── \(return 2\) \[old command\] ──/);
  await h.send("+");
  assert.deepEqual(adjustments, ["123"]);
  await h.send("\u001b[D");
  assert.match(h.frame(), /old output/);
  await h.send("\u001b[C");
  assert.match(h.frame(), /line 39/);

  const completed = { ...running, running: false, output: "finished", exitCode: 0 };
  const next = { ...running, id: "next", pid: "456", command: "next command", background: true };
  await h.rerender(view([old, completed, next]));
  assert.match(h.frame(), /── \(return 0\) \[npm test\] ──/);
  assert.match(h.frame(), /finished/);
  await h.send("\u001b[C");
  assert.match(h.frame(), /── Process 456 \(background\) \[next command\] ──/);
  await h.send("+");
  assert.deepEqual(adjustments, ["123"]);
  await h.send("\u000f");
  assert.equal(dismissed, 1);
});

test("panel wraps the complete command and keeps output scrollable within its height", async (t) => {
  const command = `python3 -c "print('/System/Library/AssetsV2/${"路径👩‍💻".repeat(25)}/command-end')"`;
  const output = Array.from({ length: 40 }, (_, i) => `output-${i}`).join("\n");
  const items = buildProcessOutputItems([toolMessage("long", command, output, 0)], null);
  const h = await terminal(
    t,
    React.createElement(ProcessStdoutView, {
      processStdoutRef: { current: new Map() },
      items,
      onDismiss() {},
      onAdjustTimeout: () => null,
      screenWidth: 48,
      screenHeight: 15,
    })
  );
  const assertFullCommand = () => assert.ok(h.frame().replace(/\s/g, "").includes(command.replace(/\s/g, "")));
  assertFullCommand();
  assert.match(h.frame(), /output-39/);
  assert.ok(h.frame().trimEnd().split("\n").length <= 14);

  for (let i = 0; i < 10 && !/output-0\b/.test(h.frame()); i++) await h.send("\u001b[A");
  assertFullCommand();
  assert.match(h.frame(), /output-0\b/);
  assert.doesNotMatch(h.frame(), /output-39/);
  for (let i = 0; i < 10 && !h.frame().includes("output-39"); i++) await h.send("\u001b[B");
  assert.match(h.frame(), /output-39/);
});

test("commands taller than the panel can be paged through completely and reflow on resize", async (t) => {
  const commandLines = ["python3 <<'PY'", ...Array.from({ length: 18 }, (_, i) => `print('command-${i}')`), "", "PY"];
  const items = buildProcessOutputItems([toolMessage("multiline", commandLines.join("\n"), "finished", 0)], null);
  const view = (screenWidth: number, screenHeight: number) =>
    React.createElement(ProcessStdoutView, {
      processStdoutRef: { current: new Map<number, string>() },
      items,
      onDismiss() {},
      onAdjustTimeout: () => null,
      screenWidth,
      screenHeight,
    });
  const h = await terminal(t, view(48, 12));
  assert.match(h.frame(), /finished/);
  const frames = [h.frame()];
  for (let i = 0; i < 3 && !h.frame().includes("[python3"); i++) {
    await h.send("\u001b[5~");
    frames.push(h.frame());
    assert.ok(h.frame().trimEnd().split("\n").length <= 11);
  }
  assert.match(h.frame(), /── \(return 0\) \[python3/);
  for (const line of commandLines) assert.ok(frames.some((frame) => frame.includes(line)));

  await h.rerender(view(80, 30));
  const frame = h.frame();
  for (const line of commandLines) assert.ok(frame.includes(line));
  assert.match(frame, /finished/);
});

for (const running of [false, true]) {
  test(`long JSON output is fully visible and reflows on resize (running=${running})`, async (t) => {
    const output = JSON.stringify({
      success: true,
      result: {
        credits: 90,
        image_url: `https://example.invalid/images/${"0123456789abcdef".repeat(6)}.png`,
        path: "/tmp/generated-image.png",
      },
    });
    const item = buildProcessOutputItems([toolMessage("json", "generate image", output, 0)], null)[0]!;
    const items = [{ ...item, running, pid: "123" }];
    const processStdoutRef = { current: new Map([[123, output]]) };
    const view = (screenWidth: number) =>
      React.createElement(ProcessStdoutView, {
        processStdoutRef,
        items,
        onDismiss() {},
        onAdjustTimeout: () => null,
        screenWidth,
        screenHeight: 18,
      });
    const h = await terminal(t, view(48));
    const assertFullOutput = (width: number) => {
      assert.ok(h.frame().replace(/\s/g, "").includes(output));
      assert.ok(
        h
          .frame()
          .split("\n")
          .every((line) => stringWidth(line) <= width)
      );
      assert.ok(h.frame().trimEnd().split("\n").length <= 17);
    };
    assertFullOutput(48);
    await h.rerender(view(32));
    assertFullOutput(32);
  });
}

test("a single output line longer than the panel can be paged through without losing text", async (t) => {
  const parts = Array.from({ length: 24 }, (_, i) => `segment-${i.toString().padStart(2, "0")};`.padEnd(38, "x"));
  const items = buildProcessOutputItems([toolMessage("wide", "emit", parts.join(""), 0)], null);
  const processStdoutRef = { current: new Map<number, string>() };
  const view = (screenWidth: number) =>
    React.createElement(ProcessStdoutView, {
      processStdoutRef,
      items,
      onDismiss() {},
      onAdjustTimeout: () => null,
      screenWidth,
      screenHeight: 12,
    });
  const h = await terminal(t, view(40));
  assert.match(h.frame(), /segment-23;/);
  const frames = [h.frame()];
  for (let i = 0; i < 4 && !h.frame().includes("segment-00;"); i++) {
    await h.send("\u001b[5~");
    frames.push(h.frame());
  }
  assert.match(h.frame(), /segment-00;/);
  for (const part of parts) assert.ok(frames.some((frame) => frame.includes(part)));
  for (let i = 0; i < 4 && !h.frame().includes("segment-23;"); i++) await h.send("\u001b[6~");
  assert.match(h.frame(), /segment-23;/);

  await h.rerender(view(78));
  assert.match(h.frame(), /12 total lines/);
  assert.match(h.frame(), /segment-23;/);
});

test("scrolling tab-indented output keeps terminal rows aligned with the rendered frame", async (t) => {
  const command = 'fc-scan "/System/Library/Fonts/STHeiti Medium.ttc" 2>/dev/null | head -30 || true';
  const output = Array.from({ length: 30 }, (_, i) => `\tproperty-${i}: value`);
  output[0] = "Pattern has 27 elts (size 32)";
  output[3] =
    '\tstyle: "Medium"(s) "中黑"(s) "Halbfett"(s) "Normaali"(s) "Moyen"(s) "Medio"(s) "ミディアム"(s) "중간체"(s) "Médio"(s) "Средний"(s) "Normal"(s) "中等"(s) "Media"(s)';
  output[4] =
    '\tstylelang: "en"(s) "zh-tw"(s) "de"(s) "fi"(s) "fr"(s) "it"(s) "ja"(s) "ko"(s) "pt"(s) "ru"(s) "sv"(s) "zh-cn"(s) "es"(s)';
  const messages = [
    toolMessage("tabs", command, `${output.join("\n")}\n`, 0),
    toolMessage("next", "echo done", "done", 0),
  ];
  const items = buildProcessOutputItems(messages, null);
  const h = await terminal(
    t,
    React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(StatusLine, { busy: false, text: "status: completed", width: 120 }),
      React.createElement(ProcessStdoutView, {
        processStdoutRef: { current: new Map() },
        items,
        onDismiss() {},
        onAdjustTimeout: () => null,
        screenWidth: 120,
        screenHeight: 24,
      })
    )
  );
  await h.send("\u001b[D");
  const assertPhysicalRows = () => {
    const lines = h.frame().split("\n");
    for (const line of lines) {
      const columns = line
        .split("\t")
        .reduce((column, part, i) => column + (i ? 8 - (column % 8) : 0) + stringWidth(part), 0);
      assert.ok(columns <= 120, `Rendered line takes ${columns} terminal columns: ${line}`);
    }
    assert.equal(lines.length, 24);
    assert.doesNotMatch(h.frame(), /\t/);
  };
  for (let cycle = 0; cycle < 3; cycle++) {
    await h.send("\u001b[5~");
    assert.match(h.frame(), /Pattern has 27 elts/);
    assertPhysicalRows();
    await h.send("\u001b[6~");
    assert.match(h.frame(), /property-29: value/);
    assertPhysicalRows();
  }
  assert.equal(items[0]?.output, `${output.join("\n")}\n`);
});

test("Ctrl+O opens output for an empty prompt and expands pasted text in a nonempty prompt", async (t) => {
  let opened = 0;
  const h = await terminal(
    t,
    React.createElement(PromptInput, {
      projectRoot: process.cwd(),
      skills: [],
      reasoningSummary: "off" as const,
      onReasoningSummaryChange: () => "",
      modelConfig: { model: "test", thinkingEnabled: false, reasoningEffort: "high" },
      screenWidth: 120,
      promptHistory: [],
      busy: false,
      planMode: false,
      onSubmit() {},
      onPromptDraftApplied() {},
      onModelConfigChange: () => "",
      onPermissionSettingsChange: () => "",
      onPlanModeChange() {},
      onInterrupt() {},
      onToggleProcessStdout: () => {
        opened++;
      },
    })
  );
  await h.send("\u000f");
  assert.equal(opened, 1);
  await h.send(" ");
  await h.send("\u000f");
  assert.equal(opened, 1);
  await h.send("\u007f");
  await h.send("\u001b[200~" + Array.from({ length: 20 }, (_, i) => `pasted line ${i}`).join("\n") + "\u001b[201~");
  assert.match(h.frame(), /\[paste #1 \+20 lines\]/);
  await h.send("\u000f");
  assert.equal(opened, 1);
  assert.match(h.frame(), /pasted line 0/);
  assert.doesNotMatch(h.frame(), /\[paste #1/);
  await h.send("\u000f");
  assert.match(h.frame(), /\[paste #1 \+20 lines\]/);
});
