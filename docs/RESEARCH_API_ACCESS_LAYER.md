# RISET: Lapisan Akses API JEV / Laya pada Smart Search

**Tanggal:** 2026-10-21
**Lingkup:** `service-search` (:4000) + `app-education` (:3000)
**Metode:** instrumentasi langsung + probe terukur (script di `research/`)

---

## 0. TL;DR — 7 Temuan Utama

| # | Temuan | Dampak |
|---|---|---|
| 1 | Engine AI (JEV/Laya) **tidak pernah** mengakses API bisnis. Ia hanya memutuskan **jenis aksi** (`LIST_MENU`/`DIRECT_LINK`/`REPORT_ACTION`). | Pemisahan tugas bersih: AI = klasifikasi, kode = eksekusi. |
| 2 | **1 request search = 1 panggilan API eksternal** (JEV *atau* Laya), bukan N. | Biaya & latensi terkendali. |
| 3 | Rute modul **tidak** ditanyakan ke AI. Ditentukan lokal via *keyword scoring* + ACL dari `app-education`. | AI tidak perlu tahu katalog 100+ menu. |
| 4 | JEV ~**300 ms**, Laya ~**12 ms** warm (≈25x lebih cepat), tapi Laya cold-start **282 ms** di panggilan pertama. | JEV untuk akurasi, Laya untuk kecepatan/offline. |
| 5 | Token JEV **~430 input / 42 output**, dan **90% biaya = payload `criteria`**, bukan query user. | Menambah kriteria = biaya per request naik linear. |
| 6 | `?engine=jev` dengan key invalid → **throw 401** (HTTP 500 ke user). Hanya `auto` yang punya fallback. | 🔴 Bug ketahanan. |
| 7 | Domain tak dikenal (mis. "jadwal ekstrakurikuler") → **diam-diam diarahkan ke `/siswa`**. Tidak ada sinyal "tidak ditemukan". | 🟡 Salah arah tanpa peringatan. |

---

## 1. Peta Call-Site: Di Mana Persisnya JEV/Laya Dipanggil

Semua akses engine terisolasi di **satu file**: `service-search/src/classifier.ts`.

| Baris | Simbol | Peran |
|---|---|---|
| `152` | `const endpoint = "https://api.typesafe.ai/v1/systemone"` | Satu-satunya URL cloud |
| `150` | `classifyWithJev(query, apiKey)` | Panggilan JEV (POST JSON, 1x per query) |
| `79` | `layaEndpoint = "http://127.0.0.1:4141"` | Satu-satunya URL lokal |
| `77` | `classifyWithLaya(query, endpoint)` | Panggilan Laya (1x query embed + cache anchor) |
| `30-72` | `getOrInitAnchorEmbeddings()` | 1x batch embed saat cold start (3 intent), lalu di-cache di memori proses |
| `203-223` | `classifyIntent(query, engine)` | Orkestrator: pilih JEV / Laya / auto-fallback |

### Yang **TIDAK** dipanggil ke AI
- Katalog route / menu → diambil dari `GET app-education/api/routes` (di-cache Redis).
- Filter SQL → dibangun lokal, dieksekusi SQLite.
- Hak akses role → SQL `job ⋈ acl ⋈ groups`.

> Kesimpulan: **AI tidak pernah "mengakses API"**. AI hanya mengembalikan *label intent + probabilitas*. Semua akses API terjadi di lapisan kode deterministik setelahnya.

---

## 2. Alur Lengkap 1 Request (dengan jumlah call)

```
POST /api/search?q="lihat siswa nunggak kelas 8B"
│
├─ [1] Redis GET  smartsearch:q:1:KEUANGAN:jev:<query>        ~0.5 ms
│      └─ HIT? → selesai (0 panggilan AI)                       ← ~80% trafik
│
├─ [2] MISS → paralel:
│      ├─ JEV  POST api.typesafe.ai/v1/systemone               ~300 ms   ◀ 1 API EKSTERNAL
│      └─ Redis GET smartsearch:routes:1:KEUANGAN               ~0.5 ms
│             └─ MISS → GET app-education/api/routes (SQL ACL)   ~7 ms
│
├─ [3] extractParams(query)  — regex murni, 0 I/O                ~0.05 ms
├─ [4] dispatchAction(...)   — keyword scoring lokal, 0 I/O      ~0.1 ms
│
└─ [5] Redis SET  hasil (TTL 1800 s)                            ~0.5 ms
```

