# Production Hardening Plan: Smart Search (Ketahanan, Skala, Keamanan)

> **Status**: Draft untuk review — belum ada perubahan kode.
> **Tanggal audit**: 27 Okt 2026
> **Scope**: `service-search` (+ ketergantungannya ke `app-education`, Redis, JEV Cloud)
> **Dokumen terkait**: [`PLAN_PRODUCTION_ARCHITECTURE.md`](./PLAN_PRODUCTION_ARCHITECTURE.md) (topologi Docker `4 vCPU / 4 GB`, skema `search_routes`, fase implementasi). Dokumen ini melengkapinya dengan sisi ketahanan, skala, dan keamanan.

---

## 1. Tujuan & Asumsi Beban

**Tujuan**: layanan tetap menjawab (walau hasil terdegradasi) saat dihantam ribuan request bersamaan, saat cache dingin, saat upstream lambat/mati, dan tidak membocorkan data antar-tenant.

**Asumsi (belum terukur)**:
- Beban target: "ribuan hit" — angka konkret (RPS, concurrent user, jumlah tenant) **belum ditetapkan**. Lihat §7.
- Kapasitas per instance **belum diketahui**; harus ditentukan lewat load test (§6), bukan ditebak.
- Pola trafik diasumsikan banyak query berulang per tenant (cache hit tinggi), tetapi ekor query unik tetap ada.

**Yang sudah baik (dipertahankan)**:
- Pipeline lazy + Token Exclusion mengurangi panggilan keluar.
- Cache master list (TTL 30 menit) dan cache hasil akhir per `(client, role, engine, threshold, query)`.
- Single-flight per proses pada fetch master (`lazy-resolver.ts:42`).
- Cache regex terkompilasi (`lazy-resolver.ts:173`), timeout 1,5–2,5 dtk pada fetch ke `app-education`.
- Fallback classifier JEV → lokal, fallback routes bila manifest gagal.

---

## 2. Temuan Audit

Ikon: 🔴 kritis · 🟡 warning · 🔵 info. Semua referensi `file:baris` dibaca pada 27 Okt 2026.

### 🔴 Kritis

| # | Temuan | Lokasi | Dampak |
|---|--------|--------|--------|
| C1 | `client_id` dan `role` diambil dari query string/body request, bukan dari token terverifikasi. | `server.ts:91-107,118-119` | Siapa pun bisa meniru tenant/role lain (`?client_id=2&role=SUPERADMIN`). Cache hasil (`server.ts:136`) memakai nilai ini sehingga ikut tercemar. |
| C2 | Parameter `engine` dikendalikan klien. | `server.ts:99,117`, `classifier.ts:164-170` | Klien bisa memaksa `jev` (biaya + rate limit pihak ketiga) atau `local` (CPU) di setiap request. |
| C3 | Request ke JEV Cloud **tanpa timeout**. | `classifier.ts:118` | JEV lambat/menggantung → request menggantung tanpa batas, koneksi menumpuk, layanan ikut mati. |
| C4 | Hasil terdegradasi tetap di-cache 30 menit. Kegagalan master/search ditelan (`catch → null/[]`), lalu response tanpa filter tersebut disimpan. | `lazy-resolver.ts:252,346`, `server.ts:288` | Outage `app-education` beberapa detik → hasil salah/kurang filter dilayani 30 menit untuk query itu. |
| C5 | Manifest fallback (`allowed_params: []`) di-cache selama TTL penuh saat backend tak terjangkau. | `routes-sync.ts:172-175` | Blip singkat → 30 menit tanpa filter apa pun untuk tenant/role itu. |
| C6 | Tanpa rate limit, tanpa batas ukuran body POST, tanpa batas panjang `q`; CORS `*`. | `server.ts:42,109-113,128` | Mudah dibanjiri; body besar menghabiskan memori; query panjang membebani embedding lokal. |

### 🟡 Warning

