# Naskah Narasi: Smart Search POC (versi sederhana)

Penonton: developer, tapi video ini harus bisa diikuti tanpa berpikir keras.
Aturan tulis:

- Satu kalimat, satu ide. Maksimal sekitar 15 kata.
- Tiap scene diakhiri kalimat jembatan ("Tapi ... belum jelas. Jadi ...") yang membuka scene berikutnya.
- Satu benang merah: **satu kalimat diubah jadi link, lewat empat langkah.** Setiap scene menjawab satu pertanyaan.
- Istilah teknis tetap dipakai, tapi selalu dijelaskan dengan satu kalimat pendek.
- Angka dibatasi. Yang penting saja.

Estimasi durasi = kata ÷ 2,5 per detik. Durasi final mengikuti audio.
Angka dari trace nyata (tenant 1, `SUPERADMIN`, 2026-10-28) dan tes live.

---

## VIDEO 1: Dari Satu Kalimat ke Link (±3:30)

Query: `Siapa yang belum bayar spp minggu ini untuk kelas 8B`

### Scene 0: Kenalan dengan Aktor (≈50 dtk)

Tujuan: penonton tahu siapa saja yang bekerja di belakang layar, sebelum melihat satu query berjalan.

**Narasi:**
Sebelum lihat prosesnya, kenalan dulu dengan pemainnya. Ada enam.

Satu, App Pendidikan. Ini aplikasi sekolahnya. Ia menerima pencarian dari user, lalu meneruskannya. Ia juga menyimpan data sekolah, seperti siswa dan kelas.

Dua, service-search. Ini otak pencariannya. Semua langkah yang akan kita lihat berjalan di sini.

Tiga, JEV Cloud. Layanan AI di luar. Tugasnya menjawab satu pertanyaan: kalimat ini mau ke halaman mana.

Empat, transformers.js. Model kecil yang berjalan langsung di dalam service-search. Namanya multilingual E5 small, ukuran sekitar seratus dua puluh megabita. Ia memahami makna kalimat tanpa internet. Ia cadangan kalau JEV gagal, dan penolong kalau aturan biasa tidak cukup.

Lima, Redis. Tempat menyimpan jawaban sementara, supaya data yang sama tidak diminta berulang.

Enam, tabel search routes di database. Di sinilah daftar halaman, filter yang boleh dipakai, dan pola regex disimpan. Jadi bukan di kode.

Alurnya begini. User bertanya ke App. App meneruskan ke service-search. Service-search bertanya ke JEV, atau ke transformers.js. Lalu mengambil data dari Redis atau App. Hasil akhirnya: link.

**Layar:** enam kartu aktor muncul satu per satu, masing-masing dengan ikon dan satu baris label (`App :3000`, `service-search :4000`, `JEV Cloud`, `transformers.js · multilingual-e5-small · ±120 MB`, `Redis :6379`, `search_routes (DB)`). Setelah semua muncul, panah menggambar alur: User → App → service-search → (JEV | transformers.js) → (Redis | App) → link. Diagram ini tetap ada di pojok untuk semua scene berikutnya; tiap scene menyorot satu panah.

### Scene 1: Hook (≈10 dtk)

**Narasi:**
Ketik satu kalimat biasa. "Siapa yang belum bayar SPP minggu ini untuk kelas 8B." Dalam seperempat detik, kamu dapat link yang siap diklik. Bagaimana caranya? Ada empat langkah.

**Layar:** query diketik; dua URL muncul; badge `250 ms`; empat kotak kosong berjajar (Step 1–4).

### Scene 2: Pintu Masuk (≈10 dtk)

**Narasi:**
Sebelum empat langkah itu, ada satu pintu. Setiap request wajib bawa dua header: siapa sekolahnya, dan apa perannya. Dari sini sistem tahu menu apa yang boleh dilihat. Kalau header tidak ada, request langsung ditolak.

**Layar:** request `GET /resolve?q=...` + dua header disorot; stempel `tenant 1 · SUPERADMIN`.

### Scene 3: Step 1, Classifier (≈14 dtk)

