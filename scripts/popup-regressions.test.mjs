import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const variants = ['firefox', 'chrome', 'edge'];
const popupSource = readFileSync(resolve(root, 'app-files/firefox/popup/popup.js'), 'utf8');

function createControl(id) {
  const handlers = new Map();
  return {
    id,
    value: '',
    textContent: '',
    checked: false,
    disabled: false,
    classList: { toggle() {} },
    addEventListener(name, handler) { handlers.set(name, handler); },
    fire(name) {
      const handler = handlers.get(name);
      assert.ok(handler, `Missing ${name} handler for ${id}`);
      return handler();
    },
    hasHandler(name) { return handlers.has(name); }
  };
}

function createPopup() {
  const ids = [
    'enabled-toggle', 'strength-slider', 'strength-input', 'strength-value',
    'grey-count', 'total-seen', 'reset-btn', 'status-message'
  ];
  const controls = Object.fromEntries(ids.map(id => [id, createControl(id)]));
  const writes = [];
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
      }
    },
    storage: { onChanged: { addListener() {} } }
  };
  const context = {
    browser: api,
    document: {
      getElementById(id) { return controls[id]; },
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
    writes,
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
    assert.equal(manifest.version, '1.0.1');
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
