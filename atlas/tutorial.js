/* Global Disruption Atlas — guided tutorial.
 *
 * Four levels: Beginner, Medium, Advanced, Pro. Each step highlights part of the app,
 * explains it, and usually asks the user to try something; the step notices when they
 * have (a `check` against the app's state) and ticks itself off. Most steps offer
 * "Do it for me". Progress is remembered per level in this browser, and every level can
 * be read as a written guide. Engine adapted from the Cobot Lab tutorial.
 *
 * The app hands over window.AtlasApp (read-only views + a few actions + event counters),
 * so this file never reaches into the app's internals.
 */
(function (root) {
  "use strict";

  var since = function (app, base, k) { return app.flag(k) - (base.flags[k] || 0); };
  var has = function (app, id) { return app.events().indexOf(id) >= 0; };
  var res = function (app) { return app.result() || {}; };

  var LEVELS = [
    // ------------------------------------------------------------------ BEGINNER
    {
      id: "beginner", name: "Beginner", tagline: "Read the map", minutes: 8,
      learn: ["Move around the globe and the 2D map", "See today's real chokepoint traffic", "Replay a real disruption and watch ships reroute",
              "Read your daily brief", "Read the four headline numbers", "Open details on any port, chokepoint or event"],
      setup: function (app) { app.resetAll(); app.setProjection("3d"); },
      steps: [
        { id: "welcome", title: "Welcome to the Atlas",
          body: "<p>The Global Disruption Atlas asks one question: <b>when something breaks in global shipping, what happens to a supply network — and what should you do about it?</b></p>" +
                "<p>It combines <b>real data</b> (daily ship transits through the world's chokepoints), a <b>sea-lane router</b> that sends ships the way they really go, and an <b>optimiser</b> that re-plans the network and costs the result.</p>" +
                "<p>The network you'll see first is a <em>made-up</em> electronics company on real ports and lanes. In the Pro level you'll load your own.</p>" +
                "<p>Each step highlights what it's about; when you've done the task it ticks itself off. <b>Next</b> always skips ahead.</p>" },
        { id: "globe", title: "Spin the globe", target: "#globe-wrap",
          body: "<p>Drag to rotate, scroll to zoom. The lines are <b>ocean services</b> — weekly container sailings between ports — drawn along the sea lanes they actually use, through straits and canals. Line width shows weekly volume.</p>" +
                "<p>Short teal lines are road, rail and barge legs from factories to ports and from ports to distribution centres (DCs).</p>",
          task: "Drag the globe to look around.",
          check: function (app, b) { return since(app, b, "globe-move") > 0; },
          doit: { label: "Show me Europe", run: function (app) { app.focusGlobe(45, 10, 1.6); } } },
        { id: "asof", title: "This is real data", target: "#asof-chip",
          body: "<p>Every day a scheduled job downloads ship-transit counts for 14 chokepoints from <b>IMF PortWatch</b> (built from satellite AIS signals), plus disaster alerts from <b>GDACS</b> and earthquakes from <b>USGS</b>.</p>" +
                "<p>This chip shows how fresh the snapshot is. Nothing on this page is a simulated \"live feed\".</p>" },
        { id: "brief", title: "Your daily brief", target: "#brief-panel",
          body: "<p>Below the map, the <b>Daily brief</b> says what changed in that data since your last visit — a chokepoint or port crossing into or out of trouble, a new hazard alert near the network — ranked by how much of <em>your</em> volume it touches.</p>" +
                "<p>On a first visit it describes today's picture instead. It remembers what you saw in this browser only, and you can download it as Markdown to paste into an email or chat.</p>" },
        { id: "live", title: "Today's conditions", target: "#panel-scenario",
          body: "<p>The <b>Live</b> tab turns that data into a scenario. A chokepoint whose container traffic has fallen below <b>35%</b> of its 2019–2023 normal is treated as <em>avoided</em> by container lines; 35–85% as <em>squeezed</em>.</p>" +
                "<p>Ports work the same way from their daily container calls (below 35% of normal: near-shut; 35–60%: reduced). The coloured chips show which chokepoints and ports on this network are down right now; hazard alerts close to the network are listed underneath, ready to model.</p>",
          task: "Tick “Live conditions” in the Live tab.",
          enter: function (app) { app.setTab("live"); },
          check: function (app) { return has(app, "live"); },
          doit: { label: "Do it for me", run: function (app) { app.setEvents(["live"]); } } },
        { id: "kpis", title: "The four headline numbers", target: "#kpis",
          body: "<ul><li><b>Disruption cost</b> — extra cost versus normal over the disruption.</li><li><b>Time-to-survive vs time-to-recover</b> — does every DC's stock last until things recover? ✓ if yes, ✕ and the day it runs out if not.</li><li><b>Lost sales</b> — demand that couldn't be served.</li><li><b>Service vs target</b> — how many product families stay on their fill-rate target.</li></ul>" +
                "<p>For live conditions the Atlas assumes the network has already adapted, so you see the <em>running cost</em> of today's situation, not a shock.</p>" },
        { id: "redsea", title: "Replay a real disruption", target: "#panel-scenario",
          body: "<p>Switch to the <b>Historical</b> tab. These events really happened; each has a date range and a source link.</p>" +
                "<p>Pick the <b>Red Sea / Bab-el-Mandeb attacks</b> (from December 2023). Untick Live first, so you see the Red Sea shock on its own.</p>",
          task: "Select only the Red Sea event.",
          enter: function (app) { app.setTab("historical"); },
          check: function (app) { var e = app.events(); return e.length === 1 && e[0] === "redsea-2023"; },
          doit: { label: "Do it for me", run: function (app) { app.setEvents(["redsea-2023"]); } } },
        { id: "reroute", title: "Watch the ships go round Africa", target: "#globe-wrap",
          enter: function (app) { app.focusGlobe(5, 30, 2.3); },
          body: "<p>With Bab-el-Mandeb closed, every Asia–Europe service is re-routed by the sea graph — <b>green</b> lines now run round the <b>Cape of Good Hope</b>. The old Suez routes show as <b>red dashes</b>.</p>" +
                "<p>That adds about 10 days at sea. Ships already past the Red Sea keep arriving for a few weeks; then the gap opens. Look at the KPIs: Venlo's 8-day buffer runs out about a month in. In early 2024 Tesla's Berlin plant paused production for two weeks for exactly this reason.</p>",
          task: "Click a port, a chokepoint (◆) or a DC on the map.",
          check: function (app, b) { return since(app, b, "info") > 0; },
          doit: { label: "Show me Bab-el-Mandeb", run: function (app) { app.showInfo({ kind: "choke", id: "BAM" }); } } },
        { id: "view2d", title: "The flat map", target: "#projection-toggle",
          body: "<p>The <b>2D Map</b> uses the Equal Earth projection, so ocean areas aren't distorted the way they are on Mercator. It's easier for seeing every lane at once. Hover for details; click to open them.</p>",
          task: "Switch to the 2D Map.",
          check: function (app) { return app.projection() === "2d"; },
          doit: { label: "Do it for me", run: function (app) { app.setProjection("2d"); } } },
        { id: "details", title: "Where the numbers come from", target: "#event-list",
          body: "<p>Every event card has a <b>Details</b> button: what happened, how the Atlas models it (which chokepoints close, capacity cuts, rate rises), the duration range, and a source link.</p>" +
                "<p>The effect sizes are modelling assumptions calibrated to the public record, and they're always shown.</p>",
          task: "Open Details on any event.",
          check: function (app, b) { return since(app, b, "info-event") > 0; },
          doit: { label: "Do it for me", run: function (app) { app.showInfo({ kind: "event", id: "redsea-2023" }); } } },
        { id: "done", title: "Beginner level complete",
          body: "<p>You can now read the map, the live data and the headline numbers. Next, <b>Medium</b> shows how to stress the network harder and respond with flexibility levers.</p>" }
      ]
    },

    // ------------------------------------------------------------------ MEDIUM
    {
      id: "medium", name: "Medium", tagline: "Stress-test and respond", minutes: 12,
      learn: ["Time-to-survive vs time-to-recover", "Change how long a disruption lasts", "Add safety stock until the network survives",
              "Combine overlapping disruptions", "Read the cost breakdown and the ocean-services table"],
      setup: function (app) { app.resetAll(); app.setProjection("3d"); app.setEvents(["redsea-2023"]); },
      steps: [
        { id: "ttsttr", title: "The core test: TTS vs TTR", target: "#kpis",
          body: "<p>David Simchi-Levi's stress test for supply chains compares two numbers:</p><ul><li><b>Time-to-recover (TTR)</b> — how long the disruption lasts.</li><li><b>Time-to-survive (TTS)</b> — how long you can keep meeting demand while it lasts.</li></ul>" +
                "<p>If TTS &lt; TTR you run out before things recover. The Red Sea scenario is loaded: Venlo runs short after about a month, while the disruption — ramping up over two weeks, lasting a year, easing over two months — runs for well over a year.</p>" },
        { id: "story", title: "What happened, in words", target: "#results-panel",
          body: "<p>Scroll down. <b>Scenario results</b> opens with a plain-language account of the scenario: what closed, how much volume rerouted, which DC runs out first, and what would fix it.</p><p>Every sentence is generated from the model's results.</p>" },
        { id: "inventory", title: "Inventory running down", target: "#inv-card",
          body: "<p>Each line is a DC's stock, in days of demand. At day 0 the disruption hits. Rerouted ships arrive ~10 days late, so stock drains; when a line hits the floor, demand goes unmet until the late ships land.</p><p>Hover to read exact values.</p>" },
        { id: "unfolds", title: "How it unfolds over time", target: "#serve-card",
          body: "<p>The Atlas simulates every day: the disruption ramps up and fades, freight rates spike and decay, planners react about a week late, ships at sea divert or queue, ports work through backlogs.</p>" +
                "<p><b>Demand met</b> shows each week's service level; <b>Cargo waiting</b> (next to it) shows backlogs building at ports and chokepoints and clearing afterwards. The story above says when service is back to normal — often well after conditions themselves recover: that's the <b>recovery tail</b>.</p>" },
        { id: "duration", title: "How long does it last?", target: "#duration",
          body: "<p>The <b>Peak duration</b> slider sets how long the disruption lasts at full strength (its ramp-up and fade come on top). It starts at the event's actual duration. Try a short one (2–3 weeks) and a long one: the cost scales with time, but the stock-out doesn't — it's caused by the gap at the start, while rerouted ships are still at sea.</p>",
          task: "Move the duration slider.",
          check: function (app, b) { return since(app, b, "duration") > 0; },
          doit: { label: "Set 30 days", run: function (app) { app.setDuration(30); } } },
        { id: "buffer", title: "Buy time with safety stock", target: "#panel-levers",
          body: "<p><b>Extra safety stock</b> adds days of demand at every DC. Push it to 20 days and watch the second KPI: the first stock-out moves later and lost sales fall.</p>" +
                "<p>But it doesn't go away. In a year-long crisis the rerouted ships carry less each week, and the most valuable families claim that capacity first — appliances and some PCs stay short however much stock you hold. <b>Stock buys time; it doesn't create capacity.</b> Watch <b>Annual cost of the options held</b> too: stock costs money every year, disruption or not.</p>",
          task: "Raise extra safety stock to 20 days or more.",
          check: function (app) { return app.levers().buffer >= 20; },
          doit: { label: "Do it for me", run: function (app) { app.setLevers({ buffer: 20 }); } } },
        { id: "combine", title: "Disruptions overlap", target: "#event-list",
          body: "<p>The Red Sea crisis and the Panama Canal drought actually <b>coincided</b> in late 2023 – early 2024. Tick both: the Atlas combines them, taking the tightest capacity and the largest rate rise for each trade.</p>",
          task: "Select both Red Sea and Panama Canal drought.",
          enter: function (app) { app.setTab("historical"); },
          check: function (app) { return has(app, "redsea-2023") && has(app, "panama-2023"); },
          doit: { label: "Do it for me", run: function (app) { app.setEvents(["redsea-2023", "panama-2023"]); } } },
        { id: "cost", title: "Where the money goes", target: "#cost-card",
          body: "<p>Extra cost by component, versus the baseline. Red bars are extra cost; blue bars are savings (e.g. cheaper legs used instead).</p><p>For the Red Sea, <b>freight-rate surcharges</b> dominate — carriers charge more when capacity is scarce. Remember this for the Advanced level.</p>" },
        { id: "families", title: "Not all products are equal", target: "#family-results",
          body: "<p>The sample company sells four <b>product families</b> — smartphones, PCs, components, appliances — each with its own value per container, cost of a lost sale and <b>fill-rate target</b> (judged on its worst four weeks). Edit them in the <b>Product families</b> panel on the left.</p>" +
                "<p>When capacity runs short, the planner protects the families with the highest lost-sale cost first, so cheaper families take the hit. This table shows each family's fill rate against its target; the <b>Fill rate by product family</b> chart shows it week by week.</p>" },
        { id: "lanes", title: "Every service, before and after", target: "#lanes-panel",
          body: "<p>The <b>Ocean services</b> table lists each weekly service: the chokepoints it passes, normal and current transit days, capacity (longer voyages mean fewer weekly slots), rate and planned flow. Click a row for details.</p>",
          task: "Tick “Only affected”.",
          check: function () { var x = document.getElementById("lane-affected-only"); return !!(x && x.checked); },
          doit: { label: "Do it for me", run: function () { var x = document.getElementById("lane-affected-only"); if (x && !x.checked) x.click(); } } },
        { id: "strike", title: "Short shock, long tail", target: "#panel-scenario",
          body: "<p>The 2024 US East & Gulf Coast strike lasted only 3 days. Load it on its own, then set the duration to <b>4 weeks</b> — a strike that long was widely planned for.</p>" +
                "<p>Cargo can't be unloaded at Savannah, New York or Houston, so it's re-planned through Los Angeles — about 4 weeks away. Atlanta's 8-day buffer can't bridge that.</p>",
          task: "Load the port strike and make it last 21 days or more.",
          check: function (app) { return has(app, "ila-2024") && app.duration() >= 21 && res(app).tts !== null; },
          doit: { label: "Do it for me", run: function (app) { app.setLevers({ buffer: 0 }); app.setEvents(["ila-2024"]); app.setDuration(28); } } },
        { id: "done", title: "Medium level complete",
          body: "<p>You can now stress the network, read TTS against TTR, and buy time with stock. But how much stock is <em>worth</em> it — and what about events whose length nobody knows? That's the <b>Advanced</b> level.</p>" }
      ]
    },

    // ------------------------------------------------------------------ ADVANCED
    {
      id: "advanced", name: "Advanced", tagline: "Quantify risk, value flexibility", minutes: 15,
      learn: ["Run a Monte Carlo over durations and rate shocks", "See what an air-freight bridge buys", "Hedge price risk with fixed-rate contracts",
              "Target safety stock at critical product families", "React faster with an early-warning control tower", "Optimise how much flexibility to hold", "Score all 64 lever combinations by expected annual loss", "Test sensitivity to assumptions", "Layer a scenario on top of today's reality"],
      setup: function (app) { app.resetAll(); app.setProjection("3d"); app.setEvents(["ila-2024"]); },
      steps: [
        { id: "why", title: "Nobody knows how long it will last",
          body: "<p>When a disruption starts, its duration is unknown. Deciding from one assumed duration is how companies get caught out.</p><p>The port-strike scenario is loaded. Its actual duration was 3 days, but the Atlas samples <b>2 to 42 days</b> (most likely 7), because a long stoppage was a real possibility.</p>" },
        { id: "mc", title: "Run the Monte Carlo", target: "#risk-panel",
          body: "<p><b>Risk distribution</b> re-costs the plan 400 times, each time drawing a duration from the event's range and scaling the rate shock by ×0.6–1.4.</p>",
          task: "Press “Run 400 samples”.",
          check: function (app, b) { return since(app, b, "mc") > 0; },
          doit: { label: "Do it for me", run: function (app) { app.runMc(); } } },
        { id: "read-mc", title: "Reading the distribution", target: "#mc-out",
          body: "<ul><li><b>P50</b> — the median outcome.</li><li><b>P90 / P99</b> — the bad and severe tails. This is what a risk appetite is set against.</li><li><b>Chance some DC runs short</b> — the probability TTS &lt; TTR.</li></ul><p>The histogram is long-tailed: most strikes are short and cheap, but a few long ones are very expensive.</p>" },
        { id: "air", title: "An air bridge for the gap", target: "#lever-checks",
          body: "<p>The <b>air-freight bridge contract</b> pre-books air capacity (120 TEU-equivalent per DC per week) that is used only to cover a shortfall. It lands about a week after booking — far sooner than re-routed ships.</p>",
          task: "Turn on the air bridge, then run the Monte Carlo again.",
          check: function (app, b) { return app.levers().airBridge && since(app, b, "mc") > 0; },
          doit: { label: "Do it for me", run: function (app) { app.setLevers({ airBridge: true }); app.runMc(); } } },
        { id: "hedge", title: "The cost nobody can reroute", target: "#lever-checks",
          enter: function (app) { app.setLevers({ airBridge: false }); app.setEvents(["redsea-2023"]); },
          body: "<p>Back to the Red Sea. Most of its cost is <b>freight-rate surcharges</b>, and no stock, supplier or air bridge touches that.</p><p><b>Fixed-rate long-term contracts</b> do: pay ~8% over expected spot every year, and avoid ~70% of disruption surcharges. Watch the cost KPI and the red surcharge bar.</p>",
          task: "Turn on fixed-rate contracts.",
          check: function (app) { return app.levers().rateHedge; },
          doit: { label: "Do it for me", run: function (app) { app.setLevers({ rateHedge: true }); } } },
        { id: "targeted", title: "Stock where it matters", target: "#panel-levers",
          enter: function (app) { app.setEvents(["redsea-2023"]); },
          body: "<p>Blanket safety stock is expensive because holding cost scales with value: an extra ten days of smartphones costs far more to hold than ten days of appliances, and appliances may not need it.</p>" +
                "<p>Set <b>Apply extra stock to</b> to <b>Critical families only</b> and give it 10 days. Compare the <b>annual cost of the options</b> and the family table with the all-families version: most of the protection for a fraction of the cost.</p>",
          task: "Hold 10+ extra days for critical families only.",
          check: function (app) { var l = app.levers(); return l.bufferScope === "critical" && l.buffer >= 10; },
          doit: { label: "Do it for me", run: function (app) { app.setLevers({ buffer: 10, bufferScope: "critical" }); } } },
        { id: "tower", title: "React faster", target: "#lever-checks",
          enter: function (app) { app.setLevers({ rateHedge: false, buffer: 0, bufferScope: "all" }); },
          body: "<p>Planners usually see a disruption a week or so late — reports, meetings, approvals. Meanwhile ships keep sailing into the problem. An <b>early-warning control tower</b> (live chokepoint, port and hazard monitoring — what this Atlas does) cuts that to about two days.</p>" +
                "<p>Turn it on with the Red Sea loaded and watch lost sales and cost drop: ships turn round sooner and replacement supply starts earlier. It doesn't overreact either — planners still wait out events they expect to be over within a week.</p>",
          task: "Turn on the control tower.",
          check: function (app) { return app.levers().controlTower; },
          doit: { label: "Do it for me", run: function (app) { app.setLevers({ controlTower: true }); } } },
        { id: "portfolio", title: "Score every combination", target: "#flex-panel",
          body: "<p>Six levers make 64 combinations. For each, the Atlas simulates <b>every event in the library</b> at six duration quantiles, weights each by its assumed yearly likelihood (<b>expected annual loss</b>), and adds the annual cost of holding the options. It takes about 15 seconds.</p><p>That is the real-options view of resilience: a lever is worth holding when the expected loss it removes is greater than what it costs to hold.</p>",
          task: "Evaluate all 64 combinations.",
          check: function (app, b) { return since(app, b, "portfolio") > 0; },
          doit: { label: "Do it for me", run: function (app) { app.runPortfolio(); } } },
        { id: "read-pf", title: "What the ranking says", target: "#portfolio-out",
          body: "<p>For the sample company, <b>fixed-rate contracts plus the control tower</b> come out on top: price risk is its biggest exposure, and reacting faster is the cheapest way to cut lost sales. Blanket safety stock costs far more than it saves; the second source and the air bridge sit close to break-even.</p><p>That's a typical, and useful, result: <b>flexibility should target the risk you actually carry</b>, not the most visible one.</p>" },
        { id: "optimise", title: "How much, not just whether", target: ".opt-block",
          body: "<p>On/off combinations can't tell you <b>how much</b> to hold: 5 days of smartphone stock or 20? 35% of freight on contract or 90%? The optimiser searches over the amounts and picks the portfolio with the lowest annual option cost plus expected loss.</p>" +
                "<p>Pick <b>Protect against bad years</b> and it also weighs the worst 10% of years (CVaR 90%) — the way a risk committee thinks. The chart shows every portfolio it tried: cost of protection across, bad-year loss up; the line joins the efficient ones. It takes about a minute.</p>",
          task: "Run the optimiser.",
          check: function (app, b) { return since(app, b, "optimise") > 0; },
          doit: { label: "Do it for me", run: function (app) { app.runOptimise(); } } },
        { id: "apply", title: "Try the recommendation", target: "#apply-opt",
          body: "<p><b>Apply to the scenario</b> copies the recommended amounts into the levers panel (a note there lists them). The KPIs, charts and story then show what the recommendation does to the scenario you have loaded.</p>",
          task: "Apply the optimiser's recommendation.",
          check: function (app, b) { return since(app, b, "apply-opt") > 0; },
          doit: { label: "Do it for me", run: function (app) { app.applyOptimised(); } } },
        { id: "sensitivity", title: "How sure are we?", target: "#panel-assumptions",
          enter: function (app) { app.openDetails("panel-assumptions"); },
          body: "<p>Every conclusion rests on the assumptions. The most important one is the <b>cost of a lost sale</b>: margin plus penalties and lost customers. Raise it (e.g. to 40,000), then evaluate the portfolio again. Does the best answer change?</p>",
          task: "Change an assumption, then re-evaluate the portfolio.",
          check: function (app, b) { return since(app, b, "assume") > 0 && since(app, b, "portfolio") > 0; } },
        { id: "fromlive", title: "Start from today, not from 2019", target: "#from-live-wrap",
          enter: function (app) { app.setLevers({ rateHedge: false, controlTower: false }); },
          body: "<p>Bab-el-Mandeb is already avoided today, so replaying the Red Sea against a pre-crisis normal overstates what's still to come. <b>Start from today's live conditions</b> solves the baseline under the real current state, then adds the event on top.</p><p>Try it with the hypothetical <b>Taiwan Strait closure</b>: what does it add to today's situation?</p>",
          task: "Tick “Start from today's live conditions” and select the Taiwan Strait closure.",
          check: function (app) { return app.fromLive() && has(app, "x-taiwan"); },
          doit: { label: "Do it for me", run: function (app) { app.setFromLive(true); app.setEvents(["x-taiwan"]); } } },
        { id: "done", title: "Advanced level complete",
          body: "<p>You've moved from \"what happens\" to \"what is it worth doing about it\". The <b>Pro</b> level puts your own network in and covers the data pipeline, sharing and export.</p>" }
      ]
    },

    // ------------------------------------------------------------------ PRO
    {
      id: "pro", name: "Pro", tagline: "Your network, your decision", minutes: 20,
      learn: ["Find hidden tier-2/3 supplier dependencies", "Describe a disruption in your own words", "Import any network from two CSV files, or build one from shipment history", "Save workspaces, produce a steering-committee report, automate with the JSON API", "Find your chokepoint exposure", "Stress-test and value flexibility on your own data",
              "Find your network's worst single and paired disruptions", "Use data-informed likelihoods, climate scenarios and correlated events",
              "Share a scenario link and export results", "Understand the method, data pipeline and limits"],
      setup: function (app) { app.resetAll(); app.setProjection("3d"); },
      steps: [
        { id: "intro", title: "Bring your own network",
          body: "<p>Everything you've done so far works on any network you describe in two CSV files. They're parsed <b>in your browser</b>; nothing is uploaded.</p><p>First, two things that make a network model honest: the suppliers behind your factories, and the scenarios only you can think of.</p>" },
        { id: "deps", title: "Hidden dependencies", target: "#deps-panel",
          body: "<p>Four factories in four countries look diversified — until you notice they all need chips from the same Hsinchu fabs. The violet dots on the map are <b>tier-2 and tier-3 suppliers</b>; dashed lines show which sites need their parts and what share of output depends on them.</p>" +
                "<p>The table counts how much of your weekly volume needs each supplier, through every tier. Factories hold about two weeks of components, so a short supplier outage is absorbed; a long one isn't. Try the hypothetical <b>Taiwan fab outage</b> afterwards.</p>",
          task: "Click a supplier (a table row or a violet dot).",
          enter: function (app) { app.setProjection("2d"); },
          check: function (app, b) { return since(app, b, "supplier-info") > 0; },
          doit: { label: "Do it for me", run: function (app) { app.showInfo({ kind: "supplier", id: "s-hsinchu" }); } } },
        { id: "describe", title: "Describe it in words", target: "#panel-scenario",
          body: "<p>The <b>Yours</b> tab takes a disruption in plain words — <em>“Busan port strike for three weeks, half capacity”</em>, <em>“fire at the Hsinchu fabs for two months”</em> — and turns it into a scenario: which ports, chokepoints, suppliers or factories, how badly, for how long, any freight-rate rise.</p>" +
                "<p>It's phrase matching, not an AI model, and it shows every assumption it made so you can check and adjust the duration before adding it. Your scenarios are saved with workspaces and included in the JSON spec.</p>",
          task: "Describe a disruption and add it.",
          enter: function (app) { app.setProjection("3d"); app.setTab("custom"); },
          check: function (app, b) { return since(app, b, "custom-added") > 0; },
          doit: { label: "Do it for me", run: function (app) { app.setTab("custom"); app.describe("Busan port strike for three weeks, half capacity"); } } },
        { id: "csv", title: "Two files: nodes and lanes", target: "#panel-network",
          enter: function (app) { var d = document.querySelector(".import-details"); if (d) d.open = true; },
          body: "<p><b>nodes.csv</b>: <code>id, name, type (factory|dc|port), lat, lng, capacity_teu_wk, demand_teu_wk, buffer_days, cost_premium</code>.</p>" +
                "<p><b>lanes.csv</b>: <code>from, to, mode (sea|road|rail|barge), capacity_teu_wk, rate_per_teu, days, trade</code>. Sea lanes run port to port and their days are computed from the routed distance. Road/rail legs go factory→port, port→DC or factory→DC.</p>" +
                "<p>Ports can be any UN/LOCODE in the built-in library (<code>CNSHA</code>, <code>NLRTM</code>, <code>USLAX</code>…) or your own with coordinates. A custom port is attached to the nearest sea-lane waypoints automatically.</p>" +
                "<p>Download the templates, or load the demo: a European apparel importer sourcing from Bangladesh, Vietnam and Turkey.</p>",
          task: "Load a network (your CSVs or the demo).",
          check: function (app) { return app.network() === "custom"; },
          doit: { label: "Load the demo", run: function (app) { app.loadDemoNetwork(); } } },
        { id: "shipments", title: "Or start from your shipment history", target: "#open-shipments",
          body: "<p>Few companies have a network model, but every ERP or TMS can export shipments. <b>Build from shipment history</b> takes that export — origin, destination, ports of loading and discharge, volume, date, and optionally product family — guesses which column is which, matches ports by UN/LOCODE or common name, and builds factories, DCs with their product mix, sea lanes and inland legs.</p>" +
                "<p>Try it with the sample export (26 weeks of the sample company's shipments). Imported capacities sit 25–30% above observed volumes, and rates are distance-based estimates you can refine.</p>",
          task: "Build a network from the sample shipment history.",
          check: function (app, b) { return since(app, b, "shipments-built") > 0; },
          doit: { label: "Do it for me", run: function (app) { app.buildSampleShipments(); } } },
        { id: "exposure", title: "Where are you exposed?", target: "#live-panel",
          body: "<p>The <b>Live chokepoint monitor</b> now has a <b>Your flow</b> column: the share of your weekly volume through each chokepoint, next to how that chokepoint is doing today.</p><p>A high share on a red row is the first thing to act on. Click a row to see its traffic history since 2019.</p>",
          task: "Click a chokepoint row.",
          check: function (app, b) { return since(app, b, "choke-chart") > 0; } },
        { id: "stress", title: "Stress your own network", target: "#panel-scenario",
          body: "<p>Every event in the library applies to your network: closures reroute your sea lanes, port effects hit your ports, rate uplifts apply by trade code (or the all-trades part when your lanes have none).</p><p>Try the Red Sea or the hypothetical Malacca closure.</p>",
          task: "Select any historical or hypothetical event on your network.",
          enter: function (app) { app.setTab("historical"); },
          check: function (app) { return app.network() === "custom" && app.events().some(function (e) { return e !== "live"; }); },
          doit: { label: "Red Sea", run: function (app) { app.setEvents(["redsea-2023"]); } } },
        { id: "worst", title: "Your network's worst cases", target: "#worst-panel",
          body: "<p>Rather than guessing which scenario to test, let the Atlas try them all: every library event alone and every pair together — 105 simulations — ranked by cost or lost sales for <em>your</em> network. <b>Load</b> puts any of them on the map.</p>" +
                "<p>Watch the <b>Worse together</b> column: pairs that knock out each other's alternatives cost more than the two apart. Those combinations are where flexibility earns its keep.</p>",
          task: "Find the worst cases.",
          check: function (app, b) { return since(app, b, "worst") > 0; },
          doit: { label: "Do it for me", run: function (app) { app.runWorst(); } } },
        { id: "likely", title: "How likely, really?", target: "#lik-panel",
          body: "<p>Expected losses depend on how often each event happens. Switch <b>Likelihoods</b> to <b>Data-informed</b>: each event's stated likelihood is updated with the disruption episodes the Atlas finds in the PortWatch record, with an 80% range showing how uncertain that still is.</p>" +
                "<p>Then try <b>An El Niño year</b> or <b>2040, high warming</b>, and note the <b>shared drivers</b>: related events (Red Sea and Hormuz, say) cluster in the same year, which makes bad years worse without changing the average. The value-of-flexibility and optimiser results use these settings.</p>",
          task: "Switch to data-informed likelihoods.",
          check: function (app) { return app.risk().source === "data"; },
          doit: { label: "Do it for me", run: function (app) { app.setRisk({ source: "data" }); } } },
        { id: "hazards", title: "From alert to scenario", target: "#hazard-table",
          body: "<p>Current GDACS alerts, M6+ earthquakes and PortWatch port-disruption events, each with the distance to your <b>nearest</b> factory, port or DC.</p>" +
                "<p>When one is close enough to matter, <b>Model this</b> turns it into a scenario using the Atlas's template for that hazard type (a cyclone shuts nearby ports for days, a M7+ quake cuts ports and factories for weeks, and so on). The alert also appears under <b>Alerts near your network</b> in the Live tab. If the world is quiet near your network today, there is nothing to model — that's a result too.</p>",
          task: "Model an alert near your network (or confirm there is none).",
          check: function (app, b) { return app.alerts().length === 0 || since(app, b, "model-alert") > 0; },
          doit: { label: "Do it for me", run: function (app) { var a = app.alerts(); if (a.length) app.modelAlert(a[0]); } } },
        { id: "pf", title: "Value flexibility on your network", target: "#flex-panel",
          body: "<p>Run the portfolio on your network. The levers are generic (stock days, a standby second source, air, gateway allotments, rate contracts); the second-source surge applies only if your network has standby factories.</p>",
          task: "Evaluate the 64 combinations.",
          check: function (app, b) { return since(app, b, "portfolio") > 0; },
          doit: { label: "Do it for me", run: function (app) { app.runPortfolio(); } } },
        { id: "workspace", title: "Save it as a workspace", target: "#open-workspaces",
          body: "<p><b>Workspaces</b> (top right) save everything — the network (imported ones too), scenario, levers, families, assumptions, likelihood settings — under a name, in this browser. <b>Export</b> turns one into a file a colleague can import, so a whole analysis travels as one attachment.</p>",
          task: "Save a workspace.",
          check: function (app, b) { return since(app, b, "ws-save") > 0; },
          doit: { label: "Do it for me", run: function (app) { app.saveWorkspace("Tutorial workspace"); } } },
        { id: "report", title: "A report for the steering committee", target: "#open-report",
          body: "<p><b>Steering-committee report</b> builds a self-contained page — scenario, headline numbers, the story, cost breakdown, service by family and DC, options held, and (if you've run them) the range of outcomes, the optimiser's recommendation and the worst cases — stamped with the Atlas version and the live-data date. Print it or save it as a PDF.</p>",
          task: "Produce the report.",
          check: function (app, b) { return since(app, b, "report") > 0; },
          doit: { label: "Do it for me", run: function (app) { app.openReport(); } } },
        { id: "api", title: "Automate it", target: "#api-panel",
          enter: function (app) { app.openDetails("api-panel"); },
          body: "<p>Everything here also runs from a JSON <b>scenario spec</b>: network, events, levers, assumptions and the analyses you want, returning a versioned JSON result. <b>Use the current scenario</b> fills in what you have on screen. The same engine runs from the command line (<code>node atlas/cli/run.mjs spec.json</code>) for integrations and scheduled reviews.</p>",
          task: "Run a spec.",
          check: function (app, b) { return since(app, b, "api-run") > 0; },
          doit: { label: "Do it for me", run: function (app) { app.runApi(); } } },
        { id: "share", title: "Share the scenario", target: "#share-link",
          body: "<p>The address bar always encodes the scenario, levers and view (e.g. <code>#e=redsea-2023&amp;lv=b5,rateHedge</code>). <b>Copy share link</b> puts it on your clipboard. Custom networks stay in your browser and aren't in the link.</p>",
          task: "Copy the share link.",
          check: function (app, b) { return since(app, b, "share") > 0; },
          doit: { label: "Do it for me", run: function () { document.getElementById("share-link").click(); } } },
        { id: "export", title: "Export for your own analysis", target: "#export-json",
          body: "<p><b>Export results (JSON)</b> writes the whole run: scenario, assumptions, cost components, TTS/TTR per DC, every service's route and capacity, chokepoint exposure, the data-snapshot time and, if current, the Monte Carlo summary.</p>",
          task: "Export the results.",
          check: function (app, b) { return since(app, b, "export") > 0; },
          doit: { label: "Do it for me", run: function () { document.getElementById("export-json").click(); } } },
        { id: "validation", title: "Checked against history", target: "#validation-panel",
          body: "<p>Before trusting a model, check it against what happened. <b>Checked against history</b> sets the model's key assumptions beside the PortWatch record and cited figures: Red Sea diversion days, Bab-el-Mandeb and Cape traffic in 2024, the Ever Given week, the Panama drought.</p>" +
                "<p>It's recomputed every time the data refreshes. A flagged row means an assumption needs recalibrating — the Panama row did, in v2.1: container lines kept ~96% of their transits while other ships took the cuts.</p>" },
        { id: "method", title: "Under the hood", target: "#method-panel",
          enter: function (app) { app.openDetails("method-panel"); },
          body: "<p>Read <b>Method, assumptions &amp; limits</b> before you rely on a number. The parts:</p><ul>" +
                "<li><code>engine/seagraph.js</code> — sea-lane graph and router (distances within ~6% of published figures).</li>" +
                "<li><code>engine/flow.js</code> — the min-cost-flow solver, shared with the Network Stress Test app.</li>" +
                "<li><code>engine/model.js</code> — conditions and the min-cost-flow re-planning.</li>" +
                "<li><code>engine/dynamics.js</code> — the day-by-day simulation: ramps, rates, reaction lag, diversions, queues, stock, Monte Carlo, portfolio.</li>" +
                "<li><code>scripts/fetch-signals.mjs</code> — the daily data job (GitHub Actions).</li>" +
                "<li><code>engine/csvnet.js</code>, <code>engine/validation.js</code> — CSV import and the history checks.</li><li><code>engine/optimise.js</code> — the lever-amount optimiser and the cost–risk frontier.</li><li><code>engine/likelihood.js</code>, <code>engine/worstcase.js</code> — data-informed likelihoods, correlation, climate; worst-case search.</li><li><code>engine/shipments.js</code>, <code>engine/api.js</code>, <code>cli/run.mjs</code> — shipment import, the JSON API and its command-line runner.</li><li><code>engine/describe.js</code>, <code>engine/brief.js</code> — the words-to-scenario parser and the daily brief.</li><li><code>tests/</code> — 65 unit tests and a land-crossing check (<code>node --test atlas/tests/*.test.js</code>) plus a browser smoke test that walks this tutorial in CI.</li></ul>" +
                "<p>Events live in <code>data.js</code> with their effect parameters and sources. Adding one is a few lines.</p>" },
        { id: "done", title: "Pro level complete",
          body: "<p>You can now take any network from CSV to a quantified, shareable flexibility decision.</p><p>Want it calibrated to your real lanes, rates and service levels, or connected to your ERP and AIS feeds? <a href=\"https://github.com/kathuman\" target=\"_blank\" rel=\"noopener\">Get in touch</a>.</p>" }
      ]
    }
  ];

  // ------------------------------------------------------------------ engine
  var app, ui = {}, run = null, prog = {};
  var KEY = "atlas-tutorial-v2";
  function save() { try { localStorage.setItem(KEY, JSON.stringify(prog)); } catch (e) { /* storage blocked */ } }
  function load() { try { prog = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { prog = {}; } }
  function lv(id) { return LEVELS.filter(function (l) { return l.id === id; })[0]; }
  function doneSet(id) { prog[id] = prog[id] || { done: [], at: 0 }; return prog[id]; }
  function stepDone(level, step) { return doneSet(level.id).done.indexOf(step.id) >= 0; }
  function countDone(level) { var d = doneSet(level.id).done; return level.steps.filter(function (s) { return d.indexOf(s.id) >= 0; }).length; }
  function mk(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function build() {
    ui.chooser = mk("div", "tut-modal"); ui.chooser.hidden = true;
    ui.chooser.setAttribute("role", "dialog"); ui.chooser.setAttribute("aria-modal", "true"); ui.chooser.setAttribute("aria-label", "Choose a tutorial level");
    document.body.appendChild(ui.chooser);
    ui.chooser.addEventListener("click", function (e) { if (e.target === ui.chooser) closeChooser(); });
    ui.panel = mk("section", "tut-panel"); ui.panel.hidden = true;
    ui.panel.setAttribute("role", "dialog"); ui.panel.setAttribute("aria-label", "Tutorial step");
    ui.panel.innerHTML =
      '<div class="tut-top"><span class="tut-level"></span><span class="tut-count"></span><button class="tut-x" type="button" aria-label="Close the tutorial">×</button></div>' +
      '<div class="tut-bar"><i></i></div><h3 class="tut-title"></h3><div class="tut-body"></div>' +
      '<div class="tut-task" aria-live="polite"><span class="tut-tick"></span><span class="tut-task-text"></span></div>' +
      '<div class="tut-nav"><button class="tut-btn tut-do" type="button"></button><span class="tut-grow"></span>' +
      '<button class="tut-btn tut-back" type="button">← Back</button><button class="tut-btn primary tut-next" type="button">Next →</button></div>';
    document.body.appendChild(ui.panel);
    ui.spot = mk("div", "tut-spot"); ui.spot.hidden = true; document.body.appendChild(ui.spot);
    ui.panel.querySelector(".tut-x").addEventListener("click", close);
    ui.panel.querySelector(".tut-back").addEventListener("click", function () { go(run.i - 1); });
    ui.panel.querySelector(".tut-next").addEventListener("click", function () { if (run.i >= run.level.steps.length - 1) finish(); else go(run.i + 1); });
    ui.panel.querySelector(".tut-do").addEventListener("click", function () { var s = run.level.steps[run.i]; if (s.doit) s.doit.run(app); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { if (!ui.chooser.hidden) closeChooser(); else if (!ui.panel.hidden) close(); } });
    window.addEventListener("resize", placeSpot);
    document.addEventListener("scroll", placeSpot, true);
    setInterval(poll, 300);
    var btn = document.getElementById("open-tutorial");
    if (btn) btn.addEventListener("click", function () { openChooser(); });
  }

  function openChooser(mode) {
    load();
    var h = '<div class="tut-card"><div class="tut-top"><h2>Atlas tutorial</h2><button class="tut-x" type="button" aria-label="Close">×</button></div>';
    if (mode && mode.guide) {
      var L = lv(mode.guide);
      h += '<p class="tut-lead"><b>' + L.name + '</b> — ' + L.tagline + ' · written guide (' + L.steps.length + ' steps)</p><div class="tut-guide">';
      L.steps.forEach(function (s, i) { h += '<article><h3>' + (i + 1) + '. ' + s.title + '</h3>' + s.body + (s.task ? '<p class="tut-g-task"><b>Try it:</b> ' + s.task + '</p>' : '') + '</article>'; });
      h += '</div><div class="tut-nav"><button class="tut-btn tut-back-levels" type="button">← All levels</button><span class="tut-grow"></span><button class="tut-btn primary tut-start" data-level="' + L.id + '" type="button">Start interactive →</button></div>';
    } else {
      h += '<p class="tut-lead">Four levels, from reading the map to valuing flexibility on your own network. Each step shows you where to look, explains what\'s going on and gives you something to try; it ticks itself off when you\'ve done it. Progress is saved in this browser.</p><div class="tut-levels">';
      LEVELS.forEach(function (L) {
        var n = countDone(L), started = n > 0 || doneSet(L.id).at > 0;
        h += '<div class="tut-lvl tut-lvl-' + L.id + '"><div class="tut-lvl-head"><b>' + L.name + '</b><span>~' + L.minutes + ' min · ' + L.steps.length + ' steps</span></div>' +
          '<p class="tut-tag">' + L.tagline + '</p><ul>' + L.learn.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' +
          '<div class="tut-lvl-bar" title="' + n + ' of ' + L.steps.length + ' steps done"><i style="width:' + (n / L.steps.length * 100).toFixed(0) + '%"></i></div>' +
          '<div class="tut-lvl-actions"><button class="tut-btn primary tut-start" data-level="' + L.id + '" type="button">' + (started ? (n === L.steps.length ? 'Do it again' : 'Resume') : 'Start') + '</button>' +
          '<button class="tut-btn tut-read" data-level="' + L.id + '" type="button">Read as guide</button></div></div>';
      });
      h += '</div><p class="tut-note">Starting a level resets the scenario, levers and assumptions so the steps match what you see. An imported network is kept until the Pro level replaces it.</p>';
    }
    h += '</div>';
    ui.chooser.innerHTML = h; ui.chooser.hidden = false;
    ui.chooser.querySelector(".tut-x").addEventListener("click", closeChooser);
    Array.prototype.forEach.call(ui.chooser.querySelectorAll(".tut-start"), function (b) { b.addEventListener("click", function () { start(this.dataset.level); }); });
    Array.prototype.forEach.call(ui.chooser.querySelectorAll(".tut-read"), function (b) { b.addEventListener("click", function () { openChooser({ guide: this.dataset.level }); }); });
    var back = ui.chooser.querySelector(".tut-back-levels"); if (back) back.addEventListener("click", function () { openChooser(); });
    var first = ui.chooser.querySelector(".tut-start"); if (first) first.focus();
  }
  function closeChooser() { ui.chooser.hidden = true; }

  function start(levelId) {
    var L = lv(levelId);
    closeChooser();
    L.setup(app);
    var d = doneSet(L.id), at = d.done.length >= L.steps.length ? 0 : Math.min(d.at || 0, L.steps.length - 1);
    run = { level: L, i: -1 };
    ui.panel.hidden = false;
    go(at);
  }
  function go(i) {
    var L = run.level;
    i = Math.max(0, Math.min(L.steps.length - 1, i));
    run.i = i;
    var s = L.steps[i];
    doneSet(L.id).at = i; save();
    if (s.enter) s.enter(app);
    run.base = s.base ? s.base(app) : {};
    run.base.flags = app.flagSnapshot();
    run.justDone = false;
    var P = ui.panel;
    P.querySelector(".tut-level").textContent = L.name;
    P.querySelector(".tut-level").className = "tut-level tut-lvl-" + L.id;
    P.querySelector(".tut-count").textContent = "Step " + (i + 1) + " of " + L.steps.length;
    P.querySelector(".tut-bar i").style.width = ((i + 1) / L.steps.length * 100).toFixed(1) + "%";
    P.querySelector(".tut-title").textContent = s.title;
    P.querySelector(".tut-body").innerHTML = s.body;
    P.querySelector(".tut-body").scrollTop = 0;
    P.querySelector(".tut-task").hidden = !s.task;
    P.querySelector(".tut-task-text").textContent = s.task || "";
    var doB = P.querySelector(".tut-do"); doB.hidden = !s.doit; doB.textContent = s.doit ? s.doit.label : "";
    P.querySelector(".tut-back").disabled = i === 0;
    P.querySelector(".tut-next").textContent = i === L.steps.length - 1 ? "Finish ✓" : "Next →";
    if (!s.task) markDone(s);
    renderTask();
    var t = s.target && document.querySelector(s.target);
    if (t) {
      var inSidebar = t.closest && t.closest("#sidebar");
      var r = t.getBoundingClientRect();
      if (inSidebar || r.top < 0 || r.bottom > window.innerHeight) t.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    placeSpot(); setTimeout(placeSpot, 500);
  }
  function markDone(s) { var d = doneSet(run.level.id); if (d.done.indexOf(s.id) < 0) { d.done.push(s.id); save(); } }
  function renderTask() {
    var s = run.level.steps[run.i], ok = stepDone(run.level, s), P = ui.panel;
    P.querySelector(".tut-task").classList.toggle("ok", ok);
    P.querySelector(".tut-tick").textContent = ok ? "✓" : "○";
    P.querySelector(".tut-next").classList.toggle("pulse", ok && !!s.task && run.justDone);
  }
  function poll() {
    if (!run || ui.panel.hidden) return;
    var s = run.level.steps[run.i];
    if (s.task && s.check && !stepDone(run.level, s)) {
      var ok = false;
      try { ok = !!s.check(app, run.base); } catch (e) { ok = false; }
      if (ok) { markDone(s); run.justDone = true; renderTask(); }
    }
    placeSpot();
  }
  function placeSpot() {
    if (!run || ui.panel.hidden) { ui.spot.hidden = true; return; }
    var s = run.level.steps[run.i], t = s.target && document.querySelector(s.target);
    if (!t || t.offsetParent === null) { ui.spot.hidden = true; return; }
    var r = t.getBoundingClientRect(), pad = 6;
    if (r.width === 0 || r.bottom < 0 || r.top > innerHeight) { ui.spot.hidden = true; return; }
    ui.spot.hidden = false;
    ui.spot.style.left = (r.left - pad) + "px"; ui.spot.style.top = (Math.max(0, r.top) - pad) + "px";
    ui.spot.style.width = (r.width + pad * 2) + "px"; ui.spot.style.height = (Math.min(r.bottom, innerHeight) - Math.max(0, r.top) + pad * 2) + "px";
  }
  function finish() { run.level.steps.forEach(function (s) { if (!s.task) markDone(s); }); close(); openChooser(); }
  function close() { ui.panel.hidden = true; ui.spot.hidden = true; run = null; }

  function init(appApi) {
    app = appApi; load(); build();
    return {
      open: openChooser, start: start, close: close, levels: LEVELS,
      state: function () { return run ? { level: run.level.id, step: run.i, id: run.level.steps[run.i].id, done: stepDone(run.level, run.level.steps[run.i]) } : null; },
      go: function (i) { if (run) go(i); }
    };
  }
  root.AtlasTutorial = { init: init, LEVELS: LEVELS };
  // app.js loads first and publishes window.AtlasApp
  if (root.AtlasApp) root.AtlasTutorialInstance = init(root.AtlasApp);
})(window);