**Total panggilan API eksternal per search (cache miss): 1.**
**Total panggilan API eksternal per search (cache hit): 0.**

---

## 3. Kontrak API Terukur

### 3.1 TypeSafe JEV — `POST https://api.typesafe.ai/v1/systemone`

**Request** (persis seperti di `classifier.ts:156-176`):
```json
{
  "model": "jev-latest",
  "state": "lihat siswa nunggak kelas 8B",
  "questions": {
    "intent": {
      "type": "choice",
      "instructions": "Determine the user's intended smart search action in an education school management system.",
      "criteria": {
        "LIST_MENU": "User is looking for static navigation menus or settings (e.g. 'ke menu spp', 'menu profil').",
        "DIRECT_LINK": "User wants to view a specific filtered data table or deep link (e.g. 'lihat siswa nunggak kelas 8B', 'data nilai matematika').",
        "REPORT_ACTION": "User wants to generate, print, or download a report card / rapot document (e.g. 'cetak rapot kelas 8B', 'unduh rapot budi format pdf')."
      }
    }
  }
}
```
Header: `Authorization: Bearer $TYPESAFE_API_KEY`

**Response** (terverifikasi live):
```json
{
  "model": "jev-1.13.0",
  "answers": {
    "intent": {
      "type": "choice",
      "choice": "DIRECT_LINK",
      "confidence": 1,
      "probabilities": { "LIST_MENU": 0, "DIRECT_LINK": 1, "REPORT_ACTION": 0 }
    }
  },
  "usage": { "input_tokens": 434, "output_tokens": 42 }
}
```
> Catatan: field `model` di respons mengembalikan versi terkunci (`jev-1.13.0`), bukan string `jev-latest`.

### 3.2 Laya — `POST http://127.0.0.1:4141/embed`

**Request:** `{ "texts": ["lihat siswa nunggak kelas 8B"] }`
**Response:** `{ "embeddings": [[...768 float]] }`

Perhitungan lokal (`classifier.ts:110-140`):
1. Cosine similarity (dot product, vektor sudah ternormalisasi) query vs **semua** anchor.
2. Ambil **rata-rata top-3** skor per kategori.
3. **Softmax dengan temperature T = 0.05** → probabilitas.

---

## 4. Angka Terukur (hardware: Apple Silicon, lokal)

### 4.1 Latensi per komponen

| Komponen | avg | range | Catatan |
|---|---|---|---|
| JEV `systemone` | **357.6 ms** | 304 – 461 ms | 3 run; 1 call pertama paling lambat (TLS handshake) |
| Laya `/embed` (query) | **67.4 ms** | 12.3 – 282.3 ms | run#1 = 282 ms (model load), run#2-5 = **12–17 ms** |
| Laya `/embed` (batch anchor) | 70.3 ms | — | **hanya sekali** saat cold start proses |
| `GET /api/routes` (SQL ACL 3 tabel) | 6.9 ms | — | setelah itu di-cache Redis 30 menit |
| `GET /api/spp` (SQLite query) | 1.2 ms | — | — |
| `GET /api/rapot/download` | 0.7 ms | — | pembuatan file mock |

**Rasio JEV ÷ Laya (warm) ≈ 25x.**

### 4.2 End-to-end `/api/search`

| Skenario | Latensi |
|---|---|
| Cache **MISS** via JEV | 286.0 ms |
| Cache **HIT** (Redis) | **3.6 ms** |
| Cache **MISS** via Laya | 208.1 ms |

### 4.3 Throughput konkurensi (diukur nyata)

| Beban | Total waktu | Sukses | Throughput |
|---|---|---|---|
| 50x **cache hit** | 14.3 ms | 50/50 | **≈ 3.504 rps** |
| 10x **JEV asli** (query unik) | 328.9 ms | 10/10 | ≈ 30 rps |
| 20x **Laya asli** (query unik) | 246.7 ms | 20/20 | ≈ 81 rps |

