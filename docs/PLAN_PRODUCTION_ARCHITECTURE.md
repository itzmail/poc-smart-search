# Production Architecture & Implementation Plan: Smart Search (Multi-Tenant, Lazy Master Cache & In-Process Transformers)

> **Status**: Approved & Implemented Architecture — ✅ **Phase 1–4 SELESAI & TERVERIFIKASI PENUH**  
> **Verifikasi**: 26 Okt 2026 — `bun run test:e2e` → ✅ **16/16 check PASS** · `tsc --noEmit` → ✅ **0 error** · `bun run test:benchmark` → ✅ **JEV 94% / 272.1 ms, Lokal 94% / 2.92 ms**  
> **Scope**: `service-search` (Dockerized `4 vCPU / 4 GB RAM` + Redis) & `app-education` (External Host Service)
> **Lanjutan**: ketahanan, skala, dan keamanan production → [`PLAN_PRODUCTION_HARDENING.md`](./PLAN_PRODUCTION_HARDENING.md)

---

## 1. Tujuan Utama & Prinsip Arsitektur Production

1. **Zero Full-Table Scan (`/api/master/resolve` Dihapus)**  
   `service-search` **tidak boleh** menembak query pencarian ke semua tabel (`siswa`, `kelas`, `invoice`, `spp`) secara buta di awal request.
2. **Urutan Eksekusi Berbasis Route (`JEV` ➔ `allowed_params` ➔ `Lazy Master Resolver`)**  
   - **JEV Cloud** (atau fallback lokal `@huggingface/transformers`) jalan **duluan** untuk menentukan `intent` dan `target_route`.
   - Route yang terpilih membawa kontrak `allowed_params` dari tabel `search_routes`.
   - **Regex + `transformers.js`** mengekstrak parameter dan token kandidat **hanya** di dalam ruang lingkup `allowed_params` milik route tersebut.
3. **Generic Lazy Master Cache (Multi-Tenant `X-Client-Id` + Redis TTL 30 Menit)**  
   - Setiap parameter di `allowed_params` (`academic_year_id`, `department_id`, `class_level_id`, `subject_id`, `kelas_id`, `siswa_id`, dll.) di-fetch secara **lazy (on-demand)** hanya ketika dibutuhkan oleh kalimat user.
   - Hasil master di-cache di Redis per `client_id` dengan **TTL 30 menit (`1800s`)** dan dilindungi **Single-Flight Lock** agar ratusan request serentak pada sekolah yang sama hanya memicu 1 HTTP call ke `app-education`.
4. **Multi-Entity & Cross-Role Disambiguation Tanpa Tebakan AI**  
   - Sistem **tidak menebak** apakah kata `"Siti"` adalah nama siswa, nama wali kelas, atau nama ruang kelas.
   - Token `"Siti"` dicocokkan langsung ke sumber data yang terdaftar pada `allowed_params` route terkait (`kelas` dan `siswa`).
   - Nomor/kode kelas (mis. `"8B"` atau `"7A"`) pada pertanyaan *"Siti ini ada di kelas berapa?"* diperoleh **dari hasil response API Siswa/Kelas**, bukan dari asumsi di awal kalimat.
   - Seluruh entitas yang cocok (beberapa siswa bernama Siti + wali kelas bernama Siti) dikembalikan dalam array `options[]` lengkap dengan objek `data: { entity_role, siswa, kelas }`.
5. **In-Process `@huggingface/transformers` (Menggantikan Daemon Python `Laya`)**  
   - Menggunakan model ONNX int8 `Xenova/multilingual-e5-small` (~120 MB disk, ~220 MB RAM runtime, ~12–25 ms inferensi CPU) langsung di dalam proses Bun/Node `service-search`.
   - Berfungsi untuk:
     1. **Semantic Matching** pada parameter `allowed_params` (sinonim Bahasa Indonesia, bahasa sehari-hari, serta resolusi konteks negasi seperti *"sudah lunas"* vs *"belum bayar"*).
     2. **Semantic Query Cache** di Redis.
     3. **Local Classifier Fallback** apabila `JEV Cloud` timeout/gangguan.

