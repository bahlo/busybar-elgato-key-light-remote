#!/usr/bin/env node
// Forwards requests to an Elgato Key Light over HTTP/1.1. A real Key Light Air answers 400 to a PUT over HTTP/1.0,
// which is the only version the BUSY Bar (and the BUSY Bar Emulator) sends, so changes fail. Point the app's
// Key Light IP address at this relay instead of the light, and it re-sends each request to the light as HTTP/1.1.
// A real BUSY Bar and the emulator both need it to change a real light, until the firmware sends HTTP/1.1
// (busy-app/busybar-firmware#1125). Reading the light works without it.
//
// The relay has no authentication, like the light itself: anyone on the network who can reach it can change the light.
//
//   node tools/http11-relay.mjs --light 192.168.1.20        # relay on :9123 -> light at 192.168.1.20:9123
//   node tools/http11-relay.mjs --light 192.168.1.20 --port 9223
import http from "node:http";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    light: { type: "string" }, // the light's host, with an optional :port (default 9123)
    port: { type: "string", default: "9123" }, // where the relay listens
    host: { type: "string", default: "0.0.0.0" }, // so a BUSY Bar on the network can reach it
    quiet: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help || !values.light) {
  console.log(
    "Usage: node tools/http11-relay.mjs --light <host[:port]> [--port <listen>] [--host <addr>] [--quiet]\n" +
      "Forwards to the light over HTTP/1.1. Point the app's Key Light IP address at this relay.",
  );
  process.exit(values.help ? 0 : 2);
}

const [lightHost, lightPort = "9123"] = values.light.split(":");
const listenPort = Number(values.port);
if (!lightHost || ![listenPort, Number(lightPort)].every((p) => Number.isInteger(p) && p > 0 && p < 65536)) {
  console.error("relay: --light needs a host with an optional port, and --port a port, both from 1 to 65535");
  process.exit(2);
}
// Less than the 5 s after which the BUSY Bar gives up, so the app gets the relay's 502 instead of a timeout.
const UPSTREAM_TIMEOUT_MS = 4000;
const log = (...a) => !values.quiet && console.log(new Date().toISOString().slice(11, 19), ...a);

http
  .createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      // http.request speaks HTTP/1.1. Keep the method, path and body; set a clean Host and ask the light to close so
      // the response ends cleanly (the light otherwise keeps HTTP/1.1 connections open).
      const headers = {
        host: `${lightHost}:${lightPort}`,
        connection: "close",
        ...(req.headers["content-type"] ? { "content-type": req.headers["content-type"] } : {}),
        ...(body.length ? { "content-length": String(body.length) } : {}),
      };
      const upstream = http.request(
        { host: lightHost, port: Number(lightPort), method: req.method, path: req.url, headers, timeout: UPSTREAM_TIMEOUT_MS },
        (up) => {
          const out = [];
          up.on("data", (c) => out.push(c));
          up.on("end", () => {
            const payload = Buffer.concat(out);
            log(`${req.method} ${req.url} -> ${up.statusCode}`);
            res.writeHead(up.statusCode ?? 502, {
              "Content-Type": up.headers["content-type"] ?? "application/json",
              "Content-Length": payload.length,
              Connection: "close",
            });
            res.end(payload);
          });
        },
      );
      upstream.on("timeout", () => upstream.destroy(new Error("timeout")));
      upstream.on("error", (err) => {
        log(`${req.method} ${req.url} -> error: ${err.message}`);
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      upstream.end(body);
    });
    req.on("error", () => {});
  })
  .on("error", (err) => {
    console.error(`relay: ${err.message}`);
    process.exit(1);
  })
  .listen(listenPort, values.host, () =>
    log(`relay on ${values.host}:${listenPort} -> light ${lightHost}:${lightPort} (HTTP/1.1)`),
  );
