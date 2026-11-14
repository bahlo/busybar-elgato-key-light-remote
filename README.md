# Key Light

Control an Elgato Key Light Air from a BUSY Bar: power, brightness and color temperature, over the light's local HTTP
API. The app runs on the BUSY Bar itself; no computer needs to be on.

## Using it

1. Find the light's IP address (in Elgato Control Center, or your router). Give the light a fixed DHCP lease, because
   the BUSY Bar cannot resolve `.local` names.
2. Open the BUSY Bar's web interface (its IP address in a browser), go to the Key Light app's settings and set
   **Key Light IP address**. `192.168.1.20` and `192.168.1.20:9123` both work.
3. Start the app.

| Control | Action |
| --- | --- |
| Start / Pause | Turn the light on or off |
| Wheel press | Switch between brightness and color temperature; the selected value is outlined for 4 s |
| Wheel turn | Change the selected value: 1 % or 50 K per click, 5 % or 200 K when turned fast |
| Back | Leave the app |

The front display shows a brightness gauge tinted with the light's color, the brightness and the color temperature.
The gauge turns red when the light does not answer. The back display shows the light's name, IP address, firmware,
connection status and, when there is one, the full error.

The app reads the light every 5 s, so changes made in Control Center show up. When the light does not answer, it
waits longer between tries, up to 30 s. Wheel changes are sent at most every 150 ms, one request at a time.

## Testing without a light

`tools/fake-light.mjs` is a fake Key Light Air: the same paths, methods and JSON as a real one, plus faults you switch
on while it runs. It needs only Node.

```sh
npm run fake-light            # the light on 0.0.0.0:9123, its control port on 127.0.0.1:9124
```

Set the app's **Key Light IP address** to your computer's address on the network (not `127.0.0.1`: that is the BUSY
Bar itself). Then type commands into the fake's terminal, or send them from a script:

```sh
curl -d 'fault hang' localhost:9124                  # accepts requests, never answers
curl -d 'fault http 503 only=put times=1' localhost:9124
curl -d 'set on=0 kelvin=3200' localhost:9124        # change the light as Control Center would
curl -d 'clear' localhost:9124
```

| Command | Effect |
| --- | --- |
| `fault reset` | closes the connection without answering |
| `fault hang` | never answers; the BUSY Bar gives up after 5 s |
| `fault http <status>` | answers with that HTTP status |
| `fault garbage` | answers 200 with a body that is not JSON |
| `fault bad-shape` | answers 200 with JSON in the wrong shape |
| `fault ignore-writes` | answers PUTs with 200 and the old state, changing nothing |
| `latency <ms>` | answers every request that much later |
| `offline` / `online` | refuses connections / accepts them again |
| `set …`, `toggle` | changes the light from outside the app |
| `clear`, `status`, `help` | |

A fault takes `only=get|put`, `times=<n>` (fail the next n requests, then recover) and `rate=<0..1>` (fail that share
of requests). `--fault "<fault>"` and `--latency <ms>` start the fake with one; `--help` lists the other options.

With BUSY Bar Emulator, the app may reach your computer only on ports you allow:
`busy-emulator allow-local 9123`.

## Getting started

```sh
npm install
npm run build         # build the app into dist/me.arne.keylight.tgz
npm run app:install   # install it on the BUSY Bar connected over USB
npm run app:run       # launch the installed app
```

The app's id is `me.arne.keylight`, set in `src/appmeta/manifest.json`. An id is `<namespace>.<app>`, at most 32 characters, made of Latin letters, digits, underscores, dashes, and dots, and not starting with a dot. If yours still says `app.example`, change it to your own namespace before publishing.

## Layout

`src/` is the app — everything in it is yours to edit.

The entry point is `src/main.ts` (or `src/main.js`). The name is fixed: the build turns it into `scripts/main.js`, the file the BUSY Bar starts. Any imported modules are emitted as separate files alongside it in `scripts/`, unless `npm run build -- --bundle` inlines them.

`src/main.ts` is run from top to bottom, not imported: it starts the app by calling `main()` at the end and must not export anything. Imported modules can use standard exports.

```
my-app/
├── src/                          the app
│   ├── main.ts                   the entry point: function main(), called at the end
│   ├── appmeta/
│   │   ├── manifest.json         id, name, version, api_version
│   │   ├── settings.json         the settings screen — optional
│   │   ├── icon_front_8x8.png    front icon, 8×8 color — optional
│   │   └── icon_back_11x11.png   back icon, 11×11 grayscale — optional
│   ├── images/
│   ├── animations/
│   └── sounds/
├── shared/                       app-level helpers, imported as @shared/*
```

Both icons are optional; without them a default is used.

## Resources

Anything in `src/` that isn't a source file is copied into the package, sorted by what the BUSY Bar can read:

| Extension | Destination |
| --- | --- |
| `.png` `.image` | `images/` |
| `.anim` | `animations/` |
| `.snd` | `sounds/` |
| anything else | `resources/` |

