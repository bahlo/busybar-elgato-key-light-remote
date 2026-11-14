import { describe, expect, it } from "vitest";
import { elements, tint, type ViewState } from "../src/view";

const base: ViewState = {
  host: "192.168.1.20",
  light: { on: true, brightness: 40, kelvin: 4700 },
  info: null,
  status: "ok",
  error: null,
  writeError: null,
  presets: [],
  chosenPreset: -1,
  selected: "brightness",
  highlighted: false,
};

const byId = (state: ViewState) => new Map(elements(state).map((element) => [element.id, element]));
const text = (state: ViewState, id: string) => (byId(state).get(id) as { text?: string } | undefined)?.text;

describe("elements", () => {
  it("gives every element its own id", () => {
    const ids = elements({ ...base, presets: [{ brightness: 40, kelvin: 4700 }] }).map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows a message until the light has answered", () => {
    expect(text({ ...base, light: null, status: "connecting" }, "message")).toBe("Connecting");
    expect(text({ ...base, light: null, status: "no_ip", host: "" }, "message")).toBe("Set light IP");
    expect(text({ ...base, light: null, status: "no_settings" }, "message")).toBe("No settings");
    expect(text({ ...base, light: null, status: "error", error: "socket error" }, "message")).toBe("No light");
  });

  it("shows the values", () => {
    expect(text(base, "brightness_text")).toBe("40%");
    expect(text(base, "temperature_text")).toBe("4700K");
  });

  it("has no bar while the light is off", () => {
    expect(byId({ ...base, light: { on: false, brightness: 40, kelvin: 4700 } }).has("gauge_fill")).toBe(false);
  });

  it("has a red bar while the light does not answer, also when it was off", () => {
    const state: ViewState = { ...base, status: "error", error: "socket error", light: { on: false, brightness: 40, kelvin: 4700 } };
    expect(byId(state).get("gauge_fill")).toMatchObject({ fill_colors: ["#FF3020FF"] });
  });

  it("keeps the bar on the display", () => {
    for (const brightness of [0, 1, 50, 100]) {
      const gauge = byId({ ...base, status: "error", light: { on: true, brightness, kelvin: 4700 } }).get("gauge_fill");
      expect(gauge).toMatchObject({ y: expect.any(Number), height: expect.any(Number) });
      const { y, height } = gauge as { y: number; height: number };
      expect(y).toBeGreaterThanOrEqual(1);
      expect(y + height).toBe(15);
    }
  });

  it("outlines only the selected value, and only while highlighted", () => {
    const visible = (state: ViewState, id: string) =>
      (byId(state).get(id) as { border_color?: string }).border_color !== "#00000000";
    expect(visible(base, "brightness_box")).toBe(false);
    expect(visible({ ...base, highlighted: true }, "brightness_box")).toBe(true);
    expect(visible({ ...base, highlighted: true }, "temperature_box")).toBe(false);
  });

  it("explains a failed change on the back, but an unreachable light first", () => {
    expect(text({ ...base, writeError: "HTTP 500 on PUT /elgato/lights" }, "b_detail")).toContain("Last change failed");
    expect(text({ ...base, status: "error", error: "socket error", writeError: "x" }, "b_detail")).toBe("socket error");
    expect(byId(base).has("b_detail")).toBe(false);
  });
});

describe("tint", () => {
  it("goes from warm to cool", () => {
    expect(tint(2900)).toBe("#FFA850FF");
    expect(tint(7000)).toBe("#C8DCFFFF");
  });
});
