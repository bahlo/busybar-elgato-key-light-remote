import { describe, expect, it } from "vitest";
import { KELVIN_MAX, KELVIN_MIN, KELVIN_STEP, MIRED_MAX, MIRED_MIN, baseUrl, kelvinToMired, miredToKelvin } from "../src/elgato";

describe("baseUrl", () => {
  it("adds the default port", () => {
    expect(baseUrl("192.168.1.20")).toBe("http://192.168.1.20:9123");
  });

  it("keeps a given port", () => {
    expect(baseUrl("192.168.1.20:9223")).toBe("http://192.168.1.20:9223");
  });

  it("drops a scheme, spaces and trailing slashes", () => {
    expect(baseUrl("  http://192.168.1.20:9123/ ")).toBe("http://192.168.1.20:9123");
  });

  it("takes a host name", () => {
    expect(baseUrl("relay.lan")).toBe("http://relay.lan:9123");
  });

  it.each(["", "   ", "192.168.1.20/elgato", "a b", "[::1]", "192.168.1.20:0", "192.168.1.20:65536", "192.168.1.20:"])(
    "refuses %j",
    (setting) => {
      expect(baseUrl(setting)).toBeNull();
    },
  );

  it("refuses .local names, which the BUSY Bar cannot look up", () => {
    expect(baseUrl("elgato-key-light-air-1a2b.local")).toBeNull();
    expect(baseUrl("Light.LOCAL:9123")).toBeNull();
  });
});

describe("kelvin and mireds", () => {
  it("covers the light's range", () => {
    expect(kelvinToMired(KELVIN_MAX)).toBe(MIRED_MIN);
    expect(kelvinToMired(KELVIN_MIN)).toBe(MIRED_MAX);
    expect(miredToKelvin(MIRED_MIN)).toBe(KELVIN_MAX);
    expect(miredToKelvin(MIRED_MAX)).toBe(KELVIN_MIN);
  });

  it("clamps what is out of range", () => {
    expect(kelvinToMired(10_000)).toBe(MIRED_MIN);
    expect(kelvinToMired(1_000)).toBe(MIRED_MAX);
    expect(miredToKelvin(100)).toBe(KELVIN_MAX);
    expect(miredToKelvin(500)).toBe(KELVIN_MIN);
  });

  // The app shows what the light answers: a step that came back as another value would jump under the wheel and
  // never match a preset.
  it("gets every 50 K step back from the light unchanged", () => {
    for (let kelvin = KELVIN_MIN; kelvin <= KELVIN_MAX; kelvin += KELVIN_STEP) {
      expect(miredToKelvin(kelvinToMired(kelvin))).toBe(kelvin);
    }
  });
});
