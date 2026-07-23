const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEVICE_TYPE = 'codex_micro';
const KEYMAP_FILE = 'keymap.json';
const SMART_ACTIONS_FILE = 'smart_actions.json';
const LIGHTING_EFFECTS = new Set(['off', 'solid', 'snake', 'rainbow', 'breath', 'gradient']);
const SMART_ACTION_TYPES = new Set(['TEXT_STEP', 'CMD_STEP', 'APP_STEP', 'URL_STEP']);
const ROW_LENGTHS = [2, 4, 4, 3];
const MAX_LAYERS = 6;
const FILE_CHUNK_BYTES = 3072;

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function defaultPaths(env = process.env) {
  const inputApp = env.INPUT_APP || '/Applications/input.app';
  const supportRoot = env.INPUT_SUPPORT_ROOT
    || path.join(os.homedir(), 'Library/Application Support/input');
  const addonPath = env.INPUT_HID_ADDON || path.join(
    inputApp,
    'Contents/Resources/app.asar.unpacked/node_modules/node-hid/prebuilds',
    process.arch === 'arm64' ? 'HID-darwin-arm64' : 'HID-darwin-x64',
    'node-napi-v4.node',
  );
  return {
    inputApp,
    supportRoot,
    databasePath: env.INPUT_DATABASE || path.join(supportRoot, 'input_storage.json'),
    addonPath,
  };
}

function deviceCollection(database) {
  const collection = database.collections?.find((item) => item.name === 'devices');
  if (!collection) throw new Error('Input database has no devices collection');
  return collection;
}

function settingsRecord(database) {
  const collection = database.collections?.find((item) => item.name === 'app_settings');
  return collection?.data?.[0];
}

function findRecord(database, options = {}) {
  const requestedPid = options.devicePid || process.env.INPUT_DEVICE_PID;
  const requestedType = options.deviceType || process.env.INPUT_DEVICE_TYPE || DEVICE_TYPE;
  const candidates = deviceCollection(database).data.filter((record) => {
    if (requestedPid && String(record.device?.devicePid) !== String(requestedPid)) return false;
    return record.device?.deviceType === requestedType;
  });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    throw new Error(`No Input device record found for type ${requestedType}`);
  }
  throw new Error(`Multiple Input device records found for type ${requestedType}; set INPUT_DEVICE_PID`);
}

function normalizeHexColor(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xFFFFFF) {
    return `#${value.toString(16).toUpperCase().padStart(6, '0')}`;
  }
  if (typeof value !== 'string') throw new Error(`Invalid color: ${value}`);
  let hex = value.trim().replace(/^#/, '');
  if (/^[0-9A-Fa-f]{3}$/.test(hex)) hex = hex.split('').map((char) => char + char).join('');
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) throw new Error(`Invalid color: ${value}`);
  return `#${hex.toUpperCase()}`;
}

function colorToNumber(value) {
  return Number.parseInt(normalizeHexColor(value).slice(1), 16);
}

function encodeDeviceKeycode(keycode) {
  if (typeof keycode !== 'string' || !/^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(keycode)) {
    throw new Error(`Invalid keycode: ${keycode}`);
  }
  if (keycode.startsWith('KA_')) return keycode.replace('KA_', 'KA_A');
  if (keycode.startsWith('KM_')) return keycode.replace('KM_', 'KA_M');
  return keycode;
}

function decodeDeviceKeycode(keycode) {
  if (keycode.startsWith('KA_A')) return keycode.replace('KA_A', 'KA_');
  if (keycode.startsWith('KA_M')) return keycode.replace('KA_M', 'KM_');
  if (keycode.startsWith('KC_FUNC')) return keycode.replace('KC_FUNC', 'KI_FP');
  return keycode;
}

function mapLayoutKeycodes(layout, transform) {
  const mapped = clone(layout);
  mapped.keymap = mapped.keymap.map((row) => row.map(transform));
  mapped.encoders = mapped.encoders.map((encoder) => encoder.map(transform));
  if (mapped.joystick?.sectors) {
    mapped.joystick.sectors = mapped.joystick.sectors.map((sector) => ({
      ...sector,
      k: transform(sector.k),
    }));
  }
  return mapped;
}

