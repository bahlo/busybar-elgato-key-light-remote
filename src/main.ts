import { device } from "@shared/device";
import { loadValues } from "@shared/settings";
import manifest from "./appmeta/manifest.json";
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  KELVIN_MAX,
  KELVIN_MIN,
  KELVIN_STEP,
  KeyLight,
  baseUrl,
  clamp,
  kelvinToMired,
  miredToKelvin,
  LightError,
  type LightState,
} from "./elgato";
import { activePreset, presetsFrom } from "./presets";
import { elements, type Element, type Field, type ViewState } from "./view";

/** The name the app draws under; the device clears elements by this id. */
const APP = manifest.id;

/** How long the selected value stays highlighted after a wheel press or turn. */
const HIGHLIGHT_MS = 4_000;
/** Wheel changes are sent at most this often, and only the latest value. */
const SEND_INTERVAL_MS = 150;
/** How often the light is read, so changes made elsewhere show up. Doubles on each failure, up to POLL_MAX_MS. */
const POLL_MS = 5_000;
const POLL_MAX_MS = 30_000;
/** A poll does not overwrite what the wheel just set. */
const LOCAL_CHANGE_GRACE_MS = 1_500;
/** Wheel clicks closer together than this count as a fast turn and take bigger steps. */
const FAST_TURN_MS = 80;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function report(err: unknown): void {
  console.error(`${APP}: ${message(err)}`);
}

/** Sends only the elements that changed since the last frame; one display request at a time. */
class Screen {
  private sent = new Map<string, string>();
  private busy = false;
  private dirty = false;
  private stopped = false;
  /** After a failed request the display may hold anything: clear it all before the next frame. */
  private unknown = false;
  private retry: ReturnType<typeof setTimeout> | null = null;

  private readonly frame: () => Element[];

  constructor(frame: () => Element[]) {
    this.frame = frame;
  }

  update(): void {
    if (this.stopped) return;
    this.dirty = true;
    if (!this.busy) void this.flush();
  }

  /** For good: nothing is drawn after this, whatever is still on its way. */
  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.dirty = false;
  }

  private async flush(): Promise<void> {
    this.busy = true;
    while (this.dirty && !this.stopped) {
      this.dirty = false;
      try {
        if (this.unknown) {
          await device.DisplayClear({ application_name: APP });
          this.sent.clear();
          this.unknown = false;
        }
        const frame = this.frame();
        const next = new Map(frame.map((element) => [element.id, JSON.stringify(element)]));
        const removed = [...this.sent.keys()].filter((id) => !next.has(id));
        const changed = frame.filter((element) => this.sent.get(element.id) !== next.get(element.id));
        if (removed.length) await device.DisplayClear({ application_name: APP, element_ids: removed });
        if (changed.length) await device.DisplayDraw({ application_name: APP, priority: 50, elements: changed });
        this.sent = next;
      } catch (err) {
        report(err);
        // What the display holds is unknown now: clear it and send everything again, once, a little later.
        this.unknown = true;
        if (!this.retry && !this.stopped) {
          this.retry = setTimeout(() => {
            this.retry = null;
            this.update();
          }, 2_000);
        }
      }
    }
    this.busy = false;
  }
}

