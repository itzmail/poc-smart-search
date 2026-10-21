import type { ClassificationResult, IntentType } from "./classifier.js";
import type { ExtractedParams } from "./extractor.js";

export interface MenuCard {
  id: string;
  title: string;
  description: string;
  path: string;
  icon: string;
  badge?: string;
}

export interface SmartSearchResponse {
  query: string;
  type: IntentType;
  confidence: number;
  engine: "JEV_CLOUD" | "LAYA_LOCAL";
  latency_ms: number;
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

const STATIC_MENUS: MenuCard[] = [
  {
    id: "menu-dashboard",
    title: "Dashboard Utama",
    description: "Statistik ringkas sekolah, kehadiran, dan keuangan",
    path: "/dashboard",
    icon: "layout-dashboard",
  },
  {
    id: "menu-siswa",
    title: "Master Data Siswa",
    description: "Daftar biodata siswa per rombel dan status aktif",
    path: "/siswa",
    icon: "users",
  },
  {
    id: "menu-nilai",
    title: "Penilaian Akademik",
    description: "Input dan rekap nilai mata pelajaran per semester",
    path: "/nilai",
    icon: "award",
  },
  {
    id: "menu-spp",
    title: "Pembayaran & Tagihan SPP",
    description: "Data tunggakan dan verifikasi pembayaran SPP",
    path: "/spp",
    icon: "credit-card",
  },
  {
    id: "menu-rapot",
    title: "Cetak & Distribusi Rapot",
    description: "Pusat pencetakan buku rapor dan e-rapor siswa",
    path: "/rapot",
    icon: "file-text",
  },
];

export function dispatchAction(
  query: string,
  classification: ClassificationResult,
  params: ExtractedParams
): SmartSearchResponse {
  const { intent, confidence, engine, latency_ms } = classification;

  if (intent === "LIST_MENU") {
    const qLower = query.toLowerCase();
    // Prioritaskan menu sesuai keyword domain
    let matched = STATIC_MENUS;
    if (qLower.includes("spp") || qLower.includes("bayar") || qLower.includes("uang")) {
      matched = STATIC_MENUS.filter((m) => m.id === "menu-spp" || m.id === "menu-dashboard");
    } else if (qLower.includes("nilai") || qLower.includes("akademik") || qLower.includes("mapel")) {
      matched = STATIC_MENUS.filter((m) => m.id === "menu-nilai" || m.id === "menu-rapot");
    } else if (qLower.includes("rapot") || qLower.includes("rapor")) {
      matched = STATIC_MENUS.filter((m) => m.id === "menu-rapot" || m.id === "menu-nilai");
    } else if (qLower.includes("siswa") || qLower.includes("murid")) {
      matched = STATIC_MENUS.filter((m) => m.id === "menu-siswa" || m.id === "menu-dashboard");
    }

    return {
      query,
      type: "LIST_MENU",
      confidence,
      engine,
      latency_ms,
      extracted_params: params,
      result: {
        mode: "LIST_MENU",
        matched_menus: matched,
      },
    };
  }

  if (intent === "DIRECT_LINK") {
    const qLower = query.toLowerCase();
    const queryParams = new URLSearchParams();
    let basePath = "/siswa";
    let title = "Data Siswa";

    if (qLower.includes("spp") || qLower.includes("nunggak") || qLower.includes("tagihan") || qLower.includes("lunas")) {
      basePath = "/spp";
      title = "Data Tagihan & Pembayaran SPP";
      if (params.status) queryParams.set("status", params.status);
      if (params.kelas) queryParams.set("kelas", params.kelas);
    } else if (qLower.includes("nilai") || qLower.includes("ujian") || qLower.includes("mapel")) {
      basePath = "/nilai";
      title = "Rekap Nilai Siswa";
      if (params.kelas) queryParams.set("kelas", params.kelas);
      if (params.semester) queryParams.set("semester", params.semester);
      if (params.mapel) queryParams.set("mapel", params.mapel);
    } else {
      if (params.kelas) queryParams.set("kelas", params.kelas);
      if (params.status) queryParams.set("status", params.status);
      if (params.nama) queryParams.set("q", params.nama);
    }

    const qs = queryParams.toString();
    const target_url = qs ? `${basePath}?${qs}` : basePath;
    const filterObj: Record<string, string> = {};
    queryParams.forEach((val, key) => {
      filterObj[key] = val;
    });

    return {
      query,
      type: "DIRECT_LINK",
      confidence,
      engine,
      latency_ms,
      extracted_params: params,
      result: {
        mode: "DIRECT_LINK",
        title: `${title}${params.kelas ? ` - Kelas ${params.kelas}` : ""}`,
        target_url,
        filters: filterObj,
      },
    };
  }

  // REPORT_ACTION
  const dlParams = new URLSearchParams();
  if (params.kelas) dlParams.set("kelas", params.kelas);
  if (params.semester) dlParams.set("semester", params.semester);
  dlParams.set("format", params.format || "pdf");
  if (params.nama) dlParams.set("nama", params.nama);

  const titleDesc = [
    params.nama ? `Siswa ${params.nama}` : "",
    params.kelas ? `Kelas ${params.kelas}` : "",
    params.semester ? `Semester ${params.semester}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    query,
    type: "REPORT_ACTION",
    confidence,
    engine,
    latency_ms,
    extracted_params: params,
    result: {
      mode: "REPORT_ACTION",
      action: params.format === "print" ? "PRINT_RAPOT" : "DOWNLOAD_RAPOT",
      title: `Cetak / Unduh Rapot ${titleDesc ? `(${titleDesc})` : "Siswa"}`,
      download_url: `/api/rapot/download?${dlParams.toString()}`,
      params: {
        kelas: params.kelas,
        semester: params.semester,
        format: params.format || "pdf",
        nama: params.nama,
      },
    },
  };
}
