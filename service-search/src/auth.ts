import type { IncomingMessage } from "node:http";

export interface Identity {
  clientId: string;
  role: string;
}

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const ROLE_RE = /^[A-Z_]{1,32}$/;

// AUTH_MODE:
//   trusted-header (default) -> identitas HANYA dari header X-Client-Id / X-User-Role.
//     Mengasumsikan gateway/jaringan internal yang memverifikasi dan menyuntik header ini.
//   jwt -> belum dikonfigurasi (sumber auth belum diputuskan).
// Mengembalikan null bila identitas tidak ada atau formatnya tidak valid.
export function resolveIdentity(req: IncomingMessage): Identity | null {
  const mode = process.env.AUTH_MODE || "trusted-header";
  if (mode === "jwt") throw new Error("AUTH_MODE=jwt is not configured yet");

  const clientId = (req.headers["x-client-id"] || "").toString().trim();
  const role = (req.headers["x-user-role"] || "").toString().trim().toUpperCase();
  if (!CLIENT_ID_RE.test(clientId) || !ROLE_RE.test(role)) return null;
  return { clientId, role };
}