function validateLayout(layout) {
  if (!layout || !Array.isArray(layout.keymap) || layout.keymap.length !== ROW_LENGTHS.length) {
    throw new Error(`Codex Micro keymap must have ${ROW_LENGTHS.length} rows`);
  }
  layout.keymap.forEach((row, index) => {
    if (!Array.isArray(row) || row.length !== ROW_LENGTHS[index]) {
      throw new Error(`Codex Micro row ${index + 1} must have ${ROW_LENGTHS[index]} keys`);
    }
    row.forEach(encodeDeviceKeycode);
  });
  if (!Array.isArray(layout.encoders) || layout.encoders.length !== 1 || layout.encoders[0].length !== 3) {
    throw new Error('Codex Micro encoder must expose exactly three events');
  }
  layout.encoders[0].forEach(encodeDeviceKeycode);
  const joystickType = layout.joystick?.type;
  const sectors = layout.joystick?.sectors;
  if (joystickType === 'VENDOR') {
    if (!Array.isArray(sectors)) throw new Error('Vendor joystick sectors must be an array');
  } else if (joystickType === 'RADIAL') {
    if (!Array.isArray(sectors) || sectors.length < 2 || sectors.length > 8) {
      throw new Error('Codex Micro radial joystick must contain 2 to 8 sectors');
    }
    if (sectors[0]?.k !== 'KI_X') {
      throw new Error('Codex Micro radial joystick sector zero must be the fixed KI_X close action');
    }
  } else {
    throw new Error(`Unsupported joystick mode: ${joystickType}`);
  }
  sectors.forEach((sector) => {
    encodeDeviceKeycode(sector.k);
    if (![sector.a1, sector.a2].every((angle) => Number.isFinite(angle) && angle >= 0 && angle <= 1)) {
      throw new Error('Joystick sector angles must be numbers from 0 to 1');
    }
  });
}

function validateLightingConfig(config) {
  if (!config || !LIGHTING_EFFECTS.has(config.effect)) {
    throw new Error(`Invalid lighting effect: ${config?.effect}`);
  }
  for (const field of ['brightness', 'speed', 'magic']) {
    if (config[field] !== undefined
      && (!Number.isFinite(config[field]) || config[field] < 0 || config[field] > 1)) {
      throw new Error(`Lighting ${field} must be between 0 and 1`);
    }
  }
  if (config.color !== undefined) normalizeHexColor(config.color);
}

function lightingToDevice(lights) {
  if (!lights) return undefined;
  const convert = (config) => {
    validateLightingConfig(config);
    return {
      ...config,
      color: config.color === undefined ? undefined : colorToNumber(config.color),
    };
  };
  return {
    backlight: convert(lights.backlight),
    underglow: convert(lights.underglow),
  };
}

function emptyLayer(id) {
  return {
    id,
    name: `Layer ${id + 1}`,
    color: '#FF0000',
    layout: {
      keymap: ROW_LENGTHS.map((length) => Array(length).fill('KC_NONE')),
      encoders: [['KC_NONE', 'KC_NONE', 'KC_NONE']],
      joystick: {
        type: 'RADIAL',
        sectors: radialSectors(['KI_X', 'KC_NONE']),
      },
    },
    lights: {
      backlight: {
        effect: 'solid',
        brightness: 1,
        speed: 0.5,
        magic: 1,
        color: '#FFFFFF',
      },
      underglow: {
        effect: 'rainbow',
        brightness: 1,
        speed: 0.55,
        magic: 1,
        color: '#FFFFFF',
      },
    },
  };
}

function radialSectors(keycodes) {
  if (!Array.isArray(keycodes) || keycodes.length < 2 || keycodes.length > 8) {
    throw new Error('Radial joystick requires 2 to 8 keycodes');
  }
  keycodes.forEach(encodeDeviceKeycode);
  const count = keycodes.length;
  const fixedWidth = 45 / 360;
  const remaining = 1 - fixedWidth;
  const start = (90 - 45 / 2) / 360;
  const otherWidth = remaining / (count - 1);
  return keycodes.map((keycode, index) => {
    if (index === 0) {
      return {k: keycode, a1: start, a2: (start + fixedWidth) % 1};
    }
    const a1 = start + fixedWidth + otherWidth * (index - 1);
    return {k: keycode, a1: a1 % 1, a2: (a1 + otherWidth) % 1};
  });
}

function ensureLayer(profile, layerNumber) {
  if (!Number.isInteger(layerNumber) || layerNumber < 1 || layerNumber > MAX_LAYERS) {
    throw new Error(`Layer must be between 1 and ${MAX_LAYERS}`);
  }
  while (profile.layers.length < layerNumber) profile.layers.push(emptyLayer(profile.layers.length));
  return profile.layers[layerNumber - 1];
}

function requireEditableLayer(options) {
  if (options.layer === 1 && options.allowStockLayer !== true) {
    throw new Error('Layer 1 is the protected stock Codex layer; pass allowStockLayer only when explicitly authorized');
  }
}

