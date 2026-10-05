#!/usr/bin/env node
/*
 * Global Disruption Atlas — command-line runner (v5).
 *
 *   node atlas/cli/run.mjs spec.json [--signals atlas/data/signals.js] [--out result.json]
 *   cat spec.json | node atlas/cli/run.mjs -
 *
 * Runs a JSON scenario spec (see engine/api.js for the format) through the same engine the
 * page uses and prints the JSON result. Uses the live-data snapshot shipped with the Atlas
 * unless --signals points elsewhere (or --no-signals).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log("usage: node atlas/cli/run.mjs <spec.json|-> [--signals file] [--no-signals] [--out file]\nSee atlas/engine/api.js for the spec format and atlas/examples/ for samples.");
  process.exit(args.length ? 0 : 1);
}
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const specPath = args[0];
const spec = JSON.parse(specPath === "-" ? readFileSync(0, "utf8") : readFileSync(resolve(specPath), "utf8"));
const data = require(join(here, "..", "data.js"));
let signals = null;
if (!args.includes("--no-signals")) {
  try { signals = require(resolve(opt("--signals") || join(here, "..", "data", "signals.js"))); }
  catch (e) { console.error("warning: no live snapshot (" + e.message + "); continuing without live data"); }
}
const Api = require(join(here, "..", "engine", "api.js"));
const version = (readFileSync(join(here, "..", "app.js"), "utf8").match(/APP_VERSION = "([^"]+)"/) || [])[1] || "";
const t0 = Date.now();
const result = Api.run(spec, data, signals, version);
result.runtimeMs = Date.now() - t0;
const text = JSON.stringify(result, null, 2);
if (opt("--out")) { writeFileSync(resolve(opt("--out")), text); console.error("wrote " + opt("--out")); }
else process.stdout.write(text + "\n");
