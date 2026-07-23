# Capability matrix

Status vocabulary:

- **Verified**: observed in Input 0.17.2, serialized to a Codex Micro, and/or physically exercised on firmware v0.5.0-rc.1.
- **Supported**: implemented by the bundled configurator from Input's observed schema, but still requires a physical test on the target setup.
- **Unavailable**: present as a concept but not exposed as usable configuration.
- **Unknown**: no safe public claim yet.

## Device surfaces

| Surface | Status | What can be configured |
|---|---|---|
| Physical keys | Verified | 13 keys in rows of 2, 4, 4, and 3 |
| Layers | Verified | Up to six per profile; name, color metadata, OS, layout, lighting, and linked app |
| Profiles | Supported | Up to six; id, name, active profile, layers |
| Encoder | Supported | Counter-clockwise, clockwise, and press, each mapped to any valid keycode/action reference |
| Joystick radial mode | Supported | Fixed close sector plus 1–7 schema-supported sectors; Codex marketing advertises four skills |
| Joystick analog mode | Unavailable | Input labels it “coming soon”; do not generate it |
| Backlight | Verified schema | Effect, brightness, speed, magic, color, per layer |
| Underglow | Verified schema | Effect, brightness, speed, magic, color, per layer |
| Linked apps/AppSense | Supported | Registry entry plus layer `linkedAppId` |
| Function-pad layer | Unknown | `fpLayer` is preserved if present; Codex editing semantics are not proven |
| Cheat Sheet key | Unknown | Firmware release mentions it, but safe Codex keycode/configuration is not proven |
| Bluetooth | Unknown | Current proof used USB HID |
| Windows host actions | Unknown | Current proof and paths are macOS-specific |

The six-layer and software-linked-layer behavior is described by Work Louder's [Micro setup guide](https://worklouder.cc/micro-setup). Work Louder's [Codex Micro page](https://worklouder.cc/codex-micro) also confirms 13 keys, a rotary encoder, a planar joystick, RGB lighting, and six programmable Input layers.

## Action surfaces

| Primitive | Status | Capability |
|---|---|---|
| Basic keycode | Verified | Keyboard, function, media, layer/profile, and device functions exposed by Input |
| Action | Verified schema | Ordered press, release, or click events with 0–9999 ms delay |
| Nested Action | Supported | An Action may invoke another Action; cycles are rejected |
| Multi Action | Verified | Tap, double tap, hold, tap then hold, and tapping term |
| Multi → Action | Supported | Use this for a gesture that needs a sequence |
| Multi → Smart Action | Supported | Schema accepts it; physically verify each gesture |
| Nested Multi Action | Unverified | Input internals traverse references, but the UI does not expose this safely; the configurator rejects it |
| Smart Action | Verified | One app, URL, text, or command operation |
| Smart Action chain | Not native | Use an Action, one wrapper command, or an external workflow runner |
| Groups | Supported | Action, Multi Action, and Smart Action group arrays are preserved |

## Lighting

Both backlight and underglow expose:

- effects: `off`, `solid`, `snake`, `rainbow`, `breath`, `gradient`;
- `brightness`, `speed`, and `magic` as values from `0` to `1`;
- 24-bit RGB color.

Observed Input control availability:

| Effect | Brightness | Speed | Magic | Color |
|---|---:|---:|---:|---:|
| off | no | no | no | no |
| solid | yes | no | no | yes |
| snake | yes | yes | no | yes |
| rainbow | yes | yes | yes | no |
| breath | yes | yes | yes | yes |
| gradient | yes | no | yes | yes |

The exact visual meaning of `magic` is effect-specific and not documented. Treat it as a normalized effect parameter and verify visually.

Layer `color` is distinct from lighting color. It is confirmed Input metadata; its physical effect is unknown.

## Encoder order

The live stock Codex layout is serialized as:

```text
slot 0: counter-clockwise
slot 1: clockwise
slot 2: press
```

The CLI accepts semantic names and raw `slot0`/`slot1` aliases. On a new Input or firmware version, map A/B/C temporarily and physically test all three before deploying meaningful actions.

## Joystick geometry

Input's radial layout uses 2–8 total sectors:

- sector 0 is the fixed `KI_X` close action with a 45-degree arc;
- 1–7 additional actions divide the remaining arc evenly;
- each sector stores normalized start/end angles `a1` and `a2`.

The skill preserves this invariant. The Codex product page describes four preset/custom joystick skills, so treat sectors five through seven as schema-supported but physically unverified. Exact boundary feel and wraparound should be tested on the target device.

Input must remain running to render the on-screen radial menu. Work Louder states that mapped actions can still execute without the visible menu; verify this behavior on the Codex Micro before depending on it.

## Limits and unknown ceilings

Confirmed UI limits:

- six profiles;
- six layers per profile;
- 13 physical keys;
- one encoder with three events;
- 2–8 radial sectors;
- Action and Multi Action names up to 16 characters;
- profile names 1–20 letters, numbers, or spaces.

Unknown:

- maximum Action, Multi Action, and Smart Action counts;
- firmware file-size ceiling;
- complete firmware keycode catalog;
- all behavior on Input versions other than 0.17.2;
- behavior on firmware later than v0.5.0-rc.1.

The CLI validates known invariants and chunks files, but physical verification remains mandatory.
