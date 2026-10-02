/*
 * flow.js — min-cost flow for the Atlas decision engine.
 * Copied unchanged in its algorithm from the Network Stress Test app
 * (claude-projects/network-stress-test/web/src/flowSolver.js, where it is unit-tested),
 * so both apps share one verified solver. Only the browser global name differs.
 *
 * Min-cost flow, successive shortest augmenting paths with
 * node potentials (Bellman-Ford once for initial potentials, then Dijkstra
 * + reduced costs per augmentation). Pure graph algorithm: knows nothing
 * about nodes/edges/products/modes — network.js builds the graph this
 * consumes. Verified in isolation (7 unit tests: path selection under cost,
 * capacity spillover, node-throughput capacity via split-node, flow
 * conservation, infeasible-demand and disconnected-graph handling, and a
 * 300+ node performance check) before being wired to anything else.
 */
(function (global) {
  "use strict";

  function MinCostFlow(numNodes) {
    this.n = numNodes;
    this.graph = [];
    for (let i = 0; i < numNodes; i++) this.graph.push([]);
    this.edges = []; // flat list: {to, cap, cost, flow} paired -- edges[i^1] is the reverse
  }

  MinCostFlow.prototype.addEdge = function (from, to, cap, cost) {
    this.graph[from].push(this.edges.length);
    this.edges.push({ to: to, cap: cap, cost: cost, flow: 0 });
    this.graph[to].push(this.edges.length);
    this.edges.push({ to: from, cap: 0, cost: -cost, flow: 0 });
    return this.edges.length - 2;
  };

  MinCostFlow.prototype.run = function (s, t, maxFlow) {
    const n = this.n;
    let potential = new Array(n).fill(0);

    {
      const dist = new Array(n).fill(Infinity);
      dist[s] = 0;
      for (let iter = 0; iter < n - 1; iter++) {
        let changed = false;
        for (let u = 0; u < n; u++) {
          if (dist[u] === Infinity) continue;
          for (const ei of this.graph[u]) {
            const e = this.edges[ei];
            if (e.cap - e.flow <= 0) continue;
            if (dist[u] + e.cost < dist[e.to] - 1e-9) { dist[e.to] = dist[u] + e.cost; changed = true; }
          }
        }
        if (!changed) break;
      }
      for (let i = 0; i < n; i++) potential[i] = dist[i] === Infinity ? 0 : dist[i];
    }

    let totalFlow = 0, totalCost = 0;

    while (totalFlow < maxFlow) {
      const dist = new Array(n).fill(Infinity);
      const prevEdge = new Array(n).fill(-1);
      dist[s] = 0;
      const visited = new Array(n).fill(false);
      for (let iter = 0; iter < n; iter++) {
        let u = -1, best = Infinity;
        for (let i = 0; i < n; i++) if (!visited[i] && dist[i] < best) { best = dist[i]; u = i; }
        if (u === -1) break;
        visited[u] = true;
        for (const ei of this.graph[u]) {
          const e = this.edges[ei];
          if (e.cap - e.flow <= 1e-9) continue;
          const rc = e.cost + potential[u] - potential[e.to];
          const nd = dist[u] + Math.max(0, rc);
          if (nd < dist[e.to] - 1e-9) { dist[e.to] = nd; prevEdge[e.to] = ei; }
        }
      }
      if (dist[t] === Infinity) break;

      for (let i = 0; i < n; i++) if (dist[i] < Infinity) potential[i] += dist[i];

      let aug = maxFlow - totalFlow;
      for (let v = t; v !== s;) {
        const ei = prevEdge[v];
        const e = this.edges[ei];
        aug = Math.min(aug, e.cap - e.flow);
        v = this.edges[ei ^ 1].to;
      }
      if (aug <= 1e-9) break;

      let pathCost = 0;
      for (let v = t; v !== s;) {
        const ei = prevEdge[v];
        this.edges[ei].flow += aug;
        this.edges[ei ^ 1].flow -= aug;
        pathCost += this.edges[ei].cost * aug;
        v = this.edges[ei ^ 1].to;
      }
      totalFlow += aug;
      totalCost += pathCost;
    }

    return { flow: totalFlow, cost: totalCost };
  };

  const mod = { MinCostFlow: MinCostFlow };
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  else global.AtlasFlow = mod;
})(typeof window !== "undefined" ? window : globalThis);
