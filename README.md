# POC Smart Search

**Smart Search untuk aplikasi manajemen sekolah (Pintro)** — mengubah pertanyaan bahasa alami pengguna menjadi **aksi terstruktur**: navigasi menu, deep-link dengan filter terisi, atau aksi cetak/unduh rapor.

> **Status:** ✅ **Production-Ready Core Pipeline (100% Lulus E2E & TSC 0 Error)**. Pipeline modular telah sepenuhnya terhubung dari Klasifikasi AI, Ekstraksi Kontekstual, Lazy Master Resolver berbasis Redis, hingga Dispatcher terstruktur.

---

## Konsep

Pengguna akhir tidak ingin tahu nama route, nama kolom, atau format query SQL. Mereka menulis seperti biasa:

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

### Prinsip desain yang dipegang

1. **AI hanya memilih, tidak mengarang.** Klasifikasi AI hanya menentukan *route* dan *nilai enum* dari kandidat yang sudah ada. ID database, filter SQL, dan hak akses tidak pernah dikarang AI.
2. **Zero full-table scan & Token Exclusion.** Sistem tidak pernah menembak query ke semua tabel. Route dipilih dulu, master list kecil (kelas/mapel) dicocokkan di Redis cache, lalu sisa token yang belum cocok baru dicari ke endpoint entitas dinamis (siswa/pegawai).
3. **Metadata di database, bukan di kode.** Menambah modul, kata kunci, atau spesifikasi parameter (`ParamSpec`) = satu `INSERT`/`UPDATE` di tabel `search_routes`, tanpa redeploy dan tanpa retrain model.
4. **Multi-tenant sejak awal.** Setiap request membawa `X-Client-Id`; cache dan query terisolasi per tenant dan per role.
5. **Waktu relatif bukan tebakan AI.** *"tahun ajaran ini"* dijawab dari baris `academic_year` aktif di DB (`start_date..end_date`), bukan dari tebakan kalender lokal.
6. **Graceful Shutdown Bersih.** Listener `SIGINT` (Ctrl+C) dan `SIGTERM` melepas port 3000 dan 4000 secara instan tanpa proses menggantung.

---

## Arsitektur

