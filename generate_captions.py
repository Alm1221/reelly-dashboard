"""
Reelly — Caption Generator
----------------------------
Mengubah hasil transkrip Whisper (word-level timestamps) jadi file subtitle
.ass yang siap dibakar ke video oleh FFmpeg, dengan gaya karaoke
(kata disorot satu per satu, sesuai gaya caption pendek viral).

Requirements:
  pip install faster-whisper

Pipeline penuh: video -> transcribe() -> words_to_ass() -> ffmpeg burn-in
"""

import re


ASS_HEADER = """[Script Info]
Title: Reelly Auto Caption
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Montserrat,72,&H00FFFFFF,&H0000FFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,4,2,2,60,60,200,1
Style: Highlight,Montserrat,72,&H0000D6FF,&H0000FFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,4,2,2,60,60,200,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def seconds_to_ass_time(seconds: float) -> str:
    """Convert seconds (float) to ASS time format H:MM:SS.cc"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    centiseconds = int(round((secs - int(secs)) * 100))
    return f"{hours}:{minutes:02d}:{int(secs):02d}.{centiseconds:02d}"


def group_words_into_lines(words, max_words_per_line: int = 4, max_gap: float = 0.6):
    """Group individual timestamped words into short caption lines (2-4 words),
    matching the punchy on-screen style used in short-form video captions."""
    lines = []
    current = []

    for i, w in enumerate(words):
        current.append(w)
        is_last = i == len(words) - 1
        next_gap = (words[i + 1]["start"] - w["end"]) if not is_last else 0

        if len(current) >= max_words_per_line or is_last or next_gap > max_gap:
            lines.append(current)
            current = []

    return lines


def line_to_ass_events(line, style="Default", highlight_color="&H0000D6FF"):
    """Turn one caption line into one ASS dialogue event per word,
    so each word can be highlighted as it's spoken (karaoke effect)."""
    events = []
    line_start = line[0]["start"]
    line_end = line[-1]["end"]

    for i, active_word in enumerate(line):
        # Build the line text, wrapping the currently-spoken word in a color override
        parts = []
        for j, w in enumerate(line):
            clean_word = w["word"].strip()
            if j == i:
                parts.append(f"{{\\c{highlight_color}}}{clean_word}{{\\c&HFFFFFF&}}")
            else:
                parts.append(clean_word)
        text = " ".join(parts)

        start = active_word["start"]
        end = line[i + 1]["start"] if i + 1 < len(line) else line_end

        events.append({
            "start": start,
            "end": end,
            "style": style,
            "text": text,
        })

    return events


def words_to_ass(words, output_path: str, words_per_line: int = 4):
    """Full pipeline: word-level timestamps -> .ass subtitle file."""
    lines = group_words_into_lines(words, max_words_per_line=words_per_line)

    events_text = []
    for line in lines:
        events = line_to_ass_events(line)
        for e in events:
            start_ts = seconds_to_ass_time(e["start"])
            end_ts = seconds_to_ass_time(e["end"])
            events_text.append(
                f"Dialogue: 0,{start_ts},{end_ts},{e['style']},,0,0,0,,{e['text']}"
            )

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(ASS_HEADER)
        f.write("\n".join(events_text))

    return output_path


CAPTION_PRESETS = {
    "karaoke_bold": {
        "fontsize": 72,
        "highlight_color": "&H0000D6FF",  # cyan-ish highlight
        "words_per_line": 4,
    },
    "minimal_bottom": {
        "fontsize": 56,
        "highlight_color": "&H00FFFFFF",  # no real highlight, plain white
        "words_per_line": 8,
    },
    "colorful_pop": {
        "fontsize": 80,
        "highlight_color": "&H002BFFD4",  # lime/green highlight
        "words_per_line": 3,
    },
}


if __name__ == "__main__":
    # Example usage with dummy word timestamps (normally this comes from rank_clips.transcribe())
    sample_words = [
        {"word": "ini", "start": 0.0, "end": 0.3},
        {"word": "adalah", "start": 0.3, "end": 0.6},
        {"word": "contoh", "start": 0.6, "end": 1.0},
        {"word": "caption", "start": 1.0, "end": 1.5},
        {"word": "otomatis", "start": 1.5, "end": 2.1},
        {"word": "dari", "start": 2.1, "end": 2.3},
        {"word": "Reelly", "start": 2.3, "end": 2.8},
    ]
    path = words_to_ass(sample_words, "sample_caption.ass")
    print(f"Caption file generated: {path}")
