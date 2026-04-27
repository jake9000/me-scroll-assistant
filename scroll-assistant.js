(() => {
  const PATCH_KEY = "__marinaraScrollAssistantPatch";
  const STORAGE_KEY = "marinara.scrollAssistant.options";
  const ROOT_ID = "mari-scroll-assistant-root";
  const STYLE_ID = "mari-scroll-assistant-style";
  const PANEL_ATTR = "data-scroll-assistant-options";
  const PANEL_GM_NOTE_ATTR = "data-sa-gm-note";
  const PANEL_TRACE_ACTIONS_ATTR = "data-sa-trace-actions";
  const PANEL_SIDE_ATTR = "data-sa-side";
  const PANEL_MULTI_INSTANCE_ATTR = "data-sa-multi-instance";
  const AUTOSCROLL_INTEROP_KEY = "__marinaraAutoscrollInterop";
  const SCROLL_GUARD_ID = "scroll-assistant";
  const INSTANCE_TRACKER_KEY = "__marinaraScrollAssistantInstances";
  const LONG_PRESS_MS = 420;
  const DOUBLE_TAP_MS = 280;
  const PAGE_STEP_RATIO = 0.9;
  const DEFAULT_SCROLL_STEP_PERCENT = 90;
  const BOTTOM_FAR_PX = 180;
  const BOTTOM_RESUME_PX = 8;
  const MESSAGE_JUMP_OFFSET_PX = 16;
  const MESSAGE_TOP_STOP_PX = 8;
  const TRACE_BUFFER_LIMIT = 2000;
  const DEFAULT_OPTIONS = {
    side: "right",
    autoscrollMode: "partial",
    upTap: "message-up",
    upDoubleTap: "none",
    upLongTap: "top",
    downTap: "message-down",
    downDoubleTap: "none",
    downLongTap: "bottom",
    upScrollPercent: DEFAULT_SCROLL_STEP_PERCENT,
    downScrollPercent: DEFAULT_SCROLL_STEP_PERCENT,
    debugTrace: false,
    buttonsLocked: true,
    buttonOffsetX: null,
    buttonOffsetY: null,
  };
  const ACTION_LABELS = {
    "page-up": "Scroll up",
    "page-down": "Scroll down",
    "message-up": "Previous message",
    "message-down": "Next message",
    top: "Top of page",
    bottom: "Bottom of page",
    none: "No action",
  };
  const TAP_BINDINGS = [
    { key: "upTap", label: "Up: Tap" },
    { key: "upDoubleTap", label: "Up: Double tap" },
    { key: "upLongTap", label: "Up: Long tap" },
    { key: "downTap", label: "Down: Tap" },
    { key: "downDoubleTap", label: "Down: Double tap" },
    { key: "downLongTap", label: "Down: Long tap" },
  ];
  const ACTION_KEYS = Object.keys(ACTION_LABELS);
  const autoscrollInterop = getAutoscrollInterop();
  let _viewportResizeTimer = null;
  const state = {
    options: loadOptions(),
    root: null,
    upButton: null,
    downButton: null,
    activeScroller: null,
    detachScrollerScroll: null,
    bodyObserver: null,
    scrollerObserver: null,
    intervalId: null,
    mountedPanel: null,
    toggleButton: null,
    toggleOpen: false,
    autoscroll: {
      following: true,
      suppressUserScrollUntil: 0,
      targetMessage: null,
      partialStopped: false,
      lastScrollTop: 0,
      upwardScrollStreak: 0,
    },
    trace: { enabled: false, startedAt: nowMs(), events: [], sequence: 0 },
    dragRef: null,
  };
  const instanceToken = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  if (window[PATCH_KEY] && typeof window[PATCH_KEY].restore === "function") {
    markDuplicateInstanceAttempt();
    return;
  }
  registerInstance(instanceToken);
  state.trace.enabled = !!state.options.debugTrace;
  installNativeAutoscrollHook();
  ensureStyle();
  createButtons();
  applySideOption();
  mountOptionsPanel();
  bindObservers();
  rescan();
  const restore = () => {
    unregisterInstance(instanceToken);
    if (state.detachScrollerScroll) {
      state.detachScrollerScroll();
      state.detachScrollerScroll = null;
    }
    if (state.bodyObserver) {
      state.bodyObserver.disconnect();
      state.bodyObserver = null;
    }
    if (state.scrollerObserver) {
      state.scrollerObserver.disconnect();
      state.scrollerObserver = null;
    }
    if (state.intervalId) {
      window.clearInterval(state.intervalId);
      state.intervalId = null;
    }
    if (_viewportResizeTimer) {
      clearTimeout(_viewportResizeTimer);
      _viewportResizeTimer = null;
    }
    autoscrollInterop.removeScrollGuard(SCROLL_GUARD_ID);
    autoscrollInterop.clearSourceState(SCROLL_GUARD_ID);
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("orientationchange", onViewportChange);
    if (state.mountedPanel && state.mountedPanel.isConnected) {
      state.mountedPanel.remove();
      state.mountedPanel = null;
    }
    if (state.root && state.root.isConnected) {
      state.root.remove();
      state.root = null;
    }
    const styleTag = document.getElementById(STYLE_ID);
    if (styleTag) styleTag.remove();
    delete window[PATCH_KEY];
  };
  window[PATCH_KEY] = { restore };
  if (
    typeof marinara !== "undefined" &&
    marinara &&
    typeof marinara.onCleanup === "function"
  ) {
    marinara.onCleanup(restore);
  }
  function getInstanceTracker() {
    const existing = window[INSTANCE_TRACKER_KEY];
    if (existing && typeof existing === "object") {
      if (!Array.isArray(existing.active)) existing.active = [];
      if (!Number.isFinite(existing.duplicateAttempts))
        existing.duplicateAttempts = 0;
      return existing;
    }
    const created = { active: [], duplicateAttempts: 0 };
    window[INSTANCE_TRACKER_KEY] = created;
    return created;
  }
  function registerInstance(token) {
    const tracker = getInstanceTracker();
    if (typeof token !== "string" || !token) return;
    if (!tracker.active.includes(token)) {
      tracker.active.push(token);
    }
  }
  function unregisterInstance(token) {
    const tracker = getInstanceTracker();
    tracker.active = tracker.active.filter((entry) => entry !== token);
    if (tracker.active.length <= 1) {
      tracker.duplicateAttempts = 0;
    }
  }
  function markDuplicateInstanceAttempt() {
    const tracker = getInstanceTracker();
    tracker.duplicateAttempts += 1;
  }
  function hasMultipleInstancesLoaded() {
    const tracker = getInstanceTracker();
    return tracker.active.length > 1 || tracker.duplicateAttempts > 0;
  }
  function installNativeAutoscrollHook() {
    autoscrollInterop.addScrollGuard(
      SCROLL_GUARD_ID,
      shouldSuppressNativeAutoscroll,
    );
  }
  function shouldSuppressNativeAutoscroll(target) {
    if (!(target instanceof HTMLElement)) return false;
    if (state.options.autoscrollMode !== "partial") return false;
    if (isGameModeActive()) return false;
    if (!isRoleplayAutoscrollActive()) return false;
    const scroller = state.activeScroller;
    if (!(scroller instanceof HTMLElement)) return false;
    if (!scroller.contains(target)) return false;
    if (!isLikelyBottomSentinel(target, scroller)) return false;
    traceEvent("native-guard", {
      suppressed: true,
      target: describeNode(target),
      reason: "partial-roleplay-mode",
    });
    return true;
  }
  function syncSharedAutoscrollState() {
    const disabled = isSharedAutoscrollDisabled();
    autoscrollInterop.updateSourceState(SCROLL_GUARD_ID, {
      disabled,
      reason: disabled ? "scroll-assistant" : null,
    });
  }
  function isSharedAutoscrollDisabled() {
    if (state.options.autoscrollMode === "disabled") return true;
    if (state.options.autoscrollMode !== "partial") return false;
    if (isGameModeActive()) return false;
    if (!isRoleplayAutoscrollActive()) return false;
    return state.autoscroll.partialStopped || !state.autoscroll.following;
  }
  function nowMs() {
    if (
      typeof performance !== "undefined" &&
      typeof performance.now === "function"
    ) {
      return performance.now();
    }
    return Date.now();
  }
  function describeNode(node) {
    if (!(node instanceof HTMLElement)) return null;
    const parts = [];
    const dataMessageId =
      node.getAttribute("data-message-id") || node.dataset.messageId;
    if (dataMessageId) parts.push(`id=${dataMessageId}`);
    if (node.id) parts.push(`#${node.id}`);
    if (node.classList && node.classList.length) {
      const cls = Array.from(node.classList).slice(0, 3).join(".");
      if (cls) parts.push(`.${cls}`);
    }
    return { tag: node.tagName.toLowerCase(), desc: parts.join(" ") };
  }
  function getScrollerMetrics(scroller) {
    if (!(scroller instanceof HTMLElement)) return null;
    return {
      scrollTop: Math.round(scroller.scrollTop),
      scrollHeight: Math.round(scroller.scrollHeight),
      clientHeight: Math.round(scroller.clientHeight),
      distanceFromBottom: Math.round(distanceFromBottom(scroller)),
    };
  }
  function traceEvent(event, detail) {
    if (!state.trace.enabled) return;
    const scroller = state.activeScroller;
    const entry = {
      seq: ++state.trace.sequence,
      t: Math.round(nowMs() - state.trace.startedAt),
      event,
      mode: state.options.autoscrollMode,
      following: !!state.autoscroll.following,
      partialStopped: !!state.autoscroll.partialStopped,
      ...getScrollerMetrics(scroller),
      ...(detail || {}),
    };
    state.trace.events.push(entry);
    if (state.trace.events.length > TRACE_BUFFER_LIMIT) {
      state.trace.events.splice(
        0,
        state.trace.events.length - TRACE_BUFFER_LIMIT,
      );
    }
  }
  function setTraceEnabled(enabled) {
    state.trace.enabled = !!enabled;
    state.options.debugTrace = !!enabled;
    persistOptions();
    if (state.trace.enabled) {
      state.trace.startedAt = nowMs();
      state.trace.sequence = 0;
      state.trace.events = [];
      traceEvent("trace-enabled", { note: "Scroll trace started" });
    }
  }
  function clearTrace() {
    state.trace.events = [];
    state.trace.sequence = 0;
    state.trace.startedAt = nowMs();
    if (state.trace.enabled) {
      traceEvent("trace-cleared");
    }
  }
  function exportTrace() {
    if (!state.trace.events.length) {
      window.alert("Scroll trace is empty.");
      return;
    }
    const lines = state.trace.events.map((entry) => JSON.stringify(entry));
    const text = lines.join("\n");
    const fileName = `scroll-trace-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  function getAutoscrollInterop() {
    if (window[AUTOSCROLL_INTEROP_KEY]) {
      return window[AUTOSCROLL_INTEROP_KEY];
    }
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollGuards = new Map();
    const sourceStates = new Map();
    const subscribers = new Set();
    function getSnapshot() {
      const sources = {};
      let disabled = false;
      for (const [key, value] of sourceStates.entries()) {
        sources[key] = value;
        if (value && value.disabled) {
          disabled = true;
        }
      }
      return { disabled, sources };
    }
    function emitStateChange() {
      const snapshot = getSnapshot();
      for (const subscriber of subscribers) {
        try {
          subscriber(snapshot);
        } catch {}
      }
    }
    function patchedScrollIntoView(arg) {
      for (const guard of scrollGuards.values()) {
        try {
          if (guard(this)) {
            return;
          }
        } catch {}
      }
      return originalScrollIntoView.call(this, arg);
    }
    const interop = {
      addScrollGuard(id, guard) {
        scrollGuards.set(id, guard);
        if (Element.prototype.scrollIntoView !== patchedScrollIntoView) {
          Element.prototype.scrollIntoView = patchedScrollIntoView;
        }
      },
      removeScrollGuard(id) {
        scrollGuards.delete(id);
        if (
          !scrollGuards.size &&
          Element.prototype.scrollIntoView === patchedScrollIntoView
        ) {
          Element.prototype.scrollIntoView = originalScrollIntoView;
        }
      },
      updateSourceState(id, nextState) {
        sourceStates.set(id, {
          disabled: !!(nextState && nextState.disabled),
          reason: nextState && nextState.reason ? nextState.reason : null,
        });
        emitStateChange();
      },
      clearSourceState(id) {
        if (!sourceStates.has(id)) return;
        sourceStates.delete(id);
        emitStateChange();
      },
      subscribe(listener) {
        subscribers.add(listener);
        try {
          listener(getSnapshot());
        } catch {}
        return () => {
          subscribers.delete(listener);
        };
      },
      getSnapshot,
    };
    window[AUTOSCROLL_INTEROP_KEY] = interop;
    return interop;
  }
  function isLikelyBottomSentinel(target, scroller) {
    if (!(target instanceof HTMLElement) || !(scroller instanceof HTMLElement))
      return false;
    if (target === scroller) return false;
    if (
      target.closest(
        "[data-message-id], .mari-message, [data-component='ChatMessage']",
      )
    )
      return false;
    const rect = target.getBoundingClientRect();
    if (rect.height > 12) return false;
    const scrollerRect = scroller.getBoundingClientRect();
    const targetTop = scroller.scrollTop + (rect.top - scrollerRect.top);
    const distanceFromContentBottom = scroller.scrollHeight - targetTop;
    if (distanceFromContentBottom > 48) return false;
    const lastElement = scroller.lastElementChild;
    if (lastElement === target) return true;
    if (lastElement instanceof HTMLElement && lastElement.contains(target))
      return true;
    let sibling = target;
    for (let i = 0; i < 3 && sibling; i += 1) {
      if (sibling === lastElement) return true;
      sibling = sibling.nextElementSibling;
    }
    return false;
  }
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const styleTag = document.createElement("style");
    styleTag.id = STYLE_ID;
    styleTag.textContent = ` #${ROOT_ID} { position: fixed; z-index: 9998; display: none; flex-direction: column; gap: 10px; top: 50%; transform: translateY(-50%); pointer-events: none; } #${ROOT_ID}.mari-show { display: inline-flex; } #${ROOT_ID}.mari-side-left { left: max(2px, calc(env(safe-area-inset-left, 0px) + 2px)); } #${ROOT_ID}.mari-side-right { right: max(2px, calc(env(safe-area-inset-right, 0px) + 2px)); } #${ROOT_ID} .mari-scroll-btn { width: 42px; height: 42px; border-radius: 999px; border: 1px solid var(--border, rgba(255, 255, 255, 0.22)); background: color-mix(in srgb, var(--card, #10131a) 90%, transparent); color: var(--foreground, #f8fafc); box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35); cursor: pointer; font-size: 19px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); transition: transform 120ms ease, opacity 120ms ease, background-color 120ms ease; pointer-events: auto; user-select: none; touch-action: manipulation; } #${ROOT_ID} .mari-scroll-btn:hover { transform: translateY(-1px); background: color-mix(in srgb, var(--accent, #1f2937) 90%, transparent); } #${ROOT_ID} .mari-scroll-btn:active { transform: translateY(0); } #${ROOT_ID} .mari-scroll-btn.mari-disabled { opacity: 0.44; } #${ROOT_ID} .mari-scroll-btn.mari-hold { opacity: 0.82; } #${ROOT_ID} .mari-scroll-btn:focus-visible { outline: 2px solid var(--accent, #7dd3fc); outline-offset: 2px; } [${PANEL_ATTR}="true"] { margin-top: 8px; padding: 10px; border: 1px solid var(--border, rgba(255, 255, 255, 0.18)); border-radius: 8px; background: color-mix(in srgb, var(--secondary, #1f2531) 55%, transparent); } [${PANEL_ATTR}="true"] .mari-sa-title { font-size: 12px; font-weight: 700; margin-bottom: 8px; color: var(--foreground, #f5f5f5); } [${PANEL_ATTR}="true"] .mari-sa-grid { display: grid; grid-template-columns: 1fr; gap: 8px; } [${PANEL_ATTR}="true"] label { display: grid; gap: 4px; font-size: 12px; color: var(--foreground, #f5f5f5); } [${PANEL_ATTR}="true"] select { width: 100%; border: 1px solid var(--border, rgba(255, 255, 255, 0.2)); border-radius: 6px; background: var(--background, #0f1420); color: var(--foreground, #f5f5f5); font-size: 12px; padding: 6px 8px; } [${PANEL_ATTR}="true"] .mari-sa-binding-row { display: flex; align-items: center; gap: 8px; } [${PANEL_ATTR}="true"] .mari-sa-percent-wrap { display: inline-flex; align-items: center; gap: 4px; } [${PANEL_ATTR}="true"] .mari-sa-percent-input { width: 48px; border: 1px solid var(--border, rgba(255, 255, 255, 0.2)); border-radius: 6px; background: var(--background, #0f1420); color: var(--foreground, #f5f5f5); font-size: 12px; padding: 6px 8px; text-align: right; } [${PANEL_ATTR}="true"] .mari-sa-percent-symbol { font-size: 12px; opacity: 0.85; } [${PANEL_ATTR}="true"] .mari-sa-note { margin-top: 8px; opacity: 0.78; font-size: 11px; } [${PANEL_ATTR}="true"] .mari-sa-warning { margin-bottom: 8px; padding: 7px 8px; border: 1px solid color-mix(in srgb, #f59e0b 58%, transparent); border-radius: 6px; background: color-mix(in srgb, #7c2d12 38%, transparent); color: #fde68a; font-size: 11px; line-height: 1.35; } [${PANEL_ATTR}="true"] .mari-sa-check { display: inline-flex; align-items: center; gap: 8px; } [${PANEL_ATTR}="true"] .mari-sa-check input[type="checkbox"] { width: 14px; height: 14px; } [${PANEL_ATTR}="true"] .mari-sa-actions { margin-top: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; } [${PANEL_ATTR}="true"] .mari-sa-actions button { border: 1px solid var(--border, rgba(255, 255, 255, 0.2)); border-radius: 6px; background: var(--background, #0f1420); color: var(--foreground, #f5f5f5); font-size: 11px; padding: 4px 8px; cursor: pointer; } [${PANEL_ATTR}="true"] .mari-sa-actions-note { opacity: 0.8; font-size: 11px; } .mari-sa-toggle-btn { width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border, rgba(255, 255, 255, 0.2)); background: transparent; color: var(--foreground, #f8fafc); cursor: pointer; font-size: 16px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; line-height: 1; user-select: none; touch-action: manipulation; transition: transform 220ms ease, background-color 120ms ease; flex-shrink: 0; margin-left: auto; } .mari-sa-toggle-btn:hover { background: color-mix(in srgb, var(--accent, #1f2937) 40%, transparent); } .mari-sa-toggle-btn.mari-toggle-open { transform: rotate(90deg); } [${PANEL_ATTR}="true"].mari-sa-panel-collapsed { display: none; } [${PANEL_ATTR}="true"].mari-sa-panel-expanded { display: block; animation: mari-sa-slide-down 250ms ease; } @keyframes mari-sa-slide-down { from { opacity: 0; max-height: 0; overflow: hidden; padding-top: 0; padding-bottom: 0; margin-top: 0; border-width: 0; } to { opacity: 1; max-height: 800px; } } #${ROOT_ID}.mari-unlocked { outline: 2px dashed color-mix(in srgb, var(--primary, #88c0d0) 50%, transparent); outline-offset: 4px; border-radius: 8px; } #${ROOT_ID}.mari-dragging .mari-scroll-btn { pointer-events: none; } #${ROOT_ID} .mari-drag-anchor { position: absolute; top: -8px; left: -8px; width: 18px; height: 18px; border-radius: 50%; background: var(--card, #1f2937); border: 1px solid var(--primary, #88c0d0); color: var(--primary, #88c0d0); font-size: 10px; display: none; align-items: center; justify-content: center; pointer-events: none; z-index: 1; } #${ROOT_ID}.mari-unlocked .mari-drag-anchor { display: flex; pointer-events: auto; cursor: grab; } #${ROOT_ID}.mari-dragging .mari-drag-anchor { cursor: grabbing; } `;
    document.head.appendChild(styleTag);
  }
  function loadOptions() {
    try {
      if (!window.localStorage) return { ...DEFAULT_OPTIONS };
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_OPTIONS };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return { ...DEFAULT_OPTIONS };
      return { ...DEFAULT_OPTIONS, ...sanitizeOptions(parsed) };
    } catch {
      return { ...DEFAULT_OPTIONS };
    }
  }
  function sanitizeOptions(input) {
    const safe = {};
    if (
      input.side === "left" ||
      input.side === "right" ||
      input.side === "disabled"
    ) {
      safe.side = input.side;
    }
    if (
      input.autoscrollMode === "full" ||
      input.autoscrollMode === "partial" ||
      input.autoscrollMode === "disabled"
    ) {
      safe.autoscrollMode = input.autoscrollMode;
    }
    for (const item of TAP_BINDINGS) {
      const value = input[item.key];
      if (typeof value === "string" && ACTION_KEYS.includes(value)) {
        safe[item.key] = value;
      }
    }
    if (Object.prototype.hasOwnProperty.call(input, "upScrollPercent")) {
      safe.upScrollPercent = parseScrollStepPercent(input.upScrollPercent);
    }
    if (Object.prototype.hasOwnProperty.call(input, "downScrollPercent")) {
      safe.downScrollPercent = parseScrollStepPercent(input.downScrollPercent);
    }
    if (typeof input.debugTrace === "boolean") {
      safe.debugTrace = input.debugTrace;
    }
    if (typeof input.buttonsLocked === "boolean") {
      safe.buttonsLocked = input.buttonsLocked;
    }
    if (typeof input.buttonOffsetX === "number" && Number.isFinite(input.buttonOffsetX)) {
      safe.buttonOffsetX = input.buttonOffsetX;
    }
    if (typeof input.buttonOffsetY === "number" && Number.isFinite(input.buttonOffsetY)) {
      safe.buttonOffsetY = input.buttonOffsetY;
    }
    return safe;
  }
  function persistOptions() {
    try {
      if (!window.localStorage) return;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.options));
    } catch {}
  }
  function createButtons() {
    if (document.getElementById(ROOT_ID)) {
      state.root = document.getElementById(ROOT_ID);
      state.upButton = state.root.querySelector("[data-sa-button='up']");
      state.downButton = state.root.querySelector("[data-sa-button='down']");
      bindDragEvents();
      return;
    }
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "mari-side-left";
    // Drag anchor icon — only visible when unlocked
    const anchor = document.createElement("span");
    anchor.className = "mari-drag-anchor";
    anchor.textContent = "⚓"; // ⚓ anchor symbol
    root.appendChild(anchor);
    const up = document.createElement("button");
    up.type = "button";
    up.className = "mari-scroll-btn";
    up.setAttribute("data-sa-button", "up");
    up.setAttribute("aria-label", "Scroll up controls");
    up.title = "Scroll Up";
    up.innerHTML = "&#9650;";
    const down = document.createElement("button");
    down.type = "button";
    down.className = "mari-scroll-btn";
    down.setAttribute("data-sa-button", "down");
    down.setAttribute("aria-label", "Scroll down controls");
    down.title = "Scroll Down";
    down.innerHTML = "&#9660;";
    root.appendChild(up);
    root.appendChild(down);
    document.body.appendChild(root);
    state.root = root;
    state.upButton = up;
    state.downButton = down;
    bindDragEvents();
  }
  function bindDragEvents() {
    if (!state.root) return;
    // Remove old listeners by cloning — simple and effective
    const oldEl = state.root;
    const newEl = oldEl.cloneNode(true);
    oldEl.parentNode.replaceChild(newEl, oldEl);
    state.root = newEl;
    state.upButton = newEl.querySelector("[data-sa-button='up']");
    state.downButton = newEl.querySelector("[data-sa-button='down']");
    // Re-bind button gestures on the fresh buttons
    bindButtonGestures();

    let pointerMoved = false;
    const anchorEl = newEl.querySelector(".mari-drag-anchor");
    if (anchorEl) {
      anchorEl.addEventListener("pointerdown", (e) => {
        if (state.options.buttonsLocked) return;
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        const scroller = state.activeScroller;
        if (!(scroller instanceof HTMLElement)) return;
        const rootRect = newEl.getBoundingClientRect();
        pointerMoved = false;
        state.dragRef = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          originX: rootRect.left,
          originY: rootRect.top,
        };
        newEl.setPointerCapture(e.pointerId);
        newEl.classList.add("mari-dragging");
      });
    }
    newEl.addEventListener("pointermove", (e) => {
      if (!state.dragRef || e.pointerId !== state.dragRef.pointerId) return;
      pointerMoved = true;
      const scroller = state.activeScroller;
      if (!(scroller instanceof HTMLElement)) return;
      const sr = scroller.getBoundingClientRect();
      const dy = e.clientY - state.dragRef.startY;
      let newX = state.dragRef.originX;
      let newY = state.dragRef.originY + dy;
      const rootRect = newEl.getBoundingClientRect();
      const w = rootRect.width;
      const h = rootRect.height;
      newX = Math.max(sr.left, Math.min(sr.right - w, newX));
      newY = Math.max(sr.top, Math.min(sr.bottom - h, newY));
      // Store offset: X from scroller side edge, Y from scroller vertical center
      let dragOffsetX;
      const side = state.options.side === 'left' ? 'left' : 'right';
      if (side === 'left') {
        dragOffsetX = Math.round(newX - sr.left);
      } else {
        dragOffsetX = Math.round(sr.right - newX - w);
      }
      const centerY = sr.top + sr.height / 2;
      const buttonCenterY = newY + h / 2;
      const dragOffsetY = Math.round(buttonCenterY - centerY);
      state.options.buttonOffsetX = dragOffsetX;
      state.options.buttonOffsetY = dragOffsetY;
      newEl.style.left = `${newX}px`;
      newEl.style.right = "auto";
      newEl.style.top = `${newY}px`;
      newEl.style.transform = "none";
    });
    const endDrag = () => {
      if (!state.dragRef) return;
      newEl.classList.remove("mari-dragging");
      state.dragRef = null;
      persistOptions();
      // On release without movement (pure click), treat as no-op
    };
    newEl.addEventListener("pointerup", endDrag);
    newEl.addEventListener("pointercancel", endDrag);
    // Prevent the button click handlers from firing mid-drag
    newEl.addEventListener(
      "click",
      (e) => {
        if (pointerMoved) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true,
    );
  }
  function applySideOption() {
    if (!state.root) return;
    state.root.classList.toggle(
      "mari-side-left",
      state.options.side === "left",
    );
    state.root.classList.toggle(
      "mari-side-right",
      state.options.side === "right",
    );
    const unlocked = !state.options.buttonsLocked;
    state.root.classList.toggle("mari-unlocked", unlocked);
    positionRoot();
    refreshVisibility();
  }
  function bindButtonGestures() {
    bindTapGestures(state.upButton, {
      tap: () => triggerAction("upTap"),
      doubleTap: () => triggerAction("upDoubleTap"),
      longTap: () => triggerAction("upLongTap"),
    });
    bindTapGestures(state.downButton, {
      tap: () => triggerAction("downTap"),
      doubleTap: () => triggerAction("downDoubleTap"),
      longTap: () => triggerAction("downLongTap"),
    });
  }
  function bindTapGestures(button, handlers) {
    if (!(button instanceof HTMLElement)) return;
    let longTimer = null;
    let clickTimer = null;
    let longFired = false;
    let lastTapAt = 0;
    const clearLongTimer = () => {
      if (!longTimer) return;
      window.clearTimeout(longTimer);
      longTimer = null;
    };
    const clearClickTimer = () => {
      if (!clickTimer) return;
      window.clearTimeout(clickTimer);
      clickTimer = null;
    };
    const onPointerDown = (event) => {
      if (event.button !== 0 && event.pointerType !== "touch") return;
      longFired = false;
      button.classList.add("mari-hold");
      clearLongTimer();
      longTimer = window.setTimeout(() => {
        longFired = true;
        button.classList.remove("mari-hold");
        clearClickTimer();
        handlers.longTap();
      }, LONG_PRESS_MS);
    };
    const onPointerUp = () => {
      button.classList.remove("mari-hold");
      clearLongTimer();
      if (longFired) return;
      const now = Date.now();
      if (now - lastTapAt <= DOUBLE_TAP_MS) {
        clearClickTimer();
        lastTapAt = 0;
        handlers.doubleTap();
        return;
      }
      lastTapAt = now;
      clearClickTimer();
      clickTimer = window.setTimeout(() => {
        handlers.tap();
        lastTapAt = 0;
      }, DOUBLE_TAP_MS);
    };
    const onCancel = () => {
      button.classList.remove("mari-hold");
      clearLongTimer();
    };
    button.addEventListener("pointerdown", onPointerDown, { passive: true });
    button.addEventListener("pointerup", onPointerUp, { passive: true });
    button.addEventListener("pointercancel", onCancel, { passive: true });
    button.addEventListener("pointerleave", onCancel, { passive: true });
  }
  function triggerAction(optionKey) {
    if (isBindingDisabled(optionKey)) return;
    const action = state.options[optionKey];
    performAction(action, optionKey);
  }
  function isBindingDisabled(optionKey) {
    if (typeof optionKey !== "string") return false;
    if (optionKey.startsWith("up")) {
      return !!(
        state.upButton instanceof HTMLElement &&
        state.upButton.classList.contains("mari-disabled")
      );
    }
    if (optionKey.startsWith("down")) {
      return !!(
        state.downButton instanceof HTMLElement &&
        state.downButton.classList.contains("mari-disabled")
      );
    }
    return false;
  }
  function performAction(action, optionKey) {
    const scroller = state.activeScroller;
    if (!scroller) return;
    switch (action) {
      case "page-up": {
        const delta = Math.round(
          scroller.clientHeight * getScrollStepRatio("page-up", optionKey),
        );
        smartScrollTo(scroller, scroller.scrollTop - delta, "smooth");
        break;
      }
      case "page-down": {
        const delta = Math.round(
          scroller.clientHeight * getScrollStepRatio("page-down", optionKey),
        );
        smartScrollTo(scroller, scroller.scrollTop + delta, "smooth");
        break;
      }
      case "top":
        smartScrollTo(scroller, 0, "smooth");
        break;
      case "bottom":
        scrollToBottom(scroller, "smooth");
        break;
      case "message-up": {
        const top = getMessageBoundaryTarget(scroller, "up");
        smartScrollTo(scroller, top, "smooth");
        break;
      }
      case "message-down": {
        const top = getMessageBoundaryTarget(scroller, "down");
        smartScrollTo(scroller, top, "smooth");
        break;
      }
      default:
        break;
    }
  }
  function getScrollPercentOptionKey(action) {
    if (action === "page-up") return "upScrollPercent";
    if (action === "page-down") return "downScrollPercent";
    return null;
  }
  function parseScrollStepPercent(value) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed)) return DEFAULT_SCROLL_STEP_PERCENT;
    return clamp(parsed, 1, 100);
  }
  function getScrollStepRatio(action, optionKey) {
    const mappedOptionKey = getScrollPercentOptionKey(action);
    if (!mappedOptionKey) return PAGE_STEP_RATIO;
    const optionValue = state.options[mappedOptionKey];
    const percent = parseScrollStepPercent(optionValue);
    state.options[mappedOptionKey] = percent;
    if (
      optionKey &&
      mappedOptionKey === "upScrollPercent" &&
      optionKey.startsWith("down")
    ) {
      return parseScrollStepPercent(state.options.downScrollPercent) / 100;
    }
    if (
      optionKey &&
      mappedOptionKey === "downScrollPercent" &&
      optionKey.startsWith("up")
    ) {
      return parseScrollStepPercent(state.options.upScrollPercent) / 100;
    }
    return percent / 100;
  }
  function smartScrollTo(scroller, top, behavior) {
    const boundedTop = clamp(
      top,
      0,
      Math.max(0, scroller.scrollHeight - scroller.clientHeight),
    );
    state.autoscroll.suppressUserScrollUntil = Date.now() + 140;
    traceEvent("scroll-command", {
      behavior,
      requestedTop: Math.round(top),
      boundedTop,
    });
    scroller.scrollTo({ top: boundedTop, behavior });
  }
  function scrollToBottom(scroller, behavior) {
    smartScrollTo(scroller, scroller.scrollHeight, behavior);
  }
  function getMessageBoundaryTarget(scroller, direction) {
    const messages = getJumpTargetMessages(scroller);
    if (messages.length === 0) {
      if (direction === "up")
        return scroller.scrollTop - scroller.clientHeight * PAGE_STEP_RATIO;
      return scroller.scrollTop + scroller.clientHeight * PAGE_STEP_RATIO;
    }
    const messageSpans = getMessageSpans(scroller, messages);
    if (messageSpans.length === 0) {
      if (direction === "up")
        return scroller.scrollTop - scroller.clientHeight * PAGE_STEP_RATIO;
      return scroller.scrollTop + scroller.clientHeight * PAGE_STEP_RATIO;
    }
    const currentIdx = findCurrentMessageIndex(scroller, messageSpans);
    const lastIdx = messageSpans.length - 1;
    const safeIdx = clamp(currentIdx, 0, lastIdx);
    const current = messageSpans[safeIdx];
    const nearCurrentStart = Math.abs(current.top - scroller.scrollTop) <= 24;
    if (direction === "up") {
      const targetIdx = nearCurrentStart ? Math.max(0, safeIdx - 1) : safeIdx;
      const target = messageSpans[targetIdx];
      return Math.max(0, target.top - MESSAGE_JUMP_OFFSET_PX);
    }
    const targetIdx = nearCurrentStart
      ? Math.min(lastIdx, safeIdx + 1)
      : safeIdx;
    const target = messageSpans[targetIdx];
    return Math.max(0, target.top - MESSAGE_JUMP_OFFSET_PX);
  }
  function findCurrentMessageIndex(scroller, messageSpans) {
    const viewportTop = scroller.scrollTop + MESSAGE_JUMP_OFFSET_PX;
    for (let i = 0; i < messageSpans.length; i += 1) {
      const bottom = messageSpans[i].bottom;
      if (bottom > viewportTop) return i;
    }
    return messageSpans.length - 1;
  }
  function getMessageSpans(scroller, messages) {
    const scrollerRect = scroller.getBoundingClientRect();
    return messages
      .map((message) => {
        if (!(message instanceof HTMLElement)) return null;
        const rect = message.getBoundingClientRect();
        const top = scroller.scrollTop + (rect.top - scrollerRect.top);
        const bottom = top + rect.height;
        if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
        return { top, bottom, node: message };
      })
      .filter((entry) => !!entry);
  }
  function getAllMessages(scroller) {
    const selectors = [
      "[data-message-id]",
      "[data-component='ChatMessage']",
      ".mari-chat-message",
      ".chat-message",
      "article",
    ];
    for (const selector of selectors) {
      const nodes = Array.from(scroller.querySelectorAll(selector)).filter(
        (node) => {
          if (!(node instanceof HTMLElement)) return false;
          if (!node.isConnected) return false;
          if (node.offsetHeight < 24) return false;
          return true;
        },
      );
      if (nodes.length >= 2) {
        return nodes;
      }
    }
    return Array.from(scroller.children).filter((node) => {
      if (!(node instanceof HTMLElement)) return false;
      return node.offsetHeight >= 24;
    });
  }
  function getJumpTargetMessages(scroller) {
    const messages = getAllMessages(scroller);
    const targetableMessages = messages.filter(isTargetableMessage);
    return targetableMessages.length > 0 ? targetableMessages : messages;
  }
  function isTargetableMessage(node) {
    if (!(node instanceof HTMLElement)) return false;
    const nameSelectors = [
      ".mari-message-name",
      ".message-author",
      ".message-name",
      "[data-message-author]",
      "[data-author-name]",
    ];
    for (const selector of nameSelectors) {
      const nameNode = node.querySelector(selector);
      if (!(nameNode instanceof HTMLElement)) continue;
      if (!nameNode.isConnected) continue;
      if (nameNode.getClientRects().length === 0) continue;
      const text = (nameNode.textContent || "").trim();
      if (text) return true;
    }
    return false;
  }
  function bindObservers() {
    let observerTimer = null;
    const onMutation = () => {
      clearTimeout(observerTimer);
      observerTimer = setTimeout(() => {
        rescan();
        mountOptionsPanel();
      }, 150);
    };
    state.bodyObserver = new MutationObserver(onMutation);
    state.bodyObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
    state.intervalId = window.setInterval(() => {
      if (!document.hidden) {
        rescan();
        mountOptionsPanel();
      }
    }, 1100);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);
  }
  function onViewportChange() {
    clearTimeout(_viewportResizeTimer);
    _viewportResizeTimer = setTimeout(() => {
      rescan();
    }, 200);
  }
  function bindScroller(scroller) {
    if (scroller === state.activeScroller) return;
    if (state.detachScrollerScroll) {
      state.detachScrollerScroll();
      state.detachScrollerScroll = null;
    }
    if (state.scrollerObserver) {
      state.scrollerObserver.disconnect();
      state.scrollerObserver = null;
    }
    state.activeScroller = scroller;
    state.autoscroll.targetMessage = null;
    state.autoscroll.partialStopped = false;
    state.autoscroll.lastScrollTop = scroller ? scroller.scrollTop : 0;
    state.autoscroll.upwardScrollStreak = 0;
    if (!scroller) {
      syncSharedAutoscrollState();
      refreshVisibility();
      return;
    }
    const onScroll = () => {
      const previousTop = state.autoscroll.lastScrollTop;
      const currentTop = scroller.scrollTop;
      const scrollDelta = Math.round(currentTop - previousTop);
      state.autoscroll.lastScrollTop = currentTop;
      if (Date.now() < state.autoscroll.suppressUserScrollUntil) {
        traceEvent("scroll-ignored", {
          reason: "suppress-window",
          scrollDelta,
        });
        refreshVisibility();
        return;
      }
      const dist = distanceFromBottom(scroller);
      const lastMessage = getLastMessage(scroller);
      const generationActive = isGeneratingMessage(lastMessage);
      const prevFollowing = state.autoscroll.following;
      const prevPartialStopped = state.autoscroll.partialStopped;
      if (scrollDelta < 0 && dist > BOTTOM_RESUME_PX) {
        state.autoscroll.upwardScrollStreak += 1;
      } else if (scrollDelta > 0 || dist <= BOTTOM_RESUME_PX) {
        state.autoscroll.upwardScrollStreak = 0;
      }
      if (scrollDelta < -2 && dist > BOTTOM_RESUME_PX) {
        state.autoscroll.following = false;
      } else if (state.autoscroll.upwardScrollStreak >= 2) {
        state.autoscroll.following = false;
      } else if (dist > BOTTOM_FAR_PX) {
        state.autoscroll.following = false;
      } else if (dist <= BOTTOM_RESUME_PX && !generationActive) {
        state.autoscroll.following = true;
        state.autoscroll.partialStopped = false;
      }
      traceEvent("scroll", {
        generationActive,
        dist: Math.round(dist),
        scrollDelta,
        upwardScrollStreak: state.autoscroll.upwardScrollStreak,
        followingChanged: prevFollowing !== state.autoscroll.following,
        partialStoppedChanged:
          prevPartialStopped !== state.autoscroll.partialStopped,
      });
      syncSharedAutoscrollState();
      refreshVisibility();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    state.detachScrollerScroll = () => {
      scroller.removeEventListener("scroll", onScroll);
    };
    state.scrollerObserver = new MutationObserver(() => {
      traceEvent("mutation");
      maybeAutoscroll();
      refreshVisibility();
    });
    state.scrollerObserver.observe(scroller, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    refreshVisibility();
  }
  function rescan() {
    bindScroller(pickActiveScroller());
    positionRoot();
    maybeAutoscroll();
    refreshVisibility();
  }
  function refreshVisibility() {
    if (!state.root) return;
    const shouldShow =
      !!state.activeScroller &&
      !isGameModeActive() &&
      state.options.side !== "disabled";
    state.root.classList.toggle("mari-show", shouldShow);
    updateButtonEdgeState();
    if (shouldShow) {
      positionRoot();
    }
  }
  function updateButtonEdgeState() {
    if (
      !(state.upButton instanceof HTMLElement) ||
      !(state.downButton instanceof HTMLElement)
    )
      return;
    const scroller = state.activeScroller;
    if (!(scroller instanceof HTMLElement)) {
      state.upButton.classList.remove("mari-disabled");
      state.downButton.classList.remove("mari-disabled");
      return;
    }
    const atTop = scroller.scrollTop <= 1;
    const atBottom = distanceFromBottom(scroller) <= 1;
    state.upButton.classList.toggle("mari-disabled", atTop);
    state.downButton.classList.toggle("mari-disabled", atBottom);
  }
  function positionRoot() {
    if (!state.root) return;
    const scroller = state.activeScroller;
    if (!scroller || !scroller.isConnected) {
      state.root.style.removeProperty("left");
      state.root.style.removeProperty("right");
      state.root.style.removeProperty("top");
      state.root.style.removeProperty("transform");
      return;
    }
    // Guard against zero-size scroller (e.g. during layout transitions)
    if (scroller.clientHeight < 1 || scroller.clientWidth < 1) return;

    // ── Custom position (set by dragging while unlocked, persists when locked) ──
    const offsetX = state.options.buttonOffsetX;
    const offsetY = state.options.buttonOffsetY;

    if (typeof offsetX === 'number' && typeof offsetY === 'number') {
      const rect = scroller.getBoundingClientRect();
      const rootRect = state.root.getBoundingClientRect();
      const w = rootRect.width || 84;
      const h = rootRect.height || 94;
      const side = state.options.side === 'left' ? 'left' : 'right';

      // X from scroller side edge
      let x;
      if (side === 'left') {
        x = rect.left + offsetX;
      } else {
        x = rect.right - offsetX - w;
      }

      // Y from scroller vertical center
      const centerY = rect.top + rect.height / 2;
      let y = centerY + offsetY - h / 2;

      // Clamp to scroller bounds
      x = Math.max(rect.left, Math.min(rect.right - w, x));
      y = Math.max(rect.top, Math.min(rect.bottom - h, y));

      // Recompute offsets after clamping
      let clampedOffsetX;
      if (side === 'left') {
        clampedOffsetX = Math.round(x - rect.left);
      } else {
        clampedOffsetX = Math.round(rect.right - x - w);
      }
      const clampedOffsetY = Math.round((y + h / 2) - (rect.top + rect.height / 2));
      state.options.buttonOffsetX = clampedOffsetX;
      state.options.buttonOffsetY = clampedOffsetY;

      state.root.style.left = `${x}px`;
      state.root.style.right = "auto";
      state.root.style.top = `${y}px`;
      state.root.style.transform = "none";
      return;
    }

    // ── Locked / default: scroller-edge, vertically centered ──
    state.root.style.transform = "translateY(-50%)";
    const rect2 = scroller.getBoundingClientRect();
    state.root.style.top = `${Math.round(rect2.top + rect2.height / 2)}px`;
    state.root.style.removeProperty("left");
    state.root.style.removeProperty("right");
    if (state.options.side === "right") {
      state.root.style.right = `${Math.max(2, Math.round(window.innerWidth - rect2.right + 2))}px`;
    } else {
      state.root.style.left = `${Math.max(2, Math.round(rect2.left + 2))}px`;
    }
  }
  function pickActiveScroller() {
    const candidates = Array.from(
      document.querySelectorAll(
        "[data-chat-scroll], .mari-messages-scroll, [data-radix-scroll-area-viewport]",
      ),
    );
    const usable = candidates.filter((node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (!node.isConnected) return false;
      if (node.clientHeight < 120) return false;
      const rect = node.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
      if (node.scrollHeight <= node.clientHeight + 2) return false;
      return true;
    });
    if (!usable.length) return null;
    usable.sort((a, b) => b.clientHeight - a.clientHeight);
    return usable[0];
  }
  function maybeAutoscroll() {
    const scroller = state.activeScroller;
    if (!scroller) {
      traceEvent("maybe-exit", { reason: "no-scroller" });
      syncSharedAutoscrollState();
      return;
    }
    if (isGameModeActive()) {
      traceEvent("maybe-exit", { reason: "game-mode" });
      syncSharedAutoscrollState();
      return;
    }
    if (!isRoleplayAutoscrollActive()) {
      traceEvent("maybe-exit", { reason: "not-roleplay" });
      syncSharedAutoscrollState();
      return;
    }
    const mode = state.options.autoscrollMode;
    if (mode === "disabled") {
      traceEvent("maybe-exit", { reason: "mode-disabled" });
      syncSharedAutoscrollState();
      return;
    }
    const dist = distanceFromBottom(scroller);
    const activeStreamingMessage = getActiveStreamingMessage(scroller);
    const lastMessage = getLastMessage(scroller);
    const trackedMessage = activeStreamingMessage || lastMessage;
    const generationActive = isGeneratingMessage(trackedMessage);
    const wasFollowing = state.autoscroll.following;
    if (dist <= BOTTOM_RESUME_PX && !generationActive) {
      state.autoscroll.following = true;
      state.autoscroll.partialStopped = false;
    }
    const justReengaged = !wasFollowing && state.autoscroll.following;
    traceEvent("maybe-enter", {
      dist: Math.round(dist),
      generationActive,
      justReengaged,
      tracked: describeNode(trackedMessage),
    });
    if (!state.autoscroll.following) {
      traceEvent("maybe-exit", { reason: "not-following" });
      syncSharedAutoscrollState();
      return;
    }
    if (mode === "full") {
      syncSharedAutoscrollState();
      traceEvent("maybe-action", {
        action: "scroll-bottom",
        behavior: justReengaged ? "smooth" : "auto",
        reason: "full-mode",
      });
      scrollToBottom(scroller, justReengaged ? "smooth" : "auto");
      return;
    }
    if (!trackedMessage) {
      traceEvent("maybe-exit", { reason: "no-tracked-message" });
      syncSharedAutoscrollState();
      return;
    }
    if (state.autoscroll.targetMessage !== trackedMessage) {
      state.autoscroll.targetMessage = trackedMessage;
      if (!state.autoscroll.partialStopped) {
        state.autoscroll.partialStopped = false;
      }
    }
    if (state.autoscroll.partialStopped) {
      traceEvent("maybe-exit", { reason: "partial-stopped" });
      syncSharedAutoscrollState();
      return;
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const messageRect = trackedMessage.getBoundingClientRect();
    const topOffset = messageRect.top - scrollerRect.top;
    if (generationActive && topOffset <= MESSAGE_TOP_STOP_PX) {
      traceEvent("maybe-action", {
        action: "align-message-top",
        topOffset: Math.round(topOffset),
        threshold: MESSAGE_TOP_STOP_PX,
      });
      alignMessageStartToTop(scroller, trackedMessage);
      state.autoscroll.partialStopped = true;
      state.autoscroll.following = false;
      traceEvent("maybe-action", {
        action: "set-stopped",
        following: state.autoscroll.following,
        partialStopped: state.autoscroll.partialStopped,
      });
      syncSharedAutoscrollState();
      return;
    }
    syncSharedAutoscrollState();
    traceEvent("maybe-action", {
      action: "scroll-bottom",
      behavior: justReengaged ? "smooth" : "auto",
      reason: "partial-following",
    });
    scrollToBottom(scroller, justReengaged ? "smooth" : "auto");
  }
  function alignMessageStartToTop(scroller, message) {
    if (!(scroller instanceof HTMLElement) || !(message instanceof HTMLElement))
      return;
    if (!message.isConnected) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const messageRect = message.getBoundingClientRect();
    const topOffset = messageRect.top - scrollerRect.top;
    const desiredOffset = MESSAGE_TOP_STOP_PX;
    const delta = topOffset - desiredOffset;
    if (Math.abs(delta) <= 1) return;
    const nextTop = clamp(
      scroller.scrollTop + delta,
      0,
      Math.max(0, scroller.scrollHeight - scroller.clientHeight),
    );
    state.autoscroll.suppressUserScrollUntil = Date.now() + 120;
    traceEvent("align-scroll", {
      delta: Math.round(delta),
      nextTop: Math.round(nextTop),
    });
    scroller.scrollTop = nextTop;
  }
  function getLastMessage(scroller) {
    const messages = getAllMessages(scroller);
    if (!messages.length) return null;
    return messages[messages.length - 1];
  }
  function getActiveStreamingMessage(scroller) {
    if (!(scroller instanceof HTMLElement)) return null;
    const explicitStreaming = scroller.querySelector(
      '[data-message-id="__streaming__"]',
    );
    if (explicitStreaming instanceof HTMLElement) {
      return explicitStreaming;
    }
    const messages = getAllMessages(scroller);
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (isGeneratingMessage(message)) {
        return message;
      }
    }
    return null;
  }
  function isGeneratingMessage(message) {
    if (!(message instanceof HTMLElement)) return false;
    const messageId =
      message.getAttribute("data-message-id") ||
      message.dataset.messageId ||
      message.id ||
      "";
    if (messageId === "__streaming__") return true;
    if (message.getAttribute("data-streaming") === "true") return true;
    if (message.getAttribute("aria-busy") === "true") return true;
    if (message.classList.contains("rpg-streaming")) return true;
    if (message.querySelector(".rpg-streaming, .mari-message-typing"))
      return true;
    return false;
  }
  function distanceFromBottom(scroller) {
    return Math.max(
      0,
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
    );
  }
  function isGameModeActive() {
    const modeNode = document.querySelector("[data-chat-mode='game']");
    if (modeNode) return true;
    const explicitGameNodes = [
      "[data-game-mode='true']",
      "[data-mode='game']",
      "[data-component='GameMode']",
      "[data-component='GameChat']",
    ];
    for (const selector of explicitGameNodes) {
      if (document.querySelector(selector)) return true;
    }
    const textareas = Array.from(document.querySelectorAll("textarea"));
    for (const node of textareas) {
      if (!(node instanceof HTMLTextAreaElement)) continue;
      const placeholder = (
        node.getAttribute("placeholder") || ""
      ).toLowerCase();
      if (
        placeholder.includes("waiting for the game master") ||
        placeholder.includes("say to gm") ||
        placeholder.includes("say to party") ||
        placeholder.includes("what do you do")
      ) {
        return true;
      }
      const composerMarker =
        node.getAttribute("data-game-input") === "true" ||
        node.getAttribute("data-chat-input-mode") === "game";
      if (composerMarker) return true;
    }
    return false;
  }
  function isRoleplayAutoscrollActive() {
    return !!document.querySelector("[data-component='ChatArea.Roleplay']");
  }
  function createToggleButton(mountTarget) {
    // Sweep 1: remove stray toggle buttons that ended up on wrong rows.
    for (const old of document.querySelectorAll(".mari-sa-toggle-btn")) {
      if (
        mountTarget &&
        mountTarget.anchor &&
        old.parentElement === mountTarget.anchor
      ) {
        continue; // In the right row — handled by sweep 2.
      }
      if (old === state.toggleButton) state.toggleButton = null;
      old.remove();
    }

    // Sweep 2: remove duplicate buttons from the correct row, but keep ours.
    if (mountTarget && mountTarget.anchor) {
      for (const old of mountTarget.anchor.querySelectorAll(
        ".mari-sa-toggle-btn",
      )) {
        if (old === state.toggleButton && state.toggleButton.isConnected) continue;
        if (old === state.toggleButton) state.toggleButton = null;
        old.remove();
      }
    }

    // If our button survived, just sync its state.
    if (state.toggleButton && state.toggleButton.isConnected) {
      state.toggleButton.classList.toggle("mari-toggle-open", state.toggleOpen);
      return;
    }

    if (!mountTarget || !mountTarget.anchor || !mountTarget.host) {
      if (state.toggleButton && state.toggleButton.isConnected) {
        state.toggleButton.remove();
      }
      state.toggleButton = null;
      return;
    }
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "mari-sa-toggle-btn";
    toggleBtn.setAttribute("aria-label", "Toggle options");
    toggleBtn.title = "Toggle options";
    toggleBtn.innerHTML = "&#9654;";
    if (state.toggleOpen) {
      toggleBtn.classList.add("mari-toggle-open");
    }
    toggleBtn.addEventListener("click", () => {
      state.toggleOpen = !state.toggleOpen;
      toggleBtn.classList.toggle("mari-toggle-open", state.toggleOpen);
      mountOptionsPanel();
    });
    const allButtons = mountTarget.anchor.querySelectorAll(
      "button, [role='button']",
    );
    const deleteButton =
      allButtons.length > 0 ? allButtons[allButtons.length - 1] : null;
    if (deleteButton) {
      mountTarget.anchor.insertBefore(toggleBtn, deleteButton);
    } else {
      mountTarget.anchor.appendChild(toggleBtn);
    }
    state.toggleButton = toggleBtn;
  }
  function mountOptionsPanel() {
    const mountTarget = findExtensionMountTarget();
    const showGameModeNote = isGameModeActive();
    const showTraceActions = !!state.options.debugTrace;
    const showMultiInstanceWarning = hasMultipleInstancesLoaded();
    createToggleButton(mountTarget);
    if (!mountTarget) {
      if (state.mountedPanel && state.mountedPanel.isConnected) {
        state.mountedPanel.remove();
      }
      state.mountedPanel = null;
      return;
    }
    if (state.mountedPanel && state.mountedPanel.isConnected) {
      const currentParent = state.mountedPanel.parentElement;
      if (currentParent === mountTarget.host) {
        const renderedGameModeNote =
          state.mountedPanel.getAttribute(PANEL_GM_NOTE_ATTR) === "true";
        const renderedTraceActions =
          state.mountedPanel.getAttribute(PANEL_TRACE_ACTIONS_ATTR) === "true";
        const renderedSide =
          state.mountedPanel.getAttribute(PANEL_SIDE_ATTR) || "";
        const renderedMultiInstance =
          state.mountedPanel.getAttribute(PANEL_MULTI_INSTANCE_ATTR) === "true";
        const showSide = state.options.side || "";
        if (
          renderedGameModeNote === showGameModeNote &&
          renderedTraceActions === showTraceActions &&
          renderedSide === showSide &&
          renderedMultiInstance === showMultiInstanceWarning
        ) {
          state.mountedPanel.classList.toggle(
            "mari-sa-panel-collapsed",
            !state.toggleOpen,
          );
          state.mountedPanel.classList.toggle(
            "mari-sa-panel-expanded",
            state.toggleOpen,
          );
          return;
        }
      }
      state.mountedPanel.remove();
      state.mountedPanel = null;
    }
    const panel = buildOptionsPanel(showGameModeNote, showMultiInstanceWarning);
    panel.classList.toggle("mari-sa-panel-collapsed", !state.toggleOpen);
    panel.classList.toggle("mari-sa-panel-expanded", state.toggleOpen);
    if (mountTarget.anchor.nextSibling) {
      mountTarget.host.insertBefore(panel, mountTarget.anchor.nextSibling);
    } else {
      mountTarget.host.appendChild(panel);
    }
    state.mountedPanel = panel;
  }
  function findExtensionMountTarget() {
    // Only search spans — the engine renders extension names in <span>.
    // Searching div/p/h3 risks false matches on other panels' content.
    const spans = document.querySelectorAll("span");
    for (const span of spans) {
      if (span.textContent.trim() !== "Scroll Assistant") continue;
      // Never match inside our own options panel — that would make the scan
      // land on the wrong row after one toggle.
      if (span.closest(`[${PANEL_ATTR}]`)) continue;
      const anchor =
        span.closest(".flex.items-center.gap-2") ||
        span.closest("[data-extension-item]") ||
        span.parentElement;
      if (!anchor || !anchor.parentElement) continue;
      return { host: anchor.parentElement, anchor };
    }
    return null;
  }
  function buildOptionsPanel(showGameModeNote, showMultiInstanceWarning) {
    const panel = document.createElement("div");
    panel.setAttribute(PANEL_ATTR, "true");
    panel.setAttribute(PANEL_GM_NOTE_ATTR, showGameModeNote ? "true" : "false");
    panel.setAttribute(
      PANEL_TRACE_ACTIONS_ATTR,
      state.options.debugTrace ? "true" : "false",
    );
    panel.setAttribute(PANEL_SIDE_ATTR, state.options.side || "");
    panel.setAttribute(
      PANEL_MULTI_INSTANCE_ATTR,
      showMultiInstanceWarning ? "true" : "false",
    );
    const multiInstanceWarning = document.createElement("div");
    multiInstanceWarning.className = "mari-sa-warning";
    multiInstanceWarning.textContent =
      "Warning: more than one Scroll Assistant instance appears to be loaded. Please click the trash can on one of them.";
    const title = document.createElement("div");
    title.className = "mari-sa-title";
    title.textContent = "Scroll Assistant Options";
    const note = document.createElement("div");
    note.className = "mari-sa-note";
    note.textContent = "GM mode is active; assistant buttons are disabled.";
    const grid = document.createElement("div");
    grid.className = "mari-sa-grid";
    grid.appendChild(
      buildSelectField(
        "Buttons side",
        state.options.side,
        [
          { value: "left", label: "Left" },
          { value: "right", label: "Right" },
          { value: "disabled", label: "Disabled (hide buttons)" },
        ],
        (value) => {
          state.options.side = value;
          persistOptions();
          applySideOption();
          mountOptionsPanel();
        },
      ),
    );
    grid.appendChild(
      buildCheckboxField(
        "Unlock Buttons",
        !state.options.buttonsLocked,
        (checked) => {
          state.options.buttonsLocked = !checked;
          persistOptions();
          applySideOption();
        },
      ),
    );
    grid.appendChild(
      buildSelectField(
        "Autoscroll",
        state.options.autoscrollMode,
        [
          { value: "full", label: "Full (default app behavior)" },
          { value: "partial", label: "Partial (stop at top of new message)" },
          { value: "disabled", label: "Disabled" },
        ],
        (value) => {
          state.options.autoscrollMode = value;
          state.autoscroll.partialStopped = false;
          if (value === "full") state.autoscroll.following = true;
          persistOptions();
          syncSharedAutoscrollState();
        },
      ),
    );
    if (state.options.side !== "disabled") {
      for (const binding of TAP_BINDINGS) {
        grid.appendChild(buildActionBindingField(binding));
      }
    }
    grid.appendChild(
      buildCheckboxField(
        "Scroll trace logging",
        !!state.options.debugTrace,
        (checked) => {
          setTraceEnabled(checked);
          mountOptionsPanel();
        },
      ),
    );
    const traceActions = document.createElement("div");
    traceActions.className = "mari-sa-actions";
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.textContent = "Export trace";
    exportButton.addEventListener("click", () => {
      exportTrace();
    });
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.textContent = "Clear trace";
    clearButton.addEventListener("click", () => {
      clearTrace();
      if (traceCount) {
        traceCount.textContent = `${state.trace.events.length} events`;
      }
    });
    const traceCount = document.createElement("span");
    traceCount.className = "mari-sa-actions-note";
    traceCount.textContent = `${state.trace.events.length} events`;
    traceActions.appendChild(exportButton);
    traceActions.appendChild(clearButton);
    traceActions.appendChild(traceCount);
    if (showMultiInstanceWarning) {
      panel.appendChild(multiInstanceWarning);
    }
    panel.appendChild(title);
    if (showGameModeNote) {
      panel.appendChild(note);
    }
    panel.appendChild(grid);
    if (state.options.debugTrace) {
      panel.appendChild(traceActions);
    }
    return panel;
  }
  function buildSelectField(labelText, currentValue, options, onChange) {
    const label = document.createElement("label");
    label.textContent = labelText;
    const select = document.createElement("select");
    for (const item of options) {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      if (item.value === currentValue) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => {
      onChange(select.value);
    });
    label.appendChild(select);
    return label;
  }
  function buildActionBindingField(binding) {
    const label = document.createElement("label");
    label.textContent = binding.label;
    const row = document.createElement("span");
    row.className = "mari-sa-binding-row";
    const select = document.createElement("select");
    for (const actionKey of ACTION_KEYS) {
      const option = document.createElement("option");
      option.value = actionKey;
      option.textContent = ACTION_LABELS[actionKey];
      if (actionKey === state.options[binding.key]) option.selected = true;
      select.appendChild(option);
    }
    const percentWrap = document.createElement("span");
    percentWrap.className = "mari-sa-percent-wrap";
    const percentInput = document.createElement("input");
    percentInput.type = "text";
    percentInput.inputMode = "numeric";
    percentInput.className = "mari-sa-percent-input";
    percentInput.setAttribute("aria-label", `${binding.label} percent`);
    const percentSymbol = document.createElement("span");
    percentSymbol.className = "mari-sa-percent-symbol";
    percentSymbol.textContent = "%";
    const getPercentOptionKey = () => {
      const selectedAction = select.value;
      const mapped = getScrollPercentOptionKey(selectedAction);
      if (!mapped) return null;
      if (selectedAction === "page-up" && binding.key.startsWith("down"))
        return "downScrollPercent";
      if (selectedAction === "page-down" && binding.key.startsWith("up"))
        return "upScrollPercent";
      return mapped;
    };
    const syncPercentField = () => {
      const optionKey = getPercentOptionKey();
      if (!optionKey) {
        percentWrap.style.display = "none";
        return;
      }
      const current = parseScrollStepPercent(state.options[optionKey]);
      state.options[optionKey] = current;
      percentInput.value = String(current);
      percentWrap.style.display = "inline-flex";
    };
    const commitPercentInput = () => {
      const optionKey = getPercentOptionKey();
      if (!optionKey) return;
      const nextValue = parseScrollStepPercent(percentInput.value);
      state.options[optionKey] = nextValue;
      percentInput.value = String(nextValue);
      persistOptions();
    };
    select.addEventListener("change", () => {
      state.options[binding.key] = select.value;
      persistOptions();
      syncPercentField();
    });
    percentInput.addEventListener("blur", () => {
      commitPercentInput();
    });
    percentInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      commitPercentInput();
      percentInput.blur();
    });
    percentWrap.appendChild(percentInput);
    percentWrap.appendChild(percentSymbol);
    row.appendChild(select);
    row.appendChild(percentWrap);
    label.appendChild(row);
    syncPercentField();
    return label;
  }
  function buildCheckboxField(labelText, checked, onChange) {
    const label = document.createElement("label");
    const row = document.createElement("span");
    row.className = "mari-sa-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    const text = document.createElement("span");
    text.textContent = labelText;
    input.addEventListener("change", () => {
      onChange(!!input.checked);
    });
    row.appendChild(input);
    row.appendChild(text);
    label.appendChild(row);
    return label;
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
