import type { ClassificationResult, IntentType } from "./classifier.js";
import type { RawExtraction } from "./extractor.js";
import type { AppRoute } from "./routes-sync.js";
import { indexResolvedParams, type MasterItem, type ResolvedParam } from "./lazy-resolver.js";
import { resolveDateRange } from "./date-range.js";

export type TargetType = "DETAIL" | "LIST" | "ACTION";

export interface SearchOption {
  rank: number;
  score: number;
  intent: IntentType;
  target_type: TargetType;
  title: string;
  description: string;
  destination: string;
  // Payload terstruktur: { entity: { id, name, ...baris master } } untuk DETAIL, { route, filters } untuk LIST
  data?: Record<string, any>;
}

export interface SmartSearchMeta {
  engine: "JEV_CLOUD" | "LOCAL_TRANSFORMERS";
  latency_ms: number;
  cached?: boolean;
  degraded?: boolean;
}

export interface SmartSearchResponse {
  status: "success";
  query: string;
  target_route?: string;
  total_options: number;
  options: SearchOption[];
  meta: SmartSearchMeta;
}

const r2 = (n: number) => Math.min(1, Math.round(n * 100) / 100); // clamp 0..1

function entityLabel(s: MasterItem): string {
  return s.name || s.id;
}

export function dispatchAction(
  query: string,
  classification: ClassificationResult,
  extraction: RawExtraction,
  selectedRoute: AppRoute | undefined,
  dynamicRoutes: AppRoute[],
  resolved: ResolvedParam[],
  threshold: number = 0.2,
  referenceDateStr?: string
): SmartSearchResponse {
  const { probabilities, engine, latency_ms } = classification;
  const qLower = query.toLowerCase();
  const params = indexResolvedParams(resolved);
  const options: SearchOption[] = [];

  const route = selectedRoute || dynamicRoutes[0];
  const directProb = probabilities.DIRECT_LINK || 0;
  const menuProb = probabilities.LIST_MENU || 0;

  if (route) {
    // --- 1. Entity-driven DIRECT_LINK options ---
    // The entity param is the route's mode "search" spec (structure, not a key name).
    const searchSpec = (route.allowed_params || []).find((s) => s.mode === "search");
    const entityResolved = searchSpec ? params[searchSpec.key] : undefined;

    // 1B. Dynamic DETAIL routes with :id placeholder (e.g. /ng_student/detail/:id atau /ng_counseling/edit/:id)
    const idSpec = (route.allowed_params || []).find((s) => s.key === "id");
    const idResolved = idSpec ? params[idSpec.key] : entityResolved;

    if (route.path.includes(":id") && idResolved?.values.length) {
      for (const s of idResolved.values.slice(0, 8)) {
        const name = entityLabel(s);
        options.push({
          rank: options.length + 1,
          score: r2(directProb),
          intent: "DIRECT_LINK",
          target_type: "DETAIL",
          title: `${route.title}: ${name}`,
          description: `${route.description} (${name})`,
          destination: route.path.replace(":id", String(s.id)),
          data: { entity: { ...s.raw, id: s.id, name } },
        });
      }
    }

    // 1C. Dynamic LIST route dengan query params dari resolved values
    const isListRoute = !route.path.includes(":id");

    if (isListRoute) {
      const qs = new URLSearchParams();
      // Transformer guesses on master lists are never applied as filters; offered as "did you mean"
      const suggestions: { key: string; item: { id: string; name: string } }[] = [];

      for (const spec of route.allowed_params || []) {
        // mode search: ditangani terpisah
        if (spec.mode === "search") continue;
        const rp = params[spec.key];
        if (!rp) continue;
        if (rp.source === "semantic" && (spec.mode ?? "list") === "list" && rp.values[0]) {
          suggestions.push({ key: spec.key, item: rp.values[0] });
          continue;
        }
        if (rp.source === "enum" || rp.source === "semantic") {
          // enum / date_range / date_month: nilai dari config manifest
          const v = extraction.enumValues[spec.key];
          if (v) {
            if (spec.mode === "date_range") {
              const bounds = resolveDateRange(v, referenceDateStr);
              if (bounds && spec.param_gte && spec.param_lte) {
                qs.set(spec.param_gte, bounds.gte);
                qs.set(spec.param_lte, bounds.lte);
              } else {
                qs.set(spec.key, v);
              }
            } else {
              qs.set(spec.key, v);
            }
          }
        } else if (rp.values[0]) {
          // selain enum: jika resolves_to === "name", pakai nama (misal filter teks nama rombel), jika tidak pakai ID (FK)
          const val = spec.resolves_to === "name" ? rp.values[0].name : rp.values[0].id;
          qs.set(spec.key, val);
        }
      }
      // Entity search: kirim nama entitas lengkap atau token query
      if (searchSpec && entityResolved?.values[0]) {
        const fullEntityName = entityLabel(entityResolved.values[0]);
        qs.set(searchSpec.key, fullEntityName);
      }
      const qsStr = qs.toString();

      // Label human-readable: nama item master dari setiap param mode list yang ter-resolve
      const labels = (route.allowed_params || [])
        .filter((spec) => (spec.mode ?? "list") === "list")
        .map((spec) => params[spec.key])
        .filter((rp) => rp && rp.source !== "semantic")
        .map((rp) => rp!.values[0]?.name)
        .filter(Boolean);

      options.push({
        rank: options.length + 1,
        score: r2(directProb),
        intent: "DIRECT_LINK",
        target_type: "LIST",
        title: [route.title, ...labels].join(" — "),
        description: `Buka ${route.title.toLowerCase()}${labels.length ? ` untuk ${labels.join(", ")}` : ""}`,
        destination: qsStr ? `${route.path}?${qsStr}` : route.path,
        data: {
          route: route.id,
          filters: Object.fromEntries(qs.entries()),
        },
      });

      // 1D. Jika pada route list ini ada entity resolved (misal Siswa atau Rombel),
      // sertakan juga opsi direct DETAIL untuk entitas tersebut jika ada route detail yang cocok
      const detailRoute = dynamicRoutes.find((r) => {
        if (!r.path.includes(":id")) return false;
        // Cari route detail yang id-nya mirip (misal route.id = "siswa" -> detailRoute.id = "siswa_detail")
        if (r.id === `${route.id}_detail`) return true;
        if (route.id === "counseling" && r.id === "counseling_detail") return true;
        return false;
      });

      const matchedItems = entityResolved?.values || (searchSpec ? [] : (params["filter[name]"]?.values || []));
      if (detailRoute && matchedItems.length) {
        for (const item of matchedItems.slice(0, 5)) {
          const itemName = entityLabel(item);
          options.push({
            rank: options.length + 1,
            score: r2(directProb * (matchedItems.length === 1 ? 1 : 0.95)),
            intent: "DIRECT_LINK",
            target_type: "DETAIL",
            title: `${detailRoute.title}: ${itemName}`,
            description: `${detailRoute.description} (${itemName})`,
            destination: detailRoute.path.replace(":id", String(item.id)),
            data: { entity: { ...item.raw, id: item.id, name: itemName } },
          });
        }
      }

      for (const sg of suggestions) {
        const withGuess = new URLSearchParams(qs);
        withGuess.set(sg.key, sg.item.id);
        options.push({
          rank: options.length + 1,
          score: r2(directProb * 0.9),
          intent: "DIRECT_LINK",
          target_type: "LIST",
          title: `Maksud Anda ${sg.item.name}? — ${route.title}`,
          description: `Tebakan semantik, belum pasti: buka ${route.title.toLowerCase()} untuk ${sg.item.name}`,
          destination: `${route.path}?${withGuess.toString()}`,
          data: { route: route.id, suggestion: true, filters: Object.fromEntries(withGuess.entries()) },
        });
      }

      // Tambah opsi alternatif tanpa filter waktu, jika user menyebut periode/tahun/bulan
      const timeKeys = (route.allowed_params || [])
        .filter((spec) => spec.mode === "date_range" || spec.mode === "date_month" || spec.time_slot)
        .flatMap((spec) => (spec.mode === "date_range" ? [spec.param_gte, spec.param_lte] : [spec.key]))
        .filter((k): k is string => !!k);
      if (timeKeys.some((k) => qs.has(k))) {
        const alt = new URLSearchParams(qs);
        for (const k of timeKeys) alt.delete(k);
        options.push({
          rank: options.length + 1,
          score: r2(directProb * 0.85),
          intent: "DIRECT_LINK",
          target_type: "LIST",
          title: `${route.title} — Semua Periode`,
          description: `Buka ${route.title.toLowerCase()} tanpa filter periode/tahun`,
          destination: alt.toString() ? `${route.path}?${alt.toString()}` : route.path,
          data: { route: route.id, filters: Object.fromEntries(alt.entries()) },
        });
      }
    }
  }

  // --- 2. EVALUASI INTENT LIST_MENU (fallback navigasi) ---
  if (menuProb >= threshold || options.length === 0) {
    const matchedRoutes = dynamicRoutes.filter(
      (r) => r.keywords.some((k) => qLower.includes(k.toLowerCase())) || r.title.toLowerCase().includes(qLower)
    );
    const routesToShow = matchedRoutes.length > 0 ? matchedRoutes.slice(0, 4) : dynamicRoutes.slice(0, 3);
    for (const r of routesToShow) {
      options.push({
        rank: options.length + 1,
        score: r2(menuProb),
        intent: "LIST_MENU",
        target_type: "LIST",
        title: r.title,
        description: r.description,
        destination: r.path,
        data: { route: r.id },
      });
    }
  }

  // Filter threshold & ranking
  const filteredOptions = options
    .filter((opt) => opt.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map((opt, idx) => ({ ...opt, rank: idx + 1 }));

  return {
    status: "success",
    query,
    target_route: route?.id,
    total_options: filteredOptions.length,
    options: filteredOptions,
    meta: {
      engine,
      latency_ms,
      cached: false,
    },
  };
}

// helper typo guard (agar tidak crash lama)

