const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {buildManifest, chordInputs} = require('./generate-app-layer');

const profilesDir = path.join(__dirname, '..', 'profiles');

function loadProfile(name) {
  return JSON.parse(fs.readFileSync(path.join(profilesDir, `${name}.json`), 'utf8'));
}

function record() {
  return {
    actions: [{id: 0, name: 'Mine'}, {id: 4, name: 'Fast mode'}],
    smartActions: [{id: 6, name: 'Unrelated'}],
    linkedApps: [{id: 0, name: 'Chrome', process: 'com.google.Chrome'}],
  };
}

const values = {freemicro: '/opt/bin/freemicro', t3App: '/Applications/T3 Code.app'};

test('a chord presses modifiers, clicks the key, releases in reverse', () => {
  assert.deepEqual(chordInputs(['KC_LALT', 'KC_LGUI', 'KC_F']), [
    {keycode: 'KC_LALT', delay: 0, actionType: 1},
    {keycode: 'KC_LGUI', delay: 0, actionType: 1},
    {keycode: 'KC_F', delay: 0, actionType: 2},
    {keycode: 'KC_LGUI', delay: 0, actionType: 0},
    {keycode: 'KC_LALT', delay: 0, actionType: 0},
  ]);
});

test('IDs reuse same-named definitions and never collide with existing ones', () => {
  const manifest = buildManifest(loadProfile('claude-desktop'), record(), {layer: 3, values});
  const actions = manifest.operations.filter((op) => op.type === 'upsert-action');
  const fast = actions.find((op) => op.action.name === 'Fast mode');
  assert.equal(fast.action.id, 4);
  const others = actions.filter((op) => op !== fast).map((op) => op.action.id);
  assert.ok(others.every((id) => id > 4));
  assert.equal(new Set(others).size, others.length);
  const smart = manifest.operations.filter((op) => op.type === 'upsert-smart-action');
  assert.deepEqual(smart.map((op) => op.action.id), [7, 8, 9, 10, 11, 12]);
  assert.equal(smart[0].action.payload.cmd, '/opt/bin/freemicro focus 1 </dev/null');
});

test('the layer is linked to the app and Layer 1 is refused', () => {
  const manifest = buildManifest(loadProfile('t3-code'), record(), {layer: 4, values});
  const app = manifest.operations.find((op) => op.type === 'upsert-linked-app');
  assert.equal(app.linkedApp.id, 1);
  assert.equal(app.linkedApp.path, '/Applications/T3 Code.app');
  const layer = manifest.operations.find((op) => op.type === 'set-layer');
  assert.equal(layer.linkedAppId, 1);
  assert.equal(layer.name, 'Layer 4 - T3 Code');
  assert.throws(() => buildManifest(loadProfile('t3-code'), record(), {layer: 1, values}), /Layer 1/);
});

test('the MIC halves are only touched when asked', () => {
  const plain = buildManifest(loadProfile('claude-desktop'), record(), {layer: 3, values});
  const mic = (manifest) => manifest.operations
    .filter((op) => op.type === 'set-key' && op.row === 4 && op.key < 3)
    .map((op) => op.value);
  assert.deepEqual(mic(plain), []);
  const withMic = buildManifest(loadProfile('claude-desktop'), record(), {
    layer: 3, values, mic: 'KC_LSFT,KC_LALT',
  });
  assert.deepEqual(mic(withMic), ['KC_LSFT', 'KC_LALT']);
});

test('a missing placeholder value is an error, not an empty command', () => {
  assert.throws(
    () => buildManifest(loadProfile('claude-desktop'), record(), {layer: 3, values: {}}),
    /freemicro/,
  );
});
