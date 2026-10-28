# Project Specification: Smart Search Remotion Motion Video

Dokumen ini mendefinisikan struktur visual dan animasi untuk **dua video motion** yang menjelaskan Smart Search dengan **Remotion (React Video Framework)**.

> **Sumber teks narasi: `docs/motion-video/NARASI.md`.** Dokumen ini hanya memuat struktur, layar, dan data. Jika ada beda, NARASI.md yang berlaku untuk kata-kata, dokumen ini untuk visual.

| Video | Tujuan | Durasi |
|---|---|---|
| **Video 1: Dari Satu Kalimat ke Link** | Mengenalkan aktor, lalu menelusuri satu query di empat step | ± 3:30 |
| **Video 2: Pengamanan** | Siapa yang masuk, seberapa banyak, kalau sistem sakit, siapa boleh lihat apa; plus daftar "belum" | ± 1:15 |

Durasi final mengikuti audio (voiceover dibuat user dengan tool lain). Estimasi 2,5 kata/detik.

---

## 1. Prinsip (berlaku untuk kedua video)

1. **Audiens = developer.** Bahasa teknis tapi mudah diikuti: satu kalimat satu ide, tiap scene ditutup kalimat jembatan ke scene berikutnya.
2. **Stack ditampilkan apa adanya** (keputusan user): Bun, Redis, JEV Cloud, transformers.js (`multilingual-e5-small`, q8), SQLite. Tidak ada label netral. Kotak "Di POC" tidak diperlukan.
3. **Benang merah Video 1:** satu kalimat diubah jadi link lewat empat step. Setiap scene menjawab satu pertanyaan.
4. **Diagram aktor tetap tampil di pojok** sepanjang Video 1; tiap scene menyorot satu panah.
5. **Layout per step:** kiri = INPUT, tengah = APA YANG TERJADI, kanan = OUTPUT (JSON kecil). Pill di pojok = waktu step dari `timings_ms`.
6. **Jujur soal batas.** Hal yang belum diuji atau belum ada ditampilkan sebagai "BELUM" (kuning), bukan disembunyikan.

---

## 2. Metadata Teknis

- Format: 1920x1080 (16:9), 60 FPS
- Teknologi: Remotion (React, Tailwind CSS, Lucide Icons, Spring Animations)
- Suara: tanpa audio dulu (caption dari NARASI.md). Voiceover menyusul; scene memakai `<Audio />` dan durasinya mengikuti file audio.
- Dua komposisi terpisah: `TraceVideo`, `HardeningVideo`.

---

# VIDEO 1: Dari Satu Kalimat ke Link

## 3. Kasus Nyata

> **Query:** *"Siapa yang belum bayar spp minggu ini untuk kelas 8B"*
> Tenant `1`, role `SUPERADMIN`, tanggal referensi **2026-10-28**.

Hasil trace nyata (total **250,09 ms**):

| Step | Hasil | Waktu |
|---|---|---|
| 1 Classifier | JEV_CLOUD, route `spp`, `DIRECT_LINK`, confidence 0,95 HIGH | 244,68 ms |
| 2 Extractor | `status=nunggak` (dari "belum bayar"), `periode=minggu_ini` (dari "minggu ini"), sisa token `["8b"]` | 0,21 ms |
| 3 Resolver | Redis `smartsearch:master:1:kelas_id` HIT, `http_calls: []`, `kelas_id=K-08B` "Kelas 8B", consumed `["8b","kelas8b"]`, skip `siswa_id (0 unassigned tokens left - token exclusion)` | 2,6 ms |
| 4 Dispatcher | 2 opsi: skor 1 dan skor 0,85 (× 0,85, "Semua Periode"); composite confidence 1 HIGH | 2,35 ms |

URL akhir:
- `/spp?kelas_id=K-08B&status=nunggak&created_at.%24gte=2026-10-22&created_at.%24lte=2026-10-28`
- `/spp?kelas_id=K-08B&status=nunggak`

Catatan: param bernama `periode` (bukan `created_at`) di extractor. `minggu_ini` = 7 hari inklusif berakhir hari ini (`ref − 6 … ref`). `stopwords_removed` = siapa, yang, belum, bayar, spp, minggu, ini, untuk, kelas.

## 4. Storyboard Video 1

Teks lengkap tiap scene ada di NARASI.md. Di sini hanya visual.

### Scene 0: Kenalan dengan Aktor
- Enam kartu muncul berurutan: **App Pendidikan** `:3000`, **service-search** `:4000` (Bun), **JEV Cloud**, **transformers.js** (`multilingual-e5-small`, ±120 MB), **Redis** `:6379`, **tabel `search_routes`** (DB).
- Lalu panah menggambar alur: User → App → service-search → (JEV | transformers.js) → (Redis | App) → link.
- Diagram ini mengecil ke pojok dan tetap tampil.

### Scene 1: Hook
- Query diketik; dua URL muncul; badge `250 ms`; empat kotak kosong (Step 1–4).

