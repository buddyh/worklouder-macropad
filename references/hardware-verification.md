# Hardware verification

Use a disposable layer, normally Layer 3, and a focused plain-text field. Back up first. Test one surface at a time so failures are attributable.

## Baseline

Record:

- Input version;
- firmware version from `device.status`;
- product ID discovered from Input, never assumed;
- profile and active layer;
- device `keymap.json` and `smart_actions.json` checksums;
- Input Smart Actions gate and command-permission status.

## Multi Action test

Assign one key:

```text
tap          KC_A
double tap   KC_B
hold         KC_C
tap + hold   KC_D
tapping term 250 ms
```

Expected in a text field:

- single tap inserts `a`;
- two quick taps insert `b`;
- hold triggers `c`;
- tap, release, then press-and-hold triggers `d`.

If a definition exists but nothing happens, verify the physical key maps to `KM_N` in Input and `KA_MN` on the device, and that `multiActionsUsed` contains the ID.

## Encoder test

Temporarily map:

```text
counter-clockwise  KC_A
clockwise          KC_B
press              KC_C
```

Verify each independently. If A/B are reversed, use `slot0` and `slot1`, record the app/firmware versions, and do not silently relabel them.

## Joystick test

Configure the fixed `KI_X` close sector plus four visible actions. Use text keys or Smart Actions that display a local notification. Verify:

- opening/closing radial behavior;
- each direction;
- boundary behavior;
- wraparound near zero degrees;
- return-to-center behavior;
- no accidental repeat.

Four user sectors match Work Louder's Codex Micro product description. Test sectors five through seven separately before claiming them. Do not test the unavailable analog mode.

## Lighting test

Choose visually distinct temporary settings on the disposable layer:

```text
backlight: solid, #0066FF, brightness 1
underglow: breath, #FF00AA, brightness 1, speed 0.5, magic 0.5
```

Verify:

- changing to the test layer changes the intended lights;
- switching away restores the other layer's lights;
- “apply to all layers” is not used unless explicitly intended;
- each effect's enabled parameters produce visible changes.

## Smart Action tests

Test each type separately:

1. `TEXT_STEP`: fixed non-secret text into a text field.
2. `URL_STEP`: an inert URL such as `https://example.com`.
3. `APP_STEP`: an installed application.
4. `CMD_STEP`: a visible local notification with an absolute executable path.

For each, verify:

- definition exists;
- control maps to `SA_N`;
- Input is running;
- Input log contains the expected `kb.sa.*` event;
- host result appears.

Then test Smart Actions from tap, double tap, hold, tap+hold, encoder turns/press, and joystick sectors before claiming those combinations.

## Layers, profiles, and linked apps

For Layers 2–6:

- create or select the layer;
- map one visible test action;
- switch to it with Input and with a layer-switch key;
- disconnect/reconnect;
- relaunch Input;
- verify mapping and lighting persist.

For a linked app:

- register the exact application name, process, and path;
- link only a disposable layer;
- focus away and back several times;
- verify automatic switching and recovery;
- remove the link if switching is unreliable.

## Failure classification

Keep these separate:

1. editor state saved;
2. device file written;
3. checksum/readback verified;
4. firmware emitted event;
5. Input received event;
6. host operation completed.

This prevents a host shell failure from being misdiagnosed as bad firmware, or a missing mapping from being misdiagnosed as a broken Smart Action.
