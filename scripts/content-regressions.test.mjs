import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const variants = ["firefox", "chrome", "edge"];

function loadContent(variant, initializeReady = true) {
  const source = readFileSync(`app-files/${variant}/content.js`, "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replace(/init\(\)\.catch\(reportError\);?\s*$/m, "");
  const now = { value: 0 };
  const timers = new Map();
  const sent = [];
  let nextTimer = 1;
  let nextFrame = 1;
  const frameCallbacks = new Map();
  let markRequest = () => Promise.resolve({ ok: true, generation: 0, seen: true });
  const runtimeListeners = [];
  const storageListeners = [];
  const mutationObservers = [];
  let stateRequest = () => Promise.resolve({
    ok: true, prefs: { enabled: true, greyStrength: 75 }, generation: 0,
    seenVideoIds: [], watchIntentVideoIds: []
  });
  const location = {
    hostname: "www.youtube.com",
    pathname: "/results",
    href: "https://www.youtube.com/results"
  };
  const window = {
    location,
    innerWidth: 1000,
    innerHeight: 600,
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, at: now.value + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) {
      const id = nextFrame++;
      frameCallbacks.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { frameCallbacks.delete(id); },
    addEventListener() {}
  };
  class MockElement {
    querySelectorAll() { return []; }
    closest() { return null; }
    classList = { contains: () => false };
  }
  const document = {
    hidden: false,
    body: new MockElement(),
    head: { appendChild() {} },
    documentElement: { clientWidth: 1000, clientHeight: 600 },
    getElementById() { return null; },
    createElement() { return { id: "", textContent: "" }; },
    addEventListener() {}
  };
  const browser = {
    runtime: {
      async sendMessage(message) {
        sent.push(message);
        if (message.type === "MARK_SEEN") return markRequest(message);
        if (message.type === "GET_STATE") return stateRequest(message);
        return { ok: true, generation: 0 };
      },
      onMessage: { addListener(listener) { runtimeListeners.push(listener); } }
    },
    storage: { onChanged: { addListener(listener) { storageListeners.push(listener); } } }
  };
  const context = {
    console: { error() {}, warn() {}, log() {} },
    browser,
    window,
    document,
    location,
    Date: { now: () => now.value },
    isExpired(timestamp) { return Date.now() - timestamp > 65 * 86400000; },
    Element: MockElement,
    URL,
    getComputedStyle: () => ({ position: "static" }),
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; mutationObservers.push(this); }
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    queueMicrotask,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    extractVideoId(url) {
      const parsed = new URL(url, "https://www.youtube.com");
      if (parsed.pathname.startsWith("/shorts/")) return parsed.pathname.split("/")[2];
      return parsed.searchParams.get("v");
    },
    classifyPage(path) {
      if (path === "/results") return "search";
      if (path === "/") return "home";
      if (path === "/feed/subscriptions") return "subscriptions";
      if (path === "/watch") return "watch";
      if (path.startsWith("/shorts/")) return "shorts";
      return "other";
    },
    isAllowedURL(hostname) {
      return hostname === "youtube.com" || hostname === "www.youtube.com";
    },
    shouldGreyOnPage(path) {
      return path === "/" || path === "/feed/subscriptions" ||
        path === "/watch" || path === "/results" || path.startsWith("/shorts/");
    },
    isPrimaryVideo: () => false
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: `${variant}/content.js` });
  if (initializeReady) {
    vm.runInContext("ready = true; prefs = { enabled: true, greyStrength: 75 }; generation = 0; pageType = 'search';", context);
  }
  return {
    context, now, timers, sent, frameCallbacks, runtimeListeners, storageListeners, mutationObservers,
    setMarkRequest(handler) { markRequest = handler; },
    setStateRequest(handler) { stateRequest = handler; },
    async tick(timestamp) {
      now.value = timestamp;
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.at <= timestamp).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        timer.callback();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
    flushFrames() {
      const callbacks = [...frameCallbacks.values()];
      frameCallbacks.clear();
      for (const callback of callbacks) callback();
    }
  };
}

function makeTile(initialId, box) {
  let id = initialId;
  const tile = {
    isConnected: true,
    hidden: false,
    getBoundingClientRect: () => ({ ...box }),
    querySelectorAll(selector) {
      return selector === "a[href]" ? [{ href: `https://www.youtube.com/watch?v=${id}`, getAttribute: () => `/watch?v=${id}` }] : [];
    },
    querySelector() { return null; },
    setVideoId(value) { id = value; }
  };
  return tile;
}

