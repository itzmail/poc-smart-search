# Rencana Peningkatan Klasifikasi & Ekstraksi Smart Search

**Status dokumen:** rencana (belum ada perubahan kode produksi)
**Terakhir diperbarui:** sesi diskusi klasifikasi/ekstraksi
**Lokasi proyek:** `poc-smart-search`
**Terkait:** [`docs/POC_SMART_SEARCH.md`](./POC_SMART_SEARCH.md)

Legenda status:

| Marker | Arti |
|---|---|
| ✅ | sudah terimplementasi dan terverifikasi |
| ⚠️ | temuan / perilaku bermasalah hari ini |
| 📋 | rencana, belum dikerjakan |
| ❌ | tidak bisa dilakukan (dengan alasan teknis) |

---

## 1. Ringkasan keputusan (satu halaman)

1. **AI hanya untuk niat (intent) dan modul (target_route).** Tidak untuk menghasilkan ID.
2. **Tipe entitas ditentukan DATA, bukan model.** Model tidak tahu "Siti" itu siswa atau guru — database yang tahu.
3. **Usulan "JEV melabeli slot" DIBATALKAN.** Alasan: taksonomi label hardcode, tidak terhubung kapabilitas data, dan sebagian label tidak punya tabel (mis. guru).
4. **Langkah yang paling berdampak belum ada: verifikasi ke API.** Tanpa ini, nilai salah tampil sebagai jawaban sah.
5. **Gemma tidak masuk jalur permintaan.** Perannya: pabrik data offline (alias, lexicon, goldens, penambang pola).
6. **transformers.js bukan pengganti pemahaman bahasa.** Peran utamanya: semantic cache (potong tagihan JEV) dan fallback intent.
7. **Payload JEV tetap 2 pertanyaan** (intent + target_route) → biaya tidak naik walau kualitas naik.

---

## 2. Kondisi sekarang (terverifikasi dari kode)

### 2.1 Alur `GET /api/search`

```text
service-search/src/server.ts
  :120-126  cek cache jawaban (Redis) → early return
  :130-133  Promise.all([ getRoutesManifest, resolveEntities ])
  :138-142  classifyIntent(query, engine, routes)  → JEV
  :141      routes dipetakan HANYA { id, title, description, path }
  :145-147  selectedRoute = manifest.routes.find(id === target_route)
  :148-152  extractParams(query, { allowedParams, activeContext })
  :153-161  dispatchAction(query, classification, params, routes, entities, threshold, activeContext)
  :163      response.latency_ms
```

### 2.2 Payload JEV (aktual)

```json
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <TYPESAFE_API_KEY>

{
  "model": "jev-latest",
  "state": "<query asli>",
  "questions": {
    "intent": {
      "type": "choice",
      "criteria": {
        "LIST_MENU":     "…",
        "DIRECT_LINK":   "…",
        "REPORT_ACTION": "…"
      }
    },
    "target_route": {
      "type": "choice",
      "criteria": {
        "<route_id>": "Menu \"<title>\" di path <path>: <description>"
      }
    }
  }
}
```

| Fakta | Bukti |
|---|---|
| Kriteria `intent` hardcode (enum sistem, disengaja) | `classifier.ts:162-172` |
| Kriteria `target_route` dinamis dari DB | `classifier.ts:175-186` |
| Template route hanya 3 field | `classifier.ts:178` |
| `keywords` & `supported_intents` **dibuang** sebelum dikirim | `server.ts:141` |
| Fallback diam-diam: `choice \|\| "LIST_MENU"`, `confidence ?? 1` | `classifier.ts` (~parse answer) |
| Endpoint Laya hardcode `127.0.0.1:4141` | `classifier.ts:81` |

**Biaya terukur** (dari sesi pengujian): 2 pertanyaan/4 modul = **547 token in / 88 out**, 225–357 ms (benchmark 25 Okt 2026: rata-rata 272.1 ms).
4 pertanyaan = 743 in / 147 out (+36% input, latensi tidak naik).

### 2.3 Aturan ekstraksi sekarang (`extractor.ts`, 113 baris)

