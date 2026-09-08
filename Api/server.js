const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());

// Gunakan folder /tmp karena Vercel hanya mengizinkan tulis file di folder ini
const UPLOAD_DIR = path.join("/tmp", "uploads");
const OUTPUT_DIR = path.join("/tmp", "clips");

[UPLOAD_DIR, OUTPUT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const upload = multer({ dest: UPLOAD_DIR });

// Route backend untuk memproses video
app.post("/api/process", upload.single("video"), async (req, res) => {
  const videoPath = req.file?.path;
  const numClips = parseInt(req.body.numClips || "10", 10);
  const ratio = req.body.ratio || "9:16";

  if (!videoPath) return res.status(400).json({ error: "No video file uploaded" });

  try {
    const jobId = Date.now().toString();
    const jobOutputDir = path.join(OUTPUT_DIR, jobId);
    fs.mkdirSync(jobOutputDir, { recursive: true });

    // Panggil script python yang berada di folder yang sama (api/)
    const pythonScriptPath = path.join(__dirname, "rank_clips.py");
    const { clips: rankedClips, words } = await runRankingEngine(pythonScriptPath, videoPath, numClips);

    res.json({ jobId, clips: rankedClips });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
  }
});

function runRankingEngine(scriptPath, videoPath, numClips) {
  return new Promise((resolve, reject) => {
    const py = spawn("python3", [scriptPath, videoPath, String(numClips)]);
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
        reject(new Error(`Gagal parse output python: ${e.message}`));
      }
    });
  });
}

// Export fungsi agar dikenali oleh sistem Serverless Vercel
module.exports = app;
