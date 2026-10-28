import pc from "picocolors";

// Unit test of getRoutesManifest with a mocked fetch (no servers needed):
//   bun run test-routes-sync.ts
// Redis is pointed at a dead port so the module falls back to its in-memory cache.
process.env.REDIS_URL = "redis://127.0.0.1:1";
const { getRoutesManifest } = await import("./service-search/src/routes-sync.js");

const realFetch = globalThis.fetch;
let fetchCalls = 0;
function mockFetch(impl: () => Promise<Response>) {
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    return impl();
  }) as typeof fetch;
}
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) {
    passed++;
    console.log(`  ${pc.green("✔")} ${name}`);
  } else {
    failed++;
    console.log(`  ${pc.red("✘")} ${name}`);
  }
}

const sampleRoute = {
  id: "spp",
  title: "SPP",
  path: "/spp",
  description: "",
  keywords: [],
  supported_intents: ["DIRECT_LINK"],
};

console.log("healthy upstream, empty manifest (role/tenant without permission)");
mockFetch(() => json({ routes: [] }));
const empty = await getRoutesManifest("unit-empty", "FOO");
check("returns zero routes (no fallback to the full route list)", empty.routes.length === 0);
check("not marked degraded", !empty.degraded);

console.log("empty manifest is cached like any other healthy answer");
mockFetch(() => json({ routes: [sampleRoute] }));
const cachedEmpty = await getRoutesManifest("unit-empty", "FOO");
check("second call stays empty", cachedEmpty.routes.length === 0);
check("second call does not hit upstream", fetchCalls === 0);

console.log("healthy upstream, non-empty manifest");
mockFetch(() => json({ routes: [sampleRoute] }));
const full = await getRoutesManifest("unit-full", "SUPERADMIN");
check("returns upstream routes untouched", full.routes.length === 1 && full.routes[0].id === "spp");
check("not marked degraded", !full.degraded);

console.log("upstream failure still falls back (degraded)");
mockFetch(() => json({ error: "boom" }, 500));
const http500 = await getRoutesManifest("unit-500", "SUPERADMIN");
check("HTTP 500 -> fallback routes, degraded", http500.degraded === true && http500.routes.length > 0);

mockFetch(() => Promise.reject(new Error("ECONNREFUSED")));
const down = await getRoutesManifest("unit-down", "SUPERADMIN");
check("connection refused -> fallback routes, degraded", down.degraded === true && down.routes.length > 0);

mockFetch(() => json({ nope: true }));
const malformed = await getRoutesManifest("unit-malformed", "SUPERADMIN");
check("body without routes array -> fallback routes, degraded", malformed.degraded === true && malformed.routes.length > 0);

globalThis.fetch = realFetch;
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
