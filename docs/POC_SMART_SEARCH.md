# Proof of Concept (POC): Smart Search System
### Domain: Sistem Manajemen Sekolah / Aplikasi Pendidikan
**Teknologi:** TypeSafe JEV (Cloud System One) & Laya (Local MLX Encoder) + SQLite Backend

---

## 1. Ringkasan Eksekutif & Objektif

Smart Search ini mengubah input bahasa alami (*natural language query*) dari pengguna sekolah (guru, tata usaha, orang tua) menjadi **aksi terstruktur (typed intents & parameters)** secara instan.

Terdapat 3 keluaran aksi:
1. **`LIST_MENU`**: Menampilkan navigasi kartu menu yang relevan.
2. **`DIRECT_LINK`**: Membuka halaman tabel/modul dengan filter parameter langsung terisi dan menjalankan query SQL ke database.
3. **`REPORT_ACTION`**: Menjalankan aksi cetak atau download file dokumen (misal buku rapor siswa).

Sistem ini mendukung arsitektur **Dual-Engine**:
- **Produksi (Primary)**: **TypeSafe JEV Cloud (`https://api.typesafe.ai/v1/systemone`)** — *Zero-Anchor*, model reasoning semantik terkalibrasi tanpa butuh dataset anchor contoh kalimat.
- **Lokal / Edge (Fallback / Prototyping)**: **Laya Local MLX Daemon (`http://127.0.0.1:4141`)** — Menggunakan embedding 768-dimensi MLX Apple Silicon dengan exemplar cosine similarity.

---

## 2. Arsitektur Sistem

```
                      [ User Input: Natural Language Query ]
                                        │
                                        ▼
                   ┌─────────────────────────────────────────┐
                   │       Smart Search Engine (:4000)       │
                   │  - Parameter Extractor (Regex / Entity) │
                   │  - Dual-Engine Classifier               │
                   └────────────────────┬────────────────────┘
                                        │
                 ┌──────────────────────┴──────────────────────┐
                 ▼                                             ▼
     [ TypeSafe JEV Cloud ]                        [ Laya Local MLX Daemon ]
   (https://api.typesafe.ai)                         (http://127.0.0.1:4141)
  - Zero-Anchor Semantic Criteria              - 768-dim Dense Embeddings
  - Native Calibrated Confidence               - Exemplar KNN + Softmax (T=0.05)
                 │                                             │
                 └──────────────────────┬──────────────────────┘
                                        │
                                        ▼
                   ┌─────────────────────────────────────────┐
                   │           Dispatcher Action             │
                   │  Transforms Intent + Slots into Action  │
                   └────────────────────┬────────────────────┘
                                        │
             ┌──────────────────────────┼──────────────────────────┐
             ▼                          ▼                          ▼
     [ LIST_MENU ]               [ DIRECT_LINK ]           [ REPORT_ACTION ]
  Daftar menu navigasi       URL deep link + filter       Aksi download / print
                                        │
                                        ▼
                   ┌─────────────────────────────────────────┐
                   │      App Pendidikan Backend (:3000)     │
                   │  SELECT id, ... FROM table WHERE filter │
                   │           [ SQLite Database ]           │
                   └─────────────────────────────────────────┘
```

---

## 3. Komparasi: TypeSafe JEV vs Laya MLX

| Dimensi | **TypeSafe JEV Cloud (System One)** | **Laya Local Daemon (MLX :4141)** |
|---|---|---|
| **Paradigma** | *Direct Semantic Choice via Criteria* | *Vector Embedding + Cosine Similarity* |
| **Kebutuhan Anchor** | **Zero-Anchor (TIDAK PERLU)** | **Wajib daftar kalimat anchor** (`anchors.json`) |
| **Maintenance** | Cukup deskripsikan maksud intent dalam teks singkat | Harus mengumpulkan dan memelihara variasi contoh kalimat |
| **Kecepatan (Latency)**| **~240ms – 320ms** (jaringan cloud) | **~10ms – 12ms** (in-memory warm cache lokal) |
| **Akurasi Benchmark** | **100%** pada 16 test case | **94%** pada 16 test case |
| **Deployment Target** | Cloud Production Backend | On-Premise / Edge / Offline Server |

### Mengapa JEV Tidak Membutuhkan Anchor?
Pada embedding tradisional (Laya), sistem menghitung jarak sudut vektor query ke kumpulan kalimat contoh (*anchors*). Jika variasinya belum terdaftar, akurasinya bisa menurun.

Sebaliknya, **TypeSafe JEV** menggunakan inferensi System One terarah. Developer cukup mendefinisikan kriteria logis:
```json
{
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
```
JEV langsung melakukan probabilistic reasoning atas intent tanpa perlu menyimpan atau me-maintain database vektor kalimat.