> **Rasio cache-hit vs JEV ≈ 117x.** Inilah yang membuat 1.000+ user serentak layak: mayoritas trafik tidak menyentuh AI sama sekali.

---

## 5. Model Biaya JEV — Temuan Penting

| Query | input_tokens | output_tokens | Latensi |
|---|---|---|---|
| `buka menu pembayaran spp` | 430 | 42 | 265.6 ms |
| `lihat siswa nunggak kelas 8B` | 434 | 42 | 222.6 ms |
| `cetak rapot kelas 8B semester ganjil` | 437 | 42 | 312.0 ms |
| `halo apa kabar` | 429 | 42 | 277.3 ms |
| `berapa total tunggakan bulan ini` | 432 | 42 | 336.3 ms |
| `unduh rapor budi format pdf` | 433 | 42 | 237.3 ms |

**Input token hampir konstan (~430) berapapun panjang query.**
Artinya: **~400 token adalah blok `criteria`**, hanya ~30 token milik user.

> ⚠️ **Implikasi arsitektural:** jika katalog 60 menu dijadikan `criteria` JEV (1 kriteria per menu), input token meledak ke **≈ 8.400 token/request** (≈20x). Karena itu keputusan saat ini — *JEV hanya klasifikasi 3 intent, pemilihan menu dilakukan lokal* — **sudah tepat** dan harus dipertahankan.

---

## 6. Matriks Failure Mode (diuji)

| Kondisi | `engine=auto` | `engine=jev` | `engine=laya` |
|---|---|---|---|
| Semua normal | JEV (234 ms) | JEV | Laya |
| `TYPESAFE_API_KEY` **invalid** (401) | ✅ fallback Laya, **378.6 ms** (240 ms JEV gagal + 139 ms Laya) | 🔴 **THROW** → HTTP 500 | ✅ Laya |
| `TYPESAFE_API_KEY` kosong | ✅ Laya | ✅ Laya (guard `&& apiKey`) | ✅ Laya |
| Laya daemon mati | 🔴 tetap throw di *catch* → error | — | 🔴 error |
| Redis mati | ✅ fallback in-memory Map | ✅ | ✅ |
| `app-education` mati | ✅ route fallback hardcoded | ✅ | ✅ |

**Penalti fallback: +240 ms** (waktu tunggu JEV gagal) sebelum Laya menjawab.

---

## 7. Celah Arsitektur yang Ditemukan

### 🔴 K1 — `engine=jev` tidak punya fallback
`classifier.ts:205-207` mengembalikan hasil JEV **tanpa** `try/catch`. Key kedaluwarsa / rate-limit → user melihat HTTP 500.
*Bukti:* `jev → THROW JEV request failed with HTTP 401 (239.94ms)` vs `auto → OK engine=LAYA_LOCAL 378.65ms`.

### 🟡 K2 — Domain tak dikenal diarahkan diam-diam ke `/siswa`
`dispatcher.ts:99`: `let selectedRoute = candidateRoutes.find(r => r.id === "siswa") || dynamicRoutes[0]` → default selalu siswa.
*Bukti:*
```
"tampilkan jadwal ekstrakurikuler kelas 8B"  →  /siswa?kelas=8B   ← salah, tanpa peringatan
```
Tidak ada intent `NO_MATCH`/`OUT_OF_SCOPE`, tidak ada penanda `low_confidence`.

### 🟡 K3 — Taksonomi tidak punya kelas "di luar cakupan"
Query `"halo apa kabar"` → `LIST_MENU` dengan confidence **0.99**. Sistem tidak bisa menolak query non-domain; ia memaksa memilih salah satu dari 3.

### 🔵 K4 — `confidence` ≠ probabilitas kelas terpilih
`classifier.ts:181` memakai `answer.confidence`, sedangkan `probabilities[choice]` bisa berbeda:
```
"halo apa kabar"              → confidence 0.98  vs  probs[LIST_MENU] 0.99
"berapa total tunggakan..."   → confidence 0.91  vs  probs[DIRECT_LINK] 0.94
```
Tidak salah, tapi dokumentasi/UI harus konsisten memilih satu sumber.

