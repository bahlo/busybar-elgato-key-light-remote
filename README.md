# Key Light for BUSY Bar

Control your Elgato Key Light from your BUSY Bar: turn it on and off, set brightness and color temperature with
the wheel, and switch between four presets. The app runs on the BUSY Bar itself and talks to the light over your
network, so no computer has to be on.

![Key Light on a BUSY Bar: a brightness bar, 40 %, 4700 K and the preset column](screenshot.png)

## Features

- **Power** with the Start/Pause button.
- **Brightness and color temperature** on the wheel, from 1 % to 100 % and from 2900 K to 7000 K.
- **Four presets** you define yourself, one turn of the wheel away.
- **Stays in sync** with Elgato Control Center: changes made there show up within a few seconds.
- **Status at a glance** on the back display: the light's name, address, firmware and connection.

## Setup

1. **Give the light a fixed IP address.** Look up the light's address in Elgato Control Center or your router, and
   reserve it in your router (a DHCP reservation), so it doesn't change. The BUSY Bar can't look up `.local` names, so
   the app needs the number.
2. **Install the app** on your BUSY Bar. See [Building from source](#building-from-source) below.
3. **Enter the address.** Open your BUSY Bar's web interface (its IP address in a browser), go to the Key Light app's
   settings and set **Key Light IP address**, e.g. `192.168.1.20`. Add a port only if your light uses another one
   than 9123.
4. **Start the app** from APPS on your BUSY Bar.

The BUSY Bar and the light have to be on the same network. Key Lights only connect to 2.4 GHz Wi-Fi.

## Using it

| Control | What it does |
| --- | --- |
| **Start/Pause** | Turns the light on or off |
| **Wheel press** | Selects brightness, color temperature or the presets, in turn. The selection is outlined for 4 seconds |
| **Wheel turn** | Changes the selection: 1 % or 50 K per click, 5 % or 200 K when you turn fast. On the presets, steps through them |
| **Back** | Leaves the app |

The wheel always works on what you last changed. Pressing it only to look around doesn't stick: when the outline
disappears, the wheel goes back to the value you last changed. After the app starts, it changes the brightness.

### The front display

- **Left:** a bar that grows with the brightness, in the color of the light.
- **Middle:** the brightness and the color temperature, tinted in the light's color. Both are dimmed while the light
  is off.
- **Right:** the four presets as small squares, each in its color. The one matching the light is lit.

### The back display

The light's name (or its model, if you haven't named it in Control Center), its IP address, firmware version and
connection status. When something goes wrong, the full error is shown below.

## Presets

Turn to the presets with the wheel button and step through them by turning. Picking a preset sets its brightness and
color temperature and turns the light on. As soon as you change a value by hand, here or in Control Center, no preset
is active and all four squares are dimmed.

Set the presets in the app's settings:

| Setting | Default |
| --- | --- |
| **Show presets** | On. Turn it off to hide the column; the values then use the full width |
| **Preset 1 Brightness** / **Preset 1 Temperature** | 100 % / 5600 K |
| **Preset 2 Brightness** / **Preset 2 Temperature** | 70 % / 4500 K |
| **Preset 3 Brightness** / **Preset 3 Temperature** | 40 % / 3500 K |
| **Preset 4 Brightness** / **Preset 4 Temperature** | 15 % / 2900 K |

The app can read its settings but not change them, so presets are set in the settings, not on the bar.

## Troubleshooting

| You see | What to do |
| --- | --- |
| **Set light IP** | No address is set yet. Enter it in the app's settings, see [Setup](#setup). |
| **Connecting** for a while | The app is waiting for the light's first answer, which can take up to 5 seconds. |
| **No light**, or a red bar | The light doesn't answer. Check that it's powered and on the network, and that the address in the settings is still right. The back display shows the exact error. |
| *Inactivity timeout* on the back | Nothing answered at that address. The light may have a new address, or it's on another network. |
| *socket error* on the back | The connection was refused or dropped. Check the address and port. |

While the light doesn't answer, the app tries again less often, up to every 30 seconds, and picks up as soon as it's
back.

## Compatibility

Works with the Elgato **Key Light**, **Key Light Air** and **Key Light Mini**, which share the same local API for power,
brightness and color temperature. Tested on the BUSY Bar Emulator (firmware 1.3.1) against a simulated Key Light Air,
the one in [Testing without a light](#testing-without-a-light).

## Building from source

You need Node 24 (the version in `.nvmrc`; Node 26 doesn't build).

```sh
npm install
npm run build                             # builds dist/me.arne.keylight.tgz
npm run app:install                       # installs it on a BUSY Bar connected over USB
npm run app:install -- --addr <bar-ip>    # or over Wi-Fi (add --password <password> if set)
npm run app:run                           # starts it
```

`npm run typecheck` checks the types. The code is in `src/`: `main.ts` runs the app, `elgato.ts` talks to the light,
`view.ts` draws both displays and `presets.ts` reads the presets.

## Testing without a light

`tools/fake-light.mjs` is a fake Key Light, posing as a Key Light Air. It answers like a real one and can be told to
misbehave while it runs.
It needs only Node.

```sh
npm run fake-light    # the light on port 9123, its control port on 127.0.0.1:9124
```

Set the app's **Key Light IP address** to your computer's address on the network, not `127.0.0.1`, which is the BUSY
Bar itself. With the BUSY Bar Emulator, allow the port first: `busy-emulator allow-local 9123`.

Then type commands into the fake's terminal, or send them from a script:

```sh
curl -d 'set on=0 kelvin=3200' localhost:9124    # change the light as Control Center would
curl -d 'fault hang' localhost:9124              # accept requests, never answer
curl -d 'clear' localhost:9124                   # back to normal
```

| Command | Effect |
| --- | --- |
| `set on=… brightness=… kelvin=…`, `toggle` | Changes the light from outside the app |
| `fault reset` | Closes the connection without answering |
| `fault hang` | Never answers; the BUSY Bar gives up after 5 seconds |
| `fault http <status>` | Answers with that HTTP status |
| `fault garbage` | Answers with a body that isn't JSON |
| `fault bad-shape` | Answers with JSON in the wrong shape |
| `fault ignore-writes` | Accepts changes without applying them |
| `latency <ms>` | Answers every request that much later |
| `offline` / `online` | Refuses connections / accepts them again |
| `clear`, `status`, `help` | |

A fault takes `only=get|put`, `times=<n>` (the next n requests, then it recovers) and `rate=<0..1>` (that share of
requests). `--help` lists the start options, e.g. `--name` and `--port`.

## CI and releases

CI runs on [Depot CI](https://depot.dev/docs/ci/overview), with the workflows in `.depot/workflows/`: every pull
request and push to `main` is typechecked and built. Pushing a tag that matches the `version` in
`src/appmeta/manifest.json` (e.g. `0.1.0`) attaches `me.arne.keylight-<version>.tgz` to a GitHub release. If Depot
CI's token can't create releases, add a GitHub token with `contents: write` as the Depot CI secret `RELEASE_TOKEN`.

## License

[MIT](LICENSE)