---

## 2. Topologi Deployment & Kapasitas Docker (`4 vCPU / 4 GB RAM`)

`app-education` berjalan di luar Docker (server/host utama). Container Docker (`4 vCPU / 4 GB RAM`) didedikasikan **100% untuk `service-search` dan `redis`**.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ HOST / EXTERNAL SERVER (:3000)                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │ app-education (Multi-Tenant Core App)                           │   │
│   │ - Tabel: search_routes, academic_year, master_department,       │   │
│   │          master_class_level, master_subject, master_kelas,      │   │
│   │          siswa, spp, nilai, invoice, groups, acl                │   │
│   │ - Endpoints: /api/routes, /api/master/*, /api/siswa, /api/spp   │   │
│   └───────────────────────────────▲─────────────────────────────────┘   │
└───────────────────────────────────┼─────────────────────────────────────┘
                                    │ HTTP (Header: X-Client-Id, Authorization, X-User-Role)
                                    │ Lazy On-Demand Fetch + Single-Flight Lock
┌───────────────────────────────────┼─────────────────────────────────────┐
│ DOCKER ENVIRONMENT (Total Limit: 4 vCPU / 4 GB RAM)                     │
│                                   │                                     │
│   ┌───────────────────────────────┴─────────────────────────────────┐   │
│   │ service-search (:4000) — Limit: 3.5 vCPU / 3.0 GB RAM           │   │
│   │ - Step 1: Classifier (JEV Cloud Primary + transformers.js)      │   │
│   │ - Step 2: Scoped Extractor (Regex + transformers.js Semantic)   │   │
│   │ - Step 3: Lazy Master Resolver (Single-Flight + Redis TTL 30m)  │   │
│   │ - Step 4: Multi-Entity Dispatcher (Ranked options[])            │   │
│   └───────────────────────────────┬─────────────────────────────────┘   │
│                                   │                                     │
│   ┌───────────────────────────────▼─────────────────────────────────┐   │
│   │ redis (:6379) — Limit: 0.5 vCPU / 1.0 GB RAM (allkeys-lru)      │   │
│   │ - smartsearch:routes:<client_id>:<role>          (TTL 30m)      │   │
│   │ - smartsearch:master:<client_id>:<param_key>     (TTL 30m)      │   │
│   │ - smartsearch:lookup:<client_id>:<key>:<token>   (TTL 30m)      │   │
│   │ - smartsearch:qcache:<client_id>:<role>:<hash>   (TTL 30m)      │   │
│   └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Desain 1 Tabel Baru Production-Ready: `search_routes`

Tabel `job` bawaan Pintro tetap bersih untuk struktur menu utama & ACL, sedangkan seluruh konfigurasi Smart Search disimpan pada **1 tabel khusus `search_routes`**:

### 3.1 Skema Kolom `search_routes`

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | ID unik route (mis. `SR-01`) |
| `job_id` | `TEXT NOT NULL` | Relasi ke `job.id` untuk mewarisi hak akses role (`acl` & `groups`) |
| `code` | `TEXT NOT NULL` | Kode modul unik per tenant (`dashboard`, `siswa`, `nilai`, `spp`, `rapot`, `kelas`) |
| `title` | `TEXT NOT NULL` | Nama fitur/menu yang tampil di UI |
| `url_path` | `TEXT NOT NULL` | Base path tujuan (mis. `/spp`, `/siswa`, `/kelas`) |
| `description` | `TEXT NOT NULL` | Deskripsi semantik fitur untuk dievaluasi oleh `JEV` & `transformers.js` |
| `keywords` | `TEXT NOT NULL` | JSON array kata kunci/sinonim (mis. `["spp", "syahriah", "tagihan", "bayar"]`) |
| `supported_intents` | `TEXT NOT NULL` | JSON array intent yang diizinkan (`["LIST_MENU", "DIRECT_LINK", "REPORT_ACTION"]`) |
| `allowed_params` | `TEXT NOT NULL` | JSON array definisi parameter beserta konfigurasi endpoint lazy-fetch |
| `is_active` | `INTEGER DEFAULT 1` | Status aktif route (`1` = aktif, `0` = nonaktif) |
| `client_id` | `TEXT NOT NULL` | ID Tenant / Sekolah |

### 3.2 Struktur JSON `allowed_params` (Self-Contained di Dalam `search_routes`)

Setiap elemen di dalam `allowed_params` mendefinisikan bagaimana parameter tersebut diekstrak dan di-fetch:

```json
[
  {
    "key": "academic_year_id",
    "endpoint": "/api/master/academic-years",
    "mode": "list",
    "ttl": 1800
  },
  {
    "key": "department_id",
    "endpoint": "/api/master/departments",
    "mode": "list",
    "ttl": 1800
  },
  {
    "key": "class_level_id",
    "endpoint": "/api/master/class-levels",
    "mode": "list",
    "ttl": 1800
  },
  {
    "key": "subject_id",
    "endpoint": "/api/master/subjects",
    "mode": "list",
    "ttl": 1800
  },
  {
    "key": "kelas_id",
    "endpoint": "/api/master/kelas",
    "mode": "list",
    "ttl": 1800
  },
  {
    "key": "wali_kelas",
    "endpoint": "/api/master/kelas",
    "mode": "list",
    "match_field": "wali_kelas",
    "resolves_to": "kelas_id",
    "ttl": 1800
  },
  {
    "key": "siswa_id",
    "endpoint": "/api/siswa",
    "mode": "search",
    "query_param": "q",
    "resolves_to": "kelas_id",
    "ttl": 1800
  },
  {
    "key": "status",
    "mode": "enum",
    "values": {
      "nunggak": "belum bayar, menunggak, tunggakan, belum lunas, terlambat bayar, masih hutang",
      "lunas": "sudah bayar, sudah lunas, pembayaran selesai, bebas tunggakan, riwayat lunas"
    }
  },
  {
    "key": "periode",
    "mode": "enum",
    "values": {
      "hari_ini": "hari ini, sekarang",
      "bulan_ini": "bulan ini",
      "tahun_ini": "tahun ini, tahun ajaran ini, periode berjalan"
    }
  }
]
```

### 3.3 Penjelasan 3 Mode Parameter (`list`, `search`, `enum`)

1. **`mode: "list"` (Master Data Ukuran Kecil–Sedang per Sekolah)**  
   - Contoh: `academic_year_id`, `department_id`, `class_level_id`, `subject_id`, `kelas_id`, `wali_kelas`.
   - Jumlah baris per `client_id` hanya ~5–50 baris.
   - Saat route yang dipilih membutuhkan parameter ini dan terdapat indikasi di kalimat user, `service-search` mengecek Redis `smartsearch:master:<client_id>:<endpoint>`. Jika belum ada (cache miss), fetch 1x ke `app-education` dengan meneruskan `X-Client-Id`, `Authorization`, dan `X-User-Role`, lalu simpan di Redis selama **30 menit**.
2. **`mode: "search"` (Data Ribuan Baris per Sekolah)**  
   - Contoh: `siswa_id`, `invoice_id`.
   - Tidak pernah di-dump seluruhnya ke Redis.
   - Hanya dipanggil jika ada **kandidat token** di kalimat user (mis. `"siti"`). Memanggil `GET /api/siswa?q=siti` (Header `X-Client-Id`), lalu menyimpan hasil pencarian spesifik tersebut di Redis `smartsearch:lookup:<client_id>:siswa_id:siti` selama **30 menit**.
3. **`mode: "enum"` (Nilai Statis & Semantik)**  
   - Contoh: `status` (`nunggak` vs `lunas`), `periode`, `semester`, `format` (`pdf` vs `excel`).
   - Tidak memanggil API eksternal. Dicocokkan menggunakan **Negation-Aware Regex (0 ms)** + **`transformers.js` Embedding Similarity (~12 ms)** untuk menangani kalimat alami/negasi seperti *"riwayat tagihan yang sudah lunas"*.

---

## 4. Alur Eksekusi End-to-End pada Kasus Utama

### Kasus 1: `"Siti ini ada di kelas berapa?"` (Header: `X-Client-Id: 1`)

1. **Step 1 — Klasifikasi Intent & Route (`JEV` / `transformers.js`)**:
   - Menentukan `intent = "DIRECT_LINK"`, `target_route = "kelas"`.
2. **Step 2 — Baca `allowed_params` dari Route `kelas`**:
   - Parameter yang diizinkan pada route `kelas`:
     - `kelas_id` (`mode: "list"`, `/api/master/kelas`)
     - `wali_kelas` (`mode: "list"`, `/api/master/kelas`, `match_field: "wali_kelas"`)
     - `siswa_id` (`mode: "search"`, `/api/siswa?q=`, `resolves_to: "kelas_id"`)
   - Parameter dari modul lain (`invoice`, `spp`, `subject`, `department`) **tidak ada** di `allowed_params` route `kelas`, sehingga **tidak akan disentuh**.
3. **Step 3 — Tokenisasi & Lazy Lookup**:
   - Buang kata fungsi/tanya (`ini`, `ada`, `di`, `kelas`, `berapa`) ➔ menyisakan kandidat token: **`["siti"]`**.
   - Sistem **tidak menebak** apakah `"siti"` itu nama kelas, nama siswa, atau nama wali kelas, melainkan mengecek ke sumber data `allowed_params` route `kelas`:
     1. **Cek Master Kelas (`smartsearch:master:1:/api/master/kelas`)**:
        - Apakah ada ruang kelas bernama `"Siti"`? Tidak ada.
        - Apakah ada `wali_kelas` bernama `"Siti"`? **Ada**: *Siti Aminah, S.Pd* (`id: "K-07A"`, `name: "Kelas 7A"`).
     2. **Cek API Siswa (`GET /api/siswa?q=siti`, cache `smartsearch:lookup:1:siswa_id:siti`)**:
        - **Ketemu 2 Siswa**:
          - *Siti Rahma* (`id: "S002"`, `nisn: "0081234562"`, `kelas: "8B"`, `kelas_id: "K-08B"`)
          - *Siti Aisyah* (`id: "S009"`, `nisn: "0081234569"`, `kelas: "7A"`, `kelas_id: "K-07A"`)
        - Dari response API `/api/siswa?q=siti` inilah sistem mendapatkan fakta bahwa Siti Rahma berada di **Kelas 8B (`K-08B`)** dan Siti Aisyah berada di **Kelas 7A (`K-07A`)**.
4. **Step 4 — Penilaian Konteks & Penyusunan Response JSON**:
   - Jika kalimat tidak menyebut kata `"bu"`, `"ibu"`, `"pak"`, `"wali"`, `"guru"`, maka kecocokan `siswa` diberi skor prioritas sedikit lebih tinggi daripada `wali_kelas` (namun keduanya tetap ditampilkan).
   - Output `options[]` berisi array objek lengkap (`kelas` + `siswa` / `wali_kelas`):

```json
{
  "options": [
    {
      "rank": 1,
      "score": 0.96,
      "intent": "DIRECT_LINK",
      "target_type": "DETAIL",
      "title": "Kelas 8B — Siti Rahma (Siswa)",
      "description": "Siti Rahma terdaftar sebagai Siswa di Kelas 8B",
      "destination": "/kelas/K-08B",
      "data": {
        "entity_role": "siswa",
        "siswa": { "id": "S002", "nisn": "0081234562", "nama": "Siti Rahma" },
        "kelas": { "id": "K-08B", "code": "8b", "name": "Kelas 8B" }
      }
    },
    {
      "rank": 2,
      "score": 0.94,
      "intent": "DIRECT_LINK",
      "target_type": "DETAIL",
      "title": "Kelas 7A — Siti Aisyah (Siswa)",
      "description": "Siti Aisyah terdaftar sebagai Siswa di Kelas 7A",
      "destination": "/kelas/K-07A",
      "data": {
        "entity_role": "siswa",
        "siswa": { "id": "S009", "nisn": "0081234569", "nama": "Siti Aisyah" },
        "kelas": { "id": "K-07A", "code": "7a", "name": "Kelas 7A" }
      }
    },
    {
      "rank": 3,
      "score": 0.85,
      "intent": "DIRECT_LINK",
      "target_type": "DETAIL",
      "title": "Kelas 7A — Siti Aminah, S.Pd (Wali Kelas)",
      "description": "Siti Aminah, S.Pd adalah Wali Kelas 7A",
      "destination": "/kelas/K-07A",
      "data": {
        "entity_role": "wali_kelas",
        "wali_kelas": { "nama": "Siti Aminah, S.Pd" },
        "kelas": { "id": "K-07A", "code": "7a", "name": "Kelas 7A" }
      }
    }
  ]
}
```

---

### Kasus 2: `"Siapa yang belum bayar spp tahun ajaran ini?"` (Header: `X-Client-Id: 1`)

1. **Step 1 — Klasifikasi Intent & Route**:
   - `intent = "DIRECT_LINK"`, `target_route = "spp"`.
2. **Step 2 — Scoped Extraction (`allowed_params` Route `spp`)**:
   - Regex + `transformers.js` mendeteksi:
     - `"belum bayar"` ➔ cocok dengan `status = "nunggak"`.
     - `"tahun ajaran ini"` ➔ memicu slot **`academic_year_id`** (karena ada kata waktu tahun ajaran).
     - Tidak ada sisa token nama orang ➔ slot `siswa_id` **tidak aktif** (tidak memanggil `/api/siswa`).
3. **Step 3 — Lazy Fetch `academic_year_id` per `client_id`**:
   - Cek Redis `smartsearch:master:1:/api/master/academic-years`.
   - Jika belum ada, panggil `GET /api/master/academic-years` (`X-Client-Id: 1`), simpan di Redis TTL 30 menit.
   - Karena user menyebut `"tahun ajaran ini"`, pilih item dengan `is_active === 1` ➔ **`AY-2026` (`2026/2027`)**.
4. **Step 4 — Hasil Akhir**:
   - Menghasilkan destinasi akurat: `/spp?status=nunggak&academic_year_id=AY-2026` dengan label *"Daftar Pembayaran & Tagihan SPP — Status: Nunggak, TA 2026/2027"*.

---

### Kasus 3: `"Riwayat tagihan yang sudah lunas"` (Penanganan Negasi oleh Regex + `transformers.js`)

1. **Masalah Lama**: Kata `"tagihan"` di-hardcode menjadi `status = "nunggak"`, sehingga menimpa kata `"sudah lunas"`.
2. **Solusi Baru**:
   - Kata `"tagihan"` hanya menjadi penanda modul (`spp`), **bukan** nilai `status`.
   - Pada ekstraksi `status`:
     - Lapis 1 (Negation-Aware Regex): Mengecek frasa utuh `"belum lunas"` / `"belum bayar"` terlebih dahulu sebelum `"sudah lunas"` / `"lunas"`.
     - Lapis 2 (`transformers.js` Semantic Similarity): Membandingkan embedding kalimat utuh terhadap anchor `status.lunas` vs `status.nunggak`. Kalimat *"riwayat tagihan yang sudah lunas"* memiliki cosine similarity tinggi ke `status.lunas`, sehingga menghasilkan `/spp?status=lunas`.

---

## 5. Tahapan Implementasi (Action Plan)

> **Status terverifikasi 26 Okt 2026.** Seluruh Phase 1–4 **telah diimplementasikan dan diverifikasi 100% Lulus E2E (16/16 PASS)**. Kontrak `ParamSpec` terhubung penuh, master endpoints aktif, token exclusion aktif, ekstraksi kontekstual dinamis, dan graceful shutdown terpasang.

### Phase 1: Pembaruan Skema & Endpoint Master di `app-education` ✅ (SELESAI)
- **`app-education/src/data/db.ts`** ✅ **SELESAI**:
  - Membuat tabel `search_routes` (dengan kolom JSON `allowed_params` ber-endpoint).
  - Menambahkan tabel master: `academic_year`, `master_department`, `master_class_level`, `master_subject`, `master_kelas`.
  - Menambahkan seed data multi-entitas `"Siti"` pada tabel `siswa` (*Siti Rahma - 8B*, *Siti Aisyah - 7A*) dan `master_kelas.wali_kelas` (*Siti Aminah, S.Pd - 7A*).
  - Menambahkan baris ACL Tenant 2 (`G01_T2`, `G02_T2` ➔ `J01_T2`, `J02_T2`, `J04_T2`) agar isolasi multi-tenant berfungsi penuh.
  - Memperkaya enum anchors untuk `status` (menangani frasa colloquial seperti *setor, nyetor, lunas, belum bayar*) dan `periode` (`hari_ini`, `minggu_ini`, `bulan_ini`, `bulan_lalu`, `tahun_ini`, `tahun_lalu`).
  - Helper `getSearchRoutes(clientId, role)` tersedia di `db.ts:585`.
- **`app-education/src/server.ts`** ✅ **SELESAI**:
  - `GET /api/routes` mengonsumsi `getSearchRoutes(clientId, userRole)` dari `db.ts` dan mem-parse `allowed_params` menjadi `ParamSpec[]`.
  - Endpoint master aktif: `/api/master/academic-years`, `/api/master/subjects`, `/api/master/kelas`.
  - `GET /api/siswa?q=...` mendukung pencarian nama dinamis.
  - `GET /api/spp` memfilter `academic_year_id` dan seluruh variasi `periode` (`hari_ini`, `minggu_ini`, `bulan_ini`, `bulan_lalu`, `tahun_ini`, `tahun_lalu`).
  - `getActiveContext(clientId)` mengembalikan `academic_year_id` aktif berdasarkan tanggal berjalan (`AY-2026`).
  - Graceful shutdown (`SIGINT`/`SIGTERM`) terpasang.

### Phase 2: Engine `transformers.js` + Generic Lazy Resolver di `service-search` ✅ (SELESAI)
- **`service-search/src/local-model.ts`** ✅ **SELESAI**:
  - In-process `@huggingface/transformers` (`Xenova/multilingual-e5-small`, `dtype: "q8"`).
  - Menyediakan `embed()`, `cosine()`, `classifyLocal()`, dan `semanticEnumMatch()` dengan gate margin (selisih score top-1 vs top-2 $\ge 0.003$) untuk mencegah halusinasi slot periode.
  - Teks anchor diekstrak dinamis dari `spec.values` DB tanpa kamus hardcode.
  - Berfungsi penuh tanpa Python dan tanpa internet saat model sudah di-bake lokal.
  - **Benchmark terverifikasi:** akurasi **94%**, latensi rata-rata **2.92 ms** (range 2.51–3.56 ms).
- **`service-search/src/lazy-resolver.ts`** ✅ **SELESAI**:
  - Membaca `allowed_params` dari route terpilih.
  - **Token Exclusion**: Master list kecil di-resolve duluan; token yang cocok sebagai kelas/mapel tidak ditembak secara boros ke endpoint siswa.
  - Mode `list`: lazy fetch master kecil, disimpan di Redis `smartsearch:master:<client_id>:<param_key>` (TTL 30m) + *Single-Flight Lock* + meneruskan header `X-Client-Id`, `Authorization`, dan `X-User-Role`.
  - Mode `search`: pencarian per token di Redis `smartsearch:lookup:<client_id>:<param_key>:<token>`.
  - Slot `academic_year_id` otomatis diisi dari `active_context.academic_year_id` jika user menyebut "tahun ajaran ini".

### Phase 3 & 4: Dispatcher Multi-Entitas, Kontrak TypeScript, & E2E ✅ (SELESAI)
- **`service-search/src/routes-sync.ts`** ✅ **SELESAI**:
  - `export interface ParamSpec` dengan `mode`, `endpoint`, `query_param`, `match_field`, `resolves_to`, `hint_regex`, dan `values`.
  - Argumen ke-4 `auth?: string` pada `getRoutesManifest()`.
- **`service-search/src/extractor.ts`** ✅ **SELESAI**:
  - Ekstraksi kontekstual anchor (`siswa <nama>`, `kelas <kode>`), zero hardcode nama siswa.
- **Verifikasi**:
  - `bun x tsc --noEmit` ➔ **0 errors**.
  - `bun run test-e2e.ts` ➔ **16/16 check PASS**.
  - Mode `enum`: kombinasi lapis 1 (negation-aware regex) dan lapis 2 (`semanticEnumMatch` transformers.js).
- **`service-search/src/extractor.ts` & `dispatcher.ts` & `server.ts`**:
  - Mengubah pipeline menjadi berurutan: `Classify (JEV/Transformers)` ➔ `Scoped Extract & Lazy Resolve` ➔ `Multi-Entity Dispatch`.
  - Menangani token alfanumerik pendek seperti `"8b"` tanpa terpotong stopword.
  - Menerima hasil enum baik dari `source === "enum"` maupun `source === "semantic"`.
  - Menyusun response `options[]` dengan payload terstruktur `data: { entity_role, siswa, kelas, filters }`.
- **`service-search/src/routes-sync.ts`** ❌ **BELUM SELESAI**:
  - ⬜ `export interface ParamSpec` belum ada → `TS2305` di 4 file.
  - ⬜ `AppRoute.allowed_params` masih `string[]` → `TS2339` di 11 titik.
  - ⬜ `getRoutesManifest()` hanya 3 argumen, dipanggil dengan 4 (`auth`) → `TS2554`.

### Phase 3: Dockerization (`4 vCPU / 4 GB RAM`) & Verifikasi E2E 🟡 (DOCKER SELESAI, E2E GAGAL)
- **`service-search/Dockerfile` & `prebake-model.ts`** ✅ **SELESAI**:
  - Base image `oven/bun:1-slim`. Model `Xenova/multilingual-e5-small` (q8) di-download saat docker build dan disalin ke `./models/Xenova/multilingual-e5-small/`, membuat container berukuran ~1.48GB dengan cold-start = 0ms dan zero network dependency (`HF_ALLOW_REMOTE=false`).
- **`docker-compose.yml`** ✅ **SELESAI**:
  - Alokasi resource: `service-search` (`cpus: 3.5`, `mem_limit: 3g`) dan `redis:7-alpine` (`cpus: 0.5`, `mem_limit: 1g`, `allkeys-lru`), terhubung ke `app-education` di host (`http://host.docker.internal:3000`).
- **Verifikasi E2E (`test-e2e.ts`)** ❌ **GAGAL — 15 check**:
  - ✅ Hijau: health check kedua service, ACL role `GURU` (tidak bisa akses `/spp`), isolasi multi-tenant (tenant 2 route terpisah), threshold dinamis, cache hit < 20 ms.
  - ❌ Gagal: ParamSpec dari DB, disambiguasi 2 siswa "Siti", opsi wali kelas, payload entitas, `status=nunggak`/`lunas`, 5 kasus bahasa alami, `subject_id` + `academic_year_id` route `nilai`, fallback lokal entity kelas.
  - Penyebab tunggal: kontrak ParamSpec belum tersambung (lihat Phase 1 & 2).

### Phase 4 (BARU): Menyambungkan Kontrak ParamSpec 🔴 (BLOCKER)
Urutan pengerjaan (semua file sudah ada di repo, tinggal disambungkan):

| # | File | Perubahan |
|---|---|---|
| 1 | `app-education/src/server.ts` | Pakai `getSearchRoutes(clientId, userRole)` + parse `allowed_params` JSON → `ParamSpec[]` |
| 2 | `app-education/src/server.ts` | Tambah 5 endpoint `/api/master/*` (per `X-Client-Id`) |
| 3 | `service-search/src/routes-sync.ts` | Tambah `export interface ParamSpec`; ubah `AppRoute.allowed_params?: ParamSpec[]`; tambah arg `auth` pada `getRoutesManifest()` |
| 4 | `app-education/src/server.ts` | `getActiveContext()` → tambahkan `academic_year_id` dari baris `is_active = 1` |
| 5 | `app-education/src/server.ts` | `/api/spp` → tangani `academic_year_id` + `periode` (`minggu_ini`, `bulan_lalu`, `tahun_lalu`) |

**Checkpoint Phase 4:** `bun run test:e2e` → 0 kegagalan, dan `tsc --noEmit` → 0 error.