**Narasi:**
Langkah pertama: halaman mana yang dimaksud? Classifier yang menjawab. Hasilnya halaman SPP, dengan keyakinan sembilan puluh lima persen. Kalau JEV Cloud gagal atau terlalu lama, transformers.js mengambil alih. Langkah ini yang paling lama, hampir seluruh dua ratus lima puluh milidetik. Sisanya sangat cepat. Sekarang halamannya sudah jelas. Tapi filter-nya belum.

**Layar:** kartu `route: spp · confidence 0.95`; panah putus-putus ke `model lokal` berlabel cadangan; bar durasi `245 ms` mendominasi.

### Scene 4: Step 2, Extractor (≈75 dtk)

Pertanyaan scene ini: **apa saja isi kalimatnya?**

#### 4a. Rapikan kalimat (≈11 dtk)

**Narasi:**
Langkah kedua: mengambil bahan dari kalimat. Ini bagian terpenting, jadi kita pelan-pelan. Pertama, kalimat dirapikan dulu. Semua jadi huruf kecil. Penulisan kelas diseragamkan. "Kelas delapan B" dan "kelas VIII B" sama-sama jadi "kelas 8b". Dengan begitu, mesin tidak bingung karena beda penulisan.

**Layar:** "delapan b" dan "VIII B" menyatu menjadi `8b`.

#### 4b. Bahan pertama: nilai yang sudah pasti (≈18 dtk)

**Narasi:**
Lalu, extractor mencari nilai yang sudah pasti. Caranya pakai regex. Polanya disimpan di database, bukan di kode. "Belum bayar" cocok dengan pola nunggak. Jadi statusnya: nunggak. "Minggu ini" cocok dengan pola minggu ini. Jadi periodenya: minggu ini. Dua filter ini sudah final. Tidak perlu tanya database, tidak perlu model.

**Layar:** dua frasa menyala; panah ke chip `status=nunggak` dan `periode=minggu_ini`.

#### 4b+. Kalau regex tidak kena (≈22 dtk)

**Narasi:**
Bagaimana kalau kalimatnya santai, dan regex tidak kena? Di sinilah transformers.js masuk. Ia membandingkan makna kalimat dengan makna tiap pilihan. Kalau satu pilihan jelas paling mirip, itu dipakai. Kalau dua pilihan sama kuat, ia tidak menebak. Lebih baik tanpa filter daripada filter yang salah. Di kalimat kita, regex sudah kena. Jadi transformers.js tidak dipanggil. Nanti kita lihat contoh yang memanggilnya.

**Layar:** dua lapis: `1 regex` (centang hijau) dan `2 transformers.js` (abu-abu, "tidak dipanggil"); skema skor `≥ 0,65` dan `selisih ≥ 0,04`.

#### 4c. Bahan kedua: kalimat dipotong jadi kandidat (≈30 dtk)

**Narasi:**
Tapi masih ada sisa kata. Mana yang mungkin nama kelas atau nama siswa? Untuk itu, kalimat dipotong jadi potongan kecil, atau chunk. Ada tiga cara memotong. Pertama, kata tepat setelah "siswa", "murid", atau "anak bernama" dianggap nama siswa. Kedua, kata tepat setelah "kelas" dianggap kode kelas. Di sini "8b" tertangkap. Ketiga, setiap kata lain yang punya huruf juga jadi kandidat. Lalu kata-kata biasa dibuang: "siapa", "yang", "untuk", "kelas". Ini stopword. "Belum bayar" dan "minggu ini" juga ikut dibuang, karena sudah dipakai regex tadi. Hasilnya tersisa satu kandidat: "8b". Kita sebut ini token.

Satu hal penting. Regex tadi membaca kalimat utuh. Pemotongan ini hanya untuk token, yang nanti dicari ke data sekolah.

**Layar:** kalimat terbelah jadi potongan lewat tiga jalur (anchor siswa, anchor kelas, kata lain); stopword memudar; `8b` menyala; label `token`. Di sisi lain, tampilkan ikon regex membaca kalimat utuh (tanpa potongan).

#### 4d. Jangan menebak (≈22 dtk)