function setKey(record, options) {
  requireEditableLayer(options);
  const profile = selectProfile(record, options.profileId);
  const layer = ensureLayer(profile, options.layer);
  const rowIndex = options.row - 1;
  const keyIndex = options.key - 1;
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= ROW_LENGTHS.length) {
    throw new Error(`Row must be between 1 and ${ROW_LENGTHS.length}`);
  }
  if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex >= ROW_LENGTHS[rowIndex]) {
    throw new Error(`Row ${options.row} key must be between 1 and ${ROW_LENGTHS[rowIndex]}`);
  }
  encodeDeviceKeycode(options.value);
  layer.layout.keymap[rowIndex][keyIndex] = options.value;
}

function setEncoder(record, options) {
  requireEditableLayer(options);
  const profile = selectProfile(record, options.profileId);
  const layer = ensureLayer(profile, options.layer);
  const eventIndex = {
    counterclockwise: 0,
    slot0: 0,
    clockwise: 1,
    slot1: 1,
    press: 2,
  }[options.event];
  if (eventIndex === undefined) {
    throw new Error('Encoder event must be counterclockwise, clockwise, press, slot0, or slot1');
  }
  encodeDeviceKeycode(options.value);
  layer.layout.encoders[0][eventIndex] = options.value;
}

function setJoystick(record, options) {
  requireEditableLayer(options);
  const profile = selectProfile(record, options.profileId);
  const layer = ensureLayer(profile, options.layer);
  const keycodes = options.keycodes[0] === 'KI_X'
    ? options.keycodes
    : ['KI_X', ...options.keycodes];
  layer.layout.joystick = {type: 'RADIAL', sectors: radialSectors(keycodes)};
}

function setLighting(record, options) {
  const profile = selectProfile(record, options.profileId);
  const targets = options.allLayers
    ? profile.layers.filter((layer, index) => index !== 0 || options.allowStockLayer === true)
    : (requireEditableLayer(options), [ensureLayer(profile, options.layer)]);
  if (!['backlight', 'underglow'].includes(options.target)) {
    throw new Error('Lighting target must be backlight or underglow');
  }
  validateLightingConfig(options.config);
  for (const layer of targets) {
    if (!layer.lights) layer.lights = emptyLayer(layer.id).lights;
    layer.lights[options.target] = {
      ...layer.lights[options.target],
      ...options.config,
      color: options.config.color === undefined
        ? layer.lights[options.target].color
        : normalizeHexColor(options.config.color),
    };
  }
}

function selectProfile(record, profileId = record.activeProfileId ?? 0) {
  const profile = record.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error(`Profile ${profileId} not found`);
  return profile;
}

function setProfile(record, options) {
  if (!Number.isInteger(options.profileId) || options.profileId < 0) {
    throw new Error('Profile id must be a non-negative integer');
  }
  let profile = record.profiles.find((candidate) => candidate.id === options.profileId);
  if (!profile) {
    if (record.profiles.length >= 6) throw new Error('Input supports at most six profiles');
    profile = {id: options.profileId, name: options.name || `Profile ${options.profileId + 1}`, layers: [emptyLayer(0)]};
    record.profiles.push(profile);
  }
  if (options.name !== undefined) {
    if (typeof options.name !== 'string'
      || !/^[A-Za-z0-9 ]{1,20}$/.test(options.name)) {
      throw new Error('Profile name must contain 1 to 20 letters, numbers, or spaces');
    }
    profile.name = options.name;
  }
}

function setActiveProfile(record, profileId) {
  selectProfile(record, profileId);
  record.activeProfileId = profileId;
}

function setLayer(record, options) {
  requireEditableLayer(options);
  const profile = selectProfile(record, options.profileId);
  const layer = ensureLayer(profile, options.layer);
  if (options.name !== undefined) {
    if (typeof options.name !== 'string' || options.name.length < 1) {
      throw new Error('Layer name must not be empty');
    }
    layer.name = options.name;
  }
  if (options.color !== undefined) layer.color = normalizeHexColor(options.color);
  if (options.os !== undefined) {
    if (![0, 1].includes(options.os)) throw new Error('Layer os must be 0 (macOS) or 1 (Windows)');
    layer.os = options.os;
  }
  if (options.linkedAppId !== undefined) {
    if (options.linkedAppId !== null && !Number.isInteger(options.linkedAppId)) {
      throw new Error('linkedAppId must be an integer or null');
    }
    layer.linkedAppId = options.linkedAppId;
  }
}

function upsertById(items, value, label) {
  if (!Number.isInteger(value.id) || value.id < 0) throw new Error(`${label} id must be a non-negative integer`);
  const index = items.findIndex((item) => item.id === value.id);
  if (index === -1) items.push(value);
  else items[index] = value;
}