```text
┌─────────────────────────────────────────────────────────────────────┐
│  👤 User: "Siapa yang belum bayar spp tahun ajaran ini?"             │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  service-search (:4000)                                            │
│                                                                     │
│  ① KLASIFIKASI  →  JEV Cloud (primary) │ transformers.js (fallback) │
│       ↓ intent + target_route                                      │
│  ② SCOPED EXTRACT  →  baca allowed_params route terpilih            │
│       ↓ regex + semantic enum match                                 │
│  ③ LAZY RESOLVE  →  fetch master sesuai hint_regex, cache Redis    │
│       ↓                                                              │
│  ④ DISPATCH  →  susun options[] terstruktur + filter URL           │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  app-education (:3000)  — Multi-Tenant Core App + SQLite           │
│  /api/routes (ACL)  ·  /api/master/*  ·  /api/siswa  ·  /api/spp   │
└─────────────────────────────────────────────────────────────────────┘
```

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
│ Transformers.js (Local)  │ 94%      │ 2.92 ms     │ 2.51ms – 3.56ms   │
└──────────────────────────┴──────────┴─────────────┴────────────────────┘
```

Case gagal lokal: *"halaman penilaian rapor"*, *"print leger nilai kelas 9A"*.

---

## Alur Kerja (Step by Step)

### Contoh: `"Siapa yang belum bayar spp tahun ajaran ini?"`

**Step 1 — Klasifikasi** → JEV menerima 2 pertanyaan dalam 1 request:

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

**Step 2 — Scoped Extraction.** Route `spp` membawa kontrak `allowed_params` dari tabel `search_routes`:

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
- `"belum bayar"` → cocok anchor `status.nunggak` ✅
- `"tahun ajaran ini"` → memicu slot `academic_year_id` ✅
- Tidak ada nama orang → slot `siswa_id` **tidak aktif**, `/api/siswa` tidak dipanggil ✅

**Step 3 — Lazy Resolve.** Hanya slot relevan yang di-fetch:

| Slot | Trigger | Endpoint | Cache key |
|---|---|---|---|
| `status` | enum (regex) | — (tanpa HTTP) | — |
| `academic_year_id` | `"tahun ajaran ini"` | `GET /api/master/academic-years` | `smartsearch:master:<client>:<key>` |
| `siswa_id` | — (tidak ada nama) | **tidak dipanggil** | — |

Single-Flight Lock mencegah *thundering herd* — 100 request serentak hanya memicu 1 HTTP call.

**Step 4 — Dispatch.** `academic_year_id` diambil dari baris `is_active = 1`:

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

## Konfigurasi Route (Tabel `search_routes`)

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

Tiga mode `allowed_params`:

| Mode | Artinya | Contoh | HTTP call |
|---|---|---|---|
| `list` | Master kecil, fetch 1× per tenant | `kelas_id` → `/api/master/kelas` | Ya, cache TTL 30m |
| `search` | Data besar, cari per token | `siswa_id` → `/api/siswa?q=` | Ya, cache per token |
| `enum` | Nilai tertutup, dari regex/semantic | `status`, `periode`, `semester` | Tidak |

Field `ParamSpec` lain: `query_param`, `match_field`, `resolves_to`, `hint_regex`, `values`.

> `hint_regex` adalah **trigger detection** — agar sistem tidak waste HTTP call untuk slot yang tidak relevan dengan kalimat user.

---

## Multi-Tenant & ACL

```text
search_routes  ⋈  acl  ⋈  groups        → route mana yang terlihat
WHERE client_id = ? AND UPPER(groups.code) = ?
```

Header yang meneruskan antar service:

| Header | Fungsi |
|---|---|
| `X-Client-Id` | Isolasi tenant (wajib) |
| `X-User-Role` | Filter ACL per role |
| `Authorization` | Terus diteruskan ke app-education |

Cache di-isolasi per tenant **dan** per role — user dengan role berbeda tidak pernah melihat cache satu sama lain.

---

## Cache Redis

| Key | Isi | TTL |
|---|---|---|
| `smartsearch:routes:<client>:<role>` | Route manifest | 30m |
| `smartsearch:master:<client>:<param_key>` | Master list (kelas, subject, academic year) | 30m |
| `smartsearch:lookup:<client>:<param_key>:<token>` | Hasil pencarian entitas | 30m |
| `smartsearch:q:v3:<client>:<role>:<engine>:<threshold>:<query>` | Hasil query final | 30m |

Fallback otomatis ke in-memory map bila Redis offline (`cache/redis.ts`). TTL master bisa diubah lewat `SMARTSEARCH_MASTER_TTL`.

---

## Struktur Project

```text
poc-smart-search/
├── README.md                       # Dokumen ini
├── docs/
│   ├── POC_SMART_SEARCH.md         # Dokumen teknis lengkap
│   ├── PLAN_PRODUCTION_ARCHITECTURE.md   # Rencana arsitektur production
│   ├── PLAN_KLASIFIKASI_EKSTRAKSI.md    # Analisa & rencana klasifikasi/ekstraksi
│   └── RESEARCH_API_ACCESS_LAYER.md     # Riset layer akses AI
├── service-search/                 # Search Engine (:4000)
│   ├── src/
│   │   ├── server.ts               # HTTP server, pipeline orchestrator
│   │   ├── classifier.ts           # JEV Cloud + fallback lokal
│   │   ├── local-model.ts          # transformers.js in-process (ONNX q8)
│   │   ├── routes-sync.ts          # Manifest route per (client, role)
│   │   ├── extractor.ts            # Regex + time-hint extraction
│   │   ├── lazy-resolver.ts        # Lazy master resolve (list/search/enum)
│   │   ├── dispatcher.ts           # Intent → SearchOption[]
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
├── research/                       # Probe skrip riset (JEV contract, routing gap)
├── test-e2e.ts                     # Integration test end-to-end
├── run-test.ts                     # Auto start kedua service + jalankan test
├── docker-compose.yml              # Stack production: service-search + redis
└── package.json
```

---

## Menjalankan

### Prasyarat

- **Bun 1.1+** (atau Node.js 20+ dengan `tsx`)
- **Redis** (opsional — ada fallback in-memory)
- **API key TypeSafe**: `export TYPESAFE_API_KEY="..."` (opsional — tanpa ini engine lokal dipakai)

### Mode pengembangan (host)

```bash
# Terminal 1 — core app + SQLite
bun run start:app

# Terminal 2 — search engine
bun run start:search
```

Test:

```bash
bun run test:e2e        # integration test (start dua service + test)
bun run test:benchmark  # head-to-head JEV vs lokal
bun run cli             # interactive CLI
```

Coba manual:

```bash
curl "http://127.0.0.1:3000/api/search?q=Siapa%20yang%20belum%20bayar%20spp%20tahun%20ajaran%20ini&engine=auto" \
  -H "X-Client-Id: 1" -H "X-User-Role: SUPERADMIN"
