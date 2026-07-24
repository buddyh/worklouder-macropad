const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {emptyLayer} = require('./lib/input-device');

const generator = path.join(__dirname, 'generate-diagnostic-config.js');
const cli = path.join(__dirname, 'worklouder.js');

function fixture({commandEnabled = true} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worklouder-diagnostic-test-'));
  const databasePath = path.join(root, 'input_storage.json');
  const database = {
    collections: [
      {
        name: 'devices',
        data: [{
          device: {deviceType: 'codex_micro', devicePid: 'fixture-device'},
          files: [],
          activeProfileId: 0,
          profiles: [{id: 0, name: 'Default', layers: [emptyLayer(0)]}],
          actions: [{
            id: 4,
            name: 'Existing',
            color: null,
            icon: null,
            keyInputs: [{keycode: 'KC_X', delay: 0, actionType: 2}],
          }],
          actionGroups: [],
          multiactions: [{
            id: 2,
            name: 'Existing Multi',
            color: null,
            icon: null,
            tap: {keycode: 'KC_A'},
            onHold: {keycode: 'KC_B'},
            doubleTap: {keycode: 'KC_C'},
            tapHold: {keycode: 'KC_D'},
            tappingTerms: 250,
          }],
          multiactionGroups: [],
          smartActions: [{
            id: 7,
            name: 'Existing Smart',
            color: null,
            icon: null,
            type: 'TEXT_STEP',
            payload: {text: 'existing'},
          }],
          smartActionGroups: [],
          linkedApps: [],
        }],
      },
      {name: 'app_settings', data: [{smartActionCmdEnabled: commandEnabled}]},
    ],
  };
  fs.writeFileSync(databasePath, JSON.stringify(database));
  const hudPath = path.join(root, 'worklouder-hud');
  fs.writeFileSync(hudPath, '#!/bin/sh\nexit 0\n', {mode: 0o755});
  return {
    root,
    databasePath,
    hudPath,
    env: {
      ...process.env,
      INPUT_DATABASE: databasePath,
      INPUT_SUPPORT_ROOT: root,
    },
  };
}

function runGenerator(state, args = []) {
  return childProcess.spawnSync(process.execPath, [generator, ...args], {
    encoding: 'utf8',
    env: state.env,
  });
}

function operationMap(manifest, type) {
  return manifest.operations.filter((operation) => operation.type === type);
}

function referencedIds(value, prefix) {
  if (typeof value !== 'string' || !value.startsWith(prefix)) return [];
  return [Number.parseInt(value.slice(prefix.length), 10)];
}