function upsertAction(record, action) {
  if (typeof action.name !== 'string' || action.name.length < 1 || action.name.length > 16) {
    throw new Error('Action name must contain 1 to 16 characters');
  }
  if (!Array.isArray(action.keyInputs) || action.keyInputs.length === 0) {
    throw new Error('Action requires at least one key input');
  }
  action.keyInputs.forEach((input) => {
    encodeDeviceKeycode(input.keycode);
    if (input.keycode.startsWith('KM_')) {
      throw new Error('Input does not support invoking a Multi Action from an Action');
    }
    if (![0, 1, 2].includes(input.actionType)) throw new Error('Action type must be 0, 1, or 2');
    if (!Number.isInteger(input.delay) || input.delay < 0 || input.delay > 9999) {
      throw new Error('Action delay must be an integer from 0 to 9999 milliseconds');
    }
  });
  upsertById(record.actions, clone(action), 'Action');
}

function upsertMultiAction(record, action) {
  if (typeof action.name !== 'string' || action.name.length < 1 || action.name.length > 16) {
    throw new Error('Multi Action name must contain 1 to 16 characters');
  }
  for (const field of ['tap', 'onHold', 'doubleTap', 'tapHold']) {
    if (!action[field]?.keycode) throw new Error(`Multi Action requires ${field}.keycode`);
    encodeDeviceKeycode(action[field].keycode);
    if (action[field].keycode.startsWith('KM_')) {
      throw new Error('Input does not support nesting a Multi Action inside another Multi Action');
    }
  }
  if (!Number.isFinite(action.tappingTerms) || action.tappingTerms <= 0) {
    throw new Error('Multi Action tappingTerms must be positive');
  }
  upsertById(record.multiactions, clone(action), 'Multi Action');
}

function upsertSmartAction(record, action) {
  if (typeof action.name !== 'string' || !action.name) throw new Error('Smart Action name must not be empty');
  if (!SMART_ACTION_TYPES.has(action.type)) throw new Error(`Invalid Smart Action type: ${action.type}`);
  const requiredPayloads = {
    TEXT_STEP: ['text'],
    CMD_STEP: ['cmd'],
    APP_STEP: ['name', 'path'],
    URL_STEP: ['url'],
  }[action.type];
  for (const field of requiredPayloads) {
    if (typeof action.payload?.[field] !== 'string' || !action.payload[field]) {
      throw new Error(`${action.type} requires non-empty payload.${field}`);
    }
  }
  upsertById(record.smartActions, clone(action), 'Smart Action');
}

function upsertLinkedApp(record, linkedApp) {
  if (!Number.isInteger(linkedApp.id) || linkedApp.id < 0) {
    throw new Error('Linked app id must be a non-negative integer');
  }
  for (const field of ['name', 'process', 'path']) {
    if (typeof linkedApp[field] !== 'string' || !linkedApp[field]) {
      throw new Error(`Linked app requires ${field}`);
    }
  }
  upsertById(record.linkedApps, clone(linkedApp), 'Linked app');
}

function setCommandPermission(database, enabled) {
  if (typeof enabled !== 'boolean') throw new Error('Command permission must be true or false');
  const settings = settingsRecord(database);
  if (!settings) throw new Error('Input database has no app settings record');
  settings.smartActionCmdEnabled = enabled;
  settings.meta = {
    ...(settings.meta ?? {}),
    revision: (settings.meta?.revision ?? 0) + 1,
    updated: Date.now(),
  };
}

function collectReferences(profile, prefix) {
  const ids = new Set();
  const visit = (keycode) => {
    if (keycode.startsWith(prefix)) ids.add(Number.parseInt(keycode.slice(prefix.length), 10));
  };
  for (const layer of profile.layers) {
    layer.layout.keymap.forEach((row) => row.forEach(visit));
    layer.layout.encoders.forEach((encoder) => encoder.forEach(visit));
    layer.layout.joystick?.sectors?.forEach((sector) => visit(sector.k));
  }
  return [...ids].filter(Number.isInteger).sort((a, b) => a - b);
}

function validateReference(record, keycode, location) {
  const lookup = [
    ['KA_', record.actions, 'Action'],
    ['KM_', record.multiactions, 'Multi Action'],
    ['SA_', record.smartActions, 'Smart Action'],
  ].find(([prefix]) => keycode.startsWith(prefix));
  if (!lookup) return;
  const [prefix, items, label] = lookup;
  const id = Number.parseInt(keycode.slice(prefix.length), 10);
  if (!items.some((item) => item.id === id)) {
    throw new Error(`${location} references missing ${label} ${id}`);
  }
}

