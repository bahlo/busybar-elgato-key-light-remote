// A minimal client for the Elgato Key Light's local HTTP API (port 9123, no auth, JSON).
//
// Elgato does not document the API; this follows the reverse-engineered docs and the python-elgato library:
// GET/PUT /elgato/lights and GET /elgato/accessory-info. A PUT may carry only the fields that change, and the light
// answers with its full state.

export const DEFAULT_PORT = 9123;

/** Brightness in percent. The API takes 0-100, but the lowest few values barely light the panel. */
export const BRIGHTNESS_MIN = 3;
export const BRIGHTNESS_MAX = 100;

/** Color temperature as the API takes it, in mireds: 143 is about 7000 K, 344 about 2900 K. */
export const MIRED_MIN = 143;
export const MIRED_MAX = 344;

/** Color temperature as people read it, in the 50 K steps Elgato's own app uses. */
export const KELVIN_MIN = 2900;
export const KELVIN_MAX = 7000;
export const KELVIN_STEP = 50;

/** One light's state, as the API reports it. */
export interface LightState {
  on: boolean;
  brightness: number;
  /** Mireds. */
  temperature: number;
}

/** The fields of /elgato/accessory-info the app shows. */
export interface LightInfo {
  productName: string;
  displayName: string;
  firmwareVersion: string;
  firmwareBuildNumber: number | null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function miredToKelvin(mired: number): number {
  const kelvin = Math.round(1e6 / mired / KELVIN_STEP) * KELVIN_STEP;
  return clamp(kelvin, KELVIN_MIN, KELVIN_MAX);
}

export function kelvinToMired(kelvin: number): number {
  return clamp(Math.round(1e6 / kelvin), MIRED_MIN, MIRED_MAX);
}

/**
 * The light's base URL from the app's setting: an IP or host name, with an optional port. Null when it is empty or
 * not something a URL can hold.
 */
export function baseUrl(setting: string): string | null {
  const host = setting.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return null;
  return `http://${host.includes(":") ? host : `${host}:${DEFAULT_PORT}`}`;
}

/** A failed request, with a message short enough for the back display. */
export class LightError extends Error {}

/**
 * The BUSY Bar's fetch rejects with a string ("socket error", "Inactivity timeout"), not an Error; both end up as
 * a LightError with that text.
 */
function asLightError(err: unknown): LightError {
  if (err instanceof LightError) return err;
  return new LightError(err instanceof Error ? err.message : String(err));
}

function parseLights(body: unknown): LightState {
  const light = (body as { lights?: unknown[] } | null)?.lights?.[0] as Record<string, unknown> | undefined;
  if (
    !light ||
    typeof light.on !== "number" ||
    typeof light.brightness !== "number" ||
    typeof light.temperature !== "number"
  ) {
    throw new LightError("Unexpected answer from the light");
  }
  return { on: light.on === 1, brightness: light.brightness, temperature: light.temperature };
}

function parseInfo(body: unknown): LightInfo {
  const info = (body ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    productName: text(info.productName),
    displayName: text(info.displayName),
    firmwareVersion: text(info.firmwareVersion),
    firmwareBuildNumber: typeof info.firmwareBuildNumber === "number" ? info.firmwareBuildNumber : null,
  };
}

export class KeyLight {
  readonly base: string;

  constructor(base: string) {
    this.base = base;
  }

  private async request(method: "GET" | "PUT", path: string, body?: unknown): Promise<unknown> {
    // The BUSY Bar's fetch rejects `headers: undefined` ("Headers is not an object"): leave keys out instead.
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    try {
      const res = await fetch(`${this.base}${path}`, init);
      if (!res.ok) throw new LightError(`HTTP ${res.status} on ${method} ${path}`);
      return await res.json();
    } catch (err) {
      throw asLightError(err);
    }
  }

  async state(): Promise<LightState> {
    return parseLights(await this.request("GET", "/elgato/lights"));
  }

  /** Changes only the given fields and returns the light's full state after the change. */
  async update(patch: Partial<LightState>): Promise<LightState> {
    const light: Record<string, number> = {};
    if (patch.on !== undefined) light.on = patch.on ? 1 : 0;
    if (patch.brightness !== undefined) light.brightness = Math.round(patch.brightness);
    if (patch.temperature !== undefined) light.temperature = Math.round(patch.temperature);
    return parseLights(await this.request("PUT", "/elgato/lights", { numberOfLights: 1, lights: [light] }));
  }

  async info(): Promise<LightInfo> {
    return parseInfo(await this.request("GET", "/elgato/accessory-info"));
  }
}
