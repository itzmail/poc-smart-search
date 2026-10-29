# POC Smart Search

**Smart Search untuk aplikasi manajemen sekolah (Pintro)**: mengubah pertanyaan bahasa alami pengguna menjadi **aksi terstruktur** berupa navigasi menu, deep-link dengan filter terisi, atau aksi cetak/unduh rapor.

> **Status:** Core pipeline lengkap dan terhubung: Klasifikasi AI, Ekstraksi Kontekstual, Lazy Master Resolver berbasis Redis, sampai Dispatcher terstruktur. Hasil verifikasi ada di [Status Verifikasi](#12-status-verifikasi). Kesiapan produksi dan sisa pekerjaan ada di [`docs/PLAN_PRODUCTION_HARDENING.md`](docs/PLAN_PRODUCTION_HARDENING.md).

## Daftar Isi

1. [Ringkasan dan Prinsip Desain](#1-ringkasan-dan-prinsip-desain)
2. [Arsitektur](#2-arsitektur)
3. [Pipeline Pemrosesan](#3-pipeline-pemrosesan)
4. [Kontrak Data: `search_routes` dan `ParamSpec`](#4-kontrak-data-search_routes-dan-paramspec)
5. [Antarmuka HTTP](#5-antarmuka-http)
6. [Multi-Tenant dan ACL](#6-multi-tenant-dan-acl)
7. [Pengamanan dan Ketahanan](#7-pengamanan-dan-ketahanan)
8. [Cache Redis](#8-cache-redis)
9. [Konfigurasi](#9-konfigurasi)
10. [Struktur Project](#10-struktur-project)
11. [Menjalankan](#11-menjalankan)
12. [Status Verifikasi](#12-status-verifikasi)
13. [Dokumentasi Lanjutan dan Batasan](#13-dokumentasi-lanjutan-dan-batasan)

## Video Penjelasan

**1. Dari Satu Kalimat ke Link**: jejak nyata satu query melewati Classifier, Extractor, Resolver, dan Dispatcher.

[![Dari Satu Kalimat ke Link](https://img.youtube.com/vi/7RHD1GbpkEY/maxresdefault.jpg)](https://youtu.be/7RHD1GbpkEY)

**2. Pengamanan**: auth, batas input, rate limit, degradasi, dan ACL, lengkap dengan status teruji atau belum.

[![Pengamanan](https://img.youtube.com/vi/_7TZjwI2_XE/maxresdefault.jpg)](https://youtu.be/_7TZjwI2_XE)

Sumber video (Remotion) ada di [`docs/motion-video/`](docs/motion-video/). Versi baca untuk non-teknis ada di [`docs/POC_SMART_SEARCH.md`](docs/POC_SMART_SEARCH.md) Section 23, dan estimasi biaya JEV di Section 24.

---

## 1. Ringkasan dan Prinsip Desain

Pengguna akhir tidak perlu tahu nama route, nama kolom, atau format query SQL. Mereka menulis seperti biasa:

| Pertanyaan pengguna | Hasil |
|---|---|
| *"Siti ini ada di kelas berapa?"* | 3 opsi: Kelas 8B — Siti Rahma, Kelas 7A — Siti Aisyah, Kelas 7A — Siti Aminah (Wali Kelas) |
| *"Siapa yang belum bayar spp tahun ajaran ini?"* | `/spp?status=nunggak&academic_year_id=AY-2026` |
| *"riwayat tagihan yang sudah lunas"* | `/spp?status=lunas` |
| *"cetak rapot kelas 8B semester ganjil"* | `/api/rapot/download?kelas=...&semester=ganjil&format=pdf` |

Tiga aksi keluaran (`Intent`):

| Intent | Arti | Contoh output |
|---|---|---|
| `LIST_MENU` | Navigasi menu | Kartu menu relevan |
| `DIRECT_LINK` | Buka tabel dengan filter | `/spp?status=nunggak&academic_year_id=AY-2026` |
| `REPORT_ACTION` | Cetak/unduh dokumen | `/api/rapot/download?...` |

### Prinsip desain

1. **AI hanya memilih, tidak mengarang.** Klasifikasi AI hanya menentukan *route* dan *nilai enum* dari kandidat yang sudah ada. ID database, filter SQL, dan hak akses tidak pernah dikarang AI.
2. **Zero full-table scan dan token exclusion.** Route dipilih dulu, master list kecil (kelas/mapel) dicocokkan di cache Redis, lalu sisa token yang belum cocok baru dicari ke endpoint entitas dinamis (siswa/pegawai).
3. **Metadata di database, bukan di kode.** Menambah modul, kata kunci, atau spesifikasi parameter (`ParamSpec`) cukup satu `INSERT`/`UPDATE` di tabel `search_routes`, tanpa redeploy dan tanpa retrain model.
4. **Multi-tenant sejak awal.** Setiap request membawa `X-Client-Id`; cache dan query terisolasi per tenant dan per role.
5. **Waktu relatif bukan tebakan AI.** *"tahun ajaran ini"* dijawab dari baris `academic_year` aktif di DB (`start_date..end_date`), bukan dari tebakan kalender lokal.
6. **Graceful shutdown.** Listener `SIGINT` dan `SIGTERM` melepas port 3000 dan 4000 tanpa proses menggantung.

---

## 2. Arsitektur

```text
┌─────────────────────────────────────────────────────────────────────┐
│  User: "Siapa yang belum bayar spp tahun ajaran ini?"               │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  service-search (:4000)                                             │
│                                                                     │
│  ① KLASIFIKASI  →  JEV Cloud (primary) │ transformers.js (fallback) │
│       ↓ intent + target_route                                       │
│  ② SCOPED EXTRACT  →  baca allowed_params route terpilih            │
│       ↓ regex + semantic enum match                                 │
│  ③ LAZY RESOLVE  →  fetch master sesuai hint_regex, cache Redis    │
│       ↓                                                             │
│  ④ DISPATCH  →  susun options[] terstruktur + filter URL            │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  app-education (:3000)  — Multi-Tenant Core App + SQLite            │
│  /api/routes (ACL)  ·  /api/master/*  ·  /api/siswa  ·  /api/spp    │
└─────────────────────────────────────────────────────────────────────┘
```

| Komponen | Berkas utama | Tanggung jawab |
|---|---|---|
| Classifier | `classifier.ts`, `local-model.ts` | Menentukan `intent` dan `target_route` (JEV Cloud, fallback lokal) |
| Extractor | `extractor.ts`, `date-range.ts`, `normalize.ts` | Merapikan kalimat, regex dari DB, enum semantik, rentang waktu |
| Resolver | `lazy-resolver.ts`, `routes-sync.ts` | Master list dan lookup entitas (Redis), manifest route per (client, role) |
| Dispatcher | `dispatcher.ts` | Merakit `options[]`, URL tujuan, dan skor |
| Pendukung | `auth.ts`, `rate-limit.ts`, `breaker.ts`, `tracer.ts`, `logger.ts`, `cache/redis.ts` | Identitas, batas laju, circuit breaker, jejak pipeline, log, cache |

### Dual-Engine

| | TypeSafe JEV Cloud | Transformers.js (in-process) |
|---|---|---|
| Endpoint | `https://api.typesafe.ai/v1/systemone` | lokal, ONNX q8 |
| Paradigma | Zero-anchor semantic *choice* | Embedding + cosine similarity |
| Model | `jev-latest` | `Xenova/multilingual-e5-small` (q8) |
| Akurasi benchmark | 94% | 94% |
| Latensi rata-rata | 272.1 ms | **2.92 ms** |
| Butuh internet | Ya | Tidak (model di-bake ke image) |
| Peran | **Primary** | **Fallback** saat JEV gagal/offline |

Benchmark 16 query Bahasa Indonesia, 25 Okt 2026 (`bun run test:benchmark`):

```text
┌──────────────────────────┬──────────┬─────────────┬────────────────────┐
│ Engine                   │ Accuracy │ Avg Latency │ Latency Range      │
├──────────────────────────┼──────────┼─────────────┼────────────────────┤
│ TypeSafe JEV (Cloud)     │ 94%      │ 272.1 ms    │ 224.82ms – 357.07ms│
│ Transformers.js (Local)  │ 94%      │ 2.92 ms     │ 2.51ms – 3.56ms    │
└──────────────────────────┴──────────┴─────────────┴────────────────────┘
```

Case gagal lokal: *"halaman penilaian rapor"*, *"print leger nilai kelas 9A"*.

---

## 3. Pipeline Pemrosesan

### Contoh: `"Siapa yang belum bayar spp tahun ajaran ini?"`

**Step 1: Klasifikasi.** JEV menerima 2 pertanyaan dalam 1 request:

```json
{
  "model": "jev-latest",
  "state": "Siapa yang belum bayar spp tahun ajaran ini?",
  "questions": {
    "intent": { "type": "choice", "criteria": { "LIST_MENU": "...", "DIRECT_LINK": "...", "REPORT_ACTION": "..." } },
    "target_route": { "type": "choice", "criteria": { "spp": "Menu \"Pembayaran & Tagihan SPP\" di path /spp: ..." } }
  }
}
```

Hasil: `intent = DIRECT_LINK`, `target_route = spp`.

**Step 2: Scoped Extraction.** Route `spp` membawa kontrak `allowed_params` dari tabel `search_routes`:

```json
[
  { "key": "siswa_id", "endpoint": "/api/siswa", "mode": "search", "query_param": "q", "hint_regex": "\\b(siapa|siswa|murid)\\b|..." },
  { "key": "kelas_id", "endpoint": "/api/master/kelas", "mode": "list", "hint_regex": "\\bkelas\\b|..." },
  { "key": "status", "mode": "enum", "values": { "nunggak": "\\b(nunggak|belum\\s*(bayar|lunas|setor))\\b|...", "lunas": "\\b(lunas|sudah\\s*(bayar|lunas))\\b|..." } },
  { "key": "periode", "mode": "enum", "hint_regex": "\\b(hari|minggu|bulan|tahun)\\b", "values": { "hari_ini": "...", "minggu_ini": "...", "bulan_lalu": "...", "tahun_lalu": "..." } },
  { "key": "academic_year_id", "endpoint": "/api/master/academic-years", "mode": "list", "hint_regex": "tahun\\s*(ajaran|pelajaran)?\\s*(ini|sekarang)|[0-9]{4}/[0-9]{4}" }
]
```

Ekstraksi:
- `"belum bayar"` cocok anchor `status.nunggak`.
- `"tahun ajaran ini"` memicu slot `academic_year_id`.
- Tidak ada nama orang, sehingga slot `siswa_id` **tidak aktif** dan `/api/siswa` tidak dipanggil.

**Step 3: Lazy Resolve.** Hanya slot relevan yang di-fetch:

| Slot | Trigger | Endpoint | Cache key |
|---|---|---|---|
| `status` | enum (regex) | — (tanpa HTTP) | — |
| `academic_year_id` | `"tahun ajaran ini"` | `GET /api/master/academic-years` | `smartsearch:master:<client>:<key>` |
| `siswa_id` | — (tidak ada nama) | **tidak dipanggil** | — |

Single-flight lock mencegah *thundering herd*: 100 request serentak hanya memicu 1 HTTP call.

**Step 4: Dispatch.** `academic_year_id` diambil dari baris `is_active = 1`:

```json
{
  "status": "success",
  "query": "Siapa yang belum bayar spp tahun ajaran ini?",
  "engine": "JEV_CLOUD",
  "target_route": "spp",
  "resolved_params": { "status": [], "academic_year_id": [{ "id": "AY-2026", "name": "2026/2027" }] },
  "total_options": 1,
  "options": [
    {
      "rank": 1,
      "score": 1,
      "intent": "DIRECT_LINK",
      "target_type": "LIST",
      "title": "Pembayaran & Tagihan SPP — Status NUNGGAK — TA 2026/2027",
      "destination": "/spp?status=nunggak&academic_year_id=AY-2026",
      "data": { "route": "spp", "filters": { "status": "nunggak", "academic_year_id": "AY-2026" } }
    }
  ]
}
```

### Contoh: `"Siti ini ada di kelas berapa?"` (disambiguasi multi-entitas)

Sistem **tidak menebak** apakah "Siti" itu siswa atau wali kelas. Route `kelas` punya 3 slot yang masing-masing punya `hint_regex` sendiri:

| Slot | Mode | Match field | Contoh hasil |
|---|---|---|---|
| `siswa_id` | `search` | `/api/siswa?q=` | Siti Rahma (8B), Siti Aisyah (7A) |
| `wali_kelas` | `list` | `wali_kelas` | Siti Aminah, S.Pd (7A) |
| `kelas_id` | `list` | `name`/`code` | K-08B, K-07A |

Respons `options[]` membawa payload entitas utuh:

```json
{
  "options": [
    { "title": "Kelas 8B — Siti Rahma (Siswa)", "destination": "/kelas/K-08B",
      "data": { "entity_role": "siswa", "siswa": { "id": "S002", "nama": "Siti Rahma", "kelas": "8B" }, "kelas": { "id": "K-08B", "code": "8b" } } },
    { "title": "Kelas 7A — Siti Aminah, S.Pd (Wali Kelas)", "destination": "/kelas/K-07A",
      "data": { "entity_role": "wali_kelas", "wali_kelas": { "nama": "Siti Aminah, S.Pd" }, "kelas": { "id": "K-07A" } } }
  ]
}
```

---

## 4. Kontrak Data: `search_routes` dan `ParamSpec`

### Tabel `search_routes`

Satu tabel production-ready, terpisah dari tabel `job` Pintro:

```sql
CREATE TABLE search_routes (
  id                TEXT PRIMARY KEY,
  job_id            TEXT NOT NULL,       -- FK ke job (ACL)
  code              TEXT NOT NULL,
  title             TEXT NOT NULL,
  url_path          TEXT NOT NULL,
  description       TEXT,
  keywords          TEXT,                -- JSON array
  supported_intents TEXT,                -- JSON array
  allowed_params    TEXT,                -- JSON array of ParamSpec
  is_active         INTEGER NOT NULL DEFAULT 1,
  client_id         TEXT NOT NULL,
  ...
);
```

### Mode `ParamSpec`

| Mode | Artinya | Contoh | HTTP call |
|---|---|---|---|
| `list` | Master kecil, fetch 1× per tenant | `kelas_id` → `/api/master/kelas` | Ya, cache TTL 30m |
| `search` | Data besar, cari per token | `siswa_id` → `/api/siswa?q=` | Ya, cache per token |
| `enum` | Nilai tertutup, dari regex/semantic | `status`, `periode`, `semester` | Tidak |

Field `ParamSpec` lain: `query_param`, `match_field`, `resolves_to`, `hint_regex`, `values`.

> `hint_regex` adalah **trigger detection**, supaya sistem tidak membuang HTTP call untuk slot yang tidak relevan dengan kalimat user. Untuk mode `list`, `hint_regex` tidak lagi menjadi gerbang: master dicocokkan langsung agar sinonim dan typo tetap tertangkap.

### Resolusi parameter dinamis (`list` / `search`)

Parameter (kelas, mapel, siswa, guru, wali kelas) dicocokkan ke master tenant, bukan ke kamus statis. Urutan pencocokan `matchListItems`:

| Tingkat | Contoh | Diterapkan sebagai filter? |
|---|---|---|
| Exact / kata utuh / substring / singkatan | `8B`, `mtk`, `b indo` | Ya |
| Fuzzy (Levenshtein, `FUZZY_MAX_DIST`, default 2) | `matematka`, `inggirs`, `Aminha` | Ya |
| Semantik (E5, ambang `LIST_SEMANTIC_MIN` 0,85, margin 0,04) | `ilmu hitung` | **Tidak**, hanya jadi saran |

- Hasil semantik tidak pernah menjadi filter. Dispatcher menampilkannya sebagai opsi terpisah **"Maksud Anda X?"** (`data.suggestion=true`, skor di bawah opsi utama); opsi utama tetap membawa filter lain yang sudah pasti (mis. `kelas_id`).
- Bila nama bentrok (mis. "Siti" = 2 siswa + 1 wali kelas), semua kandidat ditampilkan sebagai opsi terpisah.
- Teks acak (`Xqzv`, `xqzvwk`) tidak dipaksa menjadi siswa/mapel/kelas.
- Route `guru` (`/api/guru`) tersedia untuk tenant 1 dan 2; tenant 2 sengaja **tanpa** route `nilai`.

---

## 5. Antarmuka HTTP

### service-search (:4000)

| Endpoint | Metode | Fungsi |
|---|---|---|
| `/resolve` | `GET` (`?q=&threshold=`) atau `POST` (body JSON `q`/`query`, `threshold`) | Pipeline penuh; mengembalikan `options[]` |
| `/routes/refresh` | `POST` | Paksa muat ulang manifest route untuk (client, role) pemanggil |
| `/health` | `GET` | Status layanan dan status cache (Redis atau in-memory) |

`/resolve` dan `/routes/refresh` mewajibkan header `X-Client-Id` dan `X-User-Role`. Engine dipilih dari env `SMARTSEARCH_ENGINE`, bukan dari request.

### app-education (:3000)

| Endpoint | Fungsi |
|---|---|
| `/api/search` | Gateway ke `service-search` (meneruskan header identitas dan `Authorization`) |
| `/api/routes` | Manifest route sesuai ACL (client, role) |
| `/api/master/academic-years`, `/subjects`, `/kelas`, `/resolve` | Master data untuk resolver |
| `/api/siswa`, `/api/guru`, `/api/kelas/:id` | Data entitas |
| `/api/spp`, `/api/spp/invoice/:id`, `/api/nilai`, `/api/rapot`, `/api/rapot/download`, `/api/dashboard` | Data modul |

Sebagian endpoint data juga menerima alias tanpa prefiks `/api` (mis. `/spp`, `/siswa`); daftar pasti ada di `app-education/src/server.ts`. `/api/search` meneruskan `q`, `engine`, dan `threshold` (default `0.2`) ke `service-search` `/resolve`.

Contoh:

```bash
curl "http://127.0.0.1:3000/api/search?q=Siapa%20yang%20belum%20bayar%20spp%20tahun%20ajaran%20ini&engine=auto" \
  -H "X-Client-Id: 1" -H "X-User-Role: SUPERADMIN"
```

---

## 6. Multi-Tenant dan ACL

```text
search_routes  ⋈  acl  ⋈  groups        → route mana yang terlihat
WHERE client_id = ? AND UPPER(groups.code) = ?
```

Header yang diteruskan antar service:

| Header | Fungsi |
|---|---|
| `X-Client-Id` | Isolasi tenant (**wajib**, tanpa default) |
| `X-User-Role` | Filter ACL per role (**wajib**, tanpa default) |
| `Authorization` | Diteruskan ke app-education |

Cache diisolasi per tenant **dan** per role, sehingga user dengan role berbeda tidak pernah melihat cache satu sama lain.

Manifest kosong dari upstream yang sehat berarti role/tenant tanpa izin: hasilnya **nol route**, bukan jatuh ke `FALLBACK_ROUTES` (commit `ca29f34`). `FALLBACK_ROUTES` hanya dipakai bila manifest tidak bisa diambil sama sekali.

---

## 7. Pengamanan dan Ketahanan

Kolom Status: **Teruji live** = sudah dicoba pada service berjalan; **Kode saja** = ada di kode, belum dibuktikan lewat tes live.

| Area | Perilaku | Status |
|---|---|---|
| Identitas | `AUTH_MODE=trusted-header` (default): identitas hanya dari header; header kosong atau hanya satu → `401`. `client_id`/`role`/`engine` di query/body **diabaikan**. Mode `jwt` masih stub. | Teruji live |
| Asumsi keamanan | `trusted-header` hanya aman bila service terjangkau lewat gateway internal tepercaya. | Asumsi |
| Batas input | Body maks 4 KB (`413`), `q` maks 200 karakter (`400`), `threshold` di-clamp 0–1. | Teruji live |
| Rate limit | Token bucket in-process per `clientId:IP`, `RATE_LIMIT_RPM` (default 120) → `429` + `Retry-After`. Per instance; versi Redis ditunda. Hasil uji: dari 150 request beruntun, 116 lolos dan 34 ditolak. | Teruji live |
| Degraded bertingkat | (1) master di Redis kedaluwarsa → salinan `:stale` (24 jam); (2) tidak ada salinan → hasil tanpa filter + `meta.degraded=true`; (3) manifest hilang → `FALLBACK_ROUTES`. Hasil `degraded` di-cache singkat (`SMARTSEARCH_DEGRADED_TTL`, default 20 dtk). | Teruji live (app-education dimatikan) |
| ACL manifest kosong | Daftar kosong berarti nol route. | Teruji live |
| Timeout JEV | `JEV_TIMEOUT_MS` (default 1500) → fallback lokal. | Kode saja |
| Circuit breaker | `breaker.ts`: 5 kegagalan beruntun membuka sirkuit selama 15 dtk, lalu half-open. Dipasang untuk JEV dan `app-education`. | Kode saja |
| CORS | Allowlist via `CORS_ORIGINS` (kosong = tanpa header CORS). | Kode saja |
| Error | `500` generik `{error, request_id}`; detail hanya di log. | Kode saja |

Sisa pekerjaan (antara lain lock terdistribusi, penolakan role/tenant tak dikenal, JWT): [`docs/PLAN_PRODUCTION_HARDENING.md`](docs/PLAN_PRODUCTION_HARDENING.md).

---

## 8. Cache Redis

| Key | Isi | TTL |
|---|---|---|
| `smartsearch:routes:<client>:<role>` | Route manifest | 30m |
| `smartsearch:master:<client>:<param_key>` | Master list (kelas, subject, academic year) | 30m |
| `smartsearch:master:<client>:<param_key>:stale` | Salinan stale master list (stale-while-error) | 24 jam |
| `smartsearch:lookup:<client>:<param_key>:<token>` | Hasil pencarian entitas | 30m |
| `smartsearch:entity:<client>:<query>` | Hasil `resolveEntities()` di `routes-sync.ts` (saat ini tanpa pemanggil) | 30m |
| `smartsearch:q:v3:<client>:<role>:<engine>:<threshold>:<query>` | Hasil query final | 30m |

Fallback otomatis ke in-memory map bila Redis offline (`cache/redis.ts`). TTL master bisa diubah lewat `SMARTSEARCH_MASTER_TTL`; hasil `degraded` memakai TTL pendek (`SMARTSEARCH_DEGRADED_TTL`).

---

## 9. Konfigurasi

| Variable | Default | Fungsi |
|---|---|---|
| `TYPESAFE_API_KEY` | — | API key JEV (tanpa ini engine lokal dipakai) |
| `APP_EDUCATION_URL` | `http://host.docker.internal:3000` | Alamat core app |
| `REDIS_URL` | `redis://redis:6379` | Redis (container) |
| `SEARCH_PORT` | `4000` | Port service-search |
| `APP_PORT` | `3000` | Port app-education |
| `SEARCH_SERVICE_URL` | `http://127.0.0.1:4000` | Alamat service-search yang dipanggil gateway app-education |
| `SMARTSEARCH_ENGINE` | `auto` | Engine klasifikasi (`auto`/`jev`/`local`); hanya dari env, bukan request |
| `SMARTSEARCH_MASTER_TTL` | `1800` | TTL cache master (detik) |
| `SMARTSEARCH_DEGRADED_TTL` | `20` | TTL cache hasil/manifest terdegradasi (detik) |
| `SMARTSEARCH_WARMUP` | — | Prefetch manifest, mis. `1:SUPERADMIN,1:GURU` |
| `SMART_SEARCH_LOG_LEVEL` | `normal` | Tingkat log pipeline (lihat `logger.ts`) |
| `AUTH_MODE` | `trusted-header` | Sumber identitas (`jwt` masih stub) |
| `CORS_ORIGINS` | — | Daftar origin diizinkan, dipisah koma |
| `RATE_LIMIT_RPM` | `120` | Batas request per menit per `clientId:IP` (`0` = nonaktif) |
| `JEV_TIMEOUT_MS` | `1500` | Timeout panggilan JEV sebelum fallback lokal |
| `FUZZY_MAX_DIST` | `2` | Jarak Levenshtein maksimum untuk fuzzy match |
| `LIST_SEMANTIC_MIN` / `LIST_SEMANTIC_MARGIN` | `0.85` / `0.04` | Ambang dan margin saran semantik |
| `LOCAL_MODEL_ID` / `LOCAL_MODEL_PATH` / `LOCAL_MODEL_DTYPE` | — | Model lokal: id, lokasi, dan presisi |
| `HF_HOME` / `HF_ALLOW_REMOTE` | — / `false` (image) | Lokasi cache model dan izin download saat runtime |

Nilai default diambil dari kode (`service-search/src/*.ts`). Variabel bertanda `—` tidak punya default di README ini; lihat berkas pemakainya.

---

## 10. Struktur Project

```text
poc-smart-search/
├── README.md                       # Dokumen ini
├── docs/
│   ├── POC_SMART_SEARCH.md         # Dokumen teknis lengkap (24 section, termasuk versi baca dan biaya JEV)
│   ├── PLAN_PRODUCTION_ARCHITECTURE.md   # Rencana arsitektur production
│   ├── PLAN_PRODUCTION_HARDENING.md      # Audit ketahanan/skala/keamanan
│   ├── PLAN_KLASIFIKASI_EKSTRAKSI.md     # Analisa & rencana klasifikasi/ekstraksi
│   ├── RESEARCH_API_ACCESS_LAYER.md      # Riset layer akses AI
│   ├── PLAN_MOTION_VIDEO_REMOTION.md     # Rencana video penjelasan
│   └── motion-video/               # Sumber video Remotion (tracing + pengamanan)
├── service-search/                 # Search Engine (:4000)
│   ├── src/
│   │   ├── server.ts               # HTTP server, pipeline orchestrator
│   │   ├── classifier.ts           # JEV Cloud + fallback lokal
│   │   ├── local-model.ts          # transformers.js in-process (ONNX q8)
│   │   ├── auth.ts                 # Identitas (trusted-header / jwt stub)
│   │   ├── rate-limit.ts           # Rate limit in-process
│   │   ├── breaker.ts              # Circuit breaker upstream
│   │   ├── normalize.ts            # Normalisasi teks untuk matching
│   │   ├── date-range.ts           # Rentang waktu relatif
│   │   ├── routes-sync.ts          # Manifest route per (client, role)
│   │   ├── extractor.ts            # Regex + time-hint extraction
│   │   ├── lazy-resolver.ts        # Lazy master resolve (list/search/enum)
│   │   ├── dispatcher.ts           # Intent → SearchOption[]
│   │   ├── tracer.ts               # Jejak waktu dan keluaran tiap tahap
│   │   ├── logger.ts               # Log pipeline terstruktur
│   │   ├── visualizer.ts           # Terminal color visualizer
│   │   ├── cli.ts                  # Interactive CLI
│   │   ├── benchmark.ts            # Head-to-head benchmark
│   │   ├── anchors.json            # Anchor kalimat untuk intent (engine lokal)
│   │   └── cache/redis.ts          # Redis + in-memory fallback
│   ├── Dockerfile                  # Image production (model di-bake)
│   ├── prebake-model.ts            # Pre-download model saat build
│   └── package.json
├── app-education/                  # Core App + SQLite (:3000)
│   ├── src/
│   │   ├── server.ts               # REST API + gateway /api/search
│   │   └── data/db.ts              # Skema SQLite + seed + search_routes
│   ├── education.db                # Database SQLite (gitignored)
│   └── package.json
├── research/                       # Probe skrip riset (kontrak JEV, biaya/fallback, celah routing)
├── test-e2e.ts                     # Integration test end-to-end
├── test-queries.ts                 # Suite 48 kasus query (butuh server berjalan)
├── test-dispatcher.ts              # Unit test dispatcher (tanpa server)
├── test-extractor.ts               # Test ekstraktor
├── test-routes-sync.ts             # Unit test manifest route dengan fetch ter-mock (tanpa server)
├── run-test.ts                     # Auto start kedua service + jalankan test
├── docker-compose.yml              # Stack production: service-search + redis
└── package.json
```

---

## 11. Menjalankan

### Prasyarat

- **Bun 1.1+** (atau Node.js 20+ dengan `tsx`)
- **Redis** (opsional; ada fallback in-memory)
- **API key TypeSafe**: `export TYPESAFE_API_KEY="..."` (opsional; tanpa ini engine lokal dipakai)

### Mode pengembangan (host)

```bash
# Terminal 1 — core app + SQLite
bun run start:app

# Terminal 2 — search engine
bun run start:search
```

Perintah pendukung:

```bash
bun run test:e2e        # integration test (start dua service + test)
bun run test:benchmark  # head-to-head JEV vs lokal
bun run cli             # interactive CLI
```

### Mode production (Docker)

Stack khusus `4 vCPU / 4 GB RAM`: `service-search` + `redis`. `app-education` **tidak** di-container-kan (tetap di host/server utama).

```bash
export TYPESAFE_API_KEY="..."
docker compose up -d --build
docker compose logs -f service-search
```

| Service | CPU | RAM | Catatan |
|---|---|---|---|
| `service-search` | 3.5 | 3g | Model ONNX q8 di-bake ke image (~1.48 GB) |
| `redis` | 0.5 | 1g | `allkeys-lru`, `maxmemory 768mb` |

---

## 12. Status Verifikasi

> Diverifikasi 26 Okt 2026: 16/16 check E2E lulus dan TypeScript check 0 error.

```text
E2E SEQUENTIAL LAZY PIPELINE (Classify -> allowed_params -> Lazy Master -> Options)
✔ service-search: cache=redis
✔ app-education: HTTP 200
✔ ParamSpec ber-endpoint tersedia dari DB
✔ 2 siswa 'Siti' (Siti Rahma 8B & Siti Aisyah 7A) muncul sebagai opsi terpisah
✔ Opsi wali kelas 'Siti Aminah, S.Pd' juga muncul
✔ status=nunggak (negasi-aware, bukan salah ke 'lunas')
✔ academic_year_id FK tahun ajaran AKTIF dari DB (AY-2026)
✔ status=lunas (bukan nunggak meski ada kata 'tagihan') -> /spp?status=lunas
✔ Natural Language: 5 frasa colloquial/waktu relatif ter-resolve presisi
✔ subject_id ter-resolve ke master subjects & academic_year_id AKTIF ter-set
✔ ACL Isolasi: role GURU tidak bisa membuka menu /spp
✔ Multi-Tenant: Tenant 2 terisolasi tanpa bocor ke tenant lain
✔ Threshold dinamis bekerja memfilter opsi
✔ Local Fallback transformers.js in-process tetap menurunkan opsi entitas
✔ Redis Query Cache (2nd call < 1ms: 0.74ms)
SEMUA CHECK SEQUENTIAL LAZY PIPELINE LULUS
```

Suite tambahan:

```bash
bun run test-queries.ts      # 48 kasus (butuh kedua service): 47 lulus, 1 known_fail ("ilmu hitung")
bun run test-dispatcher.ts   # 8/8 lulus, tanpa server
bun run test-routes-sync.ts  # unit test manifest route, tanpa server
```

Ringkasan per kategori `test-queries.ts`: kelas 7/7, mapel 5/6, typo 6/6, waktu 9/9, siswa 8/8, wali 4/4, guru 5/5, bentrok 1/1, tenant 2/2.

> Angka E2E 16/16 di atas diambil sebelum hardening W1–W2 dan perubahan resolusi parameter. Run berikutnya dilaporkan lulus tanpa rincian jumlah check, sehingga angka dan tanggal di atas belum diperbarui.

| Komponen | Status | Catatan teknis |
|---|---|---|
| Klasifikasi dual-engine | Selesai | JEV Cloud 94% / 272 ms; fallback lokal transformers.js 94% / 2.92 ms |
| Kontrak `ParamSpec` antar-layanan | Selesai | `routes-sync.ts` dan `app-education/server.ts` sinkron via tabel `search_routes` |
| Endpoint master data | Selesai | `/api/master/academic-years`, `/subjects`, `/kelas` |
| Ekstraksi kontekstual tanpa hardcode | Selesai | Pola peran (`siswa <nama>`, `kelas <kode>`); tanpa nama orang di regex |
| Token exclusion di resolver | Selesai | Token yang cocok sebagai kelas/mapel tidak ditembak ke endpoint siswa |
| Semantic enum dynamic matching | Selesai | `semanticEnumMatch()` membaca `spec.values` dari DB |
| Cache Redis dan single-flight | Selesai | Cache hit < 1 ms; promise locking anti-stampede |
| Isolasi tenant dan role ACL | Selesai | Berdasarkan Pintro `job` + `groups` + `acl` |
| Graceful shutdown | Selesai | `SIGINT`/`SIGTERM` melepas port 3000 dan 4000 |
| Type safety | Selesai | `npx tsc --noEmit` 0 error |

---

## 13. Dokumentasi Lanjutan dan Batasan

| Dokumen | Isi |
|---|---|
| [`docs/POC_SMART_SEARCH.md`](docs/POC_SMART_SEARCH.md) | Dokumen teknis lengkap: arsitektur, benchmark, tracing, panduan versi baca (§23), estimasi biaya JEV (§24) |
| [`docs/PLAN_PRODUCTION_ARCHITECTURE.md`](docs/PLAN_PRODUCTION_ARCHITECTURE.md) | Prinsip arsitektur production, topologi Docker, desain `search_routes`, action plan |
| [`docs/PLAN_KLASIFIKASI_EKSTRAKSI.md`](docs/PLAN_KLASIFIKASI_EKSTRAKSI.md) | Analisa 14 temuan (F1–F14), pembagian peran AI vs regex, rencana P1–P9 |
| [`docs/PLAN_PRODUCTION_HARDENING.md`](docs/PLAN_PRODUCTION_HARDENING.md) | Audit ketahanan/skala/keamanan, status W1–W2, penilaian kesiapan produksi |
| [`docs/RESEARCH_API_ACCESS_LAYER.md`](docs/RESEARCH_API_ACCESS_LAYER.md) | Riset call-site layer akses JEV/lokal, biaya token, mode fallback |
| [`docs/PLAN_MOTION_VIDEO_REMOTION.md`](docs/PLAN_MOTION_VIDEO_REMOTION.md) | Rencana dan sumber video penjelasan |

### Batasan yang diketahui

- Role atau tenant yang tidak dikenal dibalas sukses dengan hasil kosong, belum ditolak.
- Di app-education (mock), halaman data seperti nilai belum mengecek peran; ini bagian aplikasi tiruan untuk POC.
- Rate limit per instance (in-process); belum terdistribusi.
- `AUTH_MODE=jwt` masih stub; `trusted-header` mengandalkan gateway internal tepercaya.
- Timeout JEV dan circuit breaker belum dibuktikan lewat tes live.
- Estimasi biaya JEV berbasis data satu hari (28 Okt 2026); lihat batasannya di `docs/POC_SMART_SEARCH.md` §24.5.

## Lisensi dan Catatan

POC internal Pintro. Berisi data simulasi (nama siswa, kelas, tagihan), bukan data produksi.
