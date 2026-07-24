#!/usr/bin/env node

const fs = require('node:fs');
const {
  KEYMAP_FILE,
  SMART_ACTIONS_FILE,
  atomicWriteFile,
  checksumJson,
  clone,
  createBackup,
  defaultPaths,
  findRecord,
  keymapFromRecord,
  openRpc,
  readDeviceFile,
  setActiveProfile,
  setCommandPermission,
  setEncoder,
  setJoystick,
  setKey,
  setLayer,
  setLighting,
  setProfile,
  smartActionsFromRecord,
  summarize,
  updateCacheAndDatabase,
  upsertAction,
  upsertLinkedApp,
  upsertMultiAction,
  upsertSmartAction,
  writeDeviceFile,
  writeDeviceText,
} = require('./lib/input-device');

const HELP = `Usage:
  node scripts/worklouder.js inspect [--live] [--show-payloads]
  node scripts/worklouder.js set-key --layer N --row N --key N --value KEYCODE [--apply]
  node scripts/worklouder.js set-encoder --layer N --event counterclockwise|clockwise|press --value KEYCODE [--apply]
  node scripts/worklouder.js set-joystick --layer N --sectors KEYCODE,KEYCODE,... [--apply]
  node scripts/worklouder.js set-lighting --layer N --target backlight|underglow --effect EFFECT [options] [--apply]
  node scripts/worklouder.js apply-config path/to/config.json [--apply]

Mutation is a dry run unless --apply is present. Quit Input before --live or --apply.
Enabling CMD_STEP requires --allow-command-execution. Changing stock Layer 1 requires
both an operation-level allowStockLayer and --allow-stock-layer.`;

function parseArgs(argv) {
  const args = {_: []};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      args._.push(value);
      continue;
    }
    const name = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[name] = true;
    else {
      args[name] = next;
      index += 1;
    }
  }
  return args;
}

function numberArg(args, name, fallback) {
  if (args[name] === undefined) return fallback;
  const value = Number(args[name]);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
  return value;
}

function boolArg(args, name) {
  return args[name] === true || args[name] === 'true';
}

function collectKeycodes(layout) {
  return [
    ...layout.keymap.flat(),
    ...layout.encoders.flat(),
    ...(layout.joystick?.sectors ?? []).map((sector) => sector.k),
  ];
}