| Param | Pola yang dikenali | Catatan |
|---|---|---|
| `kelas` | `7A`, `8B`, `kelas 8`, `kelas 10` | angka saja; "delapan B" gagal |
| `semester` | ganjil/1, genap/2 | ✅ |
| `status` | nunggak / belum lunas / lunas / aktif | ✅ |
| `mapel` | matematika, IPA, IPS, B.Indo, B.Inggris (+sinonim) | ✅ |
| `format` | pdf / excel / xlsx / csv / cetak / print | ✅ |
| `nama` | **wajib kata pemicu**: `siswa\|nama\|murid` + nama | `extractor.ts:78` |
| `periode` | `hari ini`, `bulan ini`, `tahun ini` | `extractor.ts:88-95` — hanya label |
| `academic_year_id` | **hanya** "tahun ajaran ini/sekarang/saat ini" | `extractor.ts:101` — nilai dari `active_context` |

`ExtractOptions.allowedParams` = Route-Scoped Lazy Extraction (regex hanya jalan untuk param route terpilih).

### 2.4 Endpoint app-education yang tersedia

| Endpoint | Ada? | Param yang dibaca |
|---|---|---|
| `GET /api/routes` | ✅ | — (manifest + `active_context`) |
| `GET /api/master/resolve?q=` | ✅ | hanya `q` (tipe: `kelas`, `invoice`, `siswa`, `agregasi`) |
| `GET /api/dashboard` | ✅ | — |
| `GET /api/siswa` | ✅ | `kelas`, `kelas_id`, `status`, `q` |
| `GET /api/siswa/:id` | ✅ | — |
| `GET /api/kelas/:id` | ✅ | — |
| `GET /api/spp` | ✅ | `status`, `kelas`, `kelas_id`, `periode`, `academic_year_id` |
| `GET /api/spp/invoice/:id` | ✅ | — |
| `GET /api/rapot`, `/api/rapot/download` | ✅ | — |
| **`academic_year` (daftar/resolve)** | ❌ | tabel ada, endpoint tidak |

Tabel `academic_year` **ada** (`db.ts:42`) dengan kolom `id, name, semester, start_date, end_date, is_active, client_id`.

`allowed_params` per job (seed `db.ts:174-184`):

| Job | allowed_params |
|---|---|
| J01 dashboard | `[]` |
| J02 siswa | `kelas, status, academic_year_id, q` |
| J03 nilai | `kelas, semester, mapel, academic_year_id` |
| J04 spp | `kelas, status, periode, academic_year_id, invoice_id` |
| J05 rapot | `kelas, semester, format, nama` |
| J06 kelas | `id, tingkat` |

### 2.5 Data model yang belum mendukung fitur

| Butuh | Kenyataan | Akibat |
|---|---|---|
| Nama guru / wali murid sebagai entitas | tidak ada tabel `master_guru`; `wali_kelas` hanya **kolom teks** di `master_kelas` (`db.ts:90`) | "anak bu Siti" mustahil; tidak ada ID untuk difilter |
| Rentang tanggal periode | `/api/spp` hanya menangani `periode=hari_ini` & `bulan_ini` | `periode=tahun_ini` **diabaikan diam-diam** |
| Tahun ajaran selain yang aktif | tidak ada endpoint daftar/resolve | "TA 2025/2026" mustahil |

---

## 3. Temuan (F = finding)

