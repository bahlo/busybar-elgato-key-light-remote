#!/usr/bin/env node
// A fake Elgato Key Light Air for developing the app without a light, or for making a light misbehave on purpose.
//
// It serves the light's local HTTP API (the same paths, methods and JSON as a real Key Light) and can be told, while it
// runs, to answer late, not at all, with an HTTP error, with garbage, or to drop the connection. Commands come from its
// terminal or from a control port, so a script can switch faults:
//
//   node tools/fake-light.mjs                    # light on 0.0.0.0:9123, control on 127.0.0.1:9124
//   curl -d 'fault hang' localhost:9124          # the light stops answering
//   curl -d 'clear' localhost:9124               # and is fine again
//
// `node tools/fake-light.mjs --help` lists the options, `help` in its terminal the commands.
import http from "node:http";
import readline from "node:readline";
import { parseArgs } from "node:util";

const HELP_OPTIONS = `Usage: node tools/fake-light.mjs [options]

  --port <n>          the light's port (default 9123)
  --host <addr>       where the light listens (default 0.0.0.0, so a BUSY Bar on the network can reach it)
  --control-port <n>  the control port, on 127.0.0.1 only (default 9124, 0 turns it off)
  --name <text>       the light's display name (default "Desk Light")
  --latency <ms>      answer every request this much later
  --fault "<fault>"   start with a fault, as the fault command takes it, e.g. --fault "http 503 only=put"
  --quiet             do not log requests
  --help              show this`;

const HELP_COMMANDS = `Commands (type them here, or send them: curl -d '<command>' localhost:<control-port>):

  status                       the light's state and what is set to go wrong
  set on=1 brightness=50 temperature=200
                               change the light as Control Center would (any of the three; temperature in mireds,
                               143-344, or kelvin=4500)
  toggle                       turn the light on or off
  latency <ms>                 answer every request this much later (0: at once)
  fault <kind> [options]       make requests fail:
      reset                    close the connection without answering (the app sees "socket error")
      hang                     accept the request and never answer (the BUSY Bar gives up after 5 s)
      http <status>            answer with this HTTP status, e.g. http 500, http 503
      garbage                  answer 200 with a body that is not JSON
      bad-shape                answer 200 with JSON in the wrong shape (no lights)
      ignore-writes            answer PUTs with 200 and the old state, changing nothing
    options:
      only=get|put             fail only reads or only writes
      times=<n>                fail the next n matching requests, then recover
      rate=<0..1>              fail only this share of matching requests, at random
  clear                        no fault, no latency
  offline                      stop listening: connections are refused, as with a light that is off or gone
  online                       listen again
  help                         show this`;

const MIRED_MIN = 143;
const MIRED_MAX = 344;

