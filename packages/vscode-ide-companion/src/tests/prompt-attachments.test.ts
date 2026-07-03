import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

type EventHandler = (event: any) => unknown;

class FakeClassList {
  private readonly classes = new Set<string>();

  constructor(className = "") {
    for (const classPart of className.split(/\s+/)) {
      if (classPart) {
        this.classes.add(classPart);
      }
    }
  }

  add(className: string): void {
    this.classes.add(className);
  }

  remove(className: string): void {
    this.classes.delete(className);
  }

  contains(className: string): boolean {
    return this.classes.has(className);
  }

  toggle(className: string, force?: boolean): boolean {
    const shouldAdd = force ?? !this.classes.has(className);
    if (shouldAdd) {
      this.classes.add(className);
    } else {
      this.classes.delete(className);
    }
    return shouldAdd;
  }
}

class FakeElement {
  readonly tagName: string;
  className = "";
  classList = new FakeClassList();
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  textContent = "";
  tabIndex = 0;
  draggable = false;
  href = "";
  src = "";
  alt = "";
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, EventHandler[]>();

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  set innerHTML(_value: string) {
    for (const child of this.children) {
      child.parent = null;
    }
    this.children = [];
  }

  get innerHTML(): string {
    return "";
  }

  addEventListener(type: string, handler: EventHandler): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(handler);
    this.listeners.set(type, listeners);
  }

  async dispatchEvent(event: any): Promise<void> {
    event.type ??= "";
    for (const handler of this.listeners.get(event.type) ?? []) {
      await handler(event);
    }
  }

  contains(candidate: FakeElement | null): boolean {
    if (!candidate) {
      return false;
    }
    if (candidate === this) {
      return true;
    }
    return this.children.some((child) => child.contains(candidate));
  }

  querySelector(selector: string): FakeElement | null {
    if (!selector.startsWith(".")) {
      return null;
    }
    const className = selector.slice(1);
    for (const child of this.children) {
      if (child.className.split(/\s+/).includes(className)) {
        return child;
      }
      const match = child.querySelector(selector);
      if (match) {
        return match;
      }
    }
    return null;
  }

  getBoundingClientRect(): { left: number; top: number; bottom: number; width: number; height: number } {
    return { left: 20, top: 80, bottom: 100, width: 160, height: 40 };
  }
}

class FakeDocument {
  readonly body = new FakeElement("body");

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }
}

class FakeFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: Error | null = null;

  readAsDataURL(file: { dataUrl?: string }): void {
    this.result = file.dataUrl ?? "";
    this.onload?.();
  }
}

function loadAttachmentManager(): {
  manager: { clear: () => void; hasAttachments: () => boolean; getImageUrls: () => string[] };
  promptInput: FakeElement;
  toolsLine: FakeElement;
} {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const scriptPath = path.resolve(__dirname, "../../resources/prompt-attachments.js");
  const script = fs.readFileSync(scriptPath, "utf8");

  const document = new FakeDocument();
  const window = {
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener: () => {},
    createPromptAttachmentManager: undefined as
      | undefined
      | ((options: Record<string, unknown>) => {
          clear: () => void;
          hasAttachments: () => boolean;
          getImageUrls: () => string[];
        }),
  };

  vm.runInNewContext(script, { console, document, window, FileReader: FakeFileReader });

  const createPromptAttachmentManager = window.createPromptAttachmentManager;
  if (typeof createPromptAttachmentManager !== "function") {
    throw new Error("Prompt attachment manager was not registered.");
  }
  const promptInput = new FakeElement("textarea");
  const inputWrap = new FakeElement("div");
  const toolsLine = new FakeElement("div");
  const manager = createPromptAttachmentManager({ promptInput, inputWrap, toolsLine });

  return { manager, promptInput, toolsLine };
}

async function pasteImage(promptInput: FakeElement, dataUrl: string): Promise<void> {
  let defaultPrevented = false;
  await promptInput.dispatchEvent({
    type: "paste",
    clipboardData: {
      items: [
        {
          kind: "file",
          getAsFile: () => ({ type: "image/png", name: "image.png", dataUrl }),
        },
      ],
    },
    preventDefault: () => {
      defaultPrevented = true;
    },
  });
  assert.equal(defaultPrevented, true);
}

test("prompt attachment manager appends pasted images instead of replacing the previous image", async () => {
  const { manager, promptInput, toolsLine } = loadAttachmentManager();

  await pasteImage(promptInput, "data:image/png;base64,first");
  await pasteImage(promptInput, "data:image/png;base64,second");

  assert.equal(manager.hasAttachments(), true);
  assert.deepEqual(Array.from(manager.getImageUrls()), ["data:image/png;base64,first", "data:image/png;base64,second"]);
  assert.equal(toolsLine.children.length, 2);
  assert.equal(toolsLine.classList.contains("has-attachment"), true);
});

test("prompt attachment manager removes one pasted image without clearing the rest", async () => {
  const { manager, promptInput, toolsLine } = loadAttachmentManager();

  await pasteImage(promptInput, "data:image/png;base64,first");
  await pasteImage(promptInput, "data:image/png;base64,second");

  const firstAttachment = toolsLine.children[0];
  const removeButton = firstAttachment.children[0];
  await removeButton.dispatchEvent({
    type: "click",
    preventDefault: () => {},
    stopPropagation: () => {},
  });

  assert.deepEqual(Array.from(manager.getImageUrls()), ["data:image/png;base64,second"]);
  assert.equal(toolsLine.children.length, 1);

  manager.clear();
  assert.equal(manager.hasAttachments(), false);
  assert.deepEqual(Array.from(manager.getImageUrls()), []);
  assert.equal(toolsLine.children.length, 0);
});