| # | Temuan | Bukti | Dampak | Pemilik |
|---|---|---|---|---|
| **F1** | Tidak ada langkah verifikasi nilai sebelum menyusun URL | grep `validate\|isValid` di `service-search/src` = 0; `dispatcher.ts:242-247` langsung `qParams.set` | "kelas 99" → tabel kosong disajikan sebagai jawaban sah | service-search |
| **F2** | Fallback diam-diam memberi keyakinan palsu | `choice \|\| "LIST_MENU"`, `confidence ?? 1` | JEV tanpa jawaban dianggap conf 1.0 | service-search |
| **F3** | `keywords` tidak dikirim ke JEV | `server.ts:141` memotong; `classifier.ts:178` tak memakai | "syahriah/tunggakan/beranda" tak dikenali | service-search |
| **F4** | `supported_intents` tidak dikirim & tidak divalidasi silang | idem + tidak ada cek `intent ∈ route.supported_intents` | bisa terjadi `REPORT_ACTION` → route `spp` | service-search |
| **F5** | `periode=tahun_ini` diterima extractor, diabaikan API | `extractor.ts:94` vs `/api/spp` hanya `hari_ini`/`bulan_ini` | filter waktu hilang tanpa pesan | app-education |
| **F6** | "tahun ini" tidak pernah jadi `academic_year_id` | `extractor.ts:101` hanya cocok "tahun ajaran ini" | hasil = semua tahun | service-search |
| **F7** | Tabel `academic_year` ada, endpoint tidak ada | `db.ts:42` vs inventaris endpoint | "2026/2027" tak bisa diresolusi | app-education |
| **F8** | Tak ada entitas guru/orang tua | `db.ts:90` (`wali_kelas` TEXT) | relasi guru→siswa mustahil | app-education (model data) |
| **F9** | `resolve` tanpa param `type`; nama siswa wajib kata pemicu | `server.ts:124-129`, `:223` | verifikasi menghasilkan false negative/positive | app-education |
| **F10** | Semua modul dikirim ke JEV | `server.ts:141` | biaya naik linear dgn jumlah modul (±25 token/modul) | service-search |
| **F11** | Manifest cold + fetch gagal → throw (tanpa snapshot) | `routes-sync.ts:112` | app-education mati = search 503 walau cache kosong seharusnya bisa fallback | service-search |
| **F12** | Belum ada `/metrics`, limiter, breaker, backpressure | tidak ada di `service-search/src` | tidak bisa dioperasikan di produksi | service-search |
| **F13** | `resolve` memakai `LIKE '%…%'` tanpa indeks | `server.ts:174` | data master besar → full scan | app-education |
| **F14** | Endpoint Laya hardcode & MLX tidak ada di Linux | `classifier.ts:81` | container Linux tidak bisa pakai Laya | service-search |

---

## 4. Pertimbangan pemakaian LLM / model (bagian yang diminta dicatat)

### 4.1 Pembagian peran yang disepakati

| Alat | Peran | Alasan | Di jalur permintaan? |
|---|---|---|---|
| **JEV** | intent, target_route, (opsional) penjaga luar-domain | semantik murni, tak ada padanan data | ✅ ya (hanya pada cache miss) |
| **Regex** | menemukan kandidat + nilai pasti | 0 ms, deterministik, jadi fallback | ✅ ya |
| **API app-education** | menentukan **tipe** entitas + ID resmi + verifikasi | pemilik data | ✅ ya |
| **transformers.js** | semantic cache, fallback intent, fuzzy nilai | butuh kemiripan, bukan pemahaman | 📋 nanti |
| **Laya (MLX/ONNX)** | prototipe classifier lokal + fallback | pengganti JEV saat cloud mati | 📋 opsional |
| **Gemma (llama.cpp)** | **offline saja** — pabrik data & eval | RAM/latensi tidak layak di request path | ❌ tidak |

### 4.2 Mengapa usulan "JEV melabeli slot" dibatalkan

Usulan awal: regex menemukan potongan → JEV memilih label (`TAHUN_AJARAN`, `NAMA_GURU`, dst) → API mengubah jadi ID.

Alasan pembatalan (semua terverifikasi):

1. **Taksonomi label hardcode** — sama kelasnya dengan enum intent, padahal ini kosakata dunia nyata, bukan kosakata sistem.
2. **Sebagian label tidak punya data pendukung** — `NAMA_GURU` mustahil (F8); `TAHUN_KALENDER` ambigu by design.
3. **Keputusan tipe sudah ada di data** — `/api/master/resolve` mengembalikan `type` dari tabel yang cocok. Model tidak perlu menebak.
4. **Melabeli tanpa data = keyakinan tanpa bukti** — model bisa benar, tapi tidak ada cara memverifikasi asalnya.
5. **Membuat pertanyaan slot bergantung pada route = melingkar** — `allowed_params` baru diketahui setelah JEV menjawab.

**Prinsip pengganti:**

> "AI tidak menyentuh data, data tidak menyentuh AI." Tipe & ID = tugas pemilik data.

### 4.3 Rantai yang benar (tipe dari data)

```text
span hasil regex (mis. "2026/2027", "bu siti", "8b")
   │
   ├─ [1] COCOKKAN TABEL     : academic_year.name / master_kelas.code
   │        cocok → pakai ID resmi                        (0 AI)
   ├─ [2] TABEL WAKTU        : "tahun ini" → active_context.academic_year_id
   │        cocok → pakai ID                              (0 AI)
   ├─ [3] LEXICON/ENUM       : status, semester, mapel, format
   │        cocok → pakai nilai enum                      (0 AI)
   └─ [4] TIDAK ADA YANG COCOK
            → JANGAN menebak; tawarkan pilihan ke user    (0 AI)
```

