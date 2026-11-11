/* global acquireVsCodeApi */
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const state = {
    sessionId: undefined,
    records: [],
    collapsed: new Set(),
    collapseAll: false,
    selected: null,
    tab: "Preview",
    limit: 100,
    query: "",
    imagePreviews: {},
    detailKey: "",
  };
  let currentCopyText = "";
  let snapshotKey = "";
  let rowElements = new Map();

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
            element("span", `label ${record.kind}`, record.label),
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
    const key = JSON.stringify([record, state.tab, state.imagePreviews]);
    if (key === state.detailKey) return;
    state.detailKey = key;
    $("detailTitle").textContent = record.label;
    $("detailMeta").textContent = [time(record.time, true), record.status, record.compacted ? "Compacted" : ""]
      .filter(Boolean)
      .join(" · ");
    const tabs = [];
    if (record.content || record.images.length) tabs.push(["Preview", record.content]);
    if (record.thinking) tabs.push(["Thinking", record.thinking]);
    if (record.parameters !== undefined) tabs.push(["Parameters", record.parameters || "No parameters"]);
    if (record.kind === "tool")
      tabs.push(["Result", record.result === undefined ? "No result recorded." : record.result]);
    tabs.push(["Raw", record.raw]);
    if (!tabs.some(([label]) => label === state.tab)) state.tab = tabs[0][0];
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
    if (state.tab === "Preview") {
      const markdown = element("div", "markdown");
      // Only extension-rendered Markdown (HTML disabled) enters this container.
      markdown.innerHTML = record.html || "";
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
    } else body.append(element("pre", "", currentCopyText));
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
    renderLedger();
    renderTimeline();
    renderDetails();
    (rowElements.get(previous) || $("ledger")).focus({ preventScroll: true });
  }
  $("closeDetails").addEventListener("click", closeDetails);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.selected) closeDetails();
  });
  $("wrap").addEventListener("change", () => $("detailBody").classList.toggle("wrap", $("wrap").checked));
  $("copy").addEventListener("click", () => vscode.postMessage({ type: "trajectoryCopy", text: currentCopyText }));
  $("detailBody").addEventListener("click", (event) => {
    const anchor = event.target.closest("a");
    if (anchor) {
      event.preventDefault();
      vscode.postMessage({ type: "openExternal", url: anchor.href });
    }
  });
  window.addEventListener("message", ({ data }) => {
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
      state.sessionId = data.sessionId;
      state.selected = null;
      state.tab = "Preview";
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
