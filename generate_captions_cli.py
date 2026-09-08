"""
CLI wrapper untuk generate_captions.py — dipanggil dari server.js.

Usage:
  python generate_captions_cli.py <words.json> <output.ass> <style_name>
"""

import sys
import json
from generate_captions import words_to_ass, CAPTION_PRESETS


def main():
    if len(sys.argv) < 3:
        print("Usage: python generate_captions_cli.py <words.json> <output.ass> [style_name]", file=sys.stderr)
        sys.exit(1)

    words_json_path = sys.argv[1]
    output_ass_path = sys.argv[2]
    style_name = sys.argv[3] if len(sys.argv) > 3 else "karaoke_bold"

    with open(words_json_path, "r", encoding="utf-8") as f:
        words = json.load(f)

    preset = CAPTION_PRESETS.get(style_name, CAPTION_PRESETS["karaoke_bold"])
    words_to_ass(words, output_ass_path, words_per_line=preset["words_per_line"])
    print(f"Caption generated: {output_ass_path}")


if __name__ == "__main__":
    main()
