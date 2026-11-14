// What the two displays show, as DisplayDraw elements built from the app's state. Nothing here talks to a device.
//
// Front: 72x16 RGB. A brightness gauge on the left, then brightness and color temperature. The value the wheel
// changes gets an outline for a while after a wheel press or turn.
// Back: 160x80 grayscale, its right 12 px are the firmware's status bar. The light's address, firmware and status,
// and the error in full when there is one.

import type { RectangleElement, TextElement } from "@busy-app/busy-lib";
import { KELVIN_MAX, KELVIN_MIN, type LightInfo } from "./elgato";
import { activePreset, type Preset } from "./presets";

export type Element = TextElement | RectangleElement;

/** What the wheel changes; a wheel press goes to the next. */
export type Field = "brightness" | "temperature" | "presets";

export type Status = "no_settings" | "no_ip" | "connecting" | "ok" | "error";

export interface ViewState {
  /** The light_ip setting as entered. */
  host: string;
  /** Null until the light first answers. */
  light: { on: boolean; brightness: number; kelvin: number } | null;
  info: LightInfo | null;
  status: Status;
  error: string | null;
  /** Why the last change was not taken; kept until a change goes through, even when the light answers reads again. */
  writeError: string | null;
  /** The shown presets from the settings, in order. */
  presets: Preset[];
  /** The preset last chosen with the wheel, -1 for none: it tells presets with the same values apart. */
  chosenPreset: number;
  selected: Field;
  highlighted: boolean;
}

const WHITE = "#FFFFFFFF";
const DIM = "#505050FF";
const RED = "#FF3020FF";
const NONE = "#00000000";
const BACK_DIM = "#808080FF";

/** Warm at 2900 K, cool at 7000 K: roughly the light's own color, for the gauge and the temperature. */
const WARM = [255, 168, 80];
const COOL = [200, 220, 255];

function hex(n: number): string {
  const s = Math.round(n).toString(16).toUpperCase();
  return s.length < 2 ? `0${s}` : s;
}

export function tint(kelvin: number): string {
  const t = (kelvin - KELVIN_MIN) / (KELVIN_MAX - KELVIN_MIN);
  const [r, g, b] = WARM.map((w, i) => w + (COOL[i] - w) * t);
  return `#${hex(r)}${hex(g)}${hex(b)}FF`;
}

/** A color at a fraction of its brightness, for the presets that are not active. */
function dim(color: string, factor: number): string {
  const channel = (i: number) => hex(parseInt(color.slice(i, i + 2), 16) * factor);
  return `#${channel(1)}${channel(3)}${channel(5)}FF`;
}

// Front layout. Measured in the `condensed` font: "100%" is 23 px wide, "7000K" 26 px. The outlines are 4 px wider.
const GAUGE_X = 1;
const GAUGE_W = 2;
const BRIGHTNESS_BOX_W = 27;
const TEMPERATURE_BOX_W = 30;
const MID_Y = 8;
const DISPLAY_W = 72;
// The preset column: four 2x2 squares 1 px apart, inside an outline (x 66-71, y 1-15) when presets are
// selected, 1 px away from the squares on every side.
const PRESETS_OUTLINE_X = 66;
const PRESETS_OUTLINE_Y = 1;
const PRESETS_OUTLINE_W = 6;
const PRESETS_OUTLINE_H = 15;
const PRESET_X = 68;
const PRESET_SIZE = 2;
const PRESET_PITCH = 3;
const PRESET_DIM = 0.3;

/**
 * The centers of the two values. They sit between the gauge and the preset column, or the right edge when there is
 * none, with the free space split evenly before, between and after them.
 */
function valueCenters(withPresets: boolean): { brightness: number; temperature: number } {
  const left = GAUGE_X + GAUGE_W;
  const right = withPresets ? PRESETS_OUTLINE_X : DISPLAY_W;
  const gap = Math.round((right - left - BRIGHTNESS_BOX_W - TEMPERATURE_BOX_W) / 3);
  const brightnessX = left + gap;
  const temperatureX = brightnessX + BRIGHTNESS_BOX_W + gap;
  return {
    brightness: brightnessX + Math.floor(BRIGHTNESS_BOX_W / 2),
    temperature: temperatureX + Math.floor(TEMPERATURE_BOX_W / 2),
  };
}

