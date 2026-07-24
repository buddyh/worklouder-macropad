const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {emptyLayer} = require('./lib/input-device');

const generator = path.join(__dirname, 'generate-agent-action.js');

function fixture({commandEnabled = true} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worklouder-agent-test-'));
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
          actions: [],
          actionGroups: [],
          multiactions: [],
          multiactionGroups: [],
          smartActions: [{
            id: 9,
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
  return {
    root,
    env: {
      ...process.env,
      INPUT_DATABASE: databasePath,
      INPUT_SUPPORT_ROOT: root,
    },
  };
}

function runGenerator(state, args) {
  return childProcess.spawnSync(process.execPath, [
    generator,
    '--shell', '/bin/sh',
    ...args,
  ], {
    encoding: 'utf8',
    env: state.env,
  });
}

function manifestFrom(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function commandFrom(manifest) {
  assert.equal(manifest.operations[0].type, 'upsert-smart-action');
  return manifest.operations[0].action.payload.cmd;
}

test('Codex action anchors a Git workspace without the non-Git override', (t) => {
  const state = fixture();
  t.after(() => fs.rmSync(state.root, {recursive: true, force: true}));
  const workspace = path.join(state.root, 'git-workspace');
  fs.mkdirSync(workspace);
  const initialized = childProcess.spawnSync(
    '/usr/bin/git',
    ['init', '--quiet', workspace],
    {encoding: 'utf8'},
  );
  assert.equal(initialized.status, 0, initialized.stderr);

  const manifest = manifestFrom(runGenerator(state, [
    '--agent', 'codex',
    '--workspace', workspace,
    '--prompt', 'Summarize this workspace',
    '--name', 'Codex summary',
  ]));
  const command = commandFrom(manifest);

  assert.equal(manifest.context.gitWorkspace, true);
  assert.equal(manifest.context.workspace, workspace);
  assert.match(command, /codex exec -C/);
  assert.ok(command.includes(workspace));
  assert.match(command, /<\/dev\/null/);
  assert.doesNotMatch(command, /--skip-git-repo-check/);
  assert.equal(manifest.operations.length, 1);
  assert.doesNotMatch(JSON.stringify(manifest), /\/Users\//);
});

test('Codex action adds the override for a non-Git workspace', (t) => {
  const state = fixture();
  t.after(() => fs.rmSync(state.root, {recursive: true, force: true}));
  const workspace = path.join(state.root, 'plain-workspace');
  fs.mkdirSync(workspace);

  const manifest = manifestFrom(runGenerator(state, [
    '--agent', 'codex',
    '--workspace', workspace,
    '--prompt', 'Run the routine',
    '--name', 'Codex routine',
  ]));
  const command = commandFrom(manifest);

  assert.equal(manifest.context.gitWorkspace, false);
  assert.match(command, /codex exec -C/);
  assert.ok(command.includes(workspace));
  assert.match(command, /--skip-git-repo-check/);
  assert.match(command, /<\/dev\/null/);
});

test('Claude action changes directory and closes stdin', (t) => {
  const state = fixture();
  t.after(() => fs.rmSync(state.root, {recursive: true, force: true}));
  const workspace = path.join(state.root, 'claude-workspace');
  fs.mkdirSync(workspace);

  const manifest = manifestFrom(runGenerator(state, [
    '--agent', 'claude',
    '--workspace', workspace,
    '--prompt', 'Review active tasks',
    '--name', 'Claude review',
  ]));
  const command = commandFrom(manifest);

  assert.equal(manifest.context.agent, 'claude');
  assert.match(command, /cd /);
  assert.ok(command.includes(workspace));
  assert.match(command, /&& claude -p/);
  assert.match(command, /<\/dev\/null/);
  assert.doesNotMatch(command, /codex exec|--skip-git-repo-check/);
  assert.doesNotMatch(JSON.stringify(manifest), /\/Users\//);
});

test('button mapping is optional and complete coordinates add one set-key operation', (t) => {
  const state = fixture();
  t.after(() => fs.rmSync(state.root, {recursive: true, force: true}));
  const workspace = path.join(state.root, 'mapped-workspace');
  fs.mkdirSync(workspace);

  const unmapped = manifestFrom(runGenerator(state, [
    '--workspace', workspace,
    '--prompt', 'Unmapped action',
    '--name', 'Unmapped',
  ]));
  assert.equal(unmapped.operations.length, 1);

  const mapped = manifestFrom(runGenerator(state, [
    '--workspace', workspace,
    '--prompt', 'Mapped action',
    '--name', 'Mapped',
    '--profile', '2',
    '--layer', '4',
    '--row', '2',
    '--key', '3',
  ]));
  assert.equal(mapped.operations.length, 2);
  assert.deepEqual(mapped.operations[1], {
    type: 'set-key',
    profileId: 2,
    layer: 4,
    row: 2,
    key: 3,
    value: `SA_${mapped.operations[0].action.id}`,
    allowStockLayer: false,
  });

  const partial = runGenerator(state, [
    '--workspace', workspace,
    '--prompt', 'Partial mapping',
    '--layer', '4',
  ]);
  assert.notEqual(partial.status, 0);
  assert.match(partial.stderr, /--layer, --row, and --key together/);
});

test('disabled command execution requires explicit generator and apply gates', (t) => {
  const state = fixture({commandEnabled: false});
  t.after(() => fs.rmSync(state.root, {recursive: true, force: true}));
  const workspace = path.join(state.root, 'workspace');
  fs.mkdirSync(workspace);

  const rejected = runGenerator(state, [
    '--workspace', workspace,
    '--prompt', 'Review status',
    '--name', 'Review',
  ]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /command permission is disabled/);

  const generated = manifestFrom(runGenerator(state, [
    '--workspace', workspace,
    '--prompt', 'Review status',
    '--name', 'Review',
    '--include-command-permission',
  ]));
  assert.deepEqual(
    generated.operations.filter(({type}) => type === 'set-command-permission'),
    [{type: 'set-command-permission', enabled: true}],
  );
});
