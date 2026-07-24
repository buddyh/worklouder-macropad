#!/usr/bin/env node

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

function appleScriptQuote(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function nextIdAllocator(items) {
  let next = Math.max(-1, ...items.map((item) => item.id)) + 1;
  const byName = new Map(items.map((item) => [item.name, item.id]));
  return (name) => {
    if (byName.has(name)) return byName.get(name);
    const id = next;
    next += 1;
    byName.set(name, id);
    return id;
  };
}

function keyInput(keycode, delay = 0, actionType = 2) {
  return {keycode, delay, actionType};
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const layer = Number(args.layer || 4);
  const profileId = Number(args.profile || 0);
  const mode = args.mode || 'hud';
  if (!Number.isInteger(layer) || layer < 2 || layer > 6) {
    throw new Error('--layer must be an integer from 2 to 6');
  }
  if (!['hud', 'notification', 'alert'].includes(mode)) {
    throw new Error('--mode must be hud, notification, or alert');
  }

  const paths = defaultPaths();
  const database = JSON.parse(fs.readFileSync(paths.databasePath, 'utf8'));
  const record = findRecord(database);
  const profile = record.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error(`Profile ${profileId} does not exist`);
  const targetLayer = profile.layers[layer - 1];
  if (targetLayer && !args['overwrite-layer']) {
    const assigned = [
      ...targetLayer.layout.keymap.flat(),
      ...targetLayer.layout.encoders.flat(),
      ...(targetLayer.layout.joystick?.sectors ?? []).slice(1).map((sector) => sector.k),
    ].some((keycode) => keycode !== 'KC_NONE');
    if (assigned) {
      throw new Error(
        `Layer ${layer} contains assigned controls. Re-run with --overwrite-layer only after review.`,
      );
    }
  }
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

  const hudPath = path.resolve(args.hud || path.join(
    os.homedir(),
    'Library/Application Support/worklouder-macropad/bin/worklouder-hud',
  ));
  if (mode === 'hud' && !fs.existsSync(hudPath)) {
    throw new Error(`HUD binary not found: ${hudPath}. Run node scripts/build-hud.js first.`);
  }

  const nextSmartId = nextIdAllocator(record.smartActions);
  const nextActionId = nextIdAllocator(record.actions);
  const nextMultiId = nextIdAllocator(record.multiactions);
  const operations = [];
  const smartByName = new Map();

  const feedbackCommand = (title, detail) => {
    if (mode === 'hud') {
      return [
        shellQuote(hudPath),
        shellQuote(title),
        '--detail',
        shellQuote(detail),
        '--duration',
        '0.8',
      ].join(' ');
    }
    if (mode === 'alert') {
      const script = `display alert "${appleScriptQuote(title)}" message `
        + `"${appleScriptQuote(detail)}" as informational giving up after 1`;
      return `/usr/bin/osascript -e ${shellQuote(script)}`;
    }
    const script = `display notification "${appleScriptQuote(detail)}" with title `
      + `"Work Louder Diagnostic" subtitle "${appleScriptQuote(title)}"`;
    return `/usr/bin/osascript -e ${shellQuote(script)}`;
  };

  const smart = (name, title, detail, type = 'CMD_STEP', payload) => {
    if (smartByName.has(name)) return smartByName.get(name);
    const id = nextSmartId(name);
    operations.push({
      type: 'upsert-smart-action',
      action: {
        id,
        name,
        color: '#33CC99',
        icon: null,
        type,
        payload: payload ?? {cmd: feedbackCommand(title, detail)},
      },
    });
    const keycode = `SA_${id}`;
    smartByName.set(name, keycode);
    return keycode;
  };

  const action = (name, keyInputs) => {
    const id = nextActionId(name);
    operations.push({
      type: 'upsert-action',
      action: {id, name, color: '#3399FF', icon: null, keyInputs},
    });
    return `KA_${id}`;
  };

  operations.push({
    type: 'set-layer',
    profileId,
    layer,
    name: 'Diagnostics',
    color: '#00CC88',
    os: 0,
    linkedAppId: null,
  });
  if (!commandEnabled && args['include-command-permission']) {
    operations.push({type: 'set-command-permission', enabled: true});
  }

  const base = action('Diag Base', [
    keyInput('KC_A'),
    keyInput('KC_B', 150),
    keyInput('KC_C', 150),
  ]);
  const sequence = action('Diag Seq', [
    keyInput(base),
    keyInput(smart('Diag R1K2', 'Row 1 · Key 2', 'Action sequence typed abc'), 100),
  ]);
  const chord = action('Diag Chord', [
    keyInput('KC_LSFT', 0, 1),
    keyInput('KC_A'),
    keyInput('KC_LSFT', 0, 0),
    keyInput(smart('Diag R2K1', 'Row 2 · Key 1', 'Press/click/release produced uppercase A'), 100),
  ]);
  const nested = action('Diag Nested', [
    keyInput(sequence),
    keyInput(smart('Diag R2K2', 'Row 2 · Key 2', 'Nested Action completed'), 300),
  ]);
  const delayed = action('Diag Delay', [
    keyInput(smart('Diag Delay 1', 'Row 2 · Key 3', 'Delay started')),
    keyInput(smart('Diag Delay 2', 'Row 2 · Key 3', 'One-second delayed step completed'), 1000),
  ]);

  const multiId = nextMultiId('Diag Gestures');
  operations.push({
    type: 'upsert-multi-action',
    action: {
      id: multiId,
      name: 'Diag Gestures',
      color: '#CC66FF',
      icon: null,
      tap: {keycode: smart('Diag Tap', 'Row 2 · Key 4', 'Tap')},
      doubleTap: {keycode: smart('Diag Double', 'Row 2 · Key 4', 'Double tap')},
      onHold: {keycode: smart('Diag Hold', 'Row 2 · Key 4', 'Hold')},
      tapHold: {keycode: smart('Diag TapHold', 'Row 2 · Key 4', 'Tap then hold')},
      tappingTerms: 250,
    },
  });

  const textStep = smart(
    'Diag Text Step',
    'Row 3 · Key 1',
    'TEXT_STEP',
    'TEXT_STEP',
    {text: 'TEXT_STEP_OK'},
  );
  const textAction = action('Diag Text', [
    keyInput(textStep),
    keyInput(smart('Diag R3K1', 'Row 3 · Key 1', 'TEXT_STEP inserted text'), 100),
  ]);
  const url = smart(
    'Diag URL Step',
    'Row 3 · Key 2',
    'URL_STEP',
    'URL_STEP',
    {url: 'https://example.com'},
  );
  const urlAction = action('Diag URL', [
    keyInput(smart('Diag R3K2', 'Row 3 · Key 2', 'Opening example.com')),
    keyInput(url, 150),
  ]);
  const app = smart(
    'Diag App Step',
    'Row 3 · Key 3',
    'APP_STEP',
    'APP_STEP',
    {name: 'TextEdit', path: '/System/Applications/TextEdit.app'},
  );
  const appAction = action('Diag App', [
    keyInput(smart('Diag R3K3', 'Row 3 · Key 3', 'Opening TextEdit')),
    keyInput(app, 150),
  ]);
  const actionSmart = action('Diag Smart', [
    keyInput(smart('Diag R3K4', 'Row 3 · Key 4', 'Action invoked a Smart Action')),
  ]);
  const returnLayer = Math.max(1, layer - 1);

  const keymap = [
    [
      smart('Diag R1K1', 'Row 1 · Key 1', 'Direct Smart Action'),
      sequence,
    ],
    [
      chord,
      nested,
      delayed,
      `KM_${multiId}`,
    ],
    [
      textAction,
      urlAction,
      appAction,
      actionSmart,
    ],
    [
      smart('Diag R4K1', 'Row 4 · Key 1', 'Direct CMD_STEP'),
      smart('Diag R4K2', 'Row 4 · Key 2', 'Second direct Smart Action'),
      `KI_LS${returnLayer}`,
    ],
  ];
  keymap.forEach((row, rowIndex) => row.forEach((value, keyIndex) => {
    operations.push({
      type: 'set-key',
      profileId,
      layer,
      row: rowIndex + 1,
      key: keyIndex + 1,
      value,
    });
  }));

  for (const [event, name, title, detail] of [
    ['counterclockwise', 'Diag Enc CCW', 'Encoder · Counter-clockwise', 'Encoder slot 0'],
    ['clockwise', 'Diag Enc CW', 'Encoder · Clockwise', 'Encoder slot 1'],
    ['press', 'Diag Enc Press', 'Encoder · Press', 'Encoder slot 2'],
  ]) {
    operations.push({
      type: 'set-encoder',
      profileId,
      layer,
      event,
      value: smart(name, title, detail),
    });
  }

  operations.push({
    type: 'set-joystick',
    profileId,
    layer,
    keycodes: [
      smart('Diag Joy 1', 'Joystick · Sector 1', 'Radial selection'),
      smart('Diag Joy 2', 'Joystick · Sector 2', 'Radial selection'),
      smart('Diag Joy 3', 'Joystick · Sector 3', 'Radial selection'),
      smart('Diag Joy 4', 'Joystick · Sector 4', 'Radial selection'),
    ],
  });
  operations.push({
    type: 'set-lighting',
    profileId,
    layer,
    target: 'backlight',
    config: {
      effect: 'solid',
      brightness: 1,
      speed: 0.5,
      magic: 0.5,
      color: '#00CC88',
    },
  });
  operations.push({
    type: 'set-lighting',
    profileId,
    layer,
    target: 'underglow',
    config: {
      effect: 'snake',
      brightness: 1,
      speed: 0.5,
      magic: 0.5,
      color: '#00FFFF',
    },
  });

  const config = {
    version: 1,
    generatedBy: 'worklouder-macropad diagnostic generator',
    feedbackMode: mode,
    target: {profileId, layer},
    operations,
  };
  const text = `${JSON.stringify(config, null, 2)}\n`;
  if (args.output) {
    const output = path.resolve(args.output);
    fs.writeFileSync(output, text, {mode: 0o600});
    fs.chmodSync(output, 0o600);
    console.log(JSON.stringify({generated: output, feedbackMode: mode, profileId, layer}));
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