**Narasi:**
Pertanyaannya: apa arti "8b"? Kelas? Nama siswa? Extractor sengaja tidak menjawab. Tugasnya hanya memisahkan bahan. Ia menyerahkan tiga hal: filter yang sudah pasti, petunjuk waktu, dan token yang belum jelas. Yang menentukan artinya adalah langkah berikutnya, karena hanya langkah itu yang boleh bertanya ke data sekolah.

**Layar:** kartu berisi `status`, `periode`, dan `tokens ["8b"]` bertanda tanya; kartu meluncur ke panel Step 3.

### Scene 5: Step 3, Resolver (≈45 dtk)

Pertanyaan scene ini: **apa arti "8b"?**

#### 5a. Jawabannya ada di data (≈12 dtk)

**Narasi:**
Langkah ketiga: mencari arti token. Resolver mencocokkan token ke data sekolah. Tapi ia malas dengan sengaja. Ia hanya mengambil data kalau memang perlu. Urutannya: daftar kecil dulu, seperti kelas. Pencarian besar, seperti siswa, belakangan.

**Layar:** dua tahap berurutan: `daftar kecil (kelas)` → `pencarian besar (siswa)`.

#### 5b. Cek daftar kelas (≈15 dtk)

**Narasi:**
Pertama, daftar kelas. Daftar ini sudah tersimpan di Redis, jadi tidak perlu tanya ke aplikasi sekolah. Token "8b" dicocokkan, dan ketemu: Kelas 8B, kodenya K-08B. Sekarang "8b" sudah punya arti. Ia ditandai sebagai terpakai.

**Layar:** `Redis: HIT`; `http_calls: []`; token `8b` → kartu `K-08B · Kelas 8B`; tanda `terpakai`.

#### 5c. Lewati pencarian siswa (≈18 dtk)

**Narasi:**
Berikutnya, pencarian siswa. Tapi tidak ada token yang tersisa. "8b" sudah terpakai sebagai kelas. Jadi pencarian siswa dilewati. Ini namanya token exclusion. Tanpa ini, "8b" ikut dicari ke daftar siswa, dan hasilnya pasti kosong. Itu buang waktu. Sekarang semua bahan lengkap: kelas, status, dan periode. Tinggal dirakit jadi link.

**Layar:** `siswa_id` dicoret; tulisan `0 token tersisa`; tiga chip filter bergabung: `kelas_id=K-08B`, `status=nunggak`, `periode=minggu_ini`.

### Scene 6: Step 4, Dispatcher (≈20 dtk)

**Narasi:**
Langkah terakhir: merakit link. Dispatcher menyusun semua filter jadi alamat halaman SPP. "Minggu ini" diterjemahkan jadi tanggal: tujuh hari, berakhir hari ini. Hasilnya dua pilihan. Pilihan pertama pakai filter tanggal. Pilihan kedua tanpa tanggal, untuk jaga-jaga, dengan skor lebih rendah. Selesai. Satu kalimat, jadi link.

**Layar:** dua URL dengan skor `1` dan `0.85`; chip `periode` berubah jadi rentang tanggal `22–28 Okt`.

### Scene 7: Ringkasan (≈12 dtk)

**Narasi:**
Kita rekap. Empat langkah, total dua ratus lima puluh milidetik. Hampir semuanya waktu classifier. Tiga langkah lain, masing-masing kurang dari tiga milidetik. Jadi kalau mau lebih cepat, lihat classifier.

**Layar:** stacked bar `245 / 0,2 / 2,6 / 2,4 ms`; total `250 ms`.

### Scene A: Kalau Nama Salah Ketik (≈35 dtk)

Query: `Anak bernama Sity ada di kelas berapa?`

**Narasi:**
Bagaimana kalau nama salah ketik? Contohnya: "Anak bernama Sity ada di kelas berapa". Classifier memilih halaman kelas. Extractor mengambil "sity" sebagai token. Resolver mencari siswa bernama "sity". Hasilnya kosong. Tidak ada pencocokan mirip-mirip. Jadi resolver mencoba lagi dengan memotong huruf terakhir. Sekarang tokennya "sit". Kali ini ada dua siswa: Siti Rahma dan Siti Aisyah. Hasilnya dua pilihan link, ke Kelas 8B dan Kelas 7A. Langkah ini lebih lama, sekitar enam ratus milidetik, karena harus tanya ke aplikasi sekolah. Tapi hasil pencariannya disimpan, jadi pencarian berikutnya cepat.