function validateReferences(record) {
  if (!Array.isArray(record.profiles) || record.profiles.length < 1 || record.profiles.length > 6) {
    throw new Error('Input requires 1 to 6 profiles');
  }
  for (const [items, label] of [
    [record.profiles, 'Profile'],
    [record.actions, 'Action'],
    [record.multiactions, 'Multi Action'],
    [record.smartActions, 'Smart Action'],
    [record.linkedApps ?? [], 'Linked app'],
  ]) {
    const ids = items.map((item) => item.id);
    if (new Set(ids).size !== ids.length) throw new Error(`${label} ids must be unique`);
  }
  for (const profile of record.profiles) {
    if (!Array.isArray(profile.layers) || profile.layers.length < 1 || profile.layers.length > MAX_LAYERS) {
      throw new Error(`Profile ${profile.id} requires 1 to ${MAX_LAYERS} layers`);
    }
    for (const layer of profile.layers) {
      if (layer.linkedAppId != null
        && !(record.linkedApps ?? []).some((linkedApp) => linkedApp.id === layer.linkedAppId)) {
        throw new Error(`Layer ${layer.id + 1} references missing linked app ${layer.linkedAppId}`);
      }
      layer.layout.keymap.forEach((row, rowIndex) => row.forEach((keycode, keyIndex) => {
        validateReference(record, keycode, `Layer ${layer.id + 1} row ${rowIndex + 1} key ${keyIndex + 1}`);
      }));
      layer.layout.encoders.forEach((encoder) => encoder.forEach((keycode) => {
        validateReference(record, keycode, `Layer ${layer.id + 1} encoder`);
      }));
      layer.layout.joystick?.sectors?.forEach((sector) => {
        validateReference(record, sector.k, `Layer ${layer.id + 1} joystick`);
      });
    }
  }
  for (const action of record.actions) {
    action.keyInputs.forEach((input) => validateReference(record, input.keycode, `Action ${action.id}`));
  }
  for (const action of record.multiactions) {
    for (const field of ['tap', 'onHold', 'doubleTap', 'tapHold']) {
      validateReference(record, action[field].keycode, `Multi Action ${action.id} ${field}`);
    }
  }
  validateActionCycles(record);
}