| # | Temuan | Lokasi | Dampak |
|---|--------|--------|--------|
| W1 | Single-flight hanya per proses. | `lazy-resolver.ts:42` | Multi-instance + cache dingin (deploy, TTL serentak) → thundering herd ke `/api/master/*`. Tidak ada jitter TTL / stale-while-revalidate. |
| W2 | Fallback in-memory cache tidak dibatasi dan tidak ada eviction (entri kedaluwarsa hanya dihapus saat dibaca). | `cache/redis.ts:8,49-55,72-75` | Redis mati + trafik query unik → memori proses tumbuh tanpa batas. Antar-instance isi cache berbeda. Status hanya terlihat di `/health`, tanpa metrik/alert. |
| W3 | Kunci cache hasil memuat teks query bebas dan `threshold` bebas. | `server.ts:136` | Ekor query unik memenuhi Redis (30 menit × jumlah query unik). Perlu `maxmemory` + `allkeys-lru` dan normalisasi `threshold`. |
| W4 | Inferensi lokal tanpa batas konkurensi dan tanpa timeout. | `classifier.ts:41,63`, `local-model.ts:43,110` | Dua panggilan embedding per request (intent + route). Lonjakan beban → antrean tak terbatas, latensi melonjak. |
| W5 | Tanggal relatif memakai zona waktu server saat `ref` tidak diberikan. | `date-range.ts:23` | Container UTC → "minggu ini" salah hari antara 00:00–07:00 WIB bila `active_context.today` kosong. |
| W6 | `latency_ms = 0.8` di-hardcode saat cache hit. | `server.ts:145` | Metrik latensi menyesatkan. |
| W7 | Error 500 mengembalikan `err.message` mentah. | `server.ts:296-298` | Membocorkan detail internal. |
| W8 | Trace/log/visualizer memuat query dan nama siswa. | `tracer.ts`, `logger.ts`, `visualizer.ts`, `server.ts:150-154` | PII di log produksi. Perlu gating via env + masking. |
| W9 | Shutdown memaksa exit 1 dtk, tidak menunggu request berjalan; hanya ada `/health`, tanpa `/ready`. | `server.ts:333-339` | Request terputus saat deploy rolling; load balancer tak bisa membedakan "hidup" vs "siap". |

### 🔵 Info

| # | Temuan | Catatan |
|---|--------|---------|
| I1 | Regex dari DB (`values`, `hint_regex`) tidak divalidasi saat sync dan tidak dibatasi kompleksitasnya. | Risiko ReDoS bila konfigurasi route bisa diubah pihak yang tidak tepercaya. Validasi saat sync + cache terkompilasi di `extractor.ts:95` (saat ini dikompilasi ulang tiap request). |
| I2 | SQLite di `app-education` hanya cocok untuk POC. | Untuk skala nyata: DB sungguhan + index pada `jatuh_tempo`, `kelas`, `status`. |
| I3 | `server.ts` mem-parse `.env` manual dan di-load di modul. | Cukup untuk POC; di produksi gunakan env dari orkestrator/secret manager. |

---

## 3. Target Arsitektur & Degradasi Bertingkat

Prinsip: **lebih baik hasil kurang presisi daripada tidak ada jawaban**, tetapi hasil terdegradasi **tidak boleh bertahan lama di cache**.

| Tier | Kondisi | Perilaku | Cache hasil |
|------|---------|----------|-------------|
| 0 | Normal | Pipeline penuh (classifier → extractor → resolver → dispatcher) | TTL normal (30 mnt, + jitter) |
| 1 | JEV lambat/mati | Classifier lokal; bila ikut jenuh → skor keyword dari `routes.keywords` (kode sudah punya jalur ini di `server.ts:192-203`) | TTL normal bila lokal sukses; pendek bila keyword-only |
| 2 | `app-education` lambat/mati | Layani master list **stale** dari Redis (stale-while-revalidate); tanpa data → hasil tanpa filter entitas, ditandai `meta.degraded = true` | TTL pendek (mis. 15–30 dtk) atau tidak di-cache |
| 3 | Manifest tak tersedia | Fallback routes bawaan | TTL pendek; **jangan** 30 menit |
| 4 | Overload | Tolak cepat `429`/`503` dengan `Retry-After`, bukan antre tanpa batas | — |