### Scene 2: Pintu Masuk (Gate)
- `GET /resolve?q=...` + header `X-Client-Id: 1`, `X-User-Role: SUPERADMIN` disorot; stempel `tenant 1 · SUPERADMIN`.
- Role yang dipakai di trace adalah `SUPERADMIN`. Role `ADMIN` di tenant 1 punya 0 route, jadi jangan dipakai di contoh.

### Scene 3: Step 1, Classifier
- Kartu `route: spp · DIRECT_LINK · 0.95 HIGH`; panah putus-putus ke transformers.js berlabel cadangan; bar durasi 244,68 ms mendominasi (classifier = 245 dari 250 ms).
- Tampilkan 7 route tenant 1: dashboard, siswa, nilai, spp, rapot, kelas, guru.

### Scene 4: Step 2, Extractor (inti video)
- 4a normalisasi: `delapan b` / `VIII B` → `8b`.
- 4b regex dari database, kalimat utuh: dua frasa menyala, chip `status=nunggak`, `periode=minggu_ini`.
- 4b+ lapis semantik: dua lapis (regex ✓, transformers.js "tidak dipanggil/STANDBY"); aturan skor `≥ 0,65` dan selisih `≥ 0,04`.
- 4c chunking: kalimat dipotong jadi kandidat lewat 3 jalur (anchor siswa, anchor kelas, kata lain); stopword memudar; `8b` tersisa. Tampilkan ikon "regex membaca kalimat utuh" sebagai pembeda. Lihat catatan chunking di §6.
- 4d serah-terima: kartu `RawExtraction` (`enumValues`, `timeHints`, `tokens ["8b"]`) meluncur ke Step 3.

### Scene 5: Step 3, Resolver
- 5a urutan: list (kelas) → enum fallback → search (siswa).
- 5b `Redis: HIT`, `http_calls: []`, `8b` → `K-08B · Kelas 8B`, tanda terpakai.
- 5c `siswa_id` dicoret, "0 token tersisa", maks 3 token per param; tiga chip filter bergabung.

### Scene 6: Step 4, Dispatcher
- Dua URL dengan skor `1` dan `0.85`; `periode` berubah jadi rentang `22–28 Okt`.

### Scene 7: Ringkasan
- Stacked bar `244,68 / 0,21 / 2,6 / 2,35 ms`, total `250,09 ms`.

### Scene A: Nama Salah Ketik (`Anak bernama Sity ada di kelas berapa?`)
Mekanisme nyata (bukan fuzzy edit-distance):
- Route `kelas`; token `sity`.
- Resolver memanggil `/api/siswa` dengan `sity` → 0 hasil → **prefix-truncation** jadi `sit` → 2 hasil (S002 Siti Rahma, S009 Siti Aisyah). Lookup di-cache: `smartsearch:lookup:1:siswa_id:sity`.
- Output 2 opsi skor 1: `/kelas/K-08B` (Siti Rahma) dan `/kelas/K-07A` (Siti Aisyah).
- Total 929,39 ms; resolver 632,43 ms (ada HTTP call). Tidak ada saran "Maksud Anda" di jalur ini.

### Scene B: Kalau Regex Tidak Kena (`spp pekan ini yang nunggak`)
- Regex menangkap `status=nunggak`; "pekan" tidak dikenali.
- transformers.js ENGAGED untuk `periode`: skor 0,864, selisih 0,007 → **ditolak** (selisih < 0,04).
- URL akhir `/spp?status=nunggak` tanpa tanggal.
- Pesan: transformers.js adalah pagar pengaman, bukan penyelamat. Dari 13 query santai yang diuji, tidak ada yang lolos lapis semantik.

---

# VIDEO 2: Pengamanan

Teks di NARASI.md. Semua bagian bertanda status: **teruji live**, **kode saja**, atau **belum**.

### H1: Siapa yang Masuk (teruji live)
| Request | Hasil |
|---|---|
| tanpa header | `401` |
| hanya `X-Client-Id` | `401` |
| `client_id`/`role` palsu di query | diabaikan |

### H2: Seberapa Banyak (teruji live)
| Request | Hasil |
|---|---|
| `q` 200 karakter | `200` |
| `q` 201 karakter | `400` `Query exceeds 200 characters` |
| body 5 KB | `413` `Request body too large` |
| `threshold=999` | di-clamp (0 opsi) |
| `threshold=abc` | default (1 opsi) |
| 150 request beruntun | 116 sukses, 34 `429`, mulai request ke-117, `Retry-After: 1` |

### H3: Kalau Sistem Sakit (teruji live untuk degradasi; breaker/timeout belum)
Tes dengan app-education (`:3000`) dimatikan:

| Kondisi cache | Hasil |
|---|---|
| master kelas utama ada | `200`, `kelas_id=K-08B`, tetap `degraded: true` bila master lain tidak ada di cache |
| utama hilang, `:stale` ada | `200`, `kelas_id=K-08B` tetap (stale dipakai), 289 ms |
| utama dan `:stale` hilang | `200`, filter kelas hilang, `degraded: true` |
| manifest route hilang | `200`, `FALLBACK_ROUTES`, `degraded: true`, TTL kunci manifest 20 dtk |
| kunci hasil query degraded | TTL 20 dtk |

