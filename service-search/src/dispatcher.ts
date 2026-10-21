import type { ClassificationResult, IntentType } from "./classifier.js";
import type { ExtractedParams } from "./extractor.js";
import { type AppRoute, type ResolvedEntity } from "./routes-sync.js";

export type TargetType = "DETAIL" | "LIST" | "ACTION";

export interface SearchOption {
  rank: number;
  score: number;
  intent: IntentType;
  target_type: TargetType;
  title: string;
  description: string;
  destination: string;
  entity?: {
    type: "kelas" | "invoice" | "siswa" | "agregasi";
    id: string;
    code?: string;
    name: string;
  };
}

export interface SmartSearchResponse {
  status: "success";
  query: string;
  client_id?: string;
  user_role?: string;
  engine: "JEV_CLOUD" | "LAYA_LOCAL";
  latency_ms: number;
  cached?: boolean;
  threshold: number;
  total_options: number;
  options: SearchOption[];
}

export function dispatchAction(
  query: string,
  classification: ClassificationResult,
  params: ExtractedParams,
  dynamicRoutes: AppRoute[] = [],
  resolvedEntities: ResolvedEntity[] = [],
  threshold: number = 0.2
): SmartSearchResponse {
  const { probabilities, engine, latency_ms } = classification;
  const qLower = query.toLowerCase();

  const isExplicitDetail = /\b(detail|buka|profil|ruang)\b/i.test(qLower);
  const isExplicitList = /\b(daftar|tabel|semua|lihat|rekap|nunggak|tagihan|lunas)\b/i.test(qLower);

  const matchedEntity = resolvedEntities[0];
  const options: SearchOption[] = [];

  // 1. EVALUASI INTENT DIRECT_LINK
  const directLinkProb = probabilities.DIRECT_LINK || 0;
  if (directLinkProb >= threshold) {
    // 1A. Jika ada Entitas Kelas / Invoice / Siswa yang terdeteksi
    if (matchedEntity) {
      if (matchedEntity.type === "kelas") {
        // Option 1: Detail Kelas
        options.push({
          rank: 1,
          score: Math.round((isExplicitDetail ? directLinkProb * 1.1 : directLinkProb * 0.95) * 100) / 100,
          intent: "DIRECT_LINK",
          target_type: "DETAIL",
          title: `Detail ${matchedEntity.name}`,
          description: `Buka halaman informasi dan daftar siswa ${matchedEntity.name}`,
          destination: matchedEntity.detail_url,
          entity: {
            type: "kelas",
            id: matchedEntity.id,
            code: matchedEntity.code,
            name: matchedEntity.name,
          },
        });

        // Option 2: List SPP / Siswa Terfilter Kelas Ini
        const sppRoute = dynamicRoutes.find((r) => r.id === "spp");
        if (sppRoute) {
          const qs = params.status ? `?kelas_id=${matchedEntity.id}&status=${params.status}` : `?kelas_id=${matchedEntity.id}`;
          options.push({
            rank: 2,
            score: Math.round((isExplicitList ? directLinkProb * 1.15 : directLinkProb * 0.85) * 100) / 100,
            intent: "DIRECT_LINK",
            target_type: "LIST",
            title: `Tagihan SPP - ${matchedEntity.name}${params.status ? ` (${params.status.toUpperCase()})` : ""}`,
            description: `Buka tabel tagihan SPP untuk ${matchedEntity.name}`,
            destination: `/spp${qs}`,
            entity: {
              type: "kelas",
              id: matchedEntity.id,
              code: matchedEntity.code,
              name: matchedEntity.name,
            },
          });
        }
      } else if (matchedEntity.type === "invoice") {
        // Detail Invoice Tagihan SPP
        options.push({
          rank: 1,
          score: directLinkProb,
          intent: "DIRECT_LINK",
          target_type: "DETAIL",
          title: `Invoice ${matchedEntity.name}`,
          description: `Buka rincian tagihan pembayaran SPP`,
          destination: matchedEntity.detail_url,
          entity: {
            type: "invoice",
            id: matchedEntity.id,
            name: matchedEntity.name,
          },
        });
      } else if (matchedEntity.type === "agregasi") {
        // Kasus: "kelas mana saja yang telat bayar"
        // Option 1: Rekap Utama SPP Nunggak
        options.push({
          rank: 1,
          score: directLinkProb,
          intent: "DIRECT_LINK",
          target_type: "LIST",
          title: matchedEntity.name,
          description: `Buka modul SPP dengan filter semua siswa status nunggak`,
          destination: matchedEntity.list_url,
          entity: {
            type: "agregasi",
            id: matchedEntity.id,
            name: matchedEntity.name,
          },
        });

        // Option 2 & 3: Breakdown per Kelas yang Nunggak
        const classes = matchedEntity.meta?.classes || [];
        classes.slice(0, 3).forEach((cls: any, i: number) => {
          options.push({
            rank: options.length + 1,
            score: Math.round((directLinkProb - 0.05 * (i + 1)) * 100) / 100,
            intent: "DIRECT_LINK",
            target_type: "LIST",
            title: `Daftar Tunggakan ${cls.name} (${cls.total_nunggak} Siswa)`,
            description: `Filter siswa nunggak khusus ${cls.name} (Total: Rp ${cls.total_nominal?.toLocaleString("id-ID")})`,
            destination: `/spp?status=nunggak&kelas_id=${cls.kelas_id}`,
            entity: {
              type: "kelas",
              id: cls.kelas_id,
              code: cls.code,
              name: cls.name,
            },
          });
        });
      } else if (matchedEntity.type === "siswa") {
        const isAskingClass = /\b(kelas|ruang|di\s*mana)\b/i.test(qLower);
        const isAskingBill = /\b(tagihan|bayar|spp|invoice|biaya|lunas|nunggak)\b/i.test(qLower);

        // Jika user bertanya: "anak siti ada di kelas mana", Ruang Kelas naik ke Rank #1
        if (isAskingClass && matchedEntity.meta?.kelas_id) {
          options.push({
            rank: 1,
            score: Math.round((directLinkProb * 1.05) * 100) / 100,
            intent: "DIRECT_LINK",
            target_type: "DETAIL",
            title: `Ruang Kelas ${matchedEntity.meta.kelas} (${matchedEntity.name})`,
            description: `Buka informasi ruang kelas ${matchedEntity.meta.kelas} tempat ${matchedEntity.name} belajar`,
            destination: matchedEntity.meta.kelas_detail_url || `/kelas/${matchedEntity.meta.kelas_id}`,
            entity: {
              type: "kelas",
              id: matchedEntity.meta.kelas_id,
              name: `Kelas ${matchedEntity.meta.kelas}`,
            },
          });
        }

        // Opsi Profil Siswa
        options.push({
          rank: options.length + 1,
          score: isAskingClass ? Math.round(directLinkProb * 0.9 * 100) / 100 : directLinkProb,
          intent: "DIRECT_LINK",
          target_type: "DETAIL",
          title: `Profil Siswa: ${matchedEntity.name}`,
          description: `Biodata lengkap ${matchedEntity.name} (Kelas ${matchedEntity.meta?.kelas || "-"})`,
          destination: matchedEntity.detail_url || `/siswa/${matchedEntity.id}`,
          entity: {
            type: "siswa",
            id: matchedEntity.id,
            name: matchedEntity.name,
          },
        });

        // Opsi Invoice Siswa jika ada dan ROLE MEMILIKI IZIN KE SPP/INVOICE
        const hasSppAccess = dynamicRoutes.some((r) => r.id === "spp" || r.path.startsWith("/spp"));
        const invoices = matchedEntity.meta?.invoices || [];
        if (hasSppAccess && invoices.length > 0) {
          const inv = invoices[0];
          options.push({
            rank: options.length + 1,
            score: isAskingBill ? Math.round(directLinkProb * 1.1 * 100) / 100 : Math.round(directLinkProb * 0.75 * 100) / 100,
            intent: "DIRECT_LINK",
            target_type: "DETAIL",
            title: `Tagihan SPP: ${inv.invoice_no} (${matchedEntity.name})`,
            description: `Rincian tagihan status ${inv.status.toUpperCase()} (Rp ${inv.nominal?.toLocaleString("id-ID")})`,
            destination: `/spp/invoice/${inv.id}`,
            entity: {
              type: "invoice",
              id: inv.id,
              name: `Invoice ${inv.invoice_no}`,
            },
          });
        }
      }
    } else {
      // 1B. DIRECT_LINK Tanpa Entitas Master Khusus (Filter Biasa ke Modul)
      const candidateRoutes = dynamicRoutes.filter((r) => r.supported_intents.includes("DIRECT_LINK"));
      let selectedRoute = candidateRoutes.find((r) => r.id === "siswa") || dynamicRoutes[0];
      let maxScore = 0;

      for (const r of candidateRoutes) {
        let score = 0;
        for (const k of r.keywords) {
          if (qLower.includes(k.toLowerCase())) {
            score += ["nunggak", "tagihan", "spp", "bayar", "nilai", "ulangan", "akademik"].includes(k.toLowerCase()) ? 5 : 1;
          }
        }
        if (score > maxScore) {
          maxScore = score;
          selectedRoute = r;
        }
      }

      const qParams = new URLSearchParams();
      if (params.status) qParams.set("status", params.status);
      if (params.kelas) qParams.set("kelas", params.kelas);
      if (params.semester) qParams.set("semester", params.semester);
      if (params.mapel) qParams.set("mapel", params.mapel);
      const qs = qParams.toString();

      options.push({
        rank: 1,
        score: directLinkProb,
        intent: "DIRECT_LINK",
        target_type: "LIST",
        title: `${selectedRoute.title}${params.kelas ? " - Kelas " + params.kelas : ""}`,
        description: `Buka tabel ${selectedRoute.title.toLowerCase()} dengan filter query`,
        destination: qs ? `${selectedRoute.path}?${qs}` : selectedRoute.path,
      });
    }
  }

  // 2. EVALUASI INTENT REPORT_ACTION
  const reportProb = probabilities.REPORT_ACTION || 0;
  if (reportProb >= threshold) {
    const hasRapotAccess = dynamicRoutes.some((r) => r.id === "rapot" || r.supported_intents.includes("REPORT_ACTION"));
    if (hasRapotAccess) {
      const isPrint = qLower.includes("cetak") || qLower.includes("print");
      const dlParams = new URLSearchParams();
      if (params.kelas) dlParams.set("kelas", params.kelas);
      if (params.semester) dlParams.set("semester", params.semester);
      if (params.format) dlParams.set("format", params.format);
      if (params.nama) dlParams.set("nama", params.nama);

      options.push({
        rank: options.length + 1,
        score: reportProb,
        intent: "REPORT_ACTION",
        target_type: "ACTION",
        title: `${isPrint ? "Cetak" : "Unduh"} Rapot (${params.kelas ? "Kelas " + params.kelas : "Semua Kelas"})`,
        description: `Generate dokumen rapor resmi format ${params.format?.toUpperCase() || "PDF"}`,
        destination: `/api/rapot/download?${dlParams.toString()}`,
      });
    }
  }

  // 3. EVALUASI INTENT LIST_MENU
  const menuProb = probabilities.LIST_MENU || 0;
  if (menuProb >= threshold || options.length === 0) {
    const matchedRoutes = dynamicRoutes.filter((r) =>
      r.keywords.some((k) => qLower.includes(k.toLowerCase())) ||
      r.title.toLowerCase().includes(qLower)
    );

    const routesToShow = matchedRoutes.length > 0 ? matchedRoutes : dynamicRoutes.slice(0, 3);
    for (const r of routesToShow) {
      options.push({
        rank: options.length + 1,
        score: Math.round(menuProb * 100) / 100,
        intent: "LIST_MENU",
        target_type: "LIST",
        title: r.title,
        description: r.description,
        destination: r.path,
      });
    }
  }

  // Filter threshold, izin ACL route, & ranking pengurutan opsi
  // Pastikan SEMUA opsi yang keluar diizinkan oleh dynamicRoutes (ACL Role)
  const isDestinationPermitted = (dest: string) => {
    const cleanPath = "/" + dest.replace(/^\//, "").split("?")[0].split("/")[0];
    // Route file action rapot selalu dicek ke route rapot
    if (cleanPath === "/api" && dest.includes("/rapot")) {
      return dynamicRoutes.some((r) => r.id === "rapot" || r.path.startsWith("/rapot"));
    }
    return dynamicRoutes.some((r) => r.path.startsWith(cleanPath) || r.id === cleanPath.replace("/", ""));
  };

  const filteredOptions = options
    .filter((opt) => opt.score >= threshold && isDestinationPermitted(opt.destination))
    .sort((a, b) => b.score - a.score)
    .map((opt, idx) => ({ ...opt, rank: idx + 1 }));

  return {
    status: "success",
    query,
    engine,
    latency_ms,
    threshold,
    total_options: filteredOptions.length,
    options: filteredOptions,
  };
}