Komponen target:
- **Identitas dari token**: middleware memverifikasi `Authorization`; `client_id`/`role` diturunkan dari klaim, bukan dari request.
- **Classifier terisolasi**: proses/worker terpisah dengan batas konkurensi dan timeout; `service-search` hanya memanggilnya.
- **Redis sebagai satu-satunya state bersama**; instance `service-search` stateless dan bisa di-scale horizontal.
- **Lock terdistribusi** (Redis `SET NX PX`) untuk refresh master list, menggantikan single-flight per proses sebagai pengaman lintas-instance (single-flight lokal tetap dipakai sebagai lapis pertama).

---

## 4. Workstream (Urutan Prioritas)

Setiap workstream: tujuan → file terdampak → kriteria selesai.

### W1 — Keamanan Identitas & Batas Input (🔴 C1, C2, C6)
- **Tujuan**: tenant/role tidak bisa dipalsukan; input dibatasi.
- **File**: `service-search/src/server.ts`.
- **Isi**: verifikasi token → `clientId`/`role` dari klaim; hapus `client_id`/`role`/`engine` dari input publik (engine hanya via env/admin); CORS allowlist; rate limit per `(tenant, user/IP)`; batas body (mis. 4 KB) dan panjang `q` (mis. 200 karakter); `threshold` dinormalisasi/dibatasi.
- **Selesai bila**: request dengan `client_id` palsu ditolak/diabaikan; uji e2e membuktikan tenant 1 tidak bisa membaca hasil tenant 2.

### W2 — Ketahanan Upstream & Cache Degradasi (🔴 C3, C4, C5; 🟡 W1)
- **Tujuan**: kegagalan upstream tidak melumpuhkan layanan dan tidak "diawetkan" di cache.
- **File**: `classifier.ts`, `lazy-resolver.ts`, `routes-sync.ts`, `server.ts`, `cache/redis.ts`.
- **Isi**: `AbortSignal.timeout` pada JEV; circuit breaker + bulkhead per upstream (JEV, `app-education`, per tenant); resolver mengembalikan status (`ok`/`degraded`) alih-alih `null` diam-diam; jika degraded → TTL pendek atau tanpa cache; stale-while-revalidate untuk master list; jitter TTL; lock terdistribusi.
- **Selesai bila**: simulasi JEV hang / `app-education` mati menghasilkan respons < batas waktu (SLO), `meta.degraded=true`, dan hasil terdegradasi tidak bertahan > TTL pendek.

### W3 — Classifier & Beban CPU (🟡 W4)
- **Tujuan**: inferensi tidak menjadi bottleneck tunggal.
- **File**: `classifier.ts`, `local-model.ts`, (baru) service/worker inferensi.
- **Isi**: batas konkurensi + timeout inferensi; cache hasil classify per `(tenant, query ternormalisasi)`; pertimbangkan satu panggilan embedding bersama untuk intent dan route (saat ini dua kali); evaluasi pemisahan ke proses/instance terpisah.
- **Selesai bila**: load test menunjukkan p95 stabil sampai batas konkurensi yang ditetapkan, dan di atas batas itu sistem menolak cepat (Tier 4).

### W4 — Cache & Beban ke Upstream (🟡 W2, W3)
- **Tujuan**: memori dan Redis tidak tumbuh tanpa batas.
- **File**: `cache/redis.ts`, `server.ts`, konfigurasi Redis.
- **Isi**: batas ukuran + eviction untuk fallback in-memory (LRU); `maxmemory` + `allkeys-lru` di Redis; negative cache untuk pencarian `siswa_id` tanpa hasil; metrik/alert saat engine cache = `memory`; batas konkurensi ke `/api/siswa`.
- **Selesai bila**: uji query unik massal tidak menaikkan memori di atas batas; alert menyala saat Redis diputus.

### W5 — Zona Waktu (🟡 W5)
- **Tujuan**: "hari ini/minggu ini" benar bagi pengguna Indonesia.
- **File**: `date-range.ts`, pemanggil di `dispatcher.ts` / `app-education` (`active_context.today`).
- **Isi**: zona waktu per tenant (default `Asia/Jakarta`); `ref` selalu berasal dari `active_context.today` atau konversi eksplisit ke zona tenant.
- **Selesai bila**: test unit pada jam 23:30 UTC dan 00:30 WIB memberi tanggal benar.

