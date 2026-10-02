#!/usr/bin/env node
/*
 * Browser smoke test for the Atlas: boots the page in headless Chrome, checks it renders
 * without console errors, then walks every tutorial step — running each step's
 * "Do it for me" (or a scripted stand-in) — and fails if any task doesn't tick itself off.
 *
 * Run: node atlas/tests/smoke.mjs   (needs `puppeteer`, or `puppeteer-core` + CHROME_PATH)
 * Serves the repo root itself, so no other server is needed. Exit code 1 on any failure.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".svg": "image/svg+xml" };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
}).listen(0);
const port = server.address().port;

let puppeteer;
try { puppeteer = (await import("puppeteer")).default; }
catch { puppeteer = (await import("puppeteer-core")).default; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const failures = [];

const browser = await puppeteer.launch({
  headless: "new", executablePath: process.env.CHROME_PATH || undefined,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on("console", m => { if (m.type() === "error") failures.push("console: " + m.text()); });
  page.on("pageerror", e => failures.push("pageerror: " + e.message));
  await page.goto(`http://localhost:${port}/atlas/#e=redsea-2023`, { waitUntil: "load", timeout: 60000 });
  await sleep(4000);

  const boot = await page.evaluate(() => ({
    version: window.AtlasApp && window.AtlasApp.version,
    cost: document.querySelector("#kpi-cost .k-val").textContent,
    validation: document.getElementById("validation-summary").textContent,
    paths: window.AtlasApp.result() ? window.AtlasApp.result().prep.dis.services.length : 0
  }));
  console.log("boot:", JSON.stringify(boot));
  if (!boot.version) failures.push("app did not boot");
  if (!/\$/.test(boot.cost)) failures.push("cost KPI not rendered: " + boot.cost);
  const vm = boot.validation.match(/(\d+) of (\d+)/);
  if (!vm || vm[1] !== vm[2]) failures.push("validation not all passing: " + boot.validation);

  // theme toggle + a chart table view
  await page.click("#theme-toggle");
  const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  await page.click("#theme-toggle");
  await page.evaluate(() => document.querySelector("#cost-chart .chart-tools button").click());
  const tableRows = await page.evaluate(() => document.querySelectorAll("#cost-chart-tbl tbody tr").length);
  if (!tableRows) failures.push("cost chart table view empty");
  console.log("theme toggled to:", theme, "· cost table rows:", tableRows);

  // walk the tutorial
  const manual = {
    "beginner/globe": `window.AtlasApp.focusGlobe(10,10); document.querySelector('#globe canvas').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:900,clientY:400,pointerId:1,button:0,isPrimary:true}));`,
    "advanced/sensitivity": `(()=>{const i=document.getElementById('a-lostMarginPerTeu'); i.value=40000; i.dispatchEvent(new Event('input',{bubbles:true})); setTimeout(()=>window.AtlasApp.runPortfolio(),300);})()`,
    "pro/exposure": `document.querySelector('#choke-table tbody tr').click()`
  };
  const levels = await page.evaluate(() => window.AtlasTutorial.LEVELS.map(l => ({ id: l.id, steps: l.steps.map(s => ({ id: s.id, task: !!s.task, doit: !!s.doit })) })));
  for (const L of levels) {
    await page.evaluate(id => window.AtlasTutorialInstance.start(id), L.id);
    await sleep(600);
    const line = [];
    for (let i = 0; i < L.steps.length; i++) {
      const s = L.steps[i], key = L.id + "/" + s.id;
      await page.evaluate(i => window.AtlasTutorialInstance.go(i), i);
      await sleep(500);
      if (!s.task) { line.push("·"); continue; }
      if (manual[key]) await page.evaluate(manual[key]);
      else if (s.doit) await page.evaluate(() => document.querySelector(".tut-panel .tut-do").click());
      let done = false;
      for (let t = 0; t < 30 && !done; t++) { await sleep(400); done = (await page.evaluate(() => window.AtlasTutorialInstance.state())).done; }
      line.push(done ? "✓" : "✗");
      if (!done) failures.push(`tutorial ${key} did not complete`);
    }
    console.log(L.id.padEnd(9), line.join(" "));
  }
} finally {
  await browser.close();
  server.close();
}
if (failures.length) { console.error("FAIL\n" + failures.join("\n")); process.exit(1); }
console.log("PASS");
