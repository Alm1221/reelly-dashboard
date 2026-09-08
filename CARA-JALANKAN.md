# Cara Menjalankan Reelly Secara Lokal

## 1. Siapkan dependencies

```bash
# Node.js dependencies
npm install

# Python dependencies
pip install faster-whisper requests

# FFmpeg (contoh Ubuntu/Debian) — pastikan versi mendukung filter "subtitles"
sudo apt install ffmpeg

# Ollama (lihat https://ollama.com untuk instalasi)
ollama pull llama3
```

## 2. Jalankan Ollama (di terminal terpisah, biarkan tetap jalan)

```bash
ollama serve
```

## 3. Jalankan backend server

```bash
node server.js
```
Server akan aktif di `http://localhost:3001`

## 4. Buka dashboard

Buka file `reelly-dashboard.html` langsung di browser (double click atau `open reelly-dashboard.html`).

## 5. Coba proses video

1. Buka tab **Clip Generator**
2. Upload file video (bukan link — link processing belum didukung di versi ini)
3. Atur jumlah klip, rasio ekspor, dan gaya caption (Karaoke Bold / Minimal / Pop Warna)
4. Klik **Proses Video**
5. Tunggu — proses asli (transkripsi + AI ranking + FFmpeg cropping + caption burn-in) bisa makan waktu beberapa menit tergantung panjang video dan spesifikasi komputer
6. Klip hasil (sudah ada caption terbakar di videonya) bisa diunduh langsung dari tombol Download

## Alur pipeline di balik layar

```
Upload video
   -> rank_clips.py (Whisper transkripsi + Ollama ranking)
   -> hasil: daftar klip terbaik + transkrip kata per kata
   -> untuk tiap klip:
        - FFmpeg potong & crop ke rasio pilihan
        - generate_captions_cli.py buat file .ass sesuai gaya pilihan
        - FFmpeg bakar caption ke video (burn-in)
   -> klip final siap diunduh
```

## File-file penting
- `server.js` — backend Express, orkestrasi seluruh pipeline
- `rank_clips.py` — transkripsi Whisper + ranking klip pakai Ollama
- `generate_captions.py` — logika pembuatan file subtitle .ass gaya karaoke
- `generate_captions_cli.py` — wrapper CLI supaya `generate_captions.py` bisa dipanggil dari Node
- `reelly-dashboard.html` — antarmuka dashboard

## Catatan & keterbatasan
- Fitur "Preset" di dashboard masih tampilan saja, belum otomatis diterapkan ke pipeline.
- Crop di server.js masih center-crop sederhana. Untuk face-tracking asli, tambahkan MediaPipe untuk mendeteksi koordinat wajah dan kirim ke filter FFmpeg secara dinamis (langkah berikutnya yang disarankan).
- Font caption default "Montserrat" — install font itu di sistem kamu, atau ganti nama font di `generate_captions.py` (bagian `ASS_HEADER`) sesuai font yang tersedia.
- Hanya proses video yang kamu punya haknya (rekaman sendiri, konten berizin).
