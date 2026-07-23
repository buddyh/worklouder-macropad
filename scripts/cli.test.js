const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {emptyLayer} = require('./lib/input-device');

const cli = path.join(__dirname, 'worklouder.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worklouder-cli-test-'));
  const databasePath = path.join(root, 'input_storage.json');
  const database = {
    collections: [
      {
        name: 'devices',
        data: [{
          device: {deviceType: 'codex_micro', devicePid: '123'},
          files: [],
          activeProfileId: 0,
          profiles: [{id: 0, name: 'Default', layers: [emptyLayer(0)]}],
          actions: [],
          actionGroups: [],
          multiactions: [],
          multiactionGroups: [],
          smartActions: [],
          smartActionGroups: [],
          linkedApps: [],
        }],
      },
      {name: 'app_settings', data: [{smartActionCmdEnabled: false}]},
    ],
  };
  fs.writeFileSync(databasePath, JSON.stringify(database));
  return {
    root,
    databasePath,
    env: {
      ...process.env,
      INPUT_DATABASE: databasePath,
      INPUT_SUPPORT_ROOT: root,
    },
  };
}

test('help does not require a live Input installation', () => {
  const result = childProcess.spawnSync(process.execPath, [cli, '--help'], {
    encoding: 'utf8',
    env: {...process.env, INPUT_DATABASE: '/does/not/exist'},
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Mutation is a dry run/);
});

test('dry runs redact Smart Action payloads', () => {
  const state = fixture();
  const configPath = path.join(state.root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    version: 1,
    operations: [
      {
        type: 'upsert-smart-action',
        action: {
          id: 1,
          name: 'Private',
          type: 'CMD_STEP',
          payload: {cmd: 'DO-NOT-PRINT-THIS'},
        },
      },
      {type: 'set-key', profileId: 0, layer: 2, row: 1, key: 1, value: 'SA_1'},
    ],
  }));
  const result = childProcess.spawnSync(process.execPath, [cli, 'apply-config', configPath], {
    encoding: 'utf8',
    env: state.env,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /DO-NOT-PRINT-THIS/);
  assert.match(result.stdout, /<redacted>/);
  fs.rmSync(state.root, {recursive: true, force: true});
});

test('command permission requires an affirmative CLI flag', () => {
  const state = fixture();
  const configPath = path.join(state.root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    version: 1,
    operations: [{type: 'set-command-permission', enabled: true}],
  }));
  const result = childProcess.spawnSync(process.execPath, [cli, 'apply-config', configPath], {
    encoding: 'utf8',
    env: state.env,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--allow-command-execution/);
  fs.rmSync(state.root, {recursive: true, force: true});
});
