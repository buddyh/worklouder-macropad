#!/usr/bin/env node

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  defaultPaths,
  findRecord,
} = require('./lib/input-device');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function run(command, args, options = {}) {
  return childProcess.spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
}

function resolveLoginShell(requested) {
  const candidates = [requested, process.env.SHELL, '/bin/zsh'].filter(Boolean);
  const shell = candidates.find((candidate) =>
    path.isAbsolute(candidate) && fs.existsSync(candidate));
  if (!shell) throw new Error('Could not resolve an absolute login shell; pass --shell /path/to/shell');
  return shell;
}

function isGitWorkspace(workspace) {
  const result = run('/usr/bin/git', [
    '-C',
    workspace,
    'rev-parse',
    '--is-inside-work-tree',
  ]);
  return result.status === 0 && result.stdout.trim() === 'true';
}

function findOrAllocateSmartActionId(record, name, requestedId) {
  if (requestedId !== undefined) {
    const id = Number(requestedId);
    if (!Number.isInteger(id) || id < 0) throw new Error('--id must be a non-negative integer');
    return id;
  }
  const existing = record.smartActions.find((action) => action.name === name);
  if (existing) return existing.id;
  return Math.max(-1, ...record.smartActions.map((action) => action.id)) + 1;
}

function parseOptionalMapping(args) {
  const supplied = ['layer', 'row', 'key'].filter((field) => args[field] !== undefined);
  if (supplied.length === 0) return null;
  if (supplied.length !== 3) {
    throw new Error('Button mapping requires --layer, --row, and --key together');
  }
  const mapping = Object.fromEntries(['layer', 'row', 'key'].map((field) => [
    field,
    Number(args[field]),
  ]));
  if (!Number.isInteger(mapping.layer) || mapping.layer < 1 || mapping.layer > 6) {
    throw new Error('--layer must be an integer from 1 to 6');
  }
  if (!Number.isInteger(mapping.row) || mapping.row < 1 || mapping.row > 4) {
    throw new Error('--row must be an integer from 1 to 4');
  }
  if (!Number.isInteger(mapping.key) || mapping.key < 1) {
    throw new Error('--key must be a positive integer');
  }
  return mapping;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const agent = args.agent || 'codex';
  if (!['codex', 'claude'].includes(agent)) {
    throw new Error('--agent must be codex or claude');
  }
  if (!args.workspace) throw new Error('--workspace is required');
  if (!args.prompt) throw new Error('--prompt is required');

  const workspace = path.resolve(args.workspace);
  if (!fs.statSync(workspace, {throwIfNoEntry: false})?.isDirectory()) {
    throw new Error(`Workspace is not a directory: ${workspace}`);
  }
  const shell = resolveLoginShell(args.shell);
  const name = args.name || `${agent[0].toUpperCase()}${agent.slice(1)} agent`;
  if (name.length < 1 || name.length > 16) {
    throw new Error('--name must contain 1 to 16 characters');
  }

  const paths = defaultPaths();
  const database = JSON.parse(fs.readFileSync(paths.databasePath, 'utf8'));
  const record = findRecord(database);
  const commandEnabled = Boolean(
    database.collections?.find((item) => item.name === 'app_settings')
      ?.data?.[0]?.smartActionCmdEnabled,
  );
  if (!commandEnabled && !args['include-command-permission']) {
    throw new Error(
      'Input command permission is disabled. Re-run with --include-command-permission '
      + 'and apply with --allow-command-execution only after explicit approval.',
    );
  }
  const id = findOrAllocateSmartActionId(record, name, args.id);
  const mapping = parseOptionalMapping(args);
  const gitWorkspace = isGitWorkspace(workspace);
  const inner = agent === 'codex'
    ? [
      'codex',
      'exec',
      '-C',
      shellQuote(workspace),
      ...(gitWorkspace ? [] : ['--skip-git-repo-check']),
      shellQuote(args.prompt),
      '</dev/null',
    ].join(' ')
    : [
      'cd',
      shellQuote(workspace),
      '&&',
      'claude',
      '-p',
      shellQuote(args.prompt),
      '</dev/null',
    ].join(' ');
  const command = `${shellQuote(shell)} -lic ${shellQuote(inner)}`;
  const operations = [{
    type: 'upsert-smart-action',
    action: {
      id,
      name,
      color: args.color || '#33CC99',
      icon: null,
      type: 'CMD_STEP',
      payload: {cmd: command},
    },
  }];
  if (!commandEnabled && args['include-command-permission']) {
    operations.push({type: 'set-command-permission', enabled: true});
  }
  if (mapping) {
    operations.push({
      type: 'set-key',
      profileId: Number(args.profile || 0),
      ...mapping,
      value: `SA_${id}`,
      allowStockLayer: args['allow-stock-layer'] === true,
    });
  }

  const output = {
    version: 1,
    generatedBy: 'worklouder-macropad agent action generator',
    context: {
      agent,
      workspace,
      gitWorkspace,
      shell,
    },
    operations,
  };
  const text = `${JSON.stringify(output, null, 2)}\n`;
  if (args.output) {
    const outputPath = path.resolve(args.output);
    fs.writeFileSync(outputPath, text, {mode: 0o600});
    fs.chmodSync(outputPath, 0o600);
    console.log(JSON.stringify({
      generated: outputPath,
      agent,
      workspace,
      gitWorkspace,
      smartActionId: id,
    }));
  } else {
    process.stdout.write(text);
  }
}

try {
  main();
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
}
