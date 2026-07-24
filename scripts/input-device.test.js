const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  colorToNumber,
  createBackup,
  emptyLayer,
  encodeDeviceKeycode,
  keymapFromRecord,
  radialSectors,
  referenceReport,
  serializeDeviceJson,
  setActiveProfile,
  setEncoder,
  setKey,
  setLayer,
  setLighting,
  setProfile,
  summarize,
  upsertAction,
  upsertLinkedApp,
  upsertMultiAction,
  upsertSmartAction,
  validateReferences,
  writeDeviceFile,
} = require('./lib/input-device');

function recordFixture() {
  return {
    activeProfileId: 0,
    profiles: [{id: 0, name: 'Default', layers: [emptyLayer(0)]}],
    actions: [],
    actionGroups: [],
    multiactions: [],
    multiactionGroups: [],
    smartActions: [],
    smartActionGroups: [],
    linkedApps: [],
  };
}

test('encodes editor references for firmware', () => {
  assert.equal(encodeDeviceKeycode('KA_3'), 'KA_A3');
  assert.equal(encodeDeviceKeycode('KM_4'), 'KA_M4');
  assert.equal(encodeDeviceKeycode('SA_5'), 'SA_5');
  assert.equal(encodeDeviceKeycode('KC_A'), 'KC_A');
  assert.equal(encodeDeviceKeycode('KC_FUNC'), 'KC_FUNC');
});

test('normalizes three- and six-digit colors', () => {
  assert.equal(colorToNumber('#F00'), 0xFF0000);
  assert.equal(colorToNumber('#12abEF'), 0x12ABEF);
  assert.equal(colorToNumber('##12abEF'), 0x12ABEF);
});

test('creates 2 to 8 radial sectors with normalized angles', () => {
  for (let count = 2; count <= 8; count += 1) {
    const sectors = radialSectors(Array(count).fill('KC_A'));
    assert.equal(sectors.length, count);
    assert.ok(sectors.every(({a1, a2}) => a1 >= 0 && a1 <= 1 && a2 >= 0 && a2 <= 1));
  }
  assert.throws(() => radialSectors(['KC_A']));
});

test('adds missing layers up to six and maps a key', () => {
  const record = recordFixture();
  setKey(record, {profileId: 0, layer: 6, row: 4, key: 3, value: 'KM_1'});
  assert.equal(record.profiles[0].layers.length, 6);
  assert.equal(record.profiles[0].layers[5].layout.keymap[3][2], 'KM_1');
});

test('serializes Multi Action references and usage', () => {
  const record = recordFixture();
  record.multiactions.push({
    id: 1,
    name: 'Gestures',
    color: null,
    tap: {keycode: 'KC_A', delay: 0, actionType: 1},
    onHold: {keycode: 'KC_C', delay: 0, actionType: 1},
    doubleTap: {keycode: 'KC_B', delay: 0, actionType: 1},
    tapHold: {keycode: 'KC_D', delay: 0, actionType: 1},
    tappingTerms: 250,
  });
  setKey(record, {
    profileId: 0,
    layer: 1,
    row: 1,
    key: 1,
    value: 'KM_1',
    allowStockLayer: true,
  });
  const keymap = keymapFromRecord(record);
  assert.equal(keymap.profiles[0].layers[0].layout.keymap[0][0], 'KA_M1');
  assert.deepEqual(keymap.profiles[0].multiActionsUsed, [1]);
  assert.equal(keymap.multiActions[0].kcOnDoubleTap, 'KC_B');
});

test('applies layer lighting and serializes its color', () => {
  const record = recordFixture();
  setLighting(record, {
    profileId: 0,
    layer: 1,
    allowStockLayer: true,
    target: 'backlight',
    config: {effect: 'breath', brightness: 0.8, speed: 0.3, magic: 0.7, color: '#123456'},
  });
  const config = keymapFromRecord(record).profiles[0].layers[0].lights.backlight;
  assert.equal(config.effect, 'breath');
  assert.equal(config.color, 0x123456);
});

test('creates profiles and layer metadata up to layer six', () => {
  const record = recordFixture();
  setProfile(record, {profileId: 1, name: 'Editing'});
  upsertLinkedApp(record, {id: 2, name: 'Example', process: 'Example', path: '/Applications/Example.app'});
  setLayer(record, {
    profileId: 1,
    layer: 6,
    name: 'Review',
    color: '#0AF',
    os: 0,
    linkedAppId: 2,
  });
  setActiveProfile(record, 1);
  assert.equal(record.activeProfileId, 1);
  assert.equal(record.profiles[1].layers[5].name, 'Review');
  assert.equal(record.profiles[1].layers[5].color, '#00AAFF');
  assert.equal(record.profiles[1].layers[5].linkedAppId, 2);
});

test('protects stock Layer 1 by default', () => {
  const record = recordFixture();
  assert.throws(
    () => setKey(record, {profileId: 0, layer: 1, row: 1, key: 1, value: 'KC_A'}),
    /protected stock Codex layer/,
  );
});

test('uses live Codex encoder slot order and raw slot aliases', () => {
  const record = recordFixture();
  setEncoder(record, {profileId: 0, layer: 2, event: 'counterclockwise', value: 'KC_A'});
  setEncoder(record, {profileId: 0, layer: 2, event: 'clockwise', value: 'KC_B'});
  setEncoder(record, {profileId: 0, layer: 2, event: 'press', value: 'KC_C'});
  assert.deepEqual(record.profiles[0].layers[1].layout.encoders[0], ['KC_A', 'KC_B', 'KC_C']);
});