```

### Mode production (Docker)

Stack khusus `4 vCPU / 4 GB RAM`: `service-search` + `redis`. `app-education` **tidak** di-container-kan (tetap di host/server utama).

```bash
export TYPESAFE_API_KEY="..."
docker compose up -d --build
docker compose logs -f service-search
```

Alokasi resource:

| Service | CPU | RAM | Catatan |
|---|---|---|---|
| `service-search` | 3.5 | 3g | Model ONNX q8 di-bake ke image (~1.48 GB) |
| `redis` | 0.5 | 1g | `allkeys-lru`, `maxmemory 768mb` |

Environment:

| Variable | Default | Fungsi |
|---|---|---|
| `TYPESAFE_API_KEY` | — | API key JEV |
| `APP_EDUCATION_URL` | `http://host.docker.internal:3000` | Alamat core app |
| `REDIS_URL` | `redis://redis:6379` | Redis (container) |
| `SEARCH_PORT` | `4000` | Port service-search |
| `HF_ALLOW_REMOTE` | `false` (image) | Matikan download model saat runtime |
| `SMARTSEARCH_MASTER_TTL` | `1800` | TTL cache master (detik) |
| `SMARTSEARCH_WARMUP` | — | Prefetch manifest, mis. `1:SUPERADMIN` |

---

## Status Verifikasi

> ✅ **Semua 16/16 Check E2E Lulus & TypeScript Check 0 Error.** (Diverifikasi 26 Okt 2026).

```text
🚀 E2E SEQUENTIAL LAZY PIPELINE (Classify -> allowed_params -> Lazy Master -> Options)
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
🎉 SEMUA CHECK SEQUENTIAL LAZY PIPELINE LULUS!
```

Ringkasan Status Implementasi:

| Komponen / Fungsionalitas | Status | Catatan Teknis |
|---|---|---|
| **Klasifikasi Dual-Engine** | ✅ Selesai | JEV Cloud 94% / 272ms, Fallback lokal transformers.js 94% / 2.92ms |
| **Kontrak `ParamSpec` Antar-Layanan** | ✅ Selesai | `routes-sync.ts` & `app-education/server.ts` tersinkronisasi via tabel `search_routes` |
| **Endpoint Master Data** | ✅ Selesai | `/api/master/academic-years`, `/api/master/subjects`, `/api/master/kelas` aktif |
| **Ekstraksi Kontekstual Tanpa Hardcode** | ✅ Selesai | Mengikat pola peran (`siswa <nama>`, `kelas <kode>`), zero hardcode nama orang di regex |
| **Token Exclusion di Resolver** | ✅ Selesai | Token yang cocok sebagai kelas/mapel tidak ditembak lagi ke endpoint siswa |
| **Semantic Enum Dynamic Matching** | ✅ Selesai | `semanticEnumMatch()` mengekstrak teks langsung dari `spec.values` DB tanpa kamus statis |
| **Cache Redis & Single-Flight** | ✅ Selesai | Cache hit < 1 ms, anti-stampede promise locking |
| **Isolasi Tenant & Role ACL** | ✅ Selesai | Berdasarkan Pintro `job` + `groups` + `acl` |
| **Graceful Shutdown** | ✅ Selesai | Listener `SIGINT` (Ctrl+C) dan `SIGTERM` melepas port 3000 & 4000 secara bersih |
| **Type Safety** | ✅ Selesai | `npx tsc --noEmit` 0 error di seluruh berkas |

---

## Dokumentasi

| Dokumen | Isi |
|---|---|
| [`docs/POC_SMART_SEARCH.md`](docs/POC_SMART_SEARCH.md) | Dokumen teknis lengkap: arsitektur, benchmark, tracing, 20+ section |
| [`docs/PLAN_PRODUCTION_ARCHITECTURE.md`](docs/PLAN_PRODUCTION_ARCHITECTURE.md) | Prinsip arsitektur production, topologi Docker, desain `search_routes`, action plan |
| [`docs/PLAN_KLASIFIKASI_EKSTRAKSI.md`](docs/PLAN_KLASIFIKASI_EKSTRAKSI.md) | Analisa 14 temuan (F1–F14), pembagian peran AI vs regex, rencana P1–P9 |
| [`docs/RESEARCH_API_ACCESS_LAYER.md`](docs/RESEARCH_API_ACCESS_LAYER.md) | Riset call-site layer akses JEV/lokal, biaya token, mode fallback |

---

## Lisensi & Catatan

POC internal Pintro. Berisi data simulasi (nama siswa, kelas, tagihan) — bukan data produksi.
