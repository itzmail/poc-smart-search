import type { ClassificationResult, IntentType } from "./classifier.js";
import type { RawExtraction } from "./extractor.js";
import type { AppRoute, ParamSpec } from "./routes-sync.js";
import { indexResolvedParams, type ResolvedParam } from "./lazy-resolver.js";
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
  // Payload terstruktur per entitas (multi-entity disambiguation)
  // contoh: { entity_role: "siswa", siswa: {...}, kelas: {...} }
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

function siswaLabel(s: Record<string, any>): string {
  return s?.nama || s?.nama_siswa || s?.id || "";
}

function kelasName(k: Record<string, any>): string {
  return k?.name || (k?.code ? `Kelas ${String(k.code).toUpperCase()}` : "") || "";
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
  const actionProb = probabilities.REPORT_ACTION || 0;
  const menuProb = probabilities.LIST_MENU || 0;

  if (route) {
    // --- 1. Entity-driven DIRECT_LINK options (siswa / wali_kelas / kelas) ---
    const siswaResolved = params["siswa_id"];
    const waliResolved = params["wali_kelas"];
    const kelasResolved = params["kelas_id"];

    const isAskingClass = /\b(kelas|ruang|di\s*mana|kelas\s*berapa)\b/i.test(qLower);
    const isWaliContext = /\b(wali|ibu|bu\s|pak\b|bapak|guru)\b/i.test(qLower);

    // 1A. Route "kelas": setiap match siswa = option kelas-nya +
    //     setiap match wali_kelas = option kelas sebagai homeroom teacher
    if (route.id === "kelas") {
      const siswaMatches = siswaResolved?.values.filter((v) => v.kelas_id || v.raw?.kelas_id) || [];
      // Urut: siswa match terbaik dari bertanya kelas; jika konteks wali, guru dulu
      const waliMatches = waliResolved?.values || [];

      const pushKelasOption = (
        entity_role: "siswa" | "wali_kelas",
        siswa: Record<string, any> | null,
        wali: Record<string, any> | null,
        kelas: Record<string, any>,
        score: number
      ) => {
        options.push({
          rank: options.length + 1,
          score: r2(score),
          intent: "DIRECT_LINK",
          target_type: "DETAIL",
          title:
            entity_role === "siswa"
              ? `${kelasName(kelas)} — ${siswaLabel(siswa!)} (Siswa)`
              : `${kelasName(kelas)} — ${wali?.wali_kelas || wali?.name || ""} (Wali Kelas)`,
          description:
            entity_role === "siswa"
              ? `${siswaLabel(siswa!)} terdaftar sebagai siswa di ${kelasName(kelas)}`
              : `${wali?.wali_kelas || wali?.name || ""} adalah wali kelas ${kelasName(kelas)}`,
          destination: `/kelas/${kelas.id}`,
          data: {
            entity_role,
            ...(siswa ? { siswa: { id: siswa.id, nisn: siswa.nisn || siswa.raw?.nisn, nama: siswaLabel(siswa), kelas: siswa.kelas } } : {}),
            ...(wali ? { wali_kelas: { nama: wali.wali_kelas || wali.name } } : {}),
            kelas: { id: kelas.id, code: kelas.code || kelas.raw?.code, name: kelas.name },
          },
        });
      };

      for (const s of siswaMatches.slice(0, 8)) {
        const kelasId = s.kelas_id || s.raw?.kelas_id;
        const kelasItem = (kelasResolved?.values || []).find((k) => k.id === kelasId);
        const kelas = kelasItem
          ? { id: kelasItem.id, code: kelasItem.code, name: kelasItem.name }
          : { id: kelasId, code: s.kelas, name: s.kelas ? `Kelas ${s.kelas}` : "" };
        // Match siswa: prioritas wali context jika ditanya "wali kelas mana"
        const score = isWaliContext ? directProb * 0.95 : directProb * (isAskingClass ? 1.05 : 1.0);
        pushKelasOption("siswa", s.raw, null, kelas, score);
      }

      for (const w of waliMatches.slice(0, 4)) {
        const score = isWaliContext ? directProb * 1.05 : directProb * 0.85;
        pushKelasOption("wali_kelas", null, w, { id: w.id, code: w.code, name: w.name }, score);
      }
    }

    // 1B. Route "siswa": profil siswa per match
    if (route.id === "siswa" && siswaResolved?.values.length) {
      for (const s of siswaResolved.values.slice(0, 8)) {
        options.push({
          rank: options.length + 1,
          score: r2(directProb),
          intent: "DIRECT_LINK",
          target_type: "DETAIL",
          title: `Profil Siswa: ${siswaLabel(s.raw)}`,
          description: `Biodata ${siswaLabel(s.raw)} (Kelas ${s.kelas || s.raw?.kelas || "-"})`,
          destination: `/siswa/${s.id}`,
          data: {
            entity_role: "siswa",
            siswa: { id: s.id, nisn: s.nisn || s.raw?.nisn, nama: siswaLabel(s.raw), kelas: s.kelas || s.raw?.kelas, kelas_id: s.kelas_id || s.raw?.kelas_id },
          },
        });
      }
    }

    // 1E. Route "guru": one DETAIL option per matched teacher, plain LIST when nothing matched
    if (route.id === "guru") {
      const guruResolved = params["guru_id"];
      for (const g of (guruResolved?.values || []).slice(0, 8)) {
        options.push({
          rank: options.length + 1,
          score: r2(directProb),
          intent: "DIRECT_LINK",
          target_type: "DETAIL",
          title: `Profil Guru: ${g.name}`,
          description: `${g.name}${g.raw?.mapel ? ` — ${g.raw.mapel}` : ""}`,
          destination: `/guru/${g.id}`,
          data: {
            entity_role: "guru",
            guru: { id: g.id, nama: g.name, mapel: g.raw?.mapel, wali_kelas_id: g.raw?.wali_kelas_id },
          },
        });
      }
      if (options.length === 0) {
        options.push({
          rank: 1,
          score: r2(directProb),
          intent: "DIRECT_LINK",
          target_type: "LIST",
          title: route.title,
          description: route.description,
          destination: route.path,
          data: { route: route.id },
        });
      }
    }

    // 1C. SPP/nilai/rapot: LIST route dengan query params dari resolved values
    const isListRoute = ["spp", "siswa", "nilai", "dashboard"].includes(route.id) && options.length === 0;

    if (isListRoute) {
      const qs = new URLSearchParams();
      let dateRangeApplied = false;
      // Transformer guesses on master lists are never applied as filters; offered as "did you mean"
      const suggestions: { key: string; item: { id: string; name: string } }[] = [];

      for (const spec of route.allowed_params || []) {
        // mode search (siswa_id): ditangani terpisah sebagai ?q=<nama depan entitas>
        if (spec.mode === "search") continue;
        const rp = params[spec.key];
        if (!rp) continue;
        if (rp.source === "semantic" && (spec.mode ?? "list") === "list" && rp.values[0]) {
          suggestions.push({ key: spec.key, item: rp.values[0] });
          continue;
        }
        if (rp.source === "enum" || rp.source === "semantic") {
          // enum / date_range: label dari DB config
          const v = extraction.enumValues[spec.key];
          if (v) {
            // Jika slot adalah date_range (mis. created_at) atau legacy periode
            if (spec.mode === "date_range" || spec.key === "periode" || spec.key === "created_at") {
              const bounds = resolveDateRange(v, referenceDateStr);
              if (bounds) {
                const gteKey = spec.param_gte || "created_at.$gte";
                const lteKey = spec.param_lte || "created_at.$lte";
                qs.set(gteKey, bounds.gte);
                qs.set(lteKey, bounds.lte);
                dateRangeApplied = true;
              } else {
                qs.set(spec.key, v);
              }
            } else {
              qs.set(spec.key, v);
            }
          }
        } else if (rp.values[0]) {
          // selain enum: pakai id master (FK) — mis. kelas_id=K-08B
          qs.set(spec.key, rp.values[0].id);
        }
      }
      // Entity search (siswa): backend list menerima query nama (bukan FK siswa_id)
      if (siswaResolved?.values[0] && (route.allowed_params || []).some((s) => s.mode === "search")) {
        const s = siswaResolved.values[0];
        const firstToken = siswaLabel(s.raw).split(/\s+/)[0];
        if (firstToken) qs.set("q", firstToken);
      }
      const qsStr = qs.toString();

      // Label human-readable utk tahun ajaran (dari active_context)
      const ayResolved = params["academic_year_id"];
      const statusResolved = qs.get("status");
      const kelasLabel = params["kelas_id"]?.values[0]?.name;

      options.push({
        rank: options.length + 1,
        score: r2(directProb),
        intent: "DIRECT_LINK",
        target_type: "LIST",
        title: [
          route.title,
          statusResolved ? `Status ${statusResolved.toUpperCase()}` : "",
          kelasLabel ? kelasLabel : "",
          ayResolved?.values[0]?.name ? `TA ${ayResolved.values[0].name}` : "",
        ]
          .filter(Boolean)
          .join(" — "),
        description: `Buka ${route.title.toLowerCase()}${statusResolved ? ` dengan filter status ${statusResolved}` : ""}${ayResolved?.values[0]?.name ? ` tahun ajaran ${ayResolved.values[0].name}` : ""}`,
        destination: qsStr ? `${route.path}?${qsStr}` : route.path,
        data: {
          route: route.id,
          filters: Object.fromEntries(qs.entries()),
        },
      });

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

      // Tambah opsi alternatif tanpa filter waktu, jika user menyebut periode/tahun
      if (qs.get("academic_year_id") || qs.get("created_at.$gte") || qs.get("periode")) {
        const alt = new URLSearchParams(qs);
        alt.delete("periode");
        alt.delete("created_at.$gte");
        alt.delete("created_at.$lte");
        alt.delete("academic_year_id");
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

    // 1D. Route "kelas" tanpa entity match — LIST master kelas biasa
    if (route.id === "kelas" && options.length === 0) {
      options.push({
        rank: options.length + 1,
        score: r2(directProb),
        intent: "DIRECT_LINK",
        target_type: "LIST",
        title: route.title,
        description: route.description,
        destination: route.path,
        data: { route: route.id },
      });
    }
  }

  // --- 2. EVALUASI INTENT REPORT_ACTION (rapot) ---
  if (route?.id === "rapot" && actionProb >= threshold) {
    const dlParams = new URLSearchParams();
    for (const spec of route.allowed_params || []) {
      const rp = params[spec.key];
      if (!rp) continue;
      if (rp.source === "enum" || rp.source === "semantic") {
        const v = extraction.enumValues[spec.key];
        if (v) dlParams.set(spec.key, v);
      } else if (rp.values[0]) {
        // rapot pakai kelas nama (e.g. 8B) — sementara dari master name/code
        dlParams.set(spec.key, rp.values[0].code || rp.values[0].name || rp.values[0].id);
      }
    }
    const isPrint = /cetak|print/i.test(qLower);
    options.push({
      rank: options.length + 1,
      score: r2(actionProb),
      intent: "REPORT_ACTION",
      target_type: "ACTION",
      title: `${isPrint ? "Cetak" : "Unduh"} Rapot${params["kelas_id"]?.values[0] ? ` (${params["kelas_id"]!.values[0].name})` : ""}`,
      description: `Generate dokumen rapor format ${(extraction.enumValues.format || "pdf").toUpperCase()}`,
      destination: `/api/rapot/download?${dlParams.toString()}`,
      data: { route: "rapot", filters: Object.fromEntries(dlParams.entries()) },
    });
  }

  // --- 3. EVALUASI INTENT LIST_MENU (fallback navigasi) ---
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

