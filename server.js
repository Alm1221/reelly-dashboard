/**
 * Reelly Backend Server
 * ----------------------
 * Menerima upload video, menjalankan pipeline:
 *   1. Transkripsi + ranking klip (rank_clips.py — Whisper + Ollama)
 *   2. Potong video sesuai timestamp hasil ranking (FFmpeg)
 *   3. Crop ke rasio target + bakar caption (FFmpeg)
 *   4. Kembalikan daftar file klip yang siap diunduh
 *
 * Install dependencies:
 *   npm init -y
 *   npm install express multer cors
 *
 * Requirements di sistem:
 *   - Python 3 + faster-whisper + requests (lihat rank_clips.py)
 *   - Ollama berjalan lokal (ollama serve) dengan model llama3 sudah di-pull
 *   - FFmpeg terinstall dan ada di PATH
 *
 * Jalankan:
 *   node server.js
 *   -> server aktif di http://localhost:3001
 */

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3001;

const UPLOAD_DIR = path.join(__dirname, "uploads");
const OUTPUT_DIR = path.join(__dirname, "clips");
[UPLOAD_DIR, OUTPUT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(cors());
app.use("/clips", express.static(OUTPUT_DIR)); // supaya klip hasil bisa diunduh langsung dari browser

const upload = multer({ dest: UPLOAD_DIR });

/**
 * POST /api/process
 * form-data: video (file), numClips (int), ratio (string, e.g. "9:16")
 */
app.post("/api/process", upload.single("video"), async (req, res) => {
  const videoPath = req.file?.path;
  const numClips = parseInt(req.body.numClips || "10", 10);
  const ratio = req.body.ratio || "9:16";

  if (!videoPath) {
    return res.status(400).json({ error: "No video file uploaded" });
  }

  try {
    const jobId = Date.now().toString();
    const jobOutputDir = path.join(OUTPUT_DIR, jobId);
    fs.mkdirSync(jobOutputDir, { recursive: true });

    // 1. Jalankan ranking engine (Python) untuk dapat timestamp klip terbaik + transkrip kata
    const { clips: rankedClips, words } = await runRankingEngine(videoPath, numClips);

    // 2. Potong & crop tiap segmen pakai FFmpeg, lalu bakar caption otomatis
    const captionStyle = req.body.captionStyle || "karaoke_bold";
    const results = [];
    for (const clip of rankedClips) {
      const rawFile = path.join(jobOutputDir, `clip_${clip.rank}_raw.mp4`);
      const assFile = path.join(jobOutputDir, `clip_${clip.rank}.ass`);
      const finalFile = path.join(jobOutputDir, `clip_${clip.rank}.mp4`);

      await cutAndCropClip(videoPath, rawFile, clip.start, clip.end, ratio);

      // Ambil kata-kata yang jatuh dalam rentang klip ini, geser timestamp ke waktu relatif klip
      const clipWords = (words || [])
        .filter(w => w.start >= clip.start && w.end <= clip.end)
        .map(w => ({ word: w.word, start: w.start - clip.start, end: w.end - clip.start }));

      if (clipWords.length > 0) {
        await generateCaptionFile(clipWords, assFile, captionStyle);
        await burnCaptions(rawFile, assFile, finalFile);
        fs.unlink(rawFile, () => {});
      } else {
        fs.renameSync(rawFile, finalFile);
      }

      results.push({
        rank: clip.rank,
        score: clip.score,
        reason: clip.reason,
        start: clip.start,
        end: clip.end,
        downloadUrl: `/clips/${jobId}/clip_${clip.rank}.mp4`,
      });
    }

    res.json({ jobId, clips: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    // Hapus file upload asli setelah selesai diproses
    fs.unlink(videoPath, () => {});
  }
});

/**
 * Menjalankan rank_clips.py sebagai child process dan parse output JSON-nya.
 * Mengembalikan { clips, words }.
 */
function runRankingEngine(videoPath, numClips) {
  return new Promise((resolve, reject) => {
    const py = spawn("python3", ["rank_clips.py", videoPath, String(numClips)]);

    let stdout = "";
    let stderr = "";

    py.stdout.on("data", (data) => (stdout += data.toString()));
    py.stderr.on("data", (data) => (stderr += data.toString()));

    py.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`Ranking engine gagal: ${stderr}`));
      }
      try {
        const jsonStart = stdout.indexOf("{");
        const parsed = JSON.parse(stdout.slice(jsonStart));
        resolve(parsed); // { clips: [...], words: [...] }
      } catch (e) {
        reject(new Error(`Gagal parse output ranking engine: ${e.message}`));
      }
    });
  });
}

/**
 * Memanggil generate_captions.py untuk membuat file .ass dari word-level timestamps.
 */
function generateCaptionFile(words, outputAssPath, style) {
  return new Promise((resolve, reject) => {
    const wordsJsonPath = outputAssPath.replace(".ass", "_words.json");
    fs.writeFileSync(wordsJsonPath, JSON.stringify(words));

    const py = spawn("python3", [
      "generate_captions_cli.py",
      wordsJsonPath,
      outputAssPath,
      style,
    ]);

    let stderr = "";
    py.stderr.on("data", (d) => (stderr += d.toString()));

    py.on("close", (code) => {
      fs.unlink(wordsJsonPath, () => {});
      if (code !== 0) return reject(new Error(`Gagal membuat caption: ${stderr}`));
      resolve(outputAssPath);
    });
  });
}

/**
 * Membakar file .ass ke video pakai FFmpeg subtitles filter.
 */
function burnCaptions(inputPath, assPath, outputPath) {
  return new Promise((resolve, reject) => {
    // FFmpeg butuh path di-escape khusus untuk filter subtitles
    const escapedAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
    const args = [
      "-i", inputPath,
      "-vf", `subtitles='${escapedAss}'`,
      "-c:v", "libx264",
      "-c:a", "copy",
      "-y",
      outputPath,
    ];

    const ff = spawn("ffmpeg", args);
    let stderr = "";
    ff.stderr.on("data", (d) => (stderr += d.toString()));

    ff.on("close", (code) => {
      if (code !== 0) return reject(new Error(`FFmpeg burn-in gagal: ${stderr}`));
      resolve();
    });
  });
}

/**
 * Memotong video sesuai start/end lalu crop ke rasio target pakai FFmpeg.
 * Catatan: crop di sini pakai center-crop sederhana.
 * Untuk face-tracking asli, ganti filter crop dengan koordinat dari MediaPipe.
 */
function cutAndCropClip(inputPath, outputPath, start, end, ratio) {
  return new Promise((resolve, reject) => {
    const duration = (parseFloat(end) - parseFloat(start)).toFixed(2);

    let cropFilter;
    if (ratio === "9:16") {
      cropFilter = "crop=ih*9/16:ih";
    } else if (ratio === "1:1") {
      cropFilter = "crop=ih:ih";
    } else {
      cropFilter = "crop=iw:iw*9/16"; // fallback untuk 16:9
    }

    const args = [
      "-ss", String(start),
      "-i", inputPath,
      "-t", String(duration),
      "-vf", cropFilter,
      "-c:v", "libx264",
      "-c:a", "aac",
      "-y",
      outputPath,
    ];

    const ff = spawn("ffmpeg", args);
    let stderr = "";
    ff.stderr.on("data", (d) => (stderr += d.toString()));

    ff.on("close", (code) => {
      if (code !== 0) return reject(new Error(`FFmpeg gagal: ${stderr}`));
      resolve();
    });
  });
}

app.listen(PORT, () => {
  console.log(`Reelly backend berjalan di http://localhost:${PORT}`);
});