- Tujuh query beruntun saat `:3000` mati: semua `200`, 256–371 ms, didominasi JEV (±250 ms). Karena upstream menolak koneksi seketika, **circuit breaker tidak terbukti** bekerja dari tes ini; ia baru berarti saat upstream menggantung. Jangan tampilkan angka breaker.
- Timeout JEV (1500 ms) tidak diuji (butuh JEV mati atau `JEV_TIMEOUT_MS=1`).
- Tampilan: tiga tangga (segar → stale → tanpa filter + `degraded`).

### H4: Siapa Boleh Lihat Apa (teruji live, commit `ca29f34`)
| Tenant | Role | Jumlah route |
|---|---|---|
| 1 | SUPERADMIN | 7 |
| 1 | GURU | 6 (tanpa spp) |
| 1 | ADMIN | 0 |
| 2 | ADMIN | 4 (dashboard, siswa, spp, guru) |
| 2 | GURU | 3 |
| 2 | SUPERADMIN | 0 |

Bug yang ditemukan dan diperbaiki: manifest kosong dari upstream sehat jatuh ke `FALLBACK_ROUTES` (membuka semua route). Sekarang kosong = 0 opsi, `degraded: false`. Fallback hanya dipakai bila upstream gagal. Tampilkan diff 1 baris di `routes-sync.ts`.

### H5: Yang Belum (kuning, "BELUM")
- Role/tenant tidak dikenal dibalas `200` dengan 0 opsi, bukan `403`.
- Di app-education (mock POC), endpoint data seperti `/api/nilai` hanya memfilter `client_id`, tanpa cek role; default tenant `1` dan `SUPERADMIN` bila header tidak ada (`server.ts:544`, baris 67–68).
- Sumber auth final (JWT), rate limit terdistribusi, lock terdistribusi untuk cache, load test, W3–W7. Rujukan: `docs/PLAN_PRODUCTION_HARDENING.md` §9.

---

## 5. Catatan Akurasi (disinkronkan dengan kode dan tes, 2026-10-28)

- Sumber kebenaran: `service-search/src/{extractor,normalize,lazy-resolver,local-model,dispatcher,date-range,tracer,routes-sync}.ts` dan `app-education/src/server.ts`.
- Output trace sudah diambil dari server live (bukan ilustrasi). Datanya dipindah ke `src/data/trace.json` saat proyek dibuat.
- Perubahan sementara `service-search/src/server.ts` (flag `SMARTSEARCH_EXPOSE_TRACE=1`) **tidak boleh di-commit**; kembalikan setelah semua trace diambil.
- Belum dijalankan ulang setelah perbaikan manifest: `test-queries` (sebelumnya 47/48), `test-e2e`, `test-extractor`, `test-dispatcher` (8/8). Belum ada tes unit untuk `getRoutesManifest`.
- Sudah diuji live: stale-while-error, fallback tanpa filter, fallback manifest, TTL degraded 20 dtk (app-education dimatikan). Belum terbukti: circuit breaker (koneksi ditolak seketika) dan timeout JEV.
- Catatan perilaku: token pendek umum (mis. "ya") bisa ikut dicari ke daftar siswa dan menghasilkan `q=Rian` di URL. Belum diselidiki; kandidat temuan, bukan klaim.

## 6. Hal yang Masih Terbuka

- **Chunking:** kata "chunk" tidak ada di kode maupun docs. Di NARASI.md 4c, istilah dipakai untuk pemotongan kalimat jadi token (`extractTokens`). Konfirmasi user: kalimat utuh dipakai regex dan embedding enum; hanya token yang dipotong. Update docs/README bila istilah ini resmi.
- Sumber audio dan tool voiceover: dari user.
- Tanggal referensi final di video: 2026-10-28 (sesuai trace).

---

## 7. Struktur Folder & Rencana Implementasi

Dikerjakan **setelah** NARASI.md disetujui dan audio siap.

```text
docs/motion-video/
├── NARASI.md
├── package.json
├── remotion.config.ts
├── src/
│   ├── index.ts
│   ├── Root.tsx               # komposisi: TraceVideo, HardeningVideo
│   ├── TraceVideo.tsx         # Scene 0–7, A, B
│   ├── HardeningVideo.tsx     # H1–H5
│   ├── scenes/
│   │   ├── trace/
│   │   └── hardening/
│   ├── components/            # ActorCard, ActorDiagram, StepLayout, JsonBox, Chip, ScoreBars, Caption, ...
│   ├── data/trace.json        # sumber angka semua scene
│   └── audio/                 # voiceover dari user
└── README.md
```

Semua scene membaca angka dari `data/trace.json`.

## 8. Cara Menjalankan

```bash
cd docs/motion-video
npm install
npm start                      # Remotion Studio
npx remotion render TraceVideo out/smart-search-trace.mp4
npx remotion render HardeningVideo out/smart-search-hardening.mp4
```