---

## 4. Hasil Evaluasi Benchmark Head-to-Head

Hasil pengujian otomatis pada 16 query uji representatif bahasa Indonesia:

```text
=========================================================================
| Engine                  | Accuracy | Avg Latency | Latency Range      |
|-------------------------|----------|-------------|--------------------|
| TypeSafe JEV (Cloud)    | 100%     | 287.59 ms   | 237.87ms – 333.31ms|
| Laya-MLX (Local Daemon) | 94%      | 10.53 ms    | 9.88ms – 11.38ms   |
=========================================================================
```

---

## 5. Tiga Skenario & Integrasi SQLite

### Skenario 1: `LIST_MENU`
* **Query:** `"buka menu pembayaran spp"`
* **Intent:** `LIST_MENU` (Confidence: 100%)
* **Respon:**
```json
{
  "mode": "LIST_MENU",
  "matched_menus": [
    { "title": "Dashboard Utama", "path": "/dashboard" },
    { "title": "Pembayaran & Tagihan SPP", "path": "/spp" }
  ]
}
```

### Skenario 2: `DIRECT_LINK` + Eksekusi Query SQLite
* **Query:** `"lihat siswa nunggak kelas 8B"`
* **Intent:** `DIRECT_LINK` (Confidence: 84% - 100%)
* **Extracted Params:** `{ "kelas": "8B", "status": "nunggak" }`
* **Dispatched Target URL:** `/spp?status=nunggak&kelas=8B`
* **Eksekusi SQL di Backend (`app-education`):**
```sql
SELECT id, siswa_id, nama_siswa, kelas, bulan, nominal, status, jatuh_tempo 
FROM spp 
WHERE 1=1 AND LOWER(status) = LOWER('nunggak') AND LOWER(kelas) = LOWER('8B');
```
* **Hasil SQLite:** Mengembalikan 2 record siswa nunggak (*Budi Santoso* dan *Farhan Nugraha*).

### Skenario 3: `REPORT_ACTION`
* **Query:** `"cetak rapot kelas 8B semester ganjil"`
* **Intent:** `REPORT_ACTION` (Confidence: 100%)
* **Extracted Params:** `{ "kelas": "8B", "semester": "ganjil", "format": "print" }`
* **Respon:**
```json
{
  "mode": "REPORT_ACTION",
  "action": "PRINT_RAPOT",
  "title": "Cetak / Unduh Rapot (Kelas 8B Semester ganjil)",
  "download_url": "/api/rapot/download?kelas=8B&semester=ganjil&format=print"
}
```
* **Eksekusi Download:** `HTTP GET /api/rapot/download?kelas=8B&semester=ganjil&format=print` mengembalikan header `attachment; filename="Rapor_Semua_Siswa_Kelas_8B_ganjil.print"` beserta dokumen siap cetak.

---

## 6. Struktur Project & File

```
poc-smart-search/
├── docs/
│   └── POC_SMART_SEARCH.md          # Dokumen teknis POC ini
├── service-search/                  # Service Search Engine (Port 4000)
│   ├── src/
│   │   ├── classifier.ts            # Dual engine: JEV Cloud & Laya Local
│   │   ├── extractor.ts             # Regex entity parameter extraction
│   │   ├── dispatcher.ts            # Intent → Action transformer
│   │   ├── visualizer.ts            # Terminal interactive color visualizer
│   │   ├── server.ts                # HTTP Server (:4000/resolve)
│   │   ├── cli.ts                   # Interactive CLI Runner
│   │   ├── benchmark.ts             # Automated benchmark suite
│   │   └── anchors.json             # Anchors data (khusus Laya)
│   └── package.json
├── app-education/                   # App Aplikasi Pendidikan (Port 3000)
│   ├── src/
│   │   ├── data/
│   │   │   ├── db.ts                # SQLite schema & initialization
│   │   │   └── mock.ts              # Data definition types
│   │   └── server.ts                # REST API & Search Gateway (:3000/api/search)
│   ├── education.db                 # Database SQLite lokal
│   └── package.json
├── test-e2e.ts                      # Test integrasi E2E end-to-end
├── run-test.ts                      # Automasi start-and-test runner
└── package.json                     # Root scripts runner
```

---

## 7. Panduan Menjalankan

### Persyaratan
- Node.js v20+ atau Bun 1.1+
- API Key TypeSafe tersedia di environment variable: `export TYPESAFE_API_KEY="your-key"`
- *(Opsional)* Laya daemon running di `http://127.0.0.1:4141` jika ingin menguji engine lokal.