AI hanya muncul **sebelum** rantai ini (intent + route), bukan di dalamnya.

### 4.4 Anggaran sumber daya (container Linux)

Target awal: 2 core / 2 GB. Setelah diskusi: boleh 5 s latensi, dan RAM dapat dinaikkan ke 4 GB.

| Skenario | vCPU | RAM | Model | Latensi | Layak? |
|---|---|---|---|---|---|
| A. Tanpa LLM runtime | 2–4 | 2–4 GB | — (+ Laya int8 opsional) | 15–120 ms | ✅ paling aman |
| B. LLM kecil (0,6–1,7B Q4) | 4 | 4 GB | Qwen3-0.6B / 1.7B | 0,8–3 s | ⚠️ akurasi harus diukur |
| C. Gemma E4B Q4 + prefix cache | **8** | **8 GB** | E4B Q4_K_M | 2–5 s | ⚠️ batas, hanya untuk fallback |
| D. Gemma E4B Q8 | 8 | 16 GB | E4B Q8_0 | 4–9 s | ❌ tidak disarankan di CPU |
| E. Gemma + GPU (T4/A10) | 4 | 8 GB | E4B Q4/AWQ | <1 s | ✅ tapi berbiaya |

Estimasi rinci (bukan hasil ukur):

```text
Gemma E4B, Linux CPU x86, prompt ~900 tok, output ~80 tok
  2 vCPU / 4 GB : prefill 7–13 s + generate 5–10 s = 12–25 s
  4 vCPU / 8 GB : prefill 4–7 s  + generate 5–10 s =  9–17 s
  8 vCPU / 8 GB : prefill 2–4 s  + generate 4–8 s  =  6–12 s
  8 vCPU + prefix cache                           =  4–9 s
```

Catatan penting:

- **Prefill naik ~linear dengan core; generate terikat memory bandwidth.** Karena itu 4 core tidak menyelamatkan gemma E4B.
- **Prefix cache** (instruksi + skema JSON konstan) memangkas ~80% prefill, tapi **tidak** menyentuh generate.
- **Throughput**: satu instance llama.cpp melayani ~1 request sekaligus (kecuali `--parallel`). Pada 2 s/request → ~0,5 req/s. Karena itu LLM **wajib** hanya dipanggil ketika regex + data gagal.

**Kesimpulan spec:**

```text
Gemma E4B di request path  : 8 vCPU / 8 GB (Q4) atau 8 vCPU / 16 GB (Q8) — CPU tetap lambat
Gemma E4B nyaman           : GPU (T4/A10) + 4 vCPU / 8 GB
Masuk 5 s dengan murah     : 4 vCPU / 4 GB + model 0,6–1,7B, atau tanpa LLM
```

### 4.5 Peran Gemma yang disepakati: pabrik data offline

```text
[1] kumpulkan 300–500 query nyata (atau dibuat Gemma sendiri)
[2] Gemma melabeli offline (suhu 0, JSON ketat, enable_thinking:false)
[3] manusia review ~30 sampel
[4] hasilnya jadi artefak deterministik:
      a. goldens        → set uji regresi
      b. alias/lexicon  → "syahriah"→spp, "gasal"→ganjil, "taun iki"→tahun ini
      c. celah regex    → pola baru yang harus ditambah
      d. (opsional) data latih classifier kecil
[5] runtime tetap: regex + data API + JEV  → 0 MB tambahan, 0 risiko
```

Keuntungan: kemampuan bahasa Indonesia Gemma tetap dipakai, tapi risiko (halusinasi ID, non-determinisme, RAM) hilang. Juga memenuhi aturan "orang lain tanpa Gemma tidak boleh gagal".

### 4.6 Peran transformers.js yang sah

| Peran | Bisa? | Nilai |
|---|---|---|
| Semantic cache (cosine ≥ 0,95) | ✅ tanpa data latih | ⭐⭐⭐ potong tagihan JEV |
| Fallback intent saat JEV mati | ✅ cukup 3 kelas | ⭐⭐ ketahanan |
| Fuzzy match nilai (typo) | ✅ tapi **lebih tepat di API** | ⭐ |
| Melabeli slot | ❌ butuh NER head + data latih | — |
| Menghasilkan teks | ❌ bukan model generatif | — |