function stockLayerSnapshot(record) {
  const actions = new Map(record.actions.map((item) => [item.id, item]));
  const multis = new Map(record.multiactions.map((item) => [item.id, item]));
  const smart = new Map(record.smartActions.map((item) => [item.id, item]));
  return record.profiles.map((profile) => {
    const layer = profile.layers[0];
    const usedActions = new Set();
    const usedMultis = new Set();
    const usedSmart = new Set();
    const visit = (keycode) => {
      if (keycode.startsWith('SA_')) {
        usedSmart.add(Number.parseInt(keycode.slice(3), 10));
        return;
      }
      if (keycode.startsWith('KA_')) {
        const id = Number.parseInt(keycode.slice(3), 10);
        if (usedActions.has(id)) return;
        usedActions.add(id);
        actions.get(id)?.keyInputs.forEach((input) => visit(input.keycode));
        return;
      }
      if (keycode.startsWith('KM_')) {
        const id = Number.parseInt(keycode.slice(3), 10);
        if (usedMultis.has(id)) return;
        usedMultis.add(id);
        const multi = multis.get(id);
        if (multi) {
          for (const field of ['tap', 'onHold', 'doubleTap', 'tapHold']) visit(multi[field].keycode);
        }
      }
    };
    collectKeycodes(layer.layout).forEach(visit);
    return {
      profileId: profile.id,
      layer,
      actions: [...usedActions].sort().map((id) => actions.get(id)),
      multiActions: [...usedMultis].sort().map((id) => multis.get(id)),
      smartActions: [...usedSmart].sort().map((id) => smart.get(id)),
      linkedApp: layer.linkedAppId == null
        ? null
        : record.linkedApps.find((item) => item.id === layer.linkedAppId),
    };
  });
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function operationTouchesKeymap(operation) {
  return !['upsert-smart-action', 'set-command-permission'].includes(operation.type);
}

function redactOperations(operations, showPayloads = false) {
  if (showPayloads) return operations;
  return operations.map((operation) => {
    if (operation.type !== 'upsert-smart-action') return operation;
    return {
      ...operation,
      action: {
        ...operation.action,
        payload: '<redacted>',
      },
    };
  });
}

function acquireLock(supportRoot) {
  const lockPath = `${supportRoot}/.worklouder-macropad.lock`;
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Another configurator may be running; remove stale lock only after checking: ${lockPath}`);
    }
    throw error;
  }
  fs.writeFileSync(descriptor, `${process.pid}\n`);
  return () => {
    fs.closeSync(descriptor);
    try {
      fs.unlinkSync(lockPath);
    } catch {}
  };
}

function loadState() {
  const paths = defaultPaths();
  const database = JSON.parse(fs.readFileSync(paths.databasePath, 'utf8'));
  const record = findRecord(database);
  return {paths, database, record};
}

function applyOperation(database, record, operation) {
  switch (operation.type) {
    case 'set-profile':
      setProfile(record, operation);
      break;
    case 'set-active-profile':
      setActiveProfile(record, operation.profileId);
      break;
    case 'set-layer':
      setLayer(record, operation);
      break;
    case 'set-key':
      setKey(record, operation);
      break;
    case 'set-encoder':
      setEncoder(record, operation);
      break;
    case 'set-joystick':
      setJoystick(record, operation);
      break;
    case 'set-lighting':
      setLighting(record, operation);
      break;
    case 'upsert-action':
      upsertAction(record, operation.action);
      break;
    case 'upsert-multi-action':
      upsertMultiAction(record, operation.action);
      break;
    case 'upsert-smart-action':
      upsertSmartAction(record, operation.action);
      break;
    case 'upsert-linked-app':
      upsertLinkedApp(record, operation.linkedApp);
      break;
    case 'set-command-permission':
      setCommandPermission(database, operation.enabled);
      break;
    default:
      throw new Error(`Unsupported operation type: ${operation.type}`);
  }
}

function operationFromArgs(command, args) {
  const common = {
    profileId: numberArg(args, 'profile', undefined),
    layer: numberArg(args, 'layer', undefined),
    allowStockLayer: boolArg(args, 'allow-stock-layer'),
  };
  if (command === 'set-key') {
    return {
      type: command,
      ...common,
      row: numberArg(args, 'row'),
      key: numberArg(args, 'key'),
      value: args.value,
    };
  }
  if (command === 'set-encoder') {
    return {type: command, ...common, event: args.event, value: args.value};
  }
  if (command === 'set-joystick') {
    return {type: command, ...common, keycodes: String(args.sectors || '').split(',').filter(Boolean)};
  }
  if (command === 'set-lighting') {
    const config = {effect: args.effect};
    for (const field of ['brightness', 'speed', 'magic']) {
      if (args[field] !== undefined) config[field] = numberArg(args, field);
    }
    if (args.color !== undefined) config.color = args.color;
    return {
      type: command,
      ...common,
      target: args.target,
      allLayers: boolArg(args, 'all-layers'),
      config,
    };
  }
  throw new Error(`Unknown command: ${command}`);
}

function planOutput(before, after, operations) {
  const keymapTouched = operations.some(operationTouchesKeymap);
  const beforeKeymap = keymapTouched ? keymapFromRecord(before.record) : null;
  const afterKeymap = keymapTouched ? keymapFromRecord(after.record) : null;
  const beforeSmartActions = smartActionsFromRecord(before.record);
  const afterSmartActions = smartActionsFromRecord(after.record);
  return {
    mode: 'dry-run',
    operations,
    changes: {
      keymap: keymapTouched && checksumJson(beforeKeymap) !== checksumJson(afterKeymap),
      smartActions: checksumJson(beforeSmartActions) !== checksumJson(afterSmartActions),
      inputSettings: checksumJson(before.database) !== checksumJson(after.database)
        && checksumJson(before.record) === checksumJson(after.record),
    },
    protectedLayer1Preserved: sameJson(
      stockLayerSnapshot(before.record),
      stockLayerSnapshot(after.record),
    ),
    before: {
      keymapHash: keymapTouched ? checksumJson(beforeKeymap) : '<preserved>',
      smartActionsHash: checksumJson(beforeSmartActions),
    },
    after: {
      keymapHash: keymapTouched ? checksumJson(afterKeymap) : '<preserved>',
      keymapBytes: keymapTouched ? Buffer.byteLength(JSON.stringify(afterKeymap)) : null,
      smartActionsHash: checksumJson(afterSmartActions),
      smartActionsBytes: Buffer.byteLength(JSON.stringify(afterSmartActions)),
    },
  };
}

async function applyState(state, operations) {
  const releaseLock = acquireLock(state.paths.supportRoot);
  let rpc;
  try {
    try {
      rpc = await openRpc(state.paths, state.record);
    } catch (error) {
      throw new Error(`Could not open the Codex Micro. Quit Input, reconnect the device, and retry. ${error.message}`);
    }
    const initialList = await rpc.rpc('fs.list', {checksum: true});
    const oldKeymap = await readDeviceFile(rpc.rpc, KEYMAP_FILE);
    const oldSmartActions = await readDeviceFile(rpc.rpc, SMART_ACTIONS_FILE);
    const backupPath = createBackup(
      state.paths,
      state.record,
      {[KEYMAP_FILE]: oldKeymap, [SMART_ACTIONS_FILE]: oldSmartActions},
      process.env.WORKLOUDER_BACKUP_DIR,
    );
    const beforeWriteList = await rpc.rpc('fs.list', {checksum: true});
    for (const file of [KEYMAP_FILE, SMART_ACTIONS_FILE]) {
      const initial = initialList.find((item) => item.name === file)?.checksum;
      const current = beforeWriteList.find((item) => item.name === file)?.checksum;
      if (initial !== current) {
        throw new Error(`${file} changed while preparing the write; no changes were applied`);
      }
    }

    const desired = {
      [SMART_ACTIONS_FILE]: operations.some((operation) => operation.type === 'upsert-smart-action')
        ? smartActionsFromRecord(state.record)
        : JSON.parse(oldSmartActions),
      [KEYMAP_FILE]: operations.some(operationTouchesKeymap)
        ? keymapFromRecord(state.record)
        : JSON.parse(oldKeymap),
    };
    const originals = {
      [KEYMAP_FILE]: oldKeymap,
      [SMART_ACTIONS_FILE]: oldSmartActions,
    };
    const files = {};
    const written = [];
    const rollbackDevice = async () => {
      const rollbackErrors = [];
      for (const file of [...written].reverse()) {
        try {
          await writeDeviceText(rpc.rpc, file, originals[file]);
        } catch (rollbackError) {
          rollbackErrors.push(`${file}: ${rollbackError.message}`);
        }
      }
      return rollbackErrors;
    };
    try {
      for (const file of [SMART_ACTIONS_FILE, KEYMAP_FILE]) {
        const oldValue = JSON.parse(originals[file]);
        if (sameJson(oldValue, desired[file])) continue;
        files[file] = await writeDeviceFile(rpc.rpc, file, desired[file]);
        written.push(file);
      }
    } catch (writeError) {
      const rollbackErrors = await rollbackDevice();
      if (rollbackErrors.length) {
        throw new Error(`${writeError.message}; rollback also failed: ${rollbackErrors.join('; ')}`);
      }
      throw new Error(`${writeError.message}; device files were restored from the verified backup`);
    }
    try {
      updateCacheAndDatabase(state.paths, state.database, state.record, files);
    } catch (localError) {
      const rollbackErrors = await rollbackDevice();
      try {
        restoreLocalBackup(state.paths, state.record, backupPath);
      } catch (restoreError) {
        rollbackErrors.push(`Input cache/database: ${restoreError.message}`);
      }
      if (rollbackErrors.length) {
        throw new Error(`${localError.message}; recovery also failed: ${rollbackErrors.join('; ')}`);
      }
      throw new Error(`${localError.message}; device and Input state were restored from backup`);
    }
    return {
      mode: 'applied',
      backupPath,
      hidPath: rpc.hidInfo.path,
      changedFiles: Object.keys(files),
      files: Object.fromEntries(Object.entries(files).map(([name, result]) => [
        name,
        {bytes: Buffer.byteLength(result.text), checksum: result.checksum, readbackVerified: true},
      ])),
      nextStep: 'Relaunch Input, select the configured layer, and physically verify each changed control.',
    };
  } finally {
    if (rpc) await rpc.close();
    releaseLock();
  }
}

function restoreLocalBackup(paths, record, backupPath) {
  const deviceRoot = `${paths.supportRoot}/devices/${record.device.devicePid}`;
  const restores = [
    ['input_storage.json', paths.databasePath],
    ['cache-keymap.json', `${deviceRoot}/${KEYMAP_FILE}`],
    ['cache-smart_actions.json', `${deviceRoot}/${SMART_ACTIONS_FILE}`],
  ];
  for (const [backupName, destination] of restores) {
    const source = `${backupPath}/${backupName}`;
    if (fs.existsSync(source)) atomicWriteFile(destination, fs.readFileSync(source));
  }
}

async function inspectDevice(state) {
  const rpc = await openRpc(state.paths, state.record);
  try {
    const status = await rpc.rpc('device.status');
    const files = await rpc.rpc('fs.list', {checksum: true});
    return {
      ...summarize(state.record, state.database),
      live: {
        status,
        hidPath: rpc.hidInfo.path,
        files,
      },
    };
  } finally {
    await rpc.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(HELP);
    return;
  }
  const command = args._[0] || 'inspect';
  const state = loadState();

  if (command === 'inspect') {
    const output = args.live
      ? await inspectDevice(state)
      : summarize(state.record, state.database, {showPayloads: boolArg(args, 'show-payloads')});
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const before = {
    database: clone(state.database),
    record: findRecord(clone(state.database)),
  };
  let operations;
  if (command === 'apply-config') {
    const configPath = args._[1];
    if (!configPath) throw new Error('apply-config requires a JSON file path');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.version !== 1 || !Array.isArray(config.operations)) {
      throw new Error('Config requires version: 1 and an operations array');
    }
    operations = config.operations;
  } else {
    operations = [operationFromArgs(command, args)];
  }

  if (operations.some((operation) =>
    operation.type === 'set-command-permission' && operation.enabled === true)
    && !boolArg(args, 'allow-command-execution')) {
    throw new Error('Enabling command execution requires --allow-command-execution');
  }
  for (const operation of operations) applyOperation(state.database, state.record, operation);
  const stockChanged = !sameJson(stockLayerSnapshot(before.record), stockLayerSnapshot(state.record));
  if (stockChanged && !boolArg(args, 'allow-stock-layer')) {
    throw new Error('The change affects stock Layer 1 behavior; pass --allow-stock-layer only when explicitly authorized');
  }

  if (!args.apply) {
    console.log(JSON.stringify(
      planOutput(before, state, redactOperations(operations, boolArg(args, 'show-payloads'))),
      null,
      2,
    ));
    return;
  }
  const result = await applyState(state, operations);
  console.log(JSON.stringify({
    ...result,
    operations: redactOperations(operations, boolArg(args, 'show-payloads')),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