### 1. Interactive CLI (Visualisasi Realtime)
```bash
bun run cli
```
Fitur CLI:
- Ketik `:jev` untuk memaksa JEV Cloud.
- Ketik `:laya` untuk memaksa Laya Local MLX.
- Ketik `:auto` untuk deteksi otomatis.
- Ketik query apapun dan lihat breakdown probabilitas secara langsung.

### 2. Menjalankan Benchmark Head-to-Head
```bash
bun run test:benchmark
```

### 3. Menjalankan Tes E2E (Full Integration Test)
```bash
bun run test:e2e
```

### 4. Menjalankan Server Mandiri
**Terminal 1:**
```bash
bun run start:search
```
**Terminal 2:**
```bash
bun run start:app
```
**Akses API:**
```bash
# Gateway Smart Search
curl "http://127.0.0.1:3000/api/search?q=lihat%20siswa%20nunggak%20kelas%208B&engine=jev"
```

---

## 8. Tracing Alur Eksekusi Kode: Dari Search ke Database

Berikut adalah urutan riil pemanggilan fungsi, HTTP endpoint, dan query database ketika pengguna mengetik search query:

```
[User Input] "lihat siswa nunggak kelas 8B"
     │
     ▼
[Step 1: Classification Engine]
  ↳ File: service-search/src/classifier.ts
  ↳ Memilih engine (JEV / Laya):
      • JEV Cloud (Primary):
        POST https://api.typesafe.ai/v1/systemone
        Headers: Authorization: Bearer $TYPESAFE_API_KEY
        Payload: {
          "model": "jev-latest",
          "context": "User query: \"lihat siswa nunggak kelas 8B\"",
          "schema": {
            "intent": {
              "type": "choice",
              "criteria": {
                "LIST_MENU": "Navigasi menu umum",
                "DIRECT_LINK": "Filter data tabel spesifik",
                "REPORT_ACTION": "Cetak / unduh rapot"
              }
            }
          }
        }
        Response: intent = "DIRECT_LINK" (Prob: 1.0)

      • Laya Local MLX (Fallback / Local):
        POST http://127.0.0.1:4141/embed
        Payload: { "text": "lihat siswa nunggak kelas 8B" }
        Response: Dense Vector [768 dimensions]
        Proses: Menghitung Cosine Similarity vs anchors.json + Softmax (T=0.05)

     │
     ▼
[Step 2: Slot / Parameter Extraction]
  ↳ File: service-search/src/extractor.ts
  ↳ Parsing regex & semantic dictionary:
      • Regex `\b([789]|1[0-2])\s*([A-Za-z])\b`  ➔ kelas: "8B"
      • Keyword Dictionary `nunggak|belum bayar`  ➔ status: "nunggak"
  ↳ Output: { kelas: "8B", status: "nunggak" }

     │
     ▼
[Step 3: Action Dispatching]
  ↳ File: service-search/src/dispatcher.ts
  ↳ Memetakan Intent `DIRECT_LINK` + parameter `spp/nunggak`:
      • target_url = "/spp?status=nunggak&kelas=8B"
      • title = "Data Tagihan & Pembayaran SPP - Kelas 8B"
  ↳ Output JSON dikirim kembali ke App Pendidikan Backend

     │
     ▼
[Step 4: Query Database SQLite]
  ↳ File: app-education/src/server.ts (:3000)
  ↳ Client/Browser membuka target_url: GET /api/spp?status=nunggak&kelas=8B
  ↳ Server mengeksekusi parameterized query ke SQLite (education.db):
      ```sql
      SELECT id, siswa_id, nama_siswa, kelas, bulan, nominal, status, jatuh_tempo 
      FROM spp 
      WHERE 1=1 
        AND LOWER(status) = LOWER('nunggak') 
        AND LOWER(kelas) = LOWER('8B');
      ```
  ↳ Database Return:
      - Budi Santoso (Rp 500.000, nunggak)
      - Farhan Nugraha (Rp 500.000, nunggak)

---

## 9. Kesimpulan & Rekomendasi Produksi

1. **Gunakan TypeSafe JEV untuk Produksi:**
   - Menghilangkan beban pengelolaan dan pelabelan *anchor sentences*.
   - Akurasi pemahaman konteks bahasa Indonesia sangat tinggi (100% pada benchmark).
   - Skema output berbasis kriteria mempermudah penambahan modul baru di masa depan tanpa retrain model.

2. **Laya MLX Sebagai Edge / Offline Backup:**
   - Latensi super cepat (~10ms) cocok untuk *high-frequency instant search* atau deployment sekolah tanpa koneksi internet stabil.