test('generates a portable Layer 4 diagnostic manifest with a fake HUD', (t) => {
  const state = fixture();
  t.after(() => fs.rmSync(state.root, {recursive: true, force: true}));
  const outputPath = path.join(state.root, 'diagnostic.json');
  const result = runGenerator(state, [
    '--layer', '4',
    '--mode', 'hud',
    '--hud', state.hudPath,
    '--output', outputPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.feedbackMode, 'hud');
  assert.deepEqual(manifest.target, {profileId: 0, layer: 4});
  assert.deepEqual(
    operationMap(manifest, 'set-layer').map(({profileId, layer, name}) => ({profileId, layer, name})),
    [{profileId: 0, layer: 4, name: 'Diagnostics'}],
  );

  const keys = operationMap(manifest, 'set-key');
  assert.equal(keys.length, 13);
  assert.deepEqual(
    keys.map(({row, key}) => `${row}:${key}`),
    ['1:1', '1:2', '2:1', '2:2', '2:3', '2:4',
      '3:1', '3:2', '3:3', '3:4', '4:1', '4:2', '4:3'],
  );
  assert.ok(keys.every(({profileId, layer}) => profileId === 0 && layer === 4));

  const encoders = operationMap(manifest, 'set-encoder');
  assert.deepEqual(
    encoders.map(({event}) => event),
    ['counterclockwise', 'clockwise', 'press'],
  );
  const [joystick] = operationMap(manifest, 'set-joystick');
  assert.equal(joystick.keycodes.length, 4);
  const lighting = operationMap(manifest, 'set-lighting');
  assert.deepEqual(lighting.map(({target}) => target).sort(), ['backlight', 'underglow']);

  const smartActions = operationMap(manifest, 'upsert-smart-action').map(({action}) => action);
  const actions = operationMap(manifest, 'upsert-action').map(({action}) => action);
  const [multiAction] = operationMap(manifest, 'upsert-multi-action').map(({action}) => action);
  const smartIds = new Set(smartActions.map(({id}) => id));
  const actionIds = new Set(actions.map(({id}) => id));
  const multiIds = new Set([multiAction.id]);
  const topLevelValues = [
    ...keys.map(({value}) => value),
    ...encoders.map(({value}) => value),
    ...joystick.keycodes,
  ];
  for (const value of topLevelValues) {
    for (const id of referencedIds(value, 'SA_')) assert.ok(smartIds.has(id), value);
    for (const id of referencedIds(value, 'KA_')) assert.ok(actionIds.has(id), value);
    for (const id of referencedIds(value, 'KM_')) assert.ok(multiIds.has(id), value);
  }
  for (const action of actions) {
    assert.ok(action.name.length <= 16);
    for (const {keycode} of action.keyInputs) {
      for (const id of referencedIds(keycode, 'SA_')) assert.ok(smartIds.has(id), keycode);
      for (const id of referencedIds(keycode, 'KA_')) assert.ok(actionIds.has(id), keycode);
    }
  }
  for (const gesture of ['tap', 'doubleTap', 'onHold', 'tapHold']) {
    const [id] = referencedIds(multiAction[gesture].keycode, 'SA_');
    assert.ok(smartIds.has(id), gesture);
  }
  const hudCommands = smartActions
    .filter(({type}) => type === 'CMD_STEP')
    .map(({payload}) => payload.cmd);
  assert.ok(hudCommands.length > 0);
  assert.ok(hudCommands.every((command) => command.startsWith(`'${state.hudPath}' `)));
  assert.doesNotMatch(JSON.stringify(manifest), /\/Users\//);

  const dryRun = childProcess.spawnSync(process.execPath, [cli, 'apply-config', outputPath], {
    encoding: 'utf8',
    env: state.env,
  });
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const plan = JSON.parse(dryRun.stdout);
  assert.equal(plan.changes.keymap, true);
  assert.equal(plan.changes.smartActions, true);
  assert.equal(plan.protectedLayer1Preserved, true);
});

test('HUD mode fails clearly when the executable is missing', (t) => {
  const state = fixture();
  t.after(() => fs.rmSync(state.root, {recursive: true, force: true}));
  const missingHud = path.join(state.root, 'missing-hud');
  const result = runGenerator(state, ['--mode', 'hud', '--hud', missingHud]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HUD binary not found/);
  assert.match(result.stderr, /build-hud\.js/);
});

test('disabled command execution requires an explicit generator and apply gate', (t) => {
  const state = fixture({commandEnabled: false});
  t.after(() => fs.rmSync(state.root, {recursive: true, force: true}));
  const rejected = runGenerator(state, ['--mode', 'hud', '--hud', state.hudPath]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /command permission is disabled/);
  assert.match(rejected.stderr, /--include-command-permission/);

  const outputPath = path.join(state.root, 'permission.json');
  const generated = runGenerator(state, [
    '--mode', 'hud',
    '--hud', state.hudPath,
    '--include-command-permission',
    '--output', outputPath,
  ]);
  assert.equal(generated.status, 0, generated.stderr);
  const manifest = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.deepEqual(
    operationMap(manifest, 'set-command-permission'),
    [{type: 'set-command-permission', enabled: true}],
  );

  const withoutApplyGate = childProcess.spawnSync(
    process.execPath,
    [cli, 'apply-config', outputPath],
    {encoding: 'utf8', env: state.env},
  );
  assert.notEqual(withoutApplyGate.status, 0);
  assert.match(withoutApplyGate.stderr, /--allow-command-execution/);
  const withApplyGate = childProcess.spawnSync(
    process.execPath,
    [cli, 'apply-config', outputPath, '--allow-command-execution'],
    {encoding: 'utf8', env: state.env},
  );
  assert.equal(withApplyGate.status, 0, withApplyGate.stderr);
});

for (const [mode, expectedScript] of [
  ['notification', 'display notification'],
  ['alert', 'display alert'],
]) {
  test(`${mode} mode uses osascript without requiring a HUD binary`, (t) => {
    const state = fixture();
    t.after(() => fs.rmSync(state.root, {recursive: true, force: true}));
    const outputPath = path.join(state.root, `${mode}.json`);
    const result = runGenerator(state, ['--mode', mode, '--output', outputPath]);

    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(manifest.feedbackMode, mode);
    const commands = operationMap(manifest, 'upsert-smart-action')
      .map(({action}) => action)
      .filter(({type}) => type === 'CMD_STEP')
      .map(({payload}) => payload.cmd);
    assert.ok(commands.length > 0);
    assert.ok(commands.every((command) => command.startsWith('/usr/bin/osascript -e ')));
    assert.ok(commands.every((command) => command.includes(expectedScript)));
    assert.ok(commands.every((command) => !command.includes('worklouder-hud')));
  });
}