function validateActionCycles(record) {
  const actions = new Map(record.actions.map((action) => [action.id, action]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, chain = []) => {
    if (visiting.has(id)) throw new Error(`Action cycle detected: ${[...chain, id].join(' -> ')}`);
    if (visited.has(id)) return;
    const action = actions.get(id);
    if (!action) return;
    visiting.add(id);
    for (const input of action.keyInputs) {
      if (input.keycode.startsWith('KA_')) {
        visit(Number.parseInt(input.keycode.slice(3), 10), [...chain, id]);
      }
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of actions.keys()) visit(id);
}

function actionUsageForProfile(record, profile) {
  const actionIds = new Set(collectReferences(profile, 'KA_'));
  const multiIds = collectReferences(profile, 'KM_');
  const actionsById = new Map(record.actions.map((action) => [action.id, action]));
  const multisById = new Map(record.multiactions.map((action) => [action.id, action]));
  for (const multiId of multiIds) {
    const multi = multisById.get(multiId);
    if (!multi) continue;
    for (const field of ['tap', 'onHold', 'doubleTap', 'tapHold']) {
      const keycode = multi[field].keycode;
      if (keycode.startsWith('KA_')) actionIds.add(Number.parseInt(keycode.slice(3), 10));
    }
  }
  const queue = [...actionIds];
  while (queue.length) {
    const action = actionsById.get(queue.shift());
    if (!action) continue;
    for (const input of action.keyInputs) {
      if (!input.keycode.startsWith('KA_')) continue;
      const id = Number.parseInt(input.keycode.slice(3), 10);
      if (!actionIds.has(id)) {
        actionIds.add(id);
        queue.push(id);
      }
    }
  }
  return {
    macrosUsed: [...actionIds].sort((a, b) => a - b),
    multiActionsUsed: multiIds,
  };
}

function actionToDevice(action) {
  return {
    id: action.id,
    name: action.name,
    color: action.color == null ? null : colorToNumber(action.color),
    icon: action.icon,
    actions: action.keyInputs.map((input) => ({
      kc: encodeDeviceKeycode(input.keycode),
      delay: input.delay,
      act: input.actionType,
    })),
  };
}

function multiActionToDevice(action) {
  return {
    id: action.id,
    name: action.name,
    color: action.color == null ? null : colorToNumber(action.color),
    icon: action.icon,
    kcOnTap: encodeDeviceKeycode(action.tap.keycode),
    kcOnHold: encodeDeviceKeycode(action.onHold.keycode),
    kcOnDoubleTap: encodeDeviceKeycode(action.doubleTap.keycode),
    kcOnTapHold: encodeDeviceKeycode(action.tapHold.keycode),
    tt: action.tappingTerms,
  };
}

function keymapFromRecord(record) {
  validateReferences(record);
  const keymap = {
    version: 1,
    activeProfileId: record.activeProfileId ?? 0,
    language: record.language,
    profiles: record.profiles.map((profile) => {
      const usage = actionUsageForProfile(record, profile);
      return {
        id: profile.id,
        name: profile.name,
        layers: profile.layers.map((layer) => {
          validateLayout(layer.layout);
          return {
            id: layer.id,
            name: layer.name,
            color: colorToNumber(layer.color),
            layout: mapLayoutKeycodes(layer.layout, encodeDeviceKeycode),
            os: layer.os,
            lights: lightingToDevice(layer.lights),
            linkedAppId: layer.linkedAppId,
          };
        }),
        fpLayer: profile.fpLayer,
        macrosUsed: usage.macrosUsed,
        multiActionsUsed: usage.multiActionsUsed,
      };
    }),
    multiActions: record.multiactions.map(multiActionToDevice),
    macros: record.actions.map(actionToDevice),
    macrosGroups: clone(record.actionGroups ?? []),
    multiActionsGroups: clone(record.multiactionGroups ?? []),
    deviceSpecificConfig: record.deviceSpecificConfig,
    linkedApps: clone(record.linkedApps ?? []),
  };
  return JSON.parse(JSON.stringify(keymap));
}

function smartActionsFromRecord(record) {
  return {
    version: 1,
    smartActions: Object.fromEntries(record.smartActions.map((action) => [
      `SA_${action.id}`,
      {
        name: action.name,
        icon: action.icon,
        color: action.color ?? undefined,
        type: action.type,
        payload: action.payload,
      },
    ])),
    smartActionGroups: clone(record.smartActionGroups ?? []),
  };
}

function referenceReport(record) {
  const referenced = {
    actions: new Set(),
    multiActions: new Set(),
    smartActions: new Set(),
    linkedApps: new Set(),
  };
  const missing = [];
  const definitions = {
    actions: new Set(record.actions.map((item) => item.id)),
    multiActions: new Set(record.multiactions.map((item) => item.id)),
    smartActions: new Set(record.smartActions.map((item) => item.id)),
    linkedApps: new Set((record.linkedApps ?? []).map((item) => item.id)),
  };
  const visit = (keycode, location) => {
    const match = [
      ['KA_', 'actions'],
      ['KM_', 'multiActions'],
      ['SA_', 'smartActions'],
    ].find(([prefix]) => keycode.startsWith(prefix));
    if (!match) return;
    const [prefix, kind] = match;
    const id = Number.parseInt(keycode.slice(prefix.length), 10);
    referenced[kind].add(id);
    if (!definitions[kind].has(id)) missing.push({kind, id, location});
  };
  for (const profile of record.profiles) {
    for (const layer of profile.layers) {
      collectKeycodesFromLayout(layer.layout).forEach((keycode) =>
        visit(keycode, `profile ${profile.id} layer ${layer.id}`));
      if (layer.linkedAppId != null) {
        referenced.linkedApps.add(layer.linkedAppId);
        if (!definitions.linkedApps.has(layer.linkedAppId)) {
          missing.push({kind: 'linkedApps', id: layer.linkedAppId, location: `profile ${profile.id} layer ${layer.id}`});
        }
      }
    }
  }
  for (const action of record.actions) {
    action.keyInputs.forEach((input) => visit(input.keycode, `action ${action.id}`));
  }
  for (const action of record.multiactions) {
    for (const field of ['tap', 'onHold', 'doubleTap', 'tapHold']) {
      visit(action[field].keycode, `multi action ${action.id} ${field}`);
    }
  }
  const unreachable = Object.fromEntries(Object.entries(definitions).map(([kind, ids]) => [
    kind,
    [...ids].filter((id) => !referenced[kind].has(id)).sort((a, b) => a - b),
  ]));
  return {missing, unreachable};
}

function collectKeycodesFromLayout(layout) {
  return [
    ...layout.keymap.flat(),
    ...layout.encoders.flat(),
    ...(layout.joystick?.sectors ?? []).map((sector) => sector.k),
  ];
}

function summarize(record, database, options = {}) {
  return {
    device: clone(record.device),
    activeProfileId: record.activeProfileId,
    commandActionsEnabled: Boolean(settingsRecord(database)?.smartActionCmdEnabled),
    profiles: record.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      layers: profile.layers.map((layer, index) => ({
        number: index + 1,
        id: layer.id,
        name: layer.name,
        color: layer.color,
        keys: layer.layout.keymap,
        encoder: layer.layout.encoders[0],
        joystick: layer.layout.joystick,
        lights: layer.lights,
      })),
    })),
    actions: clone(record.actions),
    multiActions: clone(record.multiactions),
    smartActions: record.smartActions.map((action) => ({
      id: action.id,
      name: action.name,
      color: action.color,
      type: action.type,
      payload: options.showPayloads ? clone(action.payload) : '<redacted>',
    })),
    references: referenceReport(record),
  };
}

