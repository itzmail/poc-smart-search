/**
 * Smart Search Date Range Resolver
 * Translates colloquial relative time hints into exact ISO date bounds:
 * "created_at.$gte" & "created_at.$lte" (YYYY-MM-DD)
 */

export interface DateRangeBounds {
  gte: string;
  lte: string;
}

export function resolveDateRange(
  periodKey: string,
  referenceDateStr?: string
): DateRangeBounds | null {
  // Parse reference date without UTC conversion shift:
  // "YYYY-MM-DD" parsed with new Date(y, m - 1, d) uses local calendar day directly.
  let ref: Date;
  if (referenceDateStr && /^\d{4}-\d{2}-\d{2}$/.test(referenceDateStr)) {
    const [y, m, d] = referenceDateStr.split("-").map(Number);
    ref = new Date(y, m - 1, d);
  } else {
    ref = new Date();
  }
  if (isNaN(ref.getTime())) return null;

  const formatDate = (d: Date): string => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const currentYear = ref.getFullYear();
  const currentMonth = ref.getMonth(); // 0-indexed

  switch (periodKey) {
    case "hari_ini": {
      const todayStr = formatDate(ref);
      return { gte: todayStr, lte: todayStr };
    }
    case "minggu_ini": {
      // 7 days rolling window ending at today
      const start = new Date(ref);
      start.setDate(ref.getDate() - 6);
      return { gte: formatDate(start), lte: formatDate(ref) };
    }
    case "bulan_ini": {
      const start = new Date(currentYear, currentMonth, 1);
      const end = new Date(currentYear, currentMonth + 1, 0); // Last day of current month
      return { gte: formatDate(start), lte: formatDate(end) };
    }
    case "bulan_lalu": {
      const start = new Date(currentYear, currentMonth - 1, 1);
      const end = new Date(currentYear, currentMonth, 0); // Last day of previous month
      return { gte: formatDate(start), lte: formatDate(end) };
    }
    case "tahun_ini": {
      const start = new Date(currentYear, 0, 1);
      const end = new Date(currentYear, 11, 31);
      return { gte: formatDate(start), lte: formatDate(end) };
    }
    case "tahun_lalu": {
      const start = new Date(currentYear - 1, 0, 1);
      const end = new Date(currentYear - 1, 11, 31);
      return { gte: formatDate(start), lte: formatDate(end) };
    }
    default:
      return null;
  }
}

export const MONTHS = [
  "januari", "februari", "maret", "april", "mei", "juni",
  "juli", "agustus", "september", "oktober", "november", "desember",
];
const MONTH_RX = `(${MONTHS.join("|")})`;

// Month numbers (1-12) for a "date_month" pair: [start, end]. null when the query names no month.
//   "bulan ini" / "bulan berjalan" -> current month
//   "bulan lalu"                   -> previous month
//   "januari" / "bulan maret"      -> that month
//   "januari sampai maret"         -> range (also "-", "s/d", "hingga")
export function resolveMonthRange(
  query: string,
  referenceDateStr?: string
): [number, number] | null {
  let ref: Date;
  if (referenceDateStr && /^\d{4}-\d{2}-\d{2}$/.test(referenceDateStr)) {
    const [y, m, d] = referenceDateStr.split("-").map(Number);
    ref = new Date(y, m - 1, d);
  } else {
    ref = new Date();
  }
  if (isNaN(ref.getTime())) return null;
  const cur = ref.getMonth() + 1;

  const q = query.toLowerCase();
  const range = q.match(new RegExp(`\\b${MONTH_RX}\\s*(?:sampai|hingga|s\\/d|sd|-)\\s*${MONTH_RX}\\b`));
  if (range) return [MONTHS.indexOf(range[1]) + 1, MONTHS.indexOf(range[2]) + 1];
  const named = q.match(new RegExp(`\\b${MONTH_RX}\\b`));
  if (named) {
    const n = MONTHS.indexOf(named[1]) + 1;
    return [n, n];
  }
  if (/\bbulan\s*(ini|berjalan)\b/.test(q)) return [cur, cur];
  if (/\bbulan\s*(lalu|kemarin|sebelumnya)\b/.test(q)) {
    const prev = cur === 1 ? 12 : cur - 1;
    return [prev, prev];
  }
  return null;
}
