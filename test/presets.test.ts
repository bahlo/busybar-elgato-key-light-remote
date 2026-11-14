import { describe, expect, it } from "vitest";
import settings from "../src/appmeta/settings.json";
import { DEFAULTS, activePreset, presetsFrom } from "../src/presets";

describe("presetsFrom", () => {
  it("has the same defaults as settings.json", () => {
    const fields = settings.fields;
    expect(DEFAULTS).toEqual([
      { brightness: fields.preset_1_brightness.default, kelvin: fields.preset_1_temperature.default },
      { brightness: fields.preset_2_brightness.default, kelvin: fields.preset_2_temperature.default },
      { brightness: fields.preset_3_brightness.default, kelvin: fields.preset_3_temperature.default },
      { brightness: fields.preset_4_brightness.default, kelvin: fields.preset_4_temperature.default },
    ]);
  });

  it("falls back to the defaults", () => {
    expect(presetsFrom({})).toEqual(DEFAULTS);
    expect(presetsFrom({ preset_1_brightness: "50", preset_1_temperature: null })[0]).toEqual(DEFAULTS[0]);
  });

  it("gives none when presets are hidden", () => {
    expect(presetsFrom({ show_presets: false })).toEqual([]);
  });

  it("clamps and rounds to what the light and the wheel take", () => {
    const [first] = presetsFrom({ preset_1_brightness: 250, preset_1_temperature: 4520 });
    expect(first).toEqual({ brightness: 100, kelvin: 4500 });
    const [low] = presetsFrom({ preset_1_brightness: 0, preset_1_temperature: 100 });
    expect(low).toEqual({ brightness: 1, kelvin: 2900 });
  });
});

describe("activePreset", () => {
  const presets = [
    { brightness: 100, kelvin: 5600 },
    { brightness: 100, kelvin: 5600 },
    { brightness: 40, kelvin: 3500 },
  ];

  it("finds the preset the light matches", () => {
    expect(activePreset(presets, { brightness: 40, kelvin: 3500 })).toBe(2);
  });

  it("gives -1 when nothing matches or nothing is known", () => {
    expect(activePreset(presets, { brightness: 41, kelvin: 3500 })).toBe(-1);
    expect(activePreset(presets, null)).toBe(-1);
  });

  it("prefers the chosen one among presets with the same values", () => {
    const light = { brightness: 100, kelvin: 5600 };
    expect(activePreset(presets, light)).toBe(0);
    expect(activePreset(presets, light, 1)).toBe(1);
  });

  it("ignores a chosen preset the light no longer matches", () => {
    expect(activePreset(presets, { brightness: 40, kelvin: 3500 }, 1)).toBe(2);
    expect(activePreset(presets, { brightness: 100, kelvin: 5600 }, 7)).toBe(0);
  });
});