const { values: options } = parseArgs({
  options: {
    port: { type: "string", default: "9123" },
    host: { type: "string", default: "0.0.0.0" },
    "control-port": { type: "string", default: "9124" },
    name: { type: "string", default: "Desk Light" },
    latency: { type: "string", default: "0" },
    fault: { type: "string" },
    quiet: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (options.help) {
  console.log(`${HELP_OPTIONS}\n\n${HELP_COMMANDS}`);
  process.exit(0);
}

// The light. Field names and values as the API has them.
const light = { on: 1, brightness: 40, temperature: 213 };
const settings = {
  powerOnBehavior: 1,
  powerOnBrightness: 20,
  powerOnTemperature: 213,
  switchOnDurationMs: 100,
  switchOffDurationMs: 300,
  colorChangeDurationMs: 100,
};
const info = {
  productName: "Elgato Key Light Air",
  hardwareBoardType: 200,
  firmwareBuildNumber: 218,
  firmwareVersion: "1.0.3",
  serialNumber: "CW44J2A03032",
  displayName: options.name,
  features: ["lights"],
};

/** What goes wrong. `fault` is null when nothing does. */
const trouble = { latencyMs: Number(options.latency) || 0, fault: null };

const log = (...parts) => console.log(new Date().toISOString().slice(11, 23), ...parts);

function describeFault(fault) {
  if (!fault) return "none";
  const parts = [fault.kind === "http" ? `http ${fault.status}` : fault.kind];
  if (fault.only) parts.push(`only=${fault.only}`);
  if (fault.times !== null) parts.push(`times=${fault.times} left`);
  if (fault.rate !== null) parts.push(`rate=${fault.rate}`);
  return parts.join(" ");
}

function status() {
  return {
    online,
    light: { ...light, kelvin: Math.round(1e6 / light.temperature) },
    latencyMs: trouble.latencyMs,
    fault: describeFault(trouble.fault),
  };
}

// --- Commands ------------------------------------------------------------------------------------------------------

const FAULT_KINDS = new Set(["reset", "hang", "http", "garbage", "bad-shape", "ignore-writes"]);

class CommandError extends Error {}

function parseFault(words) {
  const [kind, ...rest] = words;
  if (!FAULT_KINDS.has(kind)) throw new CommandError(`unknown fault "${kind ?? ""}"; one of: ${[...FAULT_KINDS].join(", ")}`);
  const fault = { kind, status: null, only: null, times: null, rate: null };
  if (kind === "http") {
    const code = Number(rest.shift());
    if (!Number.isInteger(code) || code < 100 || code > 599) throw new CommandError("http needs a status, e.g. fault http 503");
    fault.status = code;
  }
  for (const word of rest) {
    const [key, value] = word.split("=");
    if (key === "only" && (value === "get" || value === "put")) fault.only = value;
    else if (key === "times" && Number.isInteger(Number(value)) && Number(value) > 0) fault.times = Number(value);
    else if (key === "rate" && Number(value) > 0 && Number(value) <= 1) fault.rate = Number(value);
    else throw new CommandError(`unknown option "${word}"; only=get|put, times=<n>, rate=<0..1>`);
  }
  if (kind === "ignore-writes" && fault.only === "get") throw new CommandError("ignore-writes is about PUTs; only=get makes no sense");
  return fault;
}

function setLight(words) {
  const next = { ...light };
  for (const word of words) {
    const [key, raw] = word.split("=");
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new CommandError(`"${word}" needs a number`);
    if (key === "on" && (value === 0 || value === 1)) next.on = value;
    else if (key === "brightness" && value >= 0 && value <= 100) next.brightness = Math.round(value);
    else if (key === "temperature" && value >= MIRED_MIN && value <= MIRED_MAX) next.temperature = Math.round(value);
    else if (key === "kelvin" && value >= 2900 && value <= 7000) next.temperature = Math.round(1e6 / value);
    else throw new CommandError(`"${word}" is out of range: on=0|1, brightness=0-100, temperature=${MIRED_MIN}-${MIRED_MAX}, kelvin=2900-7000`);
  }
  Object.assign(light, next);
}

/** Runs one command line and returns what to tell whoever sent it. */
function run(line) {
  const [command, ...words] = line.trim().split(/\s+/);
  switch (command) {
    case "":
      return null;
    case "help":
      return HELP_COMMANDS;
    case "status":
      return status();
    case "set":
      if (!words.length) throw new CommandError("set what? e.g. set on=0 brightness=60");
      setLight(words);
      return status();
    case "toggle":
      light.on = light.on ? 0 : 1;
      return status();
    case "latency": {
      const ms = Number(words[0]);
      if (!Number.isFinite(ms) || ms < 0) throw new CommandError("latency needs milliseconds, e.g. latency 800");
      trouble.latencyMs = ms;
      return status();
    }
    case "fault":
      trouble.fault = parseFault(words);
      return status();
    case "clear":
      trouble.fault = null;
      trouble.latencyMs = 0;
      return status();
    case "offline":
      goOffline();
      return status();
    case "online":
      goOnline();
      return status();
    default:
      throw new CommandError(`unknown command "${command}"; try help`);
  }
}

function runAndPrint(line, print) {
  try {
    const answer = run(line);
    if (answer !== null) print(typeof answer === "string" ? answer : JSON.stringify(answer, null, 2));
  } catch (err) {
    if (!(err instanceof CommandError)) throw err;
    print(`error: ${err.message}`);
    return false;
  }
  return true;
}

// --- The light's API -----------------------------------------------------------------------------------------------

/** The fault that applies to this request, if any, counting it against `times`. */
function faultFor(method) {
  const fault = trouble.fault;
  if (!fault) return null;
  if (fault.only === "get" && method !== "GET") return null;
  if (fault.only === "put" && method !== "PUT") return null;
  if (fault.kind === "ignore-writes" && method !== "PUT") return null;
  if (fault.rate !== null && Math.random() >= fault.rate) return null;
  if (fault.times !== null) {
    fault.times -= 1;
    if (fault.times <= 0) {
      trouble.fault = null;
      log("fault used up, the light is fine again");
    }
  }
  return fault;
}

function send(res, status, body) {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

const lights = () => ({ numberOfLights: 1, lights: [{ ...light }] });

/** Applies a PUT /elgato/lights body; null when it is not one the light takes. */
function applyLights(body, ignore) {
  const patch = body?.lights?.[0];
  if (!patch || typeof patch !== "object") return null;
  const next = { ...light };
  if ("on" in patch) {
    if (patch.on !== 0 && patch.on !== 1) return null;
    next.on = patch.on;
  }
  if ("brightness" in patch) {
    if (!Number.isInteger(patch.brightness) || patch.brightness < 0 || patch.brightness > 100) return null;
    next.brightness = patch.brightness;
  }
  if ("temperature" in patch) {
    if (!Number.isInteger(patch.temperature) || patch.temperature < MIRED_MIN || patch.temperature > MIRED_MAX) return null;
    next.temperature = patch.temperature;
  }
  if (!ignore) Object.assign(light, next);
  return lights();
}

function answer(req, res, raw, fault) {
  if (fault?.kind === "http") return send(res, fault.status);
  if (fault?.kind === "garbage") return send(res, 200, "<html><body>oops</body></html>");
  if (fault?.kind === "bad-shape") return send(res, 200, { numberOfLights: 0, lights: [] });

  let body;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      return send(res, 400);
    }
  }
  const route = `${req.method} ${req.url.split("?")[0]}`;
  switch (route) {
    case "GET /elgato/lights":
      return send(res, 200, lights());
    case "PUT /elgato/lights": {
      const state = applyLights(body, fault?.kind === "ignore-writes");
      return state ? send(res, 200, state) : send(res, 400);
    }
    case "GET /elgato/accessory-info":
      return send(res, 200, info);
    case "PUT /elgato/accessory-info":
      if (typeof body?.displayName !== "string") return send(res, 400);
      info.displayName = body.displayName;
      return send(res, 200);
    case "GET /elgato/lights/settings":
      return send(res, 200, settings);
    case "PUT /elgato/lights/settings":
      if (!body || typeof body !== "object") return send(res, 400);
      for (const key of Object.keys(settings)) if (typeof body[key] === "number") settings[key] = body[key];
      return send(res, 200, settings);
    case "POST /elgato/identify":
      log("* blink blink *");
      return send(res, 200);
    default:
      return send(res, 404);
  }
}

/** Requests left hanging, so `clear` or `offline` can let them go. */
const hanging = new Set();

const lightServer = http.createServer((req, res) => {
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const fault = faultFor(req.method);
    if (!options.quiet) {
      const what = fault ? `  -> fault: ${describeFault(fault)}` : "";
      log(`${req.method} ${req.url} HTTP/${req.httpVersion}${raw ? ` ${raw}` : ""}${what}`);
    }
    if (fault?.kind === "reset") {
      req.socket.destroy();
      return;
    }
    if (fault?.kind === "hang") {
      hanging.add(req.socket);
      req.socket.on("close", () => hanging.delete(req.socket));
      // Not forever: a minute is far past any client's patience.
      req.socket.setTimeout(60_000, () => req.socket.destroy());
      return;
    }
    const reply = () => answer(req, res, raw, fault);
    if (trouble.latencyMs > 0) setTimeout(reply, trouble.latencyMs);
    else reply();
  });
});

