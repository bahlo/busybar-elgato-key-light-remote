// What the two displays show, as DisplayDraw elements built from the app's state. Nothing here talks to a device.
//
// Front: 72x16 RGB. A brightness gauge on the left, then brightness and color temperature. The value the wheel
// changes gets an inverted box for a while after a wheel press or turn.
// Back: 160x80 grayscale, its right 12 px are the firmware's status bar. The light's address, firmware and status,
// and the error in full when there is one.

import type { RectangleElement, TextElement } from "@busy-app/busy-lib";
import { KELVIN_MAX, KELVIN_MIN, type LightInfo } from "./elgato";

export type Element = TextElement | RectangleElement;

export type Field = "brightness" | "temperature";

export type Status = "no_ip" | "connecting" | "ok" | "error";

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
  selected: Field;
  highlighted: boolean;
}

const WHITE = "#FFFFFFFF";
const BLACK = "#000000FF";
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

// Front layout. Measured in the `normal` font: "100%" is 26 px wide, "7000K" 30 px.
const GAUGE_X = 0;
const GAUGE_W = 4;
const BRIGHTNESS_CX = 21;
const BRIGHTNESS_BOX_W = 30;
const TEMPERATURE_CX = 55;
const TEMPERATURE_BOX_W = 34;
const MID_Y = 8;

function front(state: ViewState): Element[] {
  const { light, status } = state;
  const gaugeColor = status === "error" ? RED : light?.on ? tint(light.kelvin) : DIM;
  const elements: Element[] = [
    {
      id: "gauge",
      type: "rectangle",
      x: GAUGE_X,
      y: 1,
      width: GAUGE_W,
      height: 14,
      fill: "none",
      border_width: 1,
      border_color: gaugeColor,
    },
  ];

  if (!light) {
    const text = status === "no_ip" ? "Set light IP" : status === "error" ? "No light" : "Connecting";
    elements.push({
      id: "message",
      type: "text",
      text,
      font: "small",
      color: status === "error" ? RED : WHITE,
      x: 39,
      y: MID_Y,
      align: "center",
    });
    return elements;
  }

  if (light.on) {
    // The frame's inside is 12 px tall; any brightness shows at least one row.
    const height = Math.max(1, Math.round((12 * light.brightness) / 100));
    elements.push({
      id: "gauge_fill",
      type: "rectangle",
      x: GAUGE_X + 1,
      y: 14 - height,
      width: GAUGE_W - 2,
      height,
      fill: "solid",
      fill_colors: [gaugeColor],
      border_width: 0,
    });
  }

  const values: { field: Field; text: string; color: string; cx: number; boxWidth: number }[] = [
    {
      field: "brightness",
      text: `${light.brightness}%`,
      color: light.on ? WHITE : DIM,
      cx: BRIGHTNESS_CX,
      boxWidth: BRIGHTNESS_BOX_W,
    },
    {
      field: "temperature",
      text: `${light.kelvin}K`,
      color: light.on ? tint(light.kelvin) : DIM,
      cx: TEMPERATURE_CX,
      boxWidth: TEMPERATURE_BOX_W,
    },
  ];

  for (const value of values) {
    const boxed = state.highlighted && state.selected === value.field;
    // The box is always there, empty when not highlighted, so highlighting never needs a DisplayClear.
    elements.push(
      {
        id: `${value.field}_box`,
        type: "rectangle",
        x: value.cx - Math.floor(value.boxWidth / 2),
        y: 2,
        width: value.boxWidth,
        height: 12,
        radius: 2,
        fill: "solid",
        fill_colors: [boxed ? value.color : NONE],
        border_width: 0,
        z_index: 1,
      },
      {
        id: `${value.field}_text`,
        type: "text",
        text: value.text,
        font: "normal",
        color: boxed ? BLACK : value.color,
        x: value.cx,
        y: MID_Y,
        align: "center",
        z_index: 2,
      },
    );
  }
  return elements;
}

const STATUS_TEXT: Record<Status, string> = {
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
    state.status === "no_ip"
      ? state.host
        ? `"${state.host}" is not an IP address. Fix it in the BUSY Bar's web interface.`
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