Spesifikasi: `@huggingface/transformers` (~10 MB) + `onnxruntime-node`, model ONNX `intfloat/multilingual-e5-small` (~120 MB int8, ~150–250 MB RAM, 15–60 ms/teks). Model **wajib dibakar ke image**, tidak unduh saat runtime.

### 4.7 Payload JEV rencana

Perubahan minimum, biaya tetap:

```text
questions.intent        : tetap 3 kriteria (enum sistem)
questions.target_route  : template jadi
   `Menu "<title>" di path <path>: <description> [kata kunci: a, b] [mendukung: LIST_MENU, DIRECT_LINK]`
questions.relevansi     : OPSIONAL, 2 kriteria (RELEVAN / TIDAK_RELEVAN) → penjaga luar-domain
```

Aturan payload:

| Aturan | Alasan |
|---|---|
| Nilai yang sudah pasti dari regex **tidak dikirim** | tak perlu ditanyakan |
| Data master / ID **tidak pernah dikirim** | biaya + risiko halusinasi |
| `state` = query asli (tidak dinormalisasi) | normalisasi menghapus konteks |
| Maks 1 pertanyaan tambahan (relevansi) | jaga token & akurasi System One |
| Shortlist modul bila > 20 modul | jaga biaya tetap |

Token: **547–650 in / 88–110 out**.

---

## 5. Rencana kerja (P = plan)

> **Status terverifikasi 26 Okt 2026.** Kontrak ParamSpec (P0) dan endpoint master terkait telah **SELESAI 100% dan Lulus E2E 16/16**. Detail status ada di [`POC_SMART_SEARCH.md` Section 18–21](POC_SMART_SEARCH.md).

| # | Plan | Isi | File | Ukuran | Risiko | Menutup | Status |
|---|---|---|---|---|---|---|---|
| **P0** | **Sambungkan kontrak `ParamSpec` & Endpoint Master** | `app-education` pakai `getSearchRoutes()`, endpoint `/api/master/*`, `interface ParamSpec` di `routes-sync.ts`, `auth` pada `getRoutesManifest()`, `academic_year_id` di `active_context`, filter `academic_year_id`+`periode` di `/api/spp`, token exclusion, & contextual extraction | `app-education/src/server.ts`, `service-search/src/{routes-sync,lazy-resolver,extractor,local-model}.ts` | ~250 baris | rendah | ⛔ Blocker E2E | ✅ **SELESAI (16/16 E2E PASS)** |
| **P1** | `keywords` + `supported_intents` ke JEV + validasi silang | teruskan 2 field, ubah template, tolak `intent ∉ route.supported_intents` | `server.ts:141`, `classifier.ts:178`, validasi baru | ~15 baris | rendah | F3, F4 | 📋 siap dikerjakan |
| **P2** | Hentikan fallback diam-diam | `degraded: true`, `confidence: 0` bila tanpa `choice` | `classifier.ts` | ~5 baris | rendah | F2 | 📋 siap dikerjakan |
| **P3** | **Verifikasi sebelum menjawab** (paling berdampak) | nilai param ∈ `allowed_params` dikirim ke `resolve`; 1 entitas → pakai `id`; 0 → klarifikasi; >1 → opsi; API mati → `unverified` | `verify.ts` baru + `server.ts` | ~80 baris | rendah | F1 | 🟡 sebagian (sudah tertangani di lazy-resolver) |
| **P4** | Tabel normalisasi waktu | data `time-expressions.json` + pemakaian di extractor; "tahun ini" → `active_context` | 1 file data + `extractor.ts` | ~40 baris | rendah | F6 | ✅ selesai via timeHints & dynamic active_context |
| **P5** | Cek ketahanan manifest | snapshot terakhir + 503 jujur, bukan throw | `routes-sync.ts:112` | ~20 baris | rendah | F11 | 📋 siap dikerjakan |
| **P6** | Shortlist modul | top-10 sebelum JEV (kata kunci / embedding) | `classifier.ts` / modul baru | ~50 baris | rendah | F10 | 📋 siap dikerjakan |
| **P7** | Observability + perlindungan | `/metrics` (hit-rate, p95, JEV call, breaker state), normalisasi cache key, limiter, breaker | modul baru | ~120 baris | sedang | F12 | 📋 siap dikerjakan |
| **P8** | Semantic cache | transformers.js + Redis vektor | modul baru | ~150 baris | sedang | biaya | 📋 siap dikerjakan |
| **P9** | Endpoint `academic_year` + `type` di resolve | kontrak API + implementasi | app-education | ~40 baris | sedang | F7, F9 | ✅ selesai (`/api/master/academic-years`) |
| **P10** | Perbaikan `periode` di `/api/spp` | filter `academic_year_id` + semua variasi periode | app-education | ~30 baris | rendah | F5 | ✅ selesai |