const lightPort = Number(options.port);

/** Whether the light is meant to be reachable; set at once, while listen() and close() finish on their own time. */
let online = false;

function goOnline() {
  if (online) return;
  online = true;
  lightServer.listen(lightPort, options.host, () => log(`light listening on ${options.host}:${lightPort}`));
}

function goOffline() {
  if (!online) return;
  online = false;
  lightServer.close(() => log("light offline: connections are refused"));
  lightServer.closeAllConnections();
  for (const socket of hanging) socket.destroy();
}

lightServer.on("error", (err) => {
  console.error(`light: ${err.message}`);
  process.exit(1);
});

// --- Control -------------------------------------------------------------------------------------------------------

const controlPort = Number(options["control-port"]);
if (controlPort > 0) {
  const control = http.createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const line = req.method === "GET" ? "status" : raw;
      let output = "";
      const ok = runAndPrint(line, (text) => (output = text));
      res.writeHead(ok ? 200 : 400, { "Content-Type": "text/plain" });
      res.end(`${output}\n`);
      if (ok && line.trim() && line.trim() !== "status") log(`control: ${line.trim()}`);
    });
  });
  control.on("error", (err) => {
    console.error(`control: ${err.message}`);
    process.exit(1);
  });
  control.listen(controlPort, "127.0.0.1", () => log(`control on 127.0.0.1:${controlPort}: curl -d 'help' localhost:${controlPort}`));
}

if (options.fault) {
  try {
    trouble.fault = parseFault(options.fault.trim().split(/\s+/));
  } catch (err) {
    console.error(`--fault: ${err.message}`);
    process.exit(2);
  }
}

goOnline();
log(`fault: ${describeFault(trouble.fault)}, latency: ${trouble.latencyMs} ms. Type help for commands.`);

// Commands from the terminal. Without one (stdin closed), the light keeps running.
if (process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "light> " });
  rl.on("line", (line) => {
    runAndPrint(line, console.log);
    rl.prompt();
  });
  rl.prompt();
}