**Layar:** `sity` → `/api/siswa` → 0 hasil; huruf `y` terpotong → `sit` → 2 kartu siswa; dua URL; bar resolver `632 ms`.

### Scene B: Kalau Regex Tidak Kena (≈40 dtk)

Query nyata: `spp pekan ini yang nunggak` (tenant 1, `SUPERADMIN`, tanggal 2026-10-28)

**Narasi:**
Sekarang kalimat yang lebih santai: "SPP pekan ini yang nunggak". Regex mengenali "nunggak", jadi status sudah pasti. Tapi regex tidak mengenal kata "pekan". Maka transformers.js dipanggil untuk menebak periodenya. Ia memberi skor ke tiap pilihan. Pilihan teratas dapat skor nol koma delapan enam. Kelihatannya tinggi. Tapi pilihan kedua hampir sama: selisihnya cuma nol koma nol nol tujuh. Aturannya, selisih minimal nol koma nol empat. Jadi tidak lolos. Hasilnya: filter periode dikosongkan. Link yang keluar hanya SPP yang nunggak, tanpa tanggal. Ini disengaja. Lebih baik hasilnya agak luas, daripada filternya salah.

**Layar:** kalimat dengan "nunggak" menyala hijau (regex) dan "pekan ini" menyala kuning (tidak dikenal); batang skor untuk pilihan periode (teratas `0,864`, selisih `0,007`) dengan garis ambang selisih `0,04`; badge merah `DITOLAK: selisih terlalu kecil`; URL akhir `/spp?status=nunggak`.

**Data trace nyata (ringkas):**

- `spp pekan ini yang nunggak`: regex `status=nunggak`; tfjs `periode` ENGAGED skor 0,864, margin 0,007, ditolak; URL `/spp?status=nunggak`.
- `siapa yang belom nyetor spp`: regex kosong; tfjs `status` skor 0,786 margin 0,002 dan `periode` skor 0,783 margin 0,008, keduanya ditolak; URL `/spp`.
- Pembanding yang kena regex: `spp nunggak bulan lalu` → `status=nunggak`, `periode=bulan_lalu`, tfjs STANDBY, URL dengan rentang 2026-09-01 sampai 2026-09-30.

**Catatan jujur untuk narator:** dari 13 query santai yang kucoba, tidak ada satu pun yang lolos lapis semantik (semua margin di bawah 0,04). Jadi video ini menunjukkan transformers.js sebagai **pagar pengaman**, bukan penyelamat. Jangan narasikan "transformers.js berhasil menebak".

---

## VIDEO 2: Pengamanan (±1:15)

Benang merah: **siapa boleh masuk, seberapa banyak boleh masuk, dan apa yang terjadi kalau sistem sakit.**
Hanya klaim yang sudah diuji atau terbaca di kode. Bagian bertanda **[kode, belum diuji live]** jangan dinarasikan sebagai bukti.

### H1: Siapa yang Masuk (≈14 dtk)

**Narasi:**
Pertanyaan pertama: siapa yang masuk? Identitas hanya dipercaya dari header. Tanpa header, jawabannya empat nol satu. Hanya satu header pun, tetap empat nol satu. Dan kalau seseorang menulis client id atau role palsu di alamat, itu diabaikan. Yang dipercaya hanya header.

**Layar:** tiga request: `401`, `401`, lalu query palsu tanpa efek.
**Status:** teruji live.

### H2: Seberapa Banyak (≈18 dtk)

**Narasi:**
Pertanyaan kedua: seberapa banyak? Ada batas untuk ukuran. Query maksimal dua ratus karakter. Lewat satu karakter saja, ditolak. Isi request maksimal empat kilobyte. Lebih dari itu juga ditolak. Lalu batas jumlah: seratus dua puluh request per menit. Dalam tes, seratus lima puluh request beruntun. Yang lolos seratus enam belas. Sisanya ditolak.

