# Configuration manifests

The CLI reads Input's live database, applies ordered operations in memory, validates the complete result, and prints a dry run. It writes only with `--apply`.

```json
{
  "version": 1,
  "operations": []
}
```

Operations are order-sensitive. Create definitions and linked apps before mapping references to them.

## Common addressing

- `profileId`: zero-based Input profile ID, not display position.
- `layer`: one-based layer number, 1–6.
- `row`: one-based physical row, 1–4.
- `key`: one-based key within that row.
- row widths: 2, 4, 4, 3.

Layer 1 mutation requires `allowStockLayer: true` on the operation and `--allow-stock-layer` on the CLI.

## Operations

### Profile

```json
{"type":"set-profile","profileId":1,"name":"Editing"}
{"type":"set-active-profile","profileId":1}
```

Profile names contain 1–20 letters, numbers, or spaces. Up to six profiles are supported.

### Layer metadata

```json
{
  "type": "set-layer",
  "profileId": 0,
  "layer": 3,
  "name": "Build",
  "color": "#0066FF",
  "os": 0,
  "linkedAppId": null
}
```

`os` is `0` for macOS and `1` for Windows. Layer color is Input metadata, not the backlight color.

### Physical key

```json
{
  "type": "set-key",
  "profileId": 0,
  "layer": 3,
  "row": 2,
  "key": 3,
  "value": "SA_4"
}
```

### Encoder

```json
{"type":"set-encoder","profileId":0,"layer":3,"event":"counterclockwise","value":"KC_VOLD"}
{"type":"set-encoder","profileId":0,"layer":3,"event":"clockwise","value":"KC_VOLU"}
{"type":"set-encoder","profileId":0,"layer":3,"event":"press","value":"KC_MUTE"}
```

Raw aliases `slot0` and `slot1` exist for hardware verification.

### Radial joystick

```json
{
  "type": "set-joystick",
  "profileId": 0,
  "layer": 3,
  "keycodes": ["SA_1", "SA_2", "SA_3", "SA_4"]
}
```

Provide 1–7 user actions. The configurator prepends the fixed `KI_X` close sector.

### Lighting

```json
{
  "type": "set-lighting",
  "profileId": 0,
  "layer": 3,
  "target": "backlight",
  "config": {
    "effect": "breath",
    "brightness": 0.8,
    "speed": 0.4,
    "magic": 0.5,
    "color": "#0066FF"
  }
}
```

`target` is `backlight` or `underglow`. Effects are `off`, `solid`, `snake`, `rainbow`, `breath`, or `gradient`. Numeric controls are `0`–`1`.

Set `"allLayers": true` to update every non-stock layer in the profile. Layer 1 remains excluded unless explicitly authorized.

### Action

```json
{
  "type": "upsert-action",
  "action": {
    "id": 10,
    "name": "Save and run",
    "color": "#22AA66",
    "icon": null,
    "keyInputs": [
      {"keycode":"KC_LGUI","delay":0,"actionType":1},
      {"keycode":"KC_S","delay":0,"actionType":2},
      {"keycode":"KC_LGUI","delay":0,"actionType":0},
      {"keycode":"SA_7","delay":250,"actionType":2}
    ]
  }
}
```

`actionType` is `0` release, `1` press, or `2` click. Delay is 0–9999 ms. Action names are 1–16 characters. Actions may invoke Actions or Smart Actions; cycles are rejected.

### Multi Action

```json
{
  "type": "upsert-multi-action",
  "action": {
    "id": 4,
    "name": "Agent controls",
    "color": "#AA44FF",
    "icon": null,
    "tap": {"keycode":"SA_1"},
    "doubleTap": {"keycode":"SA_2"},
    "onHold": {"keycode":"KA_10"},
    "tapHold": {"keycode":"SA_3"},
    "tappingTerms": 250
  }
}
```

Use an Action reference when a gesture needs multiple events or delays. Nested Multi Actions are rejected because their physical behavior is unverified.

### Smart Action

```json
{
  "type": "upsert-smart-action",
  "action": {
    "id": 7,
    "name": "Open dashboard",
    "color": "#3366FF",
    "icon": null,
    "type": "URL_STEP",
    "payload": {"url":"https://example.com/dashboard"}
  }
}
```

Payloads:

```json
{"type":"TEXT_STEP","payload":{"text":"Fixed non-secret text"}}
{"type":"URL_STEP","payload":{"url":"https://example.com"}}
{"type":"APP_STEP","payload":{"name":"Example","path":"/Applications/Example.app"}}
{"type":"CMD_STEP","payload":{"cmd":"/absolute/path/to/program arguments"}}
```

### Linked app

```json
{
  "type": "upsert-linked-app",
  "linkedApp": {
    "id": 2,
    "name": "Example",
    "process": "Example",
    "path": "/Applications/Example.app"
  }
}
```

After creating it, set a layer's `linkedAppId` to the same ID.

### Command permission

```json
{"type":"set-command-permission","enabled":true}
```

Applying `enabled: true` also requires `--allow-command-execution`. This protects against a manifest silently turning on host command execution.

## Full example

```json
{
  "version": 1,
  "operations": [
    {
      "type": "upsert-smart-action",
      "action": {
        "id": 8,
        "name": "Open project",
        "type": "URL_STEP",
        "payload": {"url":"https://example.com/project"}
      }
    },
    {
      "type": "upsert-multi-action",
      "action": {
        "id": 2,
        "name": "Project",
        "tap": {"keycode":"SA_8"},
        "doubleTap": {"keycode":"KC_F5"},
        "onHold": {"keycode":"KC_MUTE"},
        "tapHold": {"keycode":"KI_LS1"},
        "tappingTerms": 250
      }
    },
    {
      "type": "set-key",
      "profileId": 0,
      "layer": 3,
      "row": 2,
      "key": 1,
      "value": "KM_2"
    },
    {
      "type": "set-lighting",
      "profileId": 0,
      "layer": 3,
      "target": "backlight",
      "config": {
        "effect": "solid",
        "brightness": 1,
        "speed": 0.5,
        "magic": 0.5,
        "color": "#0066FF"
      }
    }
  ]
}
```

Run:

```bash
node scripts/worklouder.js apply-config layout.json
node scripts/worklouder.js apply-config layout.json --apply
```

Quit Input before the second command and relaunch it afterward.