for (const variant of variants) {
  test(`${variant}: Shorts tracking schedules one stable timer and commits once`, async () => {
    const app = loadContent(variant);
    const { context: c, now, sent } = app;
    vm.runInContext("pageType = 'shorts'; location.pathname = '/shorts/abcdefghijk'; location.href = 'https://www.youtube.com/shorts/abcdefghijk'", c);
    vm.runInContext("scheduleShortsTracking()", c);
    assert.equal(app.timers.size, 1);
    now.value = 1000;
    vm.runInContext("scheduleShortsTracking()", c);
    assert.equal(app.timers.size, 1, "same Shorts must not restart its timer");
    await app.tick(2000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sent.filter(message => message.type === "MARK_SEEN").length, 1);
    assert.equal(vm.runInContext("seenIds.has('abcdefghijk')", c), true);
  });

  test(`${variant}: visibility timing, virtualized video IDs and hidden tabs do not leak eligibility`, async () => {
    const app = loadContent(variant);
    const { context: c, now, sent } = app;
    const box = { left: 0, right: 300, top: 100, bottom: 300, width: 300, height: 200 };
    const tile = makeTile("AAAAAAAAAAA", box);
    c.tile = tile;
    vm.runInContext(`
      state = {
        tile, videoId: null, phase: 'idle', since: null, timer: null,
        overlay: null, target: null, thumbnail: null, positionChange: null
      };
      states.set(tile, state);
      evaluateTile(state);
    `, c);
    assert.equal(vm.runInContext("state.phase", c), "viewing");
    await app.tick(1999);
    assert.equal(sent.filter(message => message.type === "MARK_SEEN").length, 0);
    await app.tick(2000);
    assert.equal(vm.runInContext("state.phase", c), "eligible");
    assert.equal(app.timers.size, 0, "settled eligibility must not keep polling");

    box.top = 700;
    box.bottom = 900;
    now.value = 2500;
    vm.runInContext("evaluateTile(state)", c);
    assert.equal(vm.runInContext("state.phase", c), "outside");

    tile.setVideoId("BBBBBBBBBBB");
    now.value = 2600;
    vm.runInContext("evaluateTile(state)", c);
    assert.equal(vm.runInContext("state.videoId", c), "BBBBBBBBBBB");
    assert.equal(vm.runInContext("state.phase", c), "idle");
    assert.equal(app.timers.size, 0, "the new ID cannot inherit the previous ID's timer");

    box.top = 100;
    box.bottom = 300;
    now.value = 2700;
    vm.runInContext("evaluateTile(state)", c);
    assert.equal(vm.runInContext("state.phase", c), "viewing");
    assert.equal(app.timers.size, 1, "the new ID starts its own visibility timer");

    c.document.hidden = true;
    vm.runInContext("stopTracking(); evaluateTile(state)", c);
    assert.equal(vm.runInContext("state.timer", c), null);
    assert.equal(sent.filter(message => message.type === "MARK_SEEN").length, 0);
  });

  test(`${variant}: changes during startup are replayed and irrelevant mutations do no work`, async () => {
    const app = loadContent(variant, false);
    const { context: c, sent } = app;
    let finishSnapshot;
    app.setStateRequest(() => new Promise(resolve => { finishSnapshot = resolve; }));
    const startup = vm.runInContext("init()", c);
    await Promise.resolve();
    assert.equal(app.storageListeners.length, 1, "subscribe before requesting the initial snapshot");
    const id = "HHHHHHHHHHH";
    app.storageListeners[0]({
      seenChunk0: { oldValue: {}, newValue: { [id]: Date.now() } }
    }, "local");
    finishSnapshot({
      ok: true,
      prefs: { enabled: true, greyStrength: 75 },
      generation: 0,
      seenVideoIds: [],
      watchIntentVideoIds: []
    });
    await startup;
    assert.equal(vm.runInContext(`seenIds.has('${id}')`, c), true,
      "the event received during GET_STATE must apply after the snapshot");
    assert.equal(app.mutationObservers.length, 1);

    c.staleTile = { isConnected: false };
    vm.runInContext("states.set(staleTile, { tile: staleTile })", c);
    const textNode = {};
    app.mutationObservers[0].callback([{
      type: "childList",
      target: textNode,
      addedNodes: [textNode],
      removedNodes: [textNode]
    }]);
    assert.equal(app.frameCallbacks.size, 0, "text-only mutation should not enqueue a frame");
    assert.equal(vm.runInContext("states.has(staleTile)", c), true,
      "irrelevant mutations should not prune every tracked tile");
    assert.equal(sent.some(message => message.type === "MARK_SEEN"), false);
  });

  test(`${variant}: intent, reset generation and storage changes keep overlays consistent`, async () => {
    const app = loadContent(variant);
    const { context: c, sent } = app;
    const id = "CCCCCCCCCCC";
    vm.runInContext(`
      seenIds.add('${id}');
      watchIntentIds.add('${id}');
      state = {
        tile: {}, videoId: '${id}', overlay: { remove() { globalThis.removedOverlay = true; } },
        target: {}, thumbnail: null, positionChange: null
      };
      applyGrey(state);
      commitSeenVideo('${id}');
    `, c);
    assert.equal(vm.runInContext("removedOverlay", c), true);
    assert.equal(vm.runInContext("state.overlay", c), null);
    assert.equal(sent.filter(message => message.type === "MARK_SEEN").length, 0);

    let resolveMark;
    app.setMarkRequest(() => new Promise(resolve => { resolveMark = resolve; }));
    const pending = vm.runInContext("commitSeenVideo('DDDDDDDDDDD')", c);
    await Promise.resolve();
    assert.equal(sent.filter(message => message.type === "MARK_SEEN").length, 1);
    vm.runInContext("resetLocalHistory(1)", c);
    resolveMark({ ok: true, generation: 0, seen: true });
    await pending;
    assert.equal(vm.runInContext("seenIds.has('DDDDDDDDDDD')", c), false,
      "old-generation reply must not re-grey after reset");

    const changes = {
      seenChunk0: {
        oldValue: { FFFFFFFFFFF: Date.now() },
        newValue: { FFFFFFFFFFF: Date.now(), GGGGGGGGGGG: Date.now() }
      },
      seenChunk1: {
        oldValue: { GGGGGGGGGGG: Date.now() },
        newValue: {}
      }
    };
    vm.runInContext("seenIds.add('FFFFFFFFFFF'); seenIds.add('GGGGGGGGGGG')", c);
    vm.runInContext("updateHistoryFromStorage(changes, 'local')", Object.assign(c, { changes }));
    assert.equal(vm.runInContext("seenIds.has('FFFFFFFFFFF')", c), true);
    assert.equal(vm.runInContext("seenIds.has('GGGGGGGGGGG')", c), true,
      "a record moved across chunks in the same storage event must remain cached");
  });
}