**Layar:** `200 → 200`, `201 → 400`, `5 KB → 413`; grafik batang hijau 116 dan merah 34.
**Status:** teruji live.

### H3: Kalau Sistem Sakit (≈24 dtk)

**Narasi:**
Pertanyaan ketiga: kalau aplikasi sekolah mati? Kami matikan aplikasinya, lalu bertanya. Jawabannya tetap datang, bukan error. Pertama, kalau daftar kelas di Redis sudah kedaluwarsa, sistem memakai salinan lama yang disimpan satu hari. Filter kelas tetap benar. Kedua, kalau salinan lama juga tidak ada, jawaban tetap keluar, tapi tanpa filter kelas, dan ditandai "degraded". Ketiga, kalau daftar halaman pun hilang, sistem memakai daftar bawaan yang kasar. Tanda degraded ini disimpan hanya dua puluh detik, supaya gangguan sebentar tidak menempel lama. Lebih baik hasil kasar yang jujur, daripada error atau hasil salah yang tersimpan.

**Layar:** tiga tangga: `Redis segar` → `salinan lama (stale)` → `tanpa filter + degraded`. Tiap tangga menampilkan URL hasil: `/spp?kelas_id=K-08B&...`, lalu `/spp?kelas_id=K-08B&...` (stale), lalu `/spp?created_at...` tanpa kelas; badge `degraded: true`; TTL `20`.
**Status:** teruji live (aplikasi sekolah dimatikan). Circuit breaker dan timeout JEV **tidak** dinarasikan sebagai terbukti: lihat catatan.

**Data tes nyata (tenant 1, `SUPERADMIN`, `:3000` mati):**

- Cache hangat: `200`, `degraded: true` (ada master lain yang tidak ada di cache), `kelas_id=K-08B` tetap ada.
- Kunci utama kelas dihapus, `:stale` ada: `200`, `kelas_id=K-08B` tetap, `degraded: true`, 289 ms.
- Stale juga dihapus: `200`, filter kelas hilang, `degraded: true`, URL `/spp?created_at...`.
- Kunci manifest dihapus: `200`, memakai `FALLBACK_ROUTES`, `degraded: true`, TTL kunci manifest 20 dtk.
- Kunci hasil query degraded: TTL 20 dtk.
- Tujuh query beruntun saat `:3000` mati: semua `200`, 256–371 ms (didominasi JEV ±250 ms).

### H4: Siapa Boleh Lihat Apa (≈22 dtk)

**Narasi:**
Pertanyaan keempat: siapa boleh melihat apa? Setiap sekolah dan peran punya daftar halaman sendiri. Superadmin sekolah satu punya tujuh halaman. Guru hanya enam, tanpa SPP. Saat tes, kami menemukan bug. Kalau daftar halamannya kosong, sistem malah membuka semua halaman. Ini sudah diperbaiki. Sekarang daftar kosong berarti tidak ada hasil, bukan akses penuh.

**Layar:** tabel tenant × role × jumlah halaman; dua baris kode yang berubah; hasil `0 opsi`.
**Status:** teruji live, commit `ca29f34`.

### H5: Yang Belum (≈14 dtk) **[opsional]**

**Narasi:**
Ada yang belum selesai. Peran atau sekolah yang tidak dikenal masih dibalas sukses dengan hasil kosong, bukan ditolak. Dan di aplikasi contoh ini, halaman data seperti nilai belum mengecek peran. Ini bagian dari aplikasi tiruan untuk POC. Catatan ini daftar kerja berikutnya.

**Layar:** dua baris "BELUM" berwarna kuning.
**Status:** terverifikasi di kode `app-education/src/server.ts` (baris 544 dan 67–68).

---

## Catatan Produksi

- Video 1 ≈ 3:30. Kalau perlu lebih pendek: buang Scene A, atau gabung Scene 6 dan 7.
- Hanya sebut nama vendor yang terlihat di trace (JEV Cloud, transformers.js, E5). Di narasi sengaja disebut "model lokal" agar mudah dibaca; nama E5 cukup tampil di layar.
- Regex "negation-aware" tidak disebut karena belum terverifikasi di kode.