function updateMetadata(record) {
  record.meta = {
    ...(record.meta ?? {}),
    revision: (record.meta?.revision ?? 0) + 1,
    updated: Date.now(),
  };
}

function checksumJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function escapeUnicode(value) {
  return value.replace(/[^\x00-\x7F]/gu, (character) => {
    const codepoint = character.codePointAt(0);
    if (codepoint > 0xFFFF) {
      const shifted = codepoint - 0x10000;
      const high = (shifted >> 10) | 0xD800;
      const low = (shifted & 0x3FF) | 0xDC00;
      return `\\u${high.toString(16).padStart(4, '0')}\\u${low.toString(16).padStart(4, '0')}`;
    }
    return `\\u${codepoint.toString(16).padStart(4, '0')}`;
  });
}

function serializeDeviceJson(value) {
  return escapeUnicode(JSON.stringify(value));
}

function cachePaths(paths, record) {
  const root = path.join(paths.supportRoot, 'devices', String(record.device.devicePid));
  return {
    root,
    keymap: path.join(root, KEYMAP_FILE),
    smartActions: path.join(root, SMART_ACTIONS_FILE),
  };
}

function createBackup(paths, record, deviceFiles = {}, backupRoot) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const root = backupRoot || path.join(
    os.homedir(),
    'Library/Application Support/worklouder-macropad/backups',
    timestamp,
  );
  const caches = cachePaths(paths, record);
  fs.mkdirSync(root, {recursive: true, mode: 0o700});
  fs.chmodSync(root, 0o700);
  copyPrivate(paths.databasePath, path.join(root, 'input_storage.json'));
  if (fs.existsSync(caches.keymap)) copyPrivate(caches.keymap, path.join(root, 'cache-keymap.json'));
  if (fs.existsSync(caches.smartActions)) {
    copyPrivate(caches.smartActions, path.join(root, 'cache-smart_actions.json'));
  }
  for (const [name, text] of Object.entries(deviceFiles)) {
    fs.writeFileSync(path.join(root, `device-${name}`), text, {mode: 0o600});
  }
  return root;
}

function copyPrivate(source, destination) {
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o600);
}

function atomicWriteFile(destination, value) {
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, value, {mode: 0o600});
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function loadAddon(paths) {
  if (!fs.existsSync(paths.addonPath)) throw new Error(`Input HID addon not found: ${paths.addonPath}`);
  return require(paths.addonPath);
}

function findHidDevice(addon, record) {
  const productId = Number(record.device?.devicePid);
  const candidates = addon.devices().filter((device) =>
    device.usagePage === 1
    && device.usage === 6
    && Number(device.productId) === productId);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    throw new Error(`Connected HID device not found for Input product ID ${record.device?.devicePid}`);
  }
  throw new Error(`Multiple HID devices found for Input product ID ${record.device?.devicePid}`);
}

async function openRpc(paths, record) {
  const addon = loadAddon(paths);
  const hidInfo = findHidDevice(addon, record);
  const device = await addon.openAsyncHIDDevice(hidInfo.path, {nonExclusive: true});
  const pending = new Map();
  let inbound = '';
  let nextId = 9000;

  device.readStart((error, data) => {
    if (error) {
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
      return;
    }
    if (!data || data[1] !== 2 || !data[2]) return;
    inbound += Buffer.from(data.slice(3, 3 + data[2])).toString('utf8');
    let newline;
    while ((newline = inbound.indexOf('\n')) >= 0) {
      const line = inbound.slice(0, newline);
      inbound = inbound.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (parseError) {
        for (const waiter of pending.values()) {
          waiter.reject(new Error(`Malformed Input HID response: ${parseError.message}`));
        }
        pending.clear();
        continue;
      }
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result);
    }
  });

  const rpc = (method, params) => new Promise(async (resolve, reject) => {
    const id = nextId++;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 10000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    try {
      const bytes = Buffer.from(`${JSON.stringify({method, params: params ?? null, id})}\n`);
      for (let offset = 0; offset < bytes.length; offset += 61) {
        const chunk = bytes.slice(offset, offset + 61);
        const packet = Buffer.alloc(64);
        packet[0] = 6;
        packet[1] = 2;
        packet[2] = chunk.length;
        chunk.copy(packet, 3);
        await device.write(packet);
      }
    } catch (error) {
      clearTimeout(timeout);
      pending.delete(id);
      reject(error);
    }
  });

  return {
    hidInfo,
    rpc,
    close: async () => {
      try {
        device.readStop();
      } catch {}
      await device.close();
    },
  };
}

