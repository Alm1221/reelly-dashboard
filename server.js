/**
 * Reelly Backend Server - Vercel Fixed Edition
 * --------------------------------------------
 */

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();

// Menggunakan port bawaan Vercel atau default ke 3000
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join("/tmp", "uploads");
const OUTPUT_DIR = path.join("/tmp", "clips");

[UPLOAD_DIR, OUTPUT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(cors());
app.use(express.static(__dirname)); 
app.use("/clips", express.static(OUTPUT_DIR)); 

// Menampilkan halaman dashboard utama saat root diakses
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "reelly-dashboard.html"));
});

const upload = multer({ dest: UPLOAD_DIR });

/**
 * POST /api/process
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

    const { clips: rankedClips, words } = await runRankingEngine(videoPath, numClips);

    const captionStyle = req.body.captionStyle || "karaoke_bold";
    const results = [];
    for (const clip of rankedClips) {
      const rawFile = path.join(jobOutputDir, `clip_${clip.rank}_raw.mp4`);
      const assFile = path.join(jobOutputDir, `clip_${clip.rank}.ass`);
      const finalFile = path.join(jobOutputDir, `clip_${clip.rank}.mp4`);

      await cutAndCropClip(videoPath, rawFile, clip.start, clip.end, ratio);

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
    fs.unlink(videoPath, () => {});
  }
});

function runRankingEngine(videoPath, numClips) {
  return new Promise((resolve, reject) => {
    const py = spawn("python3", ["rank_clips.py", videoPath, String(numClips)]);
    let stdout = "";
    let stderr = "";
    py.stdout.on("data", (data) => (stdout += data.toString()));
    py.stderr.on("data", (data) => (stderr += data.toString()));
    py.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Ranking engine gagal: ${stderr}`));
      try {
        const jsonStart = stdout.indexOf("{");
        const parsed = JSON.parse(stdout.slice(jsonStart));
        resolve(parsed);
      } catch (e) {
        reject(new Error(`Gagal parse output ranking engine: ${e.message}`));
      }
    });
  });
}

function generateCaptionFile(words, outputAssPath, style) {
  return new Promise((resolve, reject) => {
    const wordsJsonPath = outputAssPath.replace(".ass", "_words.json");
    fs.writeFileSync(wordsJsonPath, JSON.stringify(words));

    const py = spawn("python3", ["generate_captions_cli.py", wordsJsonPath, outputAssPath, style]);
    let stderr = "";
    py.stderr.on("data", (d) => (stderr += d.toString()));
    py.on("close", (code) => {
      fs.unlink(wordsJsonPath, () => {});
      if (code !== 0) return reject(new Error(`Gagal membuat caption: ${stderr}`));
      resolve(outputAssPath);
    });
  });
}

function burnCaptions(inputPath, assPath, outputPath) {
  return new Promise((resolve, reject) => {
    const escapedAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
    const args = ["-i", inputPath, "-vf", `subtitles='${escapedAss}'`, "-c:v", "libx264", "-c:a", "copy", "-y", outputPath];
    const ff = spawn("ffmpeg", args);
    let stderr = "";
    ff.stderr.on("data", (d) => (stderr += d.toString()));
    ff.on("close", (code) => {
      if (code !== 0) return reject(new Error(`FFmpeg burn-in gagal: ${stderr}`));
      resolve();
    });
  });
}

function cutAndCropClip(inputPath, outputPath, start, end, ratio) {
  return new Promise((resolve, reject) => {
    const duration = (parseFloat(end) - parseFloat(start)).toFixed(2);
    let cropFilter = ratio === "9:16" ? "crop=ih*9/16:ih" : ratio === "1:1" ? "crop=ih:ih" : "crop=iw:iw*9/16";
    const args = ["-ss", String(start), "-i", inputPath, "-t", String(duration), "-vf", cropFilter, "-c:v", "libx264", "-c:a", "aac", "-y", outputPath];
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
    console.log(`Server berjalan lancar pada port ${PORT}`);
});
