import { classifyIntent } from "../service-search/src/classifier.js";

const realKey = process.env.REAL_KEY || "";
const mode = process.argv[2] || "usage";

if (mode === "usage") {
  // 1. Berapa token / shape usage per 1 panggilan JEV
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${realKey}` },
    body: JSON.stringify({
      model: "jev-latest",
      state: "lihat siswa nunggak kelas 8B",
      questions: {
        intent: {
          type: "choice",
          instructions: "Determine the user's intended smart search action in an education school management system.",
          criteria: {
            LIST_MENU: "User is looking for static navigation menus or settings (e.g. 'ke menu spp', 'menu profil').",
            DIRECT_LINK: "User wants to view a specific filtered data table or deep link (e.g. 'lihat siswa nunggak kelas 8B', 'data nilai matematika').",
            REPORT_ACTION: "User wants to generate, print, or download a report card / rapot document (e.g. 'cetak rapot kelas 8B', 'unduh rapot budi format pdf').",
          },
        },
      },
    }),
  });
  const j: any = await res.json();
  console.log("HTTP", res.status);
  console.log("USAGE:", JSON.stringify(j.usage));
  console.log("MODEL:", j.model);
  console.log("ANSWER:", JSON.stringify(j.answers?.intent));
}

if (mode === "fallback") {
  // 2. engine=jev dengan key invalid → apakah fallback atau throw?
  for (const engine of ["jev", "auto"] as const) {
    const t0 = performance.now();
    try {
      const r = await classifyIntent("lihat siswa nunggak kelas 8B", engine);
      console.log(`${engine.padEnd(5)} → OK   engine=${r.engine} ${Math.round((performance.now() - t0) * 100) / 100}ms`);
    } catch (e: any) {
      console.log(`${engine.padEnd(5)} → THROW ${e.message} (${Math.round((performance.now() - t0) * 100) / 100}ms)`);
    }
  }
}
