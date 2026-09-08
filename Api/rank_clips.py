"""
Reelly — Virality Ranking Engine
---------------------------------
Pipeline:
  1. Transcribe a local video/audio file with Whisper (word-level timestamps).
  2. Send the timestamped transcript to a local LLM via Ollama.
  3. Ask the model to pick the best clip-worthy segments and score them.
  4. Get back clean JSON with start/end timestamps, a score, and a reason.

Requirements:
  pip install faster-whisper requests

Ollama must be running locally with a model pulled, e.g.:
  ollama pull llama3
  ollama serve
"""

import json
import re
import requests
from faster_whisper import WhisperModel

OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3"


def transcribe(video_path: str, model_size: str = "small"):
    """Transcribe audio/video and return word-level timestamped segments."""
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, _ = model.transcribe(video_path, word_timestamps=True)

    words = []
    for segment in segments:
        for word in segment.words:
            words.append({
                "word": word.word.strip(),
                "start": round(word.start, 2),
                "end": round(word.end, 2),
            })
    return words


def build_transcript_block(words):
    """Turn word list into a readable [start-end] text block for the prompt."""
    lines = []
    for w in words:
        lines.append(f"[{w['start']}-{w['end']}] {w['word']}")
    return "\n".join(lines)


def build_prompt(transcript_block: str, num_clips: int):
    return f"""You are a viral short-video editor. Below is a word-level timestamped transcript
from a longer video. Your job is to find the {num_clips} best standalone segments that would work
as short vertical clips (15-90 seconds each).

Rules:
- Each segment must be a complete, self-contained thought (clear start and end, no cut mid-sentence).
- Prioritize segments with a strong hook in the first 3 seconds, an emotional beat, a clear point,
  a surprising statement, or a punchy conclusion.
- Segments must not overlap.
- Use the exact timestamps from the transcript for "start" and "end".
- Score each segment 0-100 for how likely it is to perform well as a short clip.
- Give a short one-sentence reason for the score.

Return ONLY a JSON array, no other text, no markdown fences. Format:
[
  {{"rank": 1, "start": 12.4, "end": 45.8, "score": 94, "reason": "Strong emotional hook and a clear punchline."}},
  ...
]

TRANSCRIPT:
{transcript_block}
"""


def call_ollama(prompt: str, model: str = OLLAMA_MODEL):
    response = requests.post(
        OLLAMA_URL,
        json={"model": model, "prompt": prompt, "stream": False},
        timeout=600,
    )
    response.raise_for_status()
    return response.json()["response"]


def parse_json_response(raw_text: str):
    """Strip markdown fences / stray text and parse the JSON array."""
    cleaned = re.sub(r"^```(json)?|```$", "", raw_text.strip(), flags=re.MULTILINE).strip()
    match = re.search(r"\[.*\]", cleaned, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON array found in model response:\n{raw_text}")
    return json.loads(match.group(0))


def rank_clips(video_path: str, num_clips: int = 10, whisper_model_size: str = "small"):
    print(f"[1/3] Transcribing {video_path} ...")
    words = transcribe(video_path, model_size=whisper_model_size)

    print("[2/3] Asking local LLM to rank clip candidates ...")
    transcript_block = build_transcript_block(words)
    prompt = build_prompt(transcript_block, num_clips)
    raw_response = call_ollama(prompt)

    print("[3/3] Parsing results ...")
    clips = parse_json_response(raw_response)
    clips = sorted(clips, key=lambda c: c.get("rank", 999))
    return clips


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python rank_clips.py <video_or_audio_path> [num_clips]")
        sys.exit(1)

    path = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 10

    results = rank_clips(path, num_clips=n)
    print(json.dumps(results, indent=2))
