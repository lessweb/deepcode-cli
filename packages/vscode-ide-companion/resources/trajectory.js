/* global acquireVsCodeApi */
(function () {
  const SHOW_EDIT_BUTTON = false;
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const state = {
    sessionId: undefined,
    records: [],
    collapsed: new Set(),
    collapseAll: false,
    selected: null,
    tab: "Content",
    limit: 100,
    query: "",
    imagePreviews: {},
    detailKey: "",
    drafts: new Map(),
    running: false,
    pending: null,
    error: "",
    fullscreen: false,
  };
  let currentCopyText = "";
  let snapshotKey = "";
  let rowElements = new Map();
  let nextRequestId = 0;
  let copyFeedbackTimer;
  let copyContext = "";
  let fullscreenScroll = null;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function time(value, full = false) {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return "—";
    return full ? date.toLocaleString() : date.toLocaleTimeString([], { hour12: false });
  }

  function preview(record) {
    const text =
      record.content ||
      record.thinking ||
      record.parameters ||
      record.result ||
      (record.images.length ? "Image" : "No content");
    return text.replace(/\s+/g, " ").slice(0, 240);
  }

  function matches(record) {
    return (
      !state.query ||
      [record.label, record.content, record.thinking, record.parameters, record.result].some((value) =>
        value?.toLocaleLowerCase().includes(state.query)
      )
    );
  }

  function select(id, locate = false) {
    if (state.selected !== id) resetEditor();
    state.selected = id;
    const index = state.records.findIndex((record) => record.id === id);
    if (index < 0) return;
    if (locate) {
      state.query = "";
      $("search").value = "";
      state.limit = Math.max(state.limit, state.records.length - index);
      state.collapsed.delete(state.records[index].turnId);
    }
    renderLedger();
    renderTimeline();
    renderDetails();
    if (locate) {
      rowElements.get(id)?.scrollIntoView({ block: "center" });
      rowElements.get(id)?.focus({ preventScroll: true });
    }
  }

  function renderLedger() {
    const ledger = $("ledger");
    const oldTop = ledger.scrollTop;
    const focusedId = document.activeElement?.dataset.recordId;
    const filtered = state.records.filter(matches);
    const visible = filtered.slice(-state.limit);
    $("loadEarlier").hidden = filtered.length <= state.limit;
    $("empty").hidden = visible.length > 0;
    $("empty").textContent = state.query ? "No matching events." : "No trajectory yet.";
    const groups = new Map();
    const turns = new Map();
    for (const record of state.records) {
      if (record.turnId !== "context" && !turns.has(record.turnId)) turns.set(record.turnId, turns.size + 1);
    }
    for (const record of visible) {
      if (!groups.has(record.turnId)) groups.set(record.turnId, []);
      groups.get(record.turnId).push(record);
    }
    rowElements = new Map();
    const fragment = document.createDocumentFragment();
    for (const [id, records] of groups) {
      const section = element("section", "turn");
      const collapsed = state.collapsed.has(id);
      const heading = element("button", "turn-heading");
      heading.setAttribute("aria-expanded", String(!collapsed));
      heading.append(element("span", "", collapsed ? "▸" : "▾"));
      heading.append(element("span", "turn-label", id === "context" ? "Context" : `Turn ${turns.get(id)}`));
      heading.append(element("span", "turn-summary", preview(records[0])));
      heading.append(element("span", "", String(records.length)));
      heading.addEventListener("click", () => {
        if (state.collapsed.has(id)) state.collapsed.delete(id);
        else state.collapsed.add(id);
        renderLedger();
        // The heading is replaced with the ledger, so restore keyboard focus.
        [...$("events").querySelectorAll(".turn-heading")][[...groups.keys()].indexOf(id)]?.focus({
          preventScroll: true,
        });
      });
      section.append(heading);
      if (!collapsed)
        for (const record of records) {
          const row = element("button", "event");
          row.dataset.recordId = record.id;
          row.setAttribute("aria-pressed", String(state.selected === record.id));
          const timestamp = element("time", "", time(record.time));
          timestamp.title = time(record.time, true);
          row.append(
            timestamp,
            element("span", `label ${record.kind}`, record.kind === "tool" ? `${record.label} tool` : record.label),
            element("span", "preview", preview(record))
          );
          row.title = [record.label, record.status, record.compacted ? "Compacted" : "", preview(record)]
            .filter(Boolean)
            .join(" · ");
          row.addEventListener("click", () => select(record.id));
          rowElements.set(record.id, row);
          section.append(row);
        }
      fragment.append(section);
    }
    $("events").replaceChildren(fragment);
    ledger.scrollTop = oldTop;
    if (focusedId) rowElements.get(focusedId)?.focus({ preventScroll: true });
  }

  function renderTimeline() {
    const records = state.records.filter(matches);
    const timed = $("actualTime").checked;
    const times = records.map((record) => Date.parse(record.time)).filter(Number.isFinite);
    const start = times.length ? Math.min(...times) : 0;
    const end = times.length ? Math.max(...times) : 0;
    $("timeline").classList.toggle("timed", timed && times.length > 0);
    $("timeRange").textContent = times.length
      ? `${time(new Date(start).toISOString())} – ${time(new Date(end).toISOString())}`
      : "";
    $("eventCount").textContent = `${records.length} ${records.length === 1 ? "event" : "events"}`;
    // Bound overview DOM size; each bucket still navigates to its event range.
    const stride = Math.max(1, Math.ceil(records.length / 300));
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < records.length; index += stride) {
      const bucket = records.slice(index, index + stride);
      const record = bucket.find((item) => item.id === state.selected) || bucket[0];
      const button = element("button", record.kind);
      button.title = `${time(record.time)} · ${record.label} · ${preview(record)}${bucket.length > 1 ? ` · ${bucket.length} events` : ""}`;
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", String(bucket.some((item) => item.id === state.selected)));
      if (timed && times.length) {
        const timestamp = Date.parse(record.time);
        if (!Number.isFinite(timestamp)) continue;
        button.style.left = `calc(${end === start ? 0 : ((timestamp - start) / (end - start)) * 100}% - ${end === start ? 0 : ((timestamp - start) / (end - start)) * 5}px)`;
      }
      button.addEventListener("click", () => select(record.id, true));
      fragment.append(button);
    }
    $("timeline").replaceChildren(fragment);
  }

  function renderDetails() {
    const record = state.records.find((item) => item.id === state.selected);
    $("details").hidden = !record;
    if (!record) {
      state.detailKey = "";
      return;
    }
    const key = JSON.stringify([
      record,
      state.tab,
      state.imagePreviews,
      [...state.drafts.keys()],
      state.running,
      state.pending,
      state.error,
    ]);
    if (key === state.detailKey) return;
    state.detailKey = key;
    $("detailTitle").textContent = record.label;
    $("detailMeta").textContent = [time(record.time, true), record.status, record.compacted ? "Compacted" : ""]
      .filter(Boolean)
      .join(" · ");
    const tabs = [];
    if (record.kind === "assistant" || record.content || record.images.length) tabs.push(["Content", record.content]);
    if (record.thinking || state.drafts.has("Thinking")) tabs.push(["Thinking", record.thinking]);
    if (record.parameters !== undefined) tabs.push(["Parameters", record.parameters]);
    if (record.kind === "tool") tabs.push(["Result", record.result ?? ""]);
    tabs.push(["Raw", record.raw]);
    if (!tabs.some(([label]) => label === state.tab)) state.tab = tabs[0][0];
    const nextCopyContext = JSON.stringify([state.sessionId, record.id, state.tab]);
    if (copyContext !== nextCopyContext) {
      resetCopyFeedback();
      copyContext = nextCopyContext;
    }
    const fragment = document.createDocumentFragment();
    for (const [label] of tabs) {
      const button = element("button", "", label);
      button.id = `tab-${label}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(label === state.tab));
      button.setAttribute("aria-controls", "detailBody");
      button.tabIndex = label === state.tab ? 0 : -1;
      button.addEventListener("click", () => {
        state.tab = label;
        renderDetails();
        $(`tab-${label}`).focus();
      });
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = tabs.findIndex(([name]) => name === label);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        state.tab = tabs[next][0];
        renderDetails();
        $(`tab-${state.tab}`).focus();
      });
      fragment.append(button);
    }
    $("tabs").replaceChildren(fragment);
    const body = $("detailBody");
    body.setAttribute("aria-labelledby", `tab-${state.tab}`);
    body.classList.toggle("wrap", $("wrap").checked);
    currentCopyText = tabs.find(([label]) => label === state.tab)[1];
    body.replaceChildren();
    const editing = state.drafts.has(state.tab);
    body.classList.toggle("editing", editing);
    $("details").classList.toggle("editing", editing);
    $("edit").hidden = !SHOW_EDIT_BUTTON || !record.editable || editing;
    $("edit").disabled = state.running || Boolean(state.pending);
    $("delete").disabled = state.running || Boolean(state.pending);
    $("save").disabled = state.running || Boolean(state.pending);
    $("cancel").disabled = Boolean(state.pending);
    $("editActions").hidden = !editing;
    $("editError").hidden = !state.error;
    $("editError").textContent = state.error;
    if (editing) {
      const input = element("textarea");
      input.id = "detailEditor";
      input.setAttribute("aria-label", `Edit ${state.tab}`);
      input.wrap = $("wrap").checked ? "soft" : "off";
      input.value = state.drafts.get(state.tab);
      input.readOnly = Boolean(state.pending);
      input.addEventListener("input", () => state.drafts.set(state.tab, input.value));
      body.append(input);
      return;
    }
    if (state.tab === "Content") {
      const markdown = element("div", "markdown");
      // Only extension-rendered Markdown (HTML disabled) enters this container.
      markdown.innerHTML = record.html || "";
      if (!record.content) markdown.textContent = "(empty)";
      body.append(markdown);
      for (const url of record.images) {
        const resolved =
          state.imagePreviews[url] || (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(url) ? url : null);
        if (!resolved) continue;
        const img = element("img");
        img.src = resolved;
        img.alt = "Attached image";
        body.append(img);
      }
    } else
      body.append(
        element(
          "pre",
          "",
          currentCopyText || (state.tab === "Result" && record.result === undefined ? "No result recorded." : "(empty)")
        )
      );
  }

  $("search").addEventListener("input", () => {
    state.query = $("search").value.trim().toLocaleLowerCase();
    state.limit = 100;
    state.collapsed.clear();
    state.collapseAll = false;
    renderLedger();
    renderTimeline();
  });
  $("expand").addEventListener("click", () => {
    state.collapsed.clear();
    state.collapseAll = false;
    renderLedger();
  });
  $("collapse").addEventListener("click", () => {
    state.collapsed = new Set(state.records.map((record) => record.turnId));
    state.collapseAll = true;
    renderLedger();
  });
  $("actualTime").addEventListener("change", renderTimeline);
  $("loadEarlier").addEventListener("click", () => {
    const ledger = $("ledger");
    const before = ledger.scrollHeight;
    const top = ledger.scrollTop;
    state.limit += 100;
    renderLedger();
    ledger.scrollTop = top + ledger.scrollHeight - before;
  });
  function closeDetails() {
    const previous = state.selected;
    state.selected = null;
    resetEditor();
    renderLedger();
    renderTimeline();
    renderDetails();
    (rowElements.get(previous) || $("ledger")).focus({ preventScroll: true });
  }
  function setFullscreen(enabled) {
    if (state.fullscreen === enabled) return;
    const positions = [$("detailBody"), $("detailEditor")].filter(Boolean).map((node) => ({
      node,
      top: node.scrollTop,
      left: node.scrollLeft,
    }));
    if (enabled) fullscreenScroll = { ledgerTop: $("ledger").scrollTop, positions };
    state.fullscreen = enabled;
    document.body.classList.toggle("details-fullscreen", enabled);
    const label = enabled ? "Exit full screen" : "Full screen";
    $("fullscreen").setAttribute("aria-label", label);
    $("fullscreen").setAttribute("aria-pressed", String(enabled));
    $("fullscreen").dataset.tooltip = label;
    $("fullscreenIcon").setAttribute(
      "d",
      enabled ? "M3 8h5V3M16 3v5h5M21 16h-5v5M8 21v-5H3" : "M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"
    );
    for (const position of positions) {
      const previous = fullscreenScroll?.positions.find((item) => item.node === position.node);
      // Restore offsets clamped by the larger viewport unless the user has scrolled since.
      position.node.scrollTop = !enabled && previous?.clampedTop === position.top ? previous.top : position.top;
      position.node.scrollLeft = !enabled && previous?.clampedLeft === position.left ? previous.left : position.left;
      if (enabled) {
        position.clampedTop = position.node.scrollTop;
        position.clampedLeft = position.node.scrollLeft;
      }
    }
    if (!enabled && fullscreenScroll) {
      $("ledger").scrollTop = fullscreenScroll.ledgerTop;
      fullscreenScroll = null;
    }
  }
  $("fullscreen").addEventListener("click", () => setFullscreen(!state.fullscreen));
  $("closeDetails").addEventListener("click", closeDetails);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.selected) return;
    event.preventDefault();
    if (state.fullscreen) setFullscreen(false);
    else closeDetails();
  });
  $("wrap").addEventListener("change", () => {
    $("detailBody").classList.toggle("wrap", $("wrap").checked);
    if ($("detailEditor")) $("detailEditor").wrap = $("wrap").checked ? "soft" : "off";
  });
  function resetCopyFeedback() {
    window.clearTimeout(copyFeedbackTimer);
    $("copy").dataset.tooltip = "Copy";
    $("copy").setAttribute("aria-label", "Copy");
    $("copy").removeAttribute("data-feedback");
    $("copyIcon").removeAttribute("hidden");
    $("copyDone").setAttribute("hidden", "");
  }
  $("copy").addEventListener("click", () => {
    resetCopyFeedback();
    vscode.postMessage({
      type: "trajectoryCopy",
      text: state.drafts.get(state.tab) ?? currentCopyText,
      context: copyContext,
    });
  });
  function resetEditor() {
    resetCopyFeedback();
    copyContext = "";
    setFullscreen(false);
    state.drafts.clear();
    state.pending = null;
    state.error = "";
    state.detailKey = "";
  }
  function mutate(type) {
    if (state.running || state.pending) return;
    state.error = "";
    state.pending = { requestId: ++nextRequestId, type, tab: state.tab };
    vscode.postMessage({
      ...state.pending,
      sessionId: state.sessionId,
      recordId: state.selected,
      text: type === "trajectoryEdit" ? state.drafts.get(state.tab) : undefined,
    });
    renderDetails();
  }
  $("edit").addEventListener("click", () => {
    state.drafts.set(state.tab, currentCopyText);
    state.error = "";
    renderDetails();
    $("detailEditor").focus();
  });
  $("save").addEventListener("click", () => mutate("trajectoryEdit"));
  $("cancel").addEventListener("click", () => {
    state.drafts.delete(state.tab);
    state.error = "";
    renderDetails();
    $("edit").focus();
  });
  $("delete").addEventListener("click", () => mutate("trajectoryDelete"));
  $("detailBody").addEventListener("click", (event) => {
    const anchor = event.target.closest("a");
    if (anchor) {
      event.preventDefault();
      vscode.postMessage({ type: "openExternal", url: anchor.href });
    }
  });
  window.addEventListener("message", ({ data }) => {
    if (data?.type === "trajectoryCopyResult") {
      if (!state.selected || data.context !== copyContext) return;
      resetCopyFeedback();
      const label = data.success ? "Copied" : "Copy failed";
      $("copy").dataset.tooltip = label;
      $("copy").setAttribute("aria-label", label);
      $("copy").setAttribute("data-feedback", "");
      $("copyIcon").toggleAttribute("hidden", data.success);
      $("copyDone").toggleAttribute("hidden", !data.success);
      copyFeedbackTimer = window.setTimeout(resetCopyFeedback, 1800);
      return;
    }
    if (data?.type === "trajectoryMutationResult") {
      if (
        data.sessionId !== state.sessionId ||
        data.recordId !== state.selected ||
        data.requestId !== state.pending?.requestId
      )
        return;
      const pending = state.pending;
      state.pending = null;
      state.error = data.error || "";
      if (!data.error) {
        if (pending.type === "trajectoryDelete") {
          closeDetails();
          return;
        }
        state.drafts.delete(pending.tab);
        if (data.nextRecordId && data.nextRecordId !== state.selected) {
          const selected = state.records.find((record) => record.id === state.selected);
          if (selected) selected.id = data.nextRecordId;
          state.selected = data.nextRecordId;
        }
      }
      renderDetails();
      return;
    }
    if (data?.type === "trajectoryProgress") {
      if (data.sessionId !== state.sessionId) return;
      updateProgress(data.progress);
      return;
    }
    if (data?.type !== "trajectorySnapshot" || !Array.isArray(data.records)) return;
    const ledger = $("ledger");
    const follow = ledger.scrollHeight - ledger.scrollTop - ledger.clientHeight < 40;
    const changed = state.sessionId !== data.sessionId;
    const oldTurns = new Set(state.records.map((record) => record.turnId));
    if (changed) {
      resetEditor();
      state.sessionId = data.sessionId;
      state.selected = null;
      state.tab = "Content";
      state.collapsed.clear();
      state.collapseAll = false;
      state.limit = 100;
      state.query = "";
      $("search").value = "";
      state.detailKey = "";
      snapshotKey = "";
    } else {
      // Keep the oldest visible record in place when new events arrive.
      const previousIds = new Set(state.records.map((record) => record.id));
      state.limit += data.records.filter((record) => !previousIds.has(record.id) && matches(record)).length;
    }
    const key = JSON.stringify(data.records);
    state.records = data.records;
    state.running = Boolean(data.running);
    if (state.selected && !state.records.some((record) => record.id === state.selected)) {
      state.selected = null;
      resetEditor();
    }
    if (state.collapseAll)
      for (const record of state.records) if (!oldTurns.has(record.turnId)) state.collapsed.add(record.turnId);
    state.imagePreviews = data.imagePreviews || {};
    $("sessionTitle").textContent = data.title;
    $("sessionStatus").textContent = (data.status || "").replaceAll("_", " ");
    $("usage").textContent = Number.isFinite(data.usage?.total_tokens)
      ? `${data.usage.total_tokens.toLocaleString()} tokens`
      : "";
    if (snapshotKey !== key) {
      renderLedger();
      renderTimeline();
      snapshotKey = key;
    }
    renderDetails();
    updateProgress(data.progress);
    if (changed || follow) ledger.scrollTop = ledger.scrollHeight;
  });
  function updateProgress(value) {
    const ledger = $("ledger");
    const follow = ledger.scrollHeight - ledger.scrollTop - ledger.clientHeight < 40;
    const progress = value?.sessionId && value.sessionId !== state.sessionId ? null : value;
    $("progress").hidden = !progress;
    $("progress").textContent = progress ? `Generating…${progress.previewText ? `\n${progress.previewText}` : ""}` : "";
    if (follow) ledger.scrollTop = ledger.scrollHeight;
  }
  vscode.postMessage({ type: "trajectoryReady" });
})();
