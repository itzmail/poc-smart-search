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