A file in `src/images`, `src/animations` or `src/sounds` keeps its folder as long as the BUSY Bar reads its format.

`images/`, `animations/` and `sounds/` hold only those formats. An image, animation or sound in another format — `.jpg`, `.gif`, `.svg`, `.wav`, `.mp3` and the like — goes to `resources/`, and the build warns that the device cannot read it.

Everything the app draws goes through the layout helpers in `@busy-app/busy-lib`: build a tree out of `row` / `column` / `stack`, hand it to `render()`, and send the result with `device.DisplayDraw()`. The screen is 72×16 pixels.

## Input

`listen("input", handler)` delivers the device keys: `ok`, `start` and `back` with a `press` / `release` / `short` / `long` / `repeat` action, and `encoder` with a `delta` of `1` or `-1`. It returns an unbind function.

Use `short` as the default action for a button press: it fires once, after a normal press and release. `press` fires immediately on key down and is followed by `short`, so handling `press` as a tap can react twice. Use `long` and `repeat` for hold gestures.

## Commands

| Command | Description |
| --- | --- |
| `npm run build` | empties `dist/` and builds the package into `dist/me.arne.keylight.tgz` |
| `npm run build -- --emit dir` | leaves the `me.arne.keylight/` folder instead of the `.tgz` |
| `npm run build -- --emit both` | leaves the folder and the `.tgz` |
| `npm run build -- --out <path>` | builds into `<path>` instead, replacing only this app's package there |
| `npm run build -- --tgz-name <name>` | names the `.tgz`, e.g. `"{id}-{version}.tgz"` |
| `npm run build -- --no-minify` | readable output, for debugging |
| `npm run build -- --bundle` | inlines every module into one `main.js` |
| `npm run build -- --addr <host>` | sets the BUSY Bar address the app connects to, `localhost` by default |
| `npm run typecheck` | type-checks the app |
| `npm run app:install` | installs `dist/me.arne.keylight.tgz` on the BUSY Bar; build it first with `npm run build` |
| `npm run app:uninstall` | removes the app from the BUSY Bar, keeping its settings |
| `npm run app:run` | launches the installed app |
| `npm run app:stop` | quits the running app |

The four `app:` commands talk to the BUSY Bar connected over USB. For a device connected over Wi-Fi, pass `--addr <host>` with its network IP address or hostname, and `--password <password>` if password protection is enabled:

```sh
npm run app:install -- --addr <host>
npm run app:install -- --addr <host> --password <password>
```

## Build output

The package folder is named after the app id:

```
dist/
└── me.arne.keylight/
    ├── appmeta/manifest.json
    ├── scripts/main.js
    └── images/ animations/ sounds/ resources/
```

By default the build packs that folder into `dist/me.arne.keylight.tgz`, with the folder itself at the root of the archive, and removes the folder; `--emit dir` keeps only the folder, `--emit both` keeps both. `--tgz-name` gives the archive another name; `{id}` and `{version}` in it are replaced with the manifest values.

## CI and releasing

CI runs on [Depot CI](https://depot.dev/docs/ci/overview); the workflows are in `.depot/workflows/`. `ci.yml`
typechecks and builds every pull request and every push to `main`.

Pushing a git tag matching the manifest `version` (e.g. `0.1.0`) builds the app and attaches `me.arne.keylight-<version>.tgz` to a GitHub release. The release notes open with the app's name, id, version and API version. The release fails when the tag differs from the manifest `version`. If Depot CI's token may not create releases, add a GitHub token with `contents: write` as the Depot CI secret `RELEASE_TOKEN`.

## Manifest

`src/appmeta/manifest.json` carries the app's identity and a couple of knobs (see the [apps documentation](https://github.com/busy-app/busybar-firmware/blob/dev/documentation/JavaScript%20Applications.dox.md)):

| Field | Description |
| --- | --- |
| `format_version` | manifest format, `1` — required |
| `id` | up to 32 characters — required |
| `name` | display name — required |
| `version` | semver, e.g. `1.0.0` — required |
| `api_version` | minimum BUSY Bar HTTP API version the app needs, e.g. `27.12.0` — required |
| `description`, `author` | free form, default `""` |
| `heap_size_kib` | memory for the app heap, 1–512, default 128 |
| `debug` | when true, shown only in developer mode, default false |

Raise `heap_size_kib` if the app runs out of memory.

## Node version

The app builds on Node 24 — the version in `.nvmrc` and the range `engines` allows. Node 26 breaks the build and is excluded. With `fnm` or `nvm` installed, `fnm use` / `nvm use` picks the right one up from `.nvmrc`.

## Settings

To give the app a settings screen, add `src/appmeta/settings.json` describing the fields, then read the stored values:

```ts
import { loadValues } from "@shared/settings";

const values = await loadValues();
```

`loadValues()` asks the BUSY Bar, which answers with every field: the saved value, or the field's `default` from `settings.json`. It returns `null` only when the app has no settings file or the BUSY Bar did not answer.