function front(state: ViewState): Element[] {
  const { light, status } = state;
  const gaugeColor = status === "error" ? RED : light?.on ? tint(light.kelvin) : DIM;
  const elements: Element[] = [];

  if (!light) {
    const text =
      status === "no_ip"
        ? "Set light IP"
        : status === "no_settings"
          ? "No settings"
          : status === "error"
            ? "No light"
            : "Connecting";
    elements.push({
      id: "message",
      type: "text",
      text,
      font: "small",
      color: status === "error" || status === "no_settings" ? RED : WHITE,
      x: DISPLAY_W / 2,
      y: MID_Y,
      align: "center",
    });
    return elements;
  }

  if (status === "error" || (light.on && light.brightness > 0)) {
    // Up to 14 px tall, from y 1 to 14 like the outlines; 1 %, the lowest the wheel goes, is a single row. A light set
    // to 0 elsewhere shows no bar. A light that stopped answering always has one, in red, also while it is off.
    const height = Math.max(1, Math.round((14 * light.brightness) / 100));
    elements.push({
      id: "gauge_fill",
      type: "rectangle",
      x: GAUGE_X,
      y: 15 - height,
      width: GAUGE_W,
      height,
      fill: "solid",
      fill_colors: [gaugeColor],
      border_width: 0,
    });
  }

  const centers = valueCenters(state.presets.length > 0);
  const values: { field: Exclude<Field, "presets">; text: string; color: string; cx: number; boxWidth: number }[] = [
    {
      field: "brightness",
      text: `${light.brightness}%`,
      color: light.on ? WHITE : DIM,
      cx: centers.brightness,
      boxWidth: BRIGHTNESS_BOX_W,
    },
    {
      field: "temperature",
      text: `${light.kelvin}K`,
      color: light.on ? tint(light.kelvin) : DIM,
      cx: centers.temperature,
      boxWidth: TEMPERATURE_BOX_W,
    },
  ];

  for (const value of values) {
    const boxed = state.highlighted && state.selected === value.field;
    // The outline is always there, invisible when not highlighted, so highlighting never needs a DisplayClear.
    elements.push(
      {
        id: `${value.field}_box`,
        type: "rectangle",
        x: value.cx - Math.floor(value.boxWidth / 2),
        y: 1,
        width: value.boxWidth,
        height: 14,
        radius: 2,
        fill: "none",
        border_width: 1,
        border_color: boxed ? value.color : NONE,
        z_index: 1,
      },
      {
        id: `${value.field}_text`,
        type: "text",
        text: value.text,
        font: "condensed",
        color: value.color,
        x: value.cx,
        y: MID_Y,
        align: "center",
        z_index: 2,
      },
    );
  }

  elements.push(...presetColumn(state, light));
  return elements;
}

/** The shown presets, the active one lit and the rest dimmed; none lit when the light matches none. */
function presetColumn(state: ViewState, light: NonNullable<ViewState["light"]>): Element[] {
  if (!state.presets.length) return [];
  const active = activePreset(state.presets, light, state.chosenPreset);
  const colors = state.presets.map((preset) => tint(preset.kelvin));
  const height = colors.length * PRESET_PITCH - 1;
  // Centered inside the outline, which leaves 1 px around four squares.
  const inside = PRESETS_OUTLINE_H - 2;
  const top = PRESETS_OUTLINE_Y + 1 + Math.floor((inside - height) / 2);
  const boxed = state.highlighted && state.selected === "presets";
  return [
    {
      id: "presets_box",
      type: "rectangle",
      x: PRESETS_OUTLINE_X,
      y: PRESETS_OUTLINE_Y,
      width: PRESETS_OUTLINE_W,
      height: PRESETS_OUTLINE_H,
      radius: 1,
      fill: "none",
      border_width: 1,
      border_color: boxed ? WHITE : NONE,
      z_index: 1,
    },
    ...colors.map(
      (color, i): Element => ({
        id: `preset_${i}`,
        type: "rectangle",
        x: PRESET_X,
        y: top + i * PRESET_PITCH,
        width: PRESET_SIZE,
        height: PRESET_SIZE,
        fill: "solid",
        fill_colors: [i === active ? color : dim(color, PRESET_DIM)],
        border_width: 0,
        z_index: 2,
      }),
    ),
  ];
}

const STATUS_TEXT: Record<Status, string> = {
  no_settings: "No settings",
  no_ip: "No IP set",
  connecting: "Connecting...",
  ok: "Connected",
  error: "Unreachable",
};

function back(state: ViewState): Element[] {
  const { info } = state;
  const title = info?.displayName || info?.productName || "Elgato Key Light";
  const firmware = info?.firmwareVersion
    ? info.firmwareBuildNumber !== null
      ? `${info.firmwareVersion} (${info.firmwareBuildNumber})`
      : info.firmwareVersion
    : "-";
  const detail =
    state.status === "no_settings"
      ? "Could not read the app's settings from the BUSY Bar. Trying again."
      : state.status === "no_ip"
      ? state.host
        ? `"${state.host}" is not an IP address (.local names do not work). Fix it in the BUSY Bar's web interface.`
        : "Set the light's IP address in the BUSY Bar's web interface."
      : state.status === "error" && state.error
        ? state.error
        : state.writeError
          ? `Last change failed: ${state.writeError}`
          : "";

  const rows: [string, string, string][] = [
    ["ip", "IP", state.host || "not set"],
    ["firmware", "Firmware", firmware],
    ["status", "Status", STATUS_TEXT[state.status]],
  ];

  const elements: Element[] = [
    { id: "b_title", type: "text", display: "back", text: title, font: "bold", color: WHITE, x: 0, y: 2 },
  ];
  rows.forEach(([id, label, value], i) => {
    const y = 18 + i * 12;
    elements.push(
      { id: `b_${id}_label`, type: "text", display: "back", text: label, font: "small", color: BACK_DIM, x: 0, y },
      { id: `b_${id}`, type: "text", display: "back", text: value, font: "small", color: WHITE, x: 44, y },
    );
  });
  if (detail) {
    elements.push({
      id: "b_detail",
      type: "text",
      display: "back",
      text: detail,
      font: "small",
      color: WHITE,
      x: 0,
      y: 58,
      // Long errors scroll within the display, left of the status bar.
      width: 147,
      scroll_rate: 1200,
    });
  }
  return elements;
}

export function elements(state: ViewState): Element[] {
  return [...front(state), ...back(state)];
}