### W6 — Observability (🟡 W6, W7, W8, W9)
- **Tujuan**: kondisi sistem terlihat dan tidak membocorkan data.
- **File**: `server.ts`, `tracer.ts`, `logger.ts`, `visualizer.ts`.
- **Isi**: metrik p50/p95/p99 per tahap (tracer sudah mencatat `timings_ms`), cache hit ratio, fallback rate, error rate upstream, jumlah degraded; `/ready` terpisah dari `/health`; ukur latensi cache hit yang sebenarnya; error 500 generik + request id; debug trace/visualizer hanya aktif via env dan memasking PII.
- **Selesai bila**: dashboard menampilkan metrik di atas; log produksi tidak memuat nama siswa.

### W7 — Operasional (🟡 W9; 🔵 I2, I3)
- **Tujuan**: deploy dan scale aman.
- **Isi**: graceful drain (tutup listener, tunggu request berjalan, batas waktu wajar); instance stateless di belakang load balancer; image Docker dipin (tanpa `latest`); secret via secret manager; DB nyata untuk `app-education`; validasi regex DB saat sync (I1).
- **Selesai bila**: rolling deploy tanpa error 5xx pada load test berjalan.

**Urutan**: W1 → W2 → W4 → W3 → W5 → W6 → W7 (W1–W2 menutup risiko keamanan dan outage; W3 memerlukan hasil load test awal untuk menentukan perlunya pemisahan).

---

## 5. Rencana Load Test (k6)

Tujuan: mengganti tebakan kapasitas dengan angka.

| Skenario | Yang diuji | Metrik lulus |
|----------|-----------|--------------|
| Cache hangat, query berulang | Throughput maksimum per instance, latensi cache hit | p95, RPS maksimum |
| Cache dingin / query unik | Beban classifier + resolver + upstream | p95, error rate, CPU/memori |
| Thundering herd | Restart serentak N instance dengan Redis kosong | Jumlah panggilan ke `/api/master/*` (target ≈ 1 per tenant per key) |
| JEV hang / lambat | Timeout + fallback classifier | Respons < batas waktu, `degraded` benar |
| `app-education` mati | Stale-while-revalidate, TTL pendek untuk degraded | Respons tetap datang; hasil degraded tidak bertahan lama |
| Redis mati | Fallback memori + alert | Tidak ada pertumbuhan memori tak terbatas |
| Overload | Tolak cepat (Tier 4) | `429/503` cepat, tidak ada antrean tak terbatas |

SLO (p95, error rate, RPS) **ditetapkan pemilik produk** — lihat §7.

---

## 6. Risiko Bila Tidak Dikerjakan

- Pemalsuan tenant/role (C1) → kebocoran data lintas tenant.
- JEV menggantung (C3) → seluruh layanan menggantung.
- Hasil degradasi tersimpan 30 menit (C4, C5) → pengguna melihat data kurang/salah tanpa tanda apa pun.
- Query unik massal (W3) → Redis/memori penuh.

---

## 7. Keputusan yang Dibutuhkan dari Pemilik Produk

1. Target beban: RPS puncak, concurrent user, jumlah tenant.
2. SLO: p95 latensi, error rate maksimum, ketersediaan.
3. Mekanisme auth: dari mana `client_id`/`role` berasal (JWT Pintro? gateway?).
4. Redis: managed/cluster atau single node? Kebijakan `maxmemory`.
5. JEV: kuota/rate limit dan biaya per request; apakah classifier lokal cukup sebagai jalur utama (benchmark di dokumen arsitektur: JEV 94% / 272 ms, lokal 94% / 2,9 ms).
6. Perilaku saat degraded: tampilkan hasil tanpa filter, atau pesan "layanan terbatas"?

---

## 8. Checklist Go-Live

- [ ] C1–C6 selesai dan diuji e2e
- [ ] Load test skenario §5 lulus terhadap SLO
- [ ] Metrik + alert aktif (cache engine = memory, fallback rate, upstream error)
- [ ] `/ready` dipakai load balancer; graceful drain teruji pada rolling deploy
- [ ] Log produksi bebas PII; trace debug nonaktif
- [ ] Redis `maxmemory` + eviction dikonfigurasi
- [ ] Image Docker dipin, secret via secret manager, `.env` tidak ikut commit
- [ ] DB `app-education` memakai DB nyata dengan index
