import type { ClassificationResult, IntentType } from "./classifier.js";
import type { ExtractedParams } from "./extractor.js";
import { type AppRoute } from "./routes-sync.js";

export interface MenuCard {
  id: string;
  title: string;
  description: string;
  path: string;
  icon: string;
}

export interface SmartSearchResponse {
  query: string;
  type: IntentType;
  confidence: number;
  engine: "JEV_CLOUD" | "LAYA_LOCAL";
  latency_ms: number;
  cached?: boolean;
  extracted_params: ExtractedParams;
  result:
    | {
        mode: "LIST_MENU";
        matched_menus: MenuCard[];
      }
    | {
        mode: "DIRECT_LINK";
        title: string;
        target_url: string;
        filters: Record<string, string>;
      }
    | {
        mode: "REPORT_ACTION";
        action: "DOWNLOAD_RAPOT" | "PRINT_RAPOT";
        title: string;
        download_url: string;
        params: {
          kelas?: string;
          semester?: string;
          format?: string;
          nama?: string;
        };
      };
}

export function dispatchAction(
  query: string,
  classification: ClassificationResult,
  params: ExtractedParams,
  dynamicRoutes: AppRoute[] = []
): SmartSearchResponse {
  const { intent, confidence, engine, latency_ms } = classification;
  const qLower = query.toLowerCase();

  // 1. SCENARIO 1: LIST_MENU (Daftar Menu Dinamis dari Cache App)
  if (intent === "LIST_MENU") {
    let matchedRoutes = dynamicRoutes.filter((r) =>
      r.keywords.some((k) => qLower.includes(k.toLowerCase())) ||
      r.title.toLowerCase().includes(qLower)
    );

    // Jika tidak ada keyword spesifik, tampilkan route dashboard + lainnya
    if (matchedRoutes.length === 0) {
      matchedRoutes = dynamicRoutes.slice(0, 3);
    } else {
      // Selalu sertakan dashboard jika ada menu terkait
      const dashboardRoute = dynamicRoutes.find((r) => r.id === "dashboard");
      if (dashboardRoute && !matchedRoutes.some((m) => m.id === "dashboard")) {
        matchedRoutes.unshift(dashboardRoute);
      }
    }

    const matched_menus: MenuCard[] = matchedRoutes.map((r) => ({
      id: `menu-${r.id}`,
      title: r.title,
      description: r.description,
      path: r.path,
      icon: r.id === "spp" ? "credit-card" : r.id === "siswa" ? "users" : r.id === "nilai" ? "award" : r.id === "rapot" ? "file-text" : "layout-dashboard",
    }));

    return {
      query,
      type: "LIST_MENU",
      confidence,
      engine,
      latency_ms,
      extracted_params: params,
      result: {
        mode: "LIST_MENU",
        matched_menus,
      },
    };
  }

  // 2. SCENARIO 2: DIRECT_LINK (URL Dinamis Berdasarkan Filter & Route Manifest)
  if (intent === "DIRECT_LINK") {
    // Cari route terbaik yang mendukung DIRECT_LINK dengan skor kecocokan tertinggi
    const candidateRoutes = dynamicRoutes.filter((r) => r.supported_intents.includes("DIRECT_LINK"));
    let selectedRoute = candidateRoutes.find((r) => r.id === "siswa") || dynamicRoutes[0];
    let maxScore = 0;

    for (const r of candidateRoutes) {
      let score = 0;
      for (const k of r.keywords) {
        if (qLower.includes(k.toLowerCase())) {
          // Bobot lebih tinggi untuk domain spesifik (keuangan/nilai) dibanding kata umum "siswa"
          score += ["nunggak", "tagihan", "spp", "bayar", "nilai", "ulangan", "akademik"].includes(k.toLowerCase()) ? 5 : 1;
        }
      }
      if (score > maxScore) {
        maxScore = score;
        selectedRoute = r;
      }
    }

    const queryParams = new URLSearchParams();
    const filterObj: Record<string, string> = {};

    // Petakan parameter yang diekstrak sesuai filter_keys milik route
    if (selectedRoute.id === "spp") {
      if (params.status) queryParams.set("status", params.status);
      if (params.kelas) queryParams.set("kelas", params.kelas);
    } else if (selectedRoute.id === "nilai") {
      if (params.kelas) queryParams.set("kelas", params.kelas);
      if (params.semester) queryParams.set("semester", params.semester);
      if (params.mapel) queryParams.set("mapel", params.mapel);
    } else {
      // Siswa / General
      if (params.kelas) queryParams.set("kelas", params.kelas);
      if (params.status) queryParams.set("status", params.status);
      if (params.nama) queryParams.set("q", params.nama);
    }

    queryParams.forEach((val, key) => {
      filterObj[key] = val;
    });

    const qs = queryParams.toString();
    const target_url = qs ? `${selectedRoute.path}?${qs}` : selectedRoute.path;

    return {
      query,
      type: "DIRECT_LINK",
      confidence,
      engine,
      latency_ms,
      extracted_params: params,
      result: {
        mode: "DIRECT_LINK",
        title: `${selectedRoute.title}${params.kelas ? " - Kelas " + params.kelas : ""}`,
        target_url,
        filters: filterObj,
      },
    };
  }

  // 3. SCENARIO 3: REPORT_ACTION (Aksi Download / Print Dokumen)
  const isPrint = qLower.includes("cetak") || qLower.includes("print");
  const actionType = isPrint ? "PRINT_RAPOT" : "DOWNLOAD_RAPOT";

  const dlParams = new URLSearchParams();
  if (params.kelas) dlParams.set("kelas", params.kelas);
  if (params.semester) dlParams.set("semester", params.semester);
  if (params.format) dlParams.set("format", params.format);
  if (params.nama) dlParams.set("nama", params.nama);

  const download_url = `/api/rapot/download?${dlParams.toString()}`;

  return {
    query,
    type: "REPORT_ACTION",
    confidence,
    engine,
    latency_ms,
    extracted_params: params,
    result: {
      mode: "REPORT_ACTION",
      action: actionType,
      title: `Cetak / Unduh Rapot (${params.kelas ? "Kelas " + params.kelas : "Semua Kelas"}${params.semester ? " Semester " + params.semester : ""})`,
      download_url,
      params: {
        kelas: params.kelas,
        semester: params.semester,
        format: params.format || "pdf",
        nama: params.nama,
      },
    },
  };
}