test('requires the fixed radial close sector', () => {
  const record = recordFixture();
  record.profiles[0].layers[0].layout.joystick.sectors[0].k = 'KC_A';
  assert.throws(() => keymapFromRecord(record), /fixed KI_X close action/);
});

test('includes actions reached through Multi Actions and nested Actions', () => {
  const record = recordFixture();
  upsertAction(record, {
    id: 2,
    name: 'Nested',
    color: null,
    keyInputs: [{keycode: 'KC_A', delay: 0, actionType: 2}],
  });
  upsertAction(record, {
    id: 1,
    name: 'Parent',
    color: null,
    keyInputs: [{keycode: 'KA_2', delay: 0, actionType: 2}],
  });
  upsertMultiAction(record, {
    id: 3,
    name: 'Gestures',
    color: null,
    tap: {keycode: 'KA_1'},
    onHold: {keycode: 'KC_B'},
    doubleTap: {keycode: 'KC_C'},
    tapHold: {keycode: 'KC_D'},
    tappingTerms: 250,
  });
  setKey(record, {
    profileId: 0,
    layer: 1,
    row: 1,
    key: 1,
    value: 'KM_3',
    allowStockLayer: true,
  });
  const profile = keymapFromRecord(record).profiles[0];
  assert.deepEqual(profile.multiActionsUsed, [3]);
  assert.deepEqual(profile.macrosUsed, [1, 2]);
});

test('rejects missing linked apps and Action cycles', () => {
  const record = recordFixture();
  setLayer(record, {
    profileId: 0,
    layer: 2,
    linkedAppId: 99,
  });
  assert.throws(() => keymapFromRecord(record), /missing linked app 99/);

  record.profiles[0].layers[1].linkedAppId = null;
  upsertAction(record, {
    id: 1,
    name: 'One',
    color: null,
    keyInputs: [{keycode: 'KA_2', delay: 0, actionType: 2}],
  });
  upsertAction(record, {
    id: 2,
    name: 'Two',
    color: null,
    keyInputs: [{keycode: 'KA_1', delay: 0, actionType: 2}],
  });
  assert.throws(() => keymapFromRecord(record), /Action cycle detected/);
});

test('redacts Smart Action payloads unless explicitly requested', () => {
  const record = recordFixture();
  upsertSmartAction(record, {
    id: 1,
    name: 'Secret command',
    type: 'CMD_STEP',
    payload: {cmd: 'token-value'},
  });
  const database = {collections: [{name: 'app_settings', data: [{}]}]};
  assert.equal(summarize(record, database).smartActions[0].payload, '<redacted>');
  assert.deepEqual(
    summarize(record, database, {showPayloads: true}).smartActions[0].payload,
    {cmd: 'token-value'},
  );
});

test('reports unreachable and missing definitions without exposing payloads', () => {
  const record = recordFixture();
  upsertSmartAction(record, {
    id: 1,
    name: 'Unused',
    type: 'TEXT_STEP',
    payload: {text: 'private'},
  });
  record.profiles[0].layers[0].layout.keymap[0][0] = 'SA_99';
  const report = referenceReport(record);
  assert.deepEqual(report.unreachable.smartActions, [1]);
  assert.deepEqual(report.missing, [{
    kind: 'smartActions',
    id: 99,
    location: 'profile 0 layer 0',
  }]);
  assert.doesNotMatch(JSON.stringify(report), /private/);
});

test('ASCII-escapes Unicode and chunk-writes large device files', async () => {
  let deviceBytes = Buffer.alloc(0);
  let writes = 0;
  const rpc = async (method, params) => {
    if (method === 'fs.writebin') {
      const chunk = Buffer.from(params.data, 'base64');
      deviceBytes = Buffer.concat([deviceBytes, chunk]);
      writes += 1;
      return {data_written: chunk.length};
    }
    if (method === 'fs.readbin') {
      const chunk = deviceBytes.subarray(params.offset, params.offset + params.len);
      return {total_size: deviceBytes.length, data: chunk.toString('base64')};
    }
    if (method === 'fs.list') {
      return [{
        name: 'smart_actions.json',
        checksum: crypto.createHash('sha1').update(deviceBytes).digest('hex'),
      }];
    }
    throw new Error(`Unexpected method ${method}`);
  };
  const value = {text: `café 🚀 ${'x'.repeat(7000)}`};
  const result = await writeDeviceFile(rpc, 'smart_actions.json', value);
  assert.ok(writes >= 3);
  assert.equal(JSON.parse(result.text).text, value.text);
  assert.equal(result.text, serializeDeviceJson(value));
  assert.doesNotMatch(result.text, /[é🚀]/u);
});

test('creates private backups', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worklouder-backup-test-'));
  const supportRoot = path.join(root, 'input');
  const backupRoot = path.join(root, 'backup');
  const databasePath = path.join(supportRoot, 'input_storage.json');
  const deviceRoot = path.join(supportRoot, 'devices', '123');
  fs.mkdirSync(deviceRoot, {recursive: true});
  fs.writeFileSync(databasePath, '{}');
  fs.writeFileSync(path.join(deviceRoot, 'keymap.json'), '{}');
  createBackup(
    {supportRoot, databasePath},
    {device: {devicePid: 123}},
    {'keymap.json': '{}'},
    backupRoot,
  );
  assert.equal(fs.statSync(backupRoot).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(backupRoot, 'input_storage.json')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(backupRoot, 'device-keymap.json')).mode & 0o777, 0o600);
  fs.rmSync(root, {recursive: true, force: true});
});
