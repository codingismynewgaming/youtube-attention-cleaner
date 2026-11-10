import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const variants = ['firefox', 'chrome', 'edge'];
const popupSource = readFileSync(resolve(root, 'app-files/firefox/popup/popup.js'), 'utf8');

function createControl(id, tag = 'div', attrs = {}) {
  const handlers = new Map();
  const attributes = new Map(Object.entries(attrs));
  const classes = new Set();
  return {
    id,
    tagName: tag.toUpperCase(),
    value: '',
    textContent: '',
    checked: false,
    disabled: false,
    classList: {
      toggle(cls, force) {
        const has = classes.has(cls);
        const shouldHave = force !== undefined ? Boolean(force) : !has;
        if (shouldHave) classes.add(cls); else classes.delete(cls);
        return shouldHave;
      },
      add(cls) { classes.add(cls); },
      remove(cls) { classes.delete(cls); },
      contains(cls) { return classes.has(cls); }
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    addEventListener(name, handler) { handlers.set(name, handler); },
    fire(name) {
      const handler = handlers.get(name);
      assert.ok(handler, `Missing ${name} handler for ${id}`);
      return handler({ preventDefault() {} });
    },
    hasHandler(name) { return handlers.has(name); }
  };
}

function createPopup() {
  const ids = [
    'enabled-toggle', 'strength-slider', 'strength-input', 'strength-value',
    'grey-count', 'total-seen', 'reset-btn', 'status-message',
    'tab-settings', 'tab-info', 'panel-settings', 'panel-info'
  ];
  const controls = Object.fromEntries(ids.map(id => [id, createControl(id)]));
  const links = [
    createControl('btn-issue', 'a', { href: 'https://github.com/codingismynewgaming/youtube-attention-cleaner/issues' }),
    createControl('btn-coffee', 'a', { href: 'https://buymeacoffee.com/codingiymynewgaming' }),
    createControl('btn-paypal', 'a', { href: 'https://www.paypal.com/donate/?hosted_button_id=ZXHJFTUW9NQK8' }),
    createControl('btn-github', 'a', { href: 'https://github.com/codingismynewgaming/youtube-attention-cleaner' })
  ];
  const writes = [];
  const createdTabs = [];
  let state = {
    prefs: { enabled: true, greyStrength: 75 },
    seenVideoIds: ['AAAAAAAAAAA', 'BBBBBBBBBBB'],
    watchIntentVideoIds: [],
    generation: 0
  };
  let count = 5;
  let resetFails = false;
  let messageListener;
  const api = {
    runtime: {
      async sendMessage(message) {
        switch (message.type) {
          case 'GET_STATE':
            return { ok: true, ...state, seenVideoIds: [...state.seenVideoIds] };
          case 'GET_TAB_COUNT':
            assert.equal(message.tabId, 7);
            return { ok: true, count };
          case 'SAVE_PREFS':
            await new Promise(done => setTimeout(done, 2));
            writes.push(message.prefs);
            state.prefs = { ...message.prefs };
            return { ok: true, prefs: { ...state.prefs } };
          case 'RESET_SEEN_VIDEOS':
            if (resetFails) return { ok: false, error: 'reset refused' };
            state = { ...state, seenVideoIds: [], watchIntentVideoIds: [], generation: 1 };
            count = 0;
            return { ok: true, generation: 1 };
          default:
            throw new Error(`Unexpected request: ${message.type}`);
        }
      },
      onMessage: { addListener(listener) { messageListener = listener; } }
    },
    tabs: {
      async query() {
        return [{ id: 7, url: 'https://www.youtube.com/results?search_query=test' }];
      },
      async create(details) {
        createdTabs.push(details);
        return { id: 99, ...details };
      }
    },
    storage: { onChanged: { addListener() {} } }
  };
  const context = {
    browser: api,
    document: {
      getElementById(id) { return controls[id]; },
      querySelectorAll(selector) {
        if (selector === 'a[href]') return links;
        return [];
      },
      body: { classList: { toggle() {} } }
    },
    setTimeout,
    clearTimeout,
    console
  };
  vm.createContext(context);
  vm.runInContext(popupSource, context, { filename: 'popup.js' });
  return {
    controls,
    links,
    writes,
    createdTabs,
    emit(message, tabId) { messageListener(message, { tab: { id: tabId } }); },
    failReset() { resetFails = true; }
  };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Popup did not reach expected state');
    await new Promise(done => setTimeout(done, 1));
  }
}