function main(): void {
  const state: ViewState = {
    host: "",
    light: null,
    info: null,
    status: "connecting",
    error: null,
    writeError: null,
    presets: [],
    chosenPreset: -1,
    selected: "brightness",
    highlighted: false,
  };
  const screen = new Screen(() => elements(state));

  let light: KeyLight | null = null;
  let stopped = false;
  /** One request to the light at a time: the Key Light stalls when requests pile up. */
  let inFlight = false;
  /** Changes made with the buttons and the wheel, not sent yet. */
  let pending: Partial<LightState> = {};
  let lastLocalChange = 0;
  let lastTurn = 0;
  let failures = 0;
  let settingsAttempts = 0;
  /** What the wheel last changed since the app started; brightness until it has changed anything. */
  let lastChanged: Field = "brightness";

  let sendTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;
  let settingsTimer: ReturnType<typeof setTimeout> | null = null;

  const fail = (err: unknown) => {
    failures += 1;
    state.status = "error";
    state.error = message(err);
    report(err);
  };

  const succeed = () => {
    failures = 0;
    state.status = "ok";
    state.error = null;
  };

  /** What the light last said its state was. A failed change goes back to it. */
  let confirmed: ViewState["light"] = null;

  /** Takes the light's answer, unless the wheel changed something since the request went out. */
  const adopt = (answer: LightState) => {
    confirmed = { on: answer.on, brightness: answer.brightness, kelvin: miredToKelvin(answer.temperature) };
    if (Object.keys(pending).length || Date.now() - lastLocalChange < LOCAL_CHANGE_GRACE_MS) return;
    state.light = { ...confirmed };
  };

  const schedulePoll = (delay: number) => {
    if (stopped || !light) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void poll();
    }, delay);
  };

  const poll = async () => {
    if (stopped || !light) return;
    if (inFlight || Object.keys(pending).length) {
      // A change is on its way; its answer has the state, look again later.
      schedulePoll(POLL_MS);
      return;
    }
    inFlight = true;
    try {
      adopt(await light.state());
      succeed();
      // The name and firmware are only for the back display: failing to read them is not the light failing.
      if (!state.info) state.info = await light.info().catch((err: unknown) => (report(err), null));
    } catch (err) {
      fail(err);
    } finally {
      inFlight = false;
    }
    screen.update();
    if (Object.keys(pending).length) scheduleSend(0);
    schedulePoll(Math.min(POLL_MS * 2 ** failures, POLL_MAX_MS));
  };

  const scheduleSend = (delay: number) => {
    if (stopped || sendTimer) return;
    sendTimer = setTimeout(() => {
      sendTimer = null;
      void send();
    }, delay);
  };

  const send = async () => {
    if (stopped || !light || inFlight) return;
    const patch = pending;
    if (!Object.keys(patch).length) return;
    pending = {};
    inFlight = true;
    try {
      const answer = await light.update(patch);
      succeed();
      state.writeError = null;
      adopt(answer);
    } catch (err) {
      // An HTTP status means the light (or the relay) answered and refused: it is reachable, only the change failed.
      if (err instanceof LightError && err.status !== null) report(err);
      else fail(err);
      state.writeError =
        err instanceof LightError && err.status === 400
          ? "HTTP 400. A Key Light refuses changes sent by a BUSY Bar directly: run the relay, see the README."
          : message(err);
      // The light did not take the change: show what it last said, unless newer changes are on their way.
      if (!Object.keys(pending).length && confirmed) {
        state.light = { ...confirmed };
        lastLocalChange = 0;
      }
    } finally {
      inFlight = false;
    }
    screen.update();
    if (Object.keys(pending).length) scheduleSend(SEND_INTERVAL_MS);
  };

  /** Shows the new value at once and sends it to the light shortly after. */
  const change = (patch: Partial<LightState>, delay: number) => {
    Object.assign(pending, patch);
    lastLocalChange = Date.now();
    screen.update();
    if (delay === 0 && sendTimer) {
      clearTimeout(sendTimer);
      sendTimer = null;
    }
    scheduleSend(delay);
  };

  const highlight = () => {
    state.highlighted = true;
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      highlightTimer = null;
      state.highlighted = false;
      // A press that changed nothing does not last: the wheel goes back to what it last changed.
      state.selected = lastChanged;
      screen.update();
    }, HIGHLIGHT_MS);
    screen.update();
  };

  const toggle = () => {
    if (!state.light) {
      // Nothing known to toggle yet: ask the light now instead of waiting for the next poll.
      schedulePoll(0);
      return;
    }
    state.light.on = !state.light.on;
    change({ on: state.light.on }, 0);
  };

  /**
   * Moves one preset down (delta 1) or up the column and applies it, turning the light on. With no preset active,
   * turning down starts at the first preset and turning up at the last. The ends stop.
   */
  const choosePreset = (delta: 1 | -1): boolean => {
    if (!state.light || !state.presets.length) return false;
    const current = activePreset(state.presets, state.light, state.chosenPreset);
    const last = state.presets.length - 1;
    const next = current === -1 ? (delta > 0 ? 0 : last) : clamp(current + delta, 0, last);
    if (next === current) return false;
    const target = state.presets[next];
    state.chosenPreset = next;
    state.light.on = true;
    state.light.brightness = target.brightness;
    state.light.kelvin = target.kelvin;
    change({ on: true, brightness: target.brightness, temperature: kelvinToMired(target.kelvin) }, SEND_INTERVAL_MS);
    return true;
  };

  /** The next thing a wheel press selects; the presets only while there are any to show. */
  const nextField = (field: Field): Field => {
    if (field === "brightness") return "temperature";
    if (field === "temperature" && state.presets.length) return "presets";
    return "brightness";
  };

  const turn = (delta: 1 | -1) => {
    const now = Date.now();
    const fast = now - lastTurn < FAST_TURN_MS;
    lastTurn = now;
    highlight();
    if (!state.light) return;

    if (state.selected === "presets") {
      if (choosePreset(delta)) lastChanged = "presets";
    } else if (state.selected === "brightness") {
      const step = fast ? 5 : 1;
      const brightness = clamp(state.light.brightness + delta * step, BRIGHTNESS_MIN, BRIGHTNESS_MAX);
      if (brightness === state.light.brightness) return;
      state.light.brightness = brightness;
      change({ brightness }, SEND_INTERVAL_MS);
      lastChanged = "brightness";
    } else {
      const step = (fast ? 4 : 1) * KELVIN_STEP;
      const kelvin = clamp(state.light.kelvin + delta * step, KELVIN_MIN, KELVIN_MAX);
      if (kelvin === state.light.kelvin) return;
      state.light.kelvin = kelvin;
      change({ temperature: kelvinToMired(kelvin) }, SEND_INTERVAL_MS);
      lastChanged = "temperature";
    }
  };

  const quit = () => {
    stopped = true;
    for (const timer of [sendTimer, pollTimer, highlightTimer, settingsTimer]) if (timer) clearTimeout(timer);
    sendTimer = pollTimer = highlightTimer = settingsTimer = null;
    screen.stop();
    // Not detached from inside the handler itself: with nothing else left the unbind would stop the app while the
    // handler still runs.
    setTimeout(unbind, 0);
  };

  const unbind = listen("input", (event) => {
    if (stopped) return;
    if (event.key === "encoder") {
      turn(event.delta);
      return;
    }
    if (event.action !== "short") return;
    if (event.key === "start") toggle();
    else if (event.key === "ok") {
      state.selected = nextField(state.selected);
      highlight();
    } else if (event.key === "back") quit();
  });

  screen.update();

  const loadSettings = () => {
    void loadValues()
      .then((values) => {
        if (stopped) return;
        if (!values) {
          // The app has a settings file, so no values means the BUSY Bar did not answer: ask again, less and less often.
          report("could not read the app's settings");
          state.status = "no_settings";
          screen.update();
          const delay = Math.min(POLL_MS * 2 ** settingsAttempts, POLL_MAX_MS);
          settingsAttempts += 1;
          settingsTimer = setTimeout(() => {
            settingsTimer = null;
            loadSettings();
          }, delay);
          return;
        }
        state.presets = presetsFrom(values);
        const host = typeof values.light_ip === "string" ? values.light_ip.trim() : "";
        const base = baseUrl(host);
        state.host = host;
        if (!base) {
          state.status = "no_ip";
          screen.update();
          return;
        }
        light = new KeyLight(base);
        state.status = "connecting";
        // Show the address while the first request is on its way: an unreachable light takes 5 s to fail.
        screen.update();
        schedulePoll(0);
      })
      .catch(report);
  };

  loadSettings();
}

main();