### 🔵 K5 — Bobot keyword masih hardcoded
`dispatcher.ts:107` memuat daftar domain berbobot 5 (`nunggak`,`tagihan`,`spp`,`bayar`,`nilai`,`ulangan`,`akademik`). Modul baru di luar daftar ini hanya dapat bobot 1, sehingga mudah kalah dari modul lama.

*Bukti katalog uji + modul PERPUSTAKAAN:*
```
"data nilai matematika kelas 8B"          → /nilai?kelas=8B&mapel=Matematika   ✅
"lihat siswa nunggak kelas 8B"            → /spp?status=nunggak&kelas=8B       ✅
"lihat daftar buku perpustakaan kelas 8B" → /perpustakaan?kelas=8B             ✅ (bobot 1, menang karena tak ada pesaing)
"tampilkan jadwal ekstrakurikuler..."     → /siswa?kelas=8B                    ❌ silent wrong
```

---

## 8. Rekomendasi Berprioritas

### P0 — Pertahanan produksi
1. Bungkus `classifyWithJev` dengan `try/catch` **juga pada cabang `engine=jev`**, agar `?engine=jev` turun ke Laya saat 401/timeout (bukan 500).
2. Tambah `AbortSignal.timeout(3000)` pada panggilan JEV — saat ini tidak ada timeout eksplisit, request bisa menggantung.
3. Cache **negatif** singkat (30–60 s) untuk hasil fallback agar tidak menembak JEV yang sedang down berulang kali.

### P1 — Kualitas hasil
4. Tambah intent ke-4 `OUT_OF_SCOPE` di `criteria` JEV (biaya: +~140 token, tetap < 600).
5. Jika tidak ada route yang cocok dan `maxScore === 0` → kembalikan `mode: "NO_MATCH"` + saran menu, jangan default ke `/siswa`.
6. Pindahkan daftar `domain berbobot 5` dari `dispatcher.ts` ke properti manifest, mis. `weight` / `boost_keywords` per route di `app-education`.

### P2 — Efisiensi
7. Lakukan **warm-up Laya** saat service start (`POST /embed` dummy) untuk menghapus penalti cold-start 282 ms.
8. Pertimbangkan **routing berjenjang**: rule/regex cepat → jika yakin, lewati JEV (hemat token); hanya query ambigu yang ke JEV.
9. Pantau `usage.input_tokens` per request; jika naik drastis, ada yang menambah kriteria.

---

## 9. Cara Mereproduksi Riset

```bash
# prasyarat: Redis + Laya daemon (:4141) hidup, TYPESAFE_API_KEY tersedia
redis-cli flushdb
nohup bun run service-search/src/server.ts   > /tmp/ss.log  2>&1 &
nohup bun run app-education/src/server.ts    > /tmp/app.log 2>&1 &
sleep 2

bun run research/api-access-layer.ts     # latensi, cache hit/miss, konkurensi
bun run research/probe-jev-contract.ts   # kontrak JEV + token + confidence vs probs
bun run research/probe-routing-gap.ts    # perilaku routing manifest dinamis
TYPESAFE_API_KEY=sk-invalid bun run research/probe-cost-fallback.ts fallback  # failure mode
```

---

## 10. Kesimpulan

Pemisahan tugas pada POC ini sudah benar dan sesuai praktik terbaik:

- **JEV / Laya = lapisan keputusan** (1 panggilan eksternal, ±300 ms / ±12 ms).
- **Kode deterministik = lapisan eksekusi** (routing ACL, deep link, SQL).

Kekuatan utama bukan pada kecepatan model, melainkan pada **Redis di depannya**: 3.504 rps saat cache hit vs 30 rps saat menembak JEV. Untuk target ribuan user serentak, kombinasi *JEV + cache 30 menit + routing lokal* adalah konfigurasi yang tepat — dengan catatan P0 (fallback & timeout) wajib diperbaiki sebelum produksi.