### Prasyarat (blocker)

| Plan | Diblokir oleh |
|---|---|
| Verifikasi nilai tahun ajaran | P0/P9 (`/api/master/academic-years` endpoint) |
| "anak bu Siti" | perubahan **model data** app-education (F8) |
| P8 semantic cache | angka hit-rate dari P7 |

### Urutan yang disarankan

```text
P0 → P2 → P1 → P3 → P4 → P5 → P7 → (ukur) → P6/P8 bila data menuntut → P9/P10 (app-education)
```

Alasan: **P0 dulu** — tanpa sambungan kontrak, semua plan lain tidak bisa diverifikasi end-to-end (15 check E2E masih gagal). Setelah itu P1–P5 menaikkan kualitas tanpa komponen baru; P7 menghasilkan angka sebelum menambah apa pun.

### Definisi selesai (checkpoint)

1. 30 query uji (termasuk kasus gagal yang terdokumentasi) dijalankan sebelum & sesudah.
2. "kelas 99" → klarifikasi, bukan tabel kosong.
3. "tagihan tahun ini" → URL membawa `academic_year_id` yang benar.
4. Query tanpa `choice` dari JEV → `degraded`, bukan conf 1.0.
5. `/metrics` menampilkan hit-rate, p95, jumlah panggilan JEV, status breaker.
6. Tidak ada hardcode Gemma/9931/llama di `service-search/src`, `app-education/src`, `test-e2e.ts`.
7. **Checkpoint tambahan (P0):** `bun run test:e2e` → 0 kegagalan, `tsc --noEmit` → 0 error.

---

## 6. Yang masih lemah dari sisi produksi (diakui, belum tertutup)

| Area | Kelemahan | Dampak |
|---|---|---|
| **Throughput JEV** | ~225–357 ms/panggilan; 1.000 RPS tanpa cache = ~400 in-flight + biaya sangat besar | butuh hit-rate cache 90–95% |
| **Ketahanan** | belum ada limiter, timeout terpusat, circuit breaker, backpressure | JEV lambat → thread habis |
| **Observability** | belum ada `/metrics`, tidak ada tracing per tahap | tidak bisa dioperasikan |
| **Cache** | kunci cache belum dinormalisasi (huruf, spasi, sinonim) | hit-rate rendah |
| **Topologi** | `app-education` di luar container → `host.docker.internal`, +1–3 ms, perlu snapshot (P5) | F11 |
| ~~**Laya**~~ | ✅ **TERSELESAI** — daemon Python `127.0.0.1:4141` diganti `transformers.js` in-process (`@huggingface/transformers`, ONNX q8). Model di-bake ke image → jalan di Linux ✅ | F14 tertutup |
| **Isolasi tenant** | verifikasi & resolve wajib memakai `X-Client-Id`; terisolasi di level cache & ACL, tapi belum diuji lintas tenant pada jalur lazy | risiko kebocoran data |
| **Data master besar** | `LIKE '%…%'` tanpa indeks (F13) | resolve melambat |
| **Uji beban** | belum ada skenario A/B/C/D (cache-hit, 10% miss, JEV mati, Redis mati) | kapasitas belum terbukti |
| **Keamanan** | log query bisa memuat PII (nama siswa); belum ada redaksi | kepatuhan |
| **Deploy** | `docker-compose.yml` + healthcheck + `restart: unless-stopped` sudah ada ✅; belum ada manifest Kubernetes / pipeline CI | belum bisa dirilis |
| **Multi-bahasa** | sinonim/daerah hanya via lexicon (belum ada isinya) | cakupan rendah |
| **Sambungan kontrak** 🔴 | `ParamSpec` belum tersambung antara `app-education` dan `service-search` → pipeline lazy tidak jalan | **BLOCKER — 15 check E2E gagal** |