test('three browser variants use the same popup and valid module loaders', () => {
  for (const variant of variants) {
    const base = resolve(root, 'app-files', variant);
    assert.equal(readFileSync(resolve(base, 'popup/popup.js'), 'utf8'), popupSource);
    const manifest = JSON.parse(readFileSync(resolve(base, 'manifest.json'), 'utf8'));
    assert.equal(manifest.version, '1.1.0');
    assert.equal(manifest.name, 'Dim + Filter Seen YouTube Videos');
    assert.deepEqual(manifest.content_scripts[0].js, ['loader.js']);
    assert.equal(manifest.content_scripts[0].type, undefined);
    assert.match(readFileSync(resolve(base, 'loader.js'), 'utf8'), /import\(contentUrl\)/);
    if (variant !== 'firefox') {
      assert.equal(manifest.background.type, 'module');
      assert.equal(manifest.browser_specific_settings, undefined);
    }
  }
});

test('popup counts only the active tab and preserves the last rapid setting change', async () => {
  const popup = createPopup();
  await waitFor(() => popup.controls['enabled-toggle'].hasHandler('change'));
  assert.equal(popup.controls['grey-count'].textContent, '5');
  assert.equal(popup.controls['total-seen'].textContent, '2');

  popup.emit({ type: 'GREY_COUNT_UPDATE', count: 99 }, 8);
  assert.equal(popup.controls['grey-count'].textContent, '5');
  popup.emit({ type: 'GREY_COUNT_UPDATE', count: 6 }, 7);
  assert.equal(popup.controls['grey-count'].textContent, '6');

  popup.controls['enabled-toggle'].checked = false;
  popup.controls['enabled-toggle'].fire('change');
  for (const value of ['10', '80', '90']) {
    popup.controls['strength-slider'].value = value;
    popup.controls['strength-slider'].fire('input');
  }
  await waitFor(() => popup.writes.at(-1)?.greyStrength === 90);
  assert.equal(popup.writes.at(-1).enabled, false);
  assert.equal(popup.controls['strength-slider'].disabled, true);
  assert.equal(popup.controls['enabled-toggle'].disabled, false);
  assert.equal(popup.controls['reset-btn'].disabled, false);
});

test('reset updates counts only after background success and surfaces errors', async () => {
  const popup = createPopup();
  await waitFor(() => popup.controls['reset-btn'].hasHandler('click'));
  await popup.controls['reset-btn'].fire('click');
  assert.equal(popup.controls['total-seen'].textContent, '0');
  assert.equal(popup.controls['grey-count'].textContent, '0');
  assert.equal(popup.controls['reset-btn'].disabled, false);

  popup.failReset();
  await popup.controls['reset-btn'].fire('click');
  assert.match(popup.controls['status-message'].textContent, /Could not reset history/);
  assert.equal(popup.controls['reset-btn'].disabled, false);
});

test('popup switches between settings and info tabs and handles link clicks', async () => {
  const popup = createPopup();
  await waitFor(() => popup.controls['tab-settings'].hasHandler('click'));
  assert.equal(popup.controls['tab-settings'].getAttribute('aria-selected'), null);

  popup.controls['tab-info'].fire('click');
  assert.equal(popup.controls['tab-info'].getAttribute('aria-selected'), 'true');
  assert.equal(popup.controls['tab-settings'].getAttribute('aria-selected'), 'false');
  assert.equal(popup.controls['tab-info'].classList.contains('active'), true);
  assert.equal(popup.controls['tab-settings'].classList.contains('active'), false);
  assert.equal(popup.controls['panel-info'].classList.contains('active'), true);
  assert.equal(popup.controls['panel-settings'].classList.contains('active'), false);

  popup.controls['tab-settings'].fire('click');
  assert.equal(popup.controls['tab-settings'].getAttribute('aria-selected'), 'true');
  assert.equal(popup.controls['tab-info'].getAttribute('aria-selected'), 'false');
  assert.equal(popup.controls['panel-settings'].classList.contains('active'), true);
  assert.equal(popup.controls['panel-info'].classList.contains('active'), false);

  assert.equal(popup.createdTabs.length, 0);
  popup.links[0].fire('click');
  assert.equal(popup.createdTabs.length, 1);
  assert.match(popup.createdTabs[0].url, /github\.com/);
  popup.links[1].fire('click');
  assert.equal(popup.createdTabs.length, 2);
  assert.match(popup.createdTabs[1].url, /buymeacoffee\.com/);
});
