#!/usr/bin/env node
'use strict';

// Turns a portable app profile (profiles/*.json) into an apply-config
// manifest for one layer. Action, Smart Action and linked-app IDs are taken
// from the user's live Input database: an existing definition with the same
// name is reused, otherwise the next free ID is allocated. Nothing is written
// to Input or the device; review the manifest, then run apply-config.

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {defaultPaths, findRecord} = require('./lib/input-device');

const POSITIONS = {
  AG00: [1, 1], AG01: [1, 2],
  AG02: [2, 1], AG03: [2, 2], AG04: [2, 3], AG05: [2, 4],
  ACT06: [3, 1], ACT07: [3, 2], ACT08: [3, 3], ACT09: [3, 4],
  ACT10: [4, 1], ACT11: [4, 2], ACT12: [4, 3],
};
const ENCODER_EVENTS = ['clockwise', 'counterclockwise', 'press'];

const HELP = `Usage:
  node scripts/generate-app-layer.js --profile profiles/claude-desktop.json --layer 3 \\
    [--freemicro /path/to/freemicro] [--t3-app "/Applications/T3 Code.app"] \\
    [--mic KC_LSFT,KC_LALT] [--profile-id 0] [--output layout.json]

--layer        Target layer, 2-6. Layer 1 is the stock Codex layer and is refused.
--mic          Keycodes for the two halves of the wide MIC key. Omit to leave them alone.
--freemicro    Resolves {{freemicro}} in command steps (default: \`command -v freemicro\`).
--t3-app       Resolves {{t3App}} (default: first T3 Code app found by Spotlight).`;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function shellOutput(command) {
  const result = childProcess.spawnSync('/bin/sh', ['-c', command], {encoding: 'utf8'});
  return result.status === 0 ? result.stdout.trim().split('\n')[0] : '';
}

function resolvePlaceholders(text, values) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    if (!values[name]) throw new Error(`Profile needs {{${name}}}; pass it on the command line`);
    return values[name];
  });
}

function findOrAllocate(list, name, field = 'name', reserved = new Set()) {
  const existing = list.find((item) => item[field] === name);
  if (existing) return existing.id;
  let id = Math.max(-1, ...list.map((item) => item.id), ...reserved) + 1;
  while (reserved.has(id)) id += 1;
  reserved.add(id);
  return id;
}

function chordInputs(keys) {
  return [
    ...keys.slice(0, -1).map((keycode) => ({keycode, delay: 0, actionType: 1})),
    {keycode: keys[keys.length - 1], delay: 0, actionType: 2},
    ...keys.slice(0, -1).reverse().map((keycode) => ({keycode, delay: 0, actionType: 0})),
  ];
}

function buildManifest(profile, record, options) {
  const layer = Number(options.layer);
  if (!Number.isInteger(layer) || layer < 2 || layer > 6) {
    throw new Error('--layer must be 2-6; Layer 1 is the stock Codex layer');
  }
  const profileId = Number(options.profileId ?? 0);
  const values = options.values || {};
  const operations = [];
  const actionIds = new Set();
  const smartIds = new Set();

  const linkedApp = {
    ...profile.linkedApp,
    path: resolvePlaceholders(profile.linkedApp.path || '', values),
  };
  const linkedAppId = findOrAllocate(record.linkedApps || [], linkedApp.process, 'process');
  operations.push({type: 'upsert-linked-app', linkedApp: {id: linkedAppId, ...linkedApp}});

  const resolve = (binding, fallbackName) => {
    if (binding.keycode) return binding.keycode;
    const name = (binding.name || fallbackName).slice(0, 16);
    if (binding.chord) {
      const id = findOrAllocate(record.actions || [], name, 'name', actionIds);
      operations.push({
        type: 'upsert-action',
        action: {id, name, color: profile.color, icon: null, keyInputs: chordInputs(binding.chord)},
      });
      return `KA_${id}`;
    }
    if (binding.command) {
      const id = findOrAllocate(record.smartActions || [], name, 'name', smartIds);
      operations.push({
        type: 'upsert-smart-action',
        action: {
          id,
          name,
          color: profile.color,
          icon: null,
          type: 'CMD_STEP',
          payload: {cmd: `${resolvePlaceholders(binding.command, values)} </dev/null`},
        },
      });
      return `SA_${id}`;
    }
    throw new Error(`Binding ${fallbackName} needs keycode, chord or command`);
  };

  const keyValues = Object.entries(profile.keys).map(([input, binding]) => {
    if (!POSITIONS[input]) throw new Error(`Unknown input ${input}`);
    return [input, resolve(binding, `${profile.layerName} ${input}`)];
  });
  if (options.mic) {
    const [left, right] = options.mic.split(',').map((value) => value.trim());
    if (!left || !right) throw new Error('--mic needs two keycodes, e.g. KC_LSFT,KC_LALT');
    keyValues.push(['ACT10', left], ['ACT11', right]);
  }
  const encoderValues = ENCODER_EVENTS
    .filter((event) => profile.encoder?.[event])
    .map((event) => [event, resolve(profile.encoder[event], `${profile.layerName} ${event}`)]);

  operations.push({
    type: 'set-layer',
    profileId,
    layer,
    name: `Layer ${layer} - ${profile.layerName}`,
    color: profile.color,
    os: 0,
    linkedAppId,
  });
  for (const [input, value] of keyValues) {
    const [row, key] = POSITIONS[input];
    operations.push({type: 'set-key', profileId, layer, row, key, value});
  }
  for (const [event, value] of encoderValues) {
    operations.push({type: 'set-encoder', profileId, layer, event, value});
  }
  return {version: 1, operations};
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.profile || !args.layer) {
    console.log(HELP);
    process.exit(args.help ? 0 : 1);
  }
  const profile = JSON.parse(fs.readFileSync(args.profile, 'utf8'));
  const database = JSON.parse(fs.readFileSync(defaultPaths().databasePath, 'utf8'));
  const record = findRecord(database);
  const values = {
    freemicro: args.freemicro || shellOutput('command -v freemicro'),
    t3App: args['t3-app'] || shellOutput("mdfind \"kMDItemCFBundleIdentifier == 'com.t3tools.t3code'\""),
  };
  const manifest = buildManifest(profile, record, {
    layer: args.layer,
    profileId: args['profile-id'],
    mic: typeof args.mic === 'string' ? args.mic : '',
    values,
  });
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  if (args.output) {
    fs.writeFileSync(path.resolve(args.output), text);
    console.log(`Wrote ${args.output}. Dry-run it: node scripts/worklouder.js apply-config ${args.output}`);
  } else {
    process.stdout.write(text);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {POSITIONS, buildManifest, chordInputs};