async function readDeviceFile(rpc, file) {
  let offset = 0;
  let totalSize;
  const chunks = [];
  do {
    const result = await rpc('fs.readbin', {file, offset, len: FILE_CHUNK_BYTES});
    const chunk = Buffer.from(result.data, 'base64');
    chunks.push(chunk);
    offset += chunk.length;
    totalSize = Number(result.total_size);
    if (chunk.length === 0 && offset < totalSize) {
      throw new Error(`${file} read stalled at byte ${offset} of ${totalSize}`);
    }
  } while (offset < totalSize);
  return Buffer.concat(chunks).toString('utf8');
}

async function writeDeviceText(rpc, file, text) {
  const bytes = Buffer.from(text);
  if (bytes.length === 0) throw new Error(`Refusing to write empty ${file}`);
  for (let offset = 0; offset < bytes.length; offset += FILE_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + FILE_CHUNK_BYTES);
    const completed = offset + chunk.length >= bytes.length;
    const result = await rpc('fs.writebin', {
      file,
      data: chunk.toString('base64'),
      append: true,
      completed,
      offset,
    });
    if (result?.data_written !== undefined && Number(result.data_written) !== chunk.length) {
      throw new Error(`${file} short write at byte ${offset}`);
    }
  }
  const readbackText = await readDeviceFile(rpc, file);
  if (readbackText !== text) {
    throw new Error(`${file} readback mismatch`);
  }
  const files = await rpc('fs.list', {checksum: true});
  const checksum = files.find((entry) => entry.name === file)?.checksum;
  if (!checksum) throw new Error(`Device did not return a checksum for ${file}`);
  const localChecksum = sha1(Buffer.from(text));
  if (checksum !== localChecksum) {
    throw new Error(`${file} checksum mismatch: device ${checksum}, local ${localChecksum}`);
  }
  return {text: readbackText, checksum};
}

async function writeDeviceFile(rpc, file, value) {
  const text = serializeDeviceJson(value);
  JSON.parse(text);
  return writeDeviceText(rpc, file, text);
}

function updateCacheAndDatabase(paths, database, record, files) {
  const caches = cachePaths(paths, record);
  fs.mkdirSync(caches.root, {recursive: true});
  for (const [fileName, result] of Object.entries(files)) {
    const destination = fileName === KEYMAP_FILE ? caches.keymap : caches.smartActions;
    atomicWriteFile(destination, result.text);
    const cachedFile = record.files.find((item) => item.fileName === fileName);
    if (cachedFile) cachedFile.checksum = result.checksum;
    else record.files.push({fileName, checksum: result.checksum});
  }
  updateMetadata(record);
  atomicWriteFile(paths.databasePath, JSON.stringify(database));
}

module.exports = {
  DEVICE_TYPE,
  FILE_CHUNK_BYTES,
  KEYMAP_FILE,
  LIGHTING_EFFECTS,
  MAX_LAYERS,
  ROW_LENGTHS,
  SMART_ACTIONS_FILE,
  atomicWriteFile,
  cachePaths,
  checksumJson,
  clone,
  colorToNumber,
  createBackup,
  decodeDeviceKeycode,
  defaultPaths,
  emptyLayer,
  encodeDeviceKeycode,
  ensureLayer,
  findRecord,
  keymapFromRecord,
  normalizeHexColor,
  openRpc,
  radialSectors,
  readDeviceFile,
  referenceReport,
  selectProfile,
  setEncoder,
  setActiveProfile,
  setCommandPermission,
  setJoystick,
  setKey,
  setLayer,
  setLighting,
  setProfile,
  serializeDeviceJson,
  sha1,
  smartActionsFromRecord,
  summarize,
  updateCacheAndDatabase,
  upsertAction,
  upsertLinkedApp,
  upsertMultiAction,
  upsertSmartAction,
  validateLightingConfig,
  validateReferences,
  writeDeviceFile,
  writeDeviceText,
};
