// Presets: four brightness and color temperature pairs from the app's settings, all shown or, with "Show presets"
// off, none.
// The active preset is the one the light matches, so a change made by hand, here or in Control Center, leaves no
// preset active by itself.

import type { SettingsValues } from "@shared/settings";
import { BRIGHTNESS_MAX, BRIGHTNESS_MIN, KELVIN_MAX, KELVIN_MIN, KELVIN_STEP, clamp } from "./elgato";

export interface Preset {
  brightness: number;
  kelvin: number;
}

/** The defaults in settings.json, for a value that is missing or not a number. */
const DEFAULTS: Preset[] = [
  { brightness: 100, kelvin: 5600 },
  { brightness: 70, kelvin: 4500 },
  { brightness: 40, kelvin: 3500 },
  { brightness: 15, kelvin: 2900 },
];

const integer = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;

/** The four presets in order, or none when "Show presets" is off. */
export function presetsFrom(values: SettingsValues): Preset[] {
  if (values.show_presets === false) return [];
  return DEFAULTS.map((fallback, i) => {
    const temperature = values[`preset_${i + 1}_temperature`];
    const kelvin = Math.round(integer(temperature, fallback.kelvin) / KELVIN_STEP) * KELVIN_STEP;
    const brightness = integer(values[`preset_${i + 1}_brightness`], fallback.brightness);
    return {
      brightness: clamp(brightness, BRIGHTNESS_MIN, BRIGHTNESS_MAX),
      kelvin: clamp(kelvin, KELVIN_MIN, KELVIN_MAX),
    };
  });
}

/** The index of the preset the light matches, or -1 when it matches none. */
export function activePreset(presets: Preset[], light: Preset | null): number {
  if (!light) return -1;
  return presets.findIndex((p) => p.brightness === light.brightness && p.kelvin === light.kelvin);
}