---

## 7. Pertanyaan terbuka (butuh keputusan)

1. **P3 (verifikasi)** — dikerjakan lebih dulu? Ini satu-satunya yang mengubah "salah" menjadi "jujur".
2. **P9 (endpoint `academic_year`)** — dikerjakan di app-education oleh siapa? Tanpa ini ide tahun ajaran tetap mustahil.
3. **F8 (entitas guru/orang tua)** — perlu perubahan model data. Masuk lingkup atau ditunda?
4. **Model lokal di runtime** — tetap tidak ada (rekomendasi), atau tetap ingin LLM kecil (0,6–1,7B) setelah diukur?
5. **Uji akurasi Gemma offline** — setuju dibuatkan probe (`research/probe-gemma-slots.ts`) sebelum memutuskan model?
6. **Redis** — tetap Redis, atau `CACHE_BACKEND=redis|memory` (default `memory` untuk POC)?
7. **Spec produksi** — 2 vCPU/2 GB (tanpa LLM), 4 vCPU/4 GB (+LLM kecil), atau 8 vCPU/8 GB (Gemma E4B jarang dipanggil)?

---

## 8. Lampiran: kasus uji yang sudah diketahui gagal

> **Status 25 Okt 2026.** Kolom "Perilaku sekarang" di bawah **sudah diverifikasi ulang** terhadap kode & DB terkini. Semua baris masih gagal, kecuali yang ditandai ✅.

| Query | Perilaku sekarang | Perilaku yang diharapkan | Status |
|---|---|---|---|
| `tagihan tahun ajaran 2026/2027` | tidak diekstrak (F6, F7) | `academic_year_id=AY-2026` | ⛔ gagal (butuh P0/P9) |
| `yang belum bayar spp tahun ini siapa?` | `periode=tahun_ini` diabaikan API (F5) / tak jadi TA (F6) | filter TA aktif + pesan asumsi | ⛔ gagal (butuh P0/P10) |
| `budi kelas 8b nunggak` | nama tak tertangkap (butuh kata pemicu) | `siswa=Budi` via resolve | ⛔ gagal |
| `kelas delapan B` | hanya angka dikenali | `kelas=8B` | ⛔ gagal |
| `SPP bulan lalu` | hanya `bulan ini` yang ditangani API | `periode=bulan_lalu` | ⛔ gagal (enum sudah ada, handler API belum) |
| `siswa kelas 99 nunggak` | tabel kosong disajikan sah (F1) | klarifikasi kelas | ⛔ gagal (butuh P3) |
| `anak bu Siti yang nunggak` | mustahil (F8) | ditunda / klarifikasi | ⛔ mustahil (perlu model data baru) |
| `resep nasi goreng` | tidak ada penjaga domain | "tidak relevan + tawarkan menu" | ⛔ gagal |
| `santri yang udah nyetor syahriah` | `status=lunas` | `status=lunas` | ⛔ gagal **di respons** (semantic match sudah benar, tapi `filters` kosong karena P0) |
| `thn ajaran sekarang` | `academic_year_id` tak ter-set | slot ter-set | ⛔ gagal (butuh P0) |

---

## 9. Catatan pemeliharaan dokumen

- Dokumen ini **rencana**, bukan catatan implementasi. Setelah P dikerjakan, ubah marker 📋 → ✅ dan pindahkan detail ke `docs/POC_SMART_SEARCH.md`.
- Setiap temuan (F) harus disertai bukti `file:line`. Bila kode berubah, verifikasi ulang sebelum mengutip.
- Angka token/latensi yang dicatat berasal dari pengukuran sesi ini; angka sumber daya LLM adalah **estimasi** dan harus diganti hasil ukur sebelum dijadikan dasar pengadaan.
- **Update 25 Okt 2026:** P0 ditambahkan sebagai blocker teratas. Angka benchmark di `POC_SMART_SEARCH.md` sudah diperbarui (JEV 94% / 272.1 ms, Lokal 94% / 2.92 ms). Item F1–F14 di Section 3 **belum diverifikasi ulang** — lakukan re-audit sebelum mengutip.
