#!/usr/bin/env bash
# Convert a WebM recording from the capture panel into an MP4 for X/Twitter.
# Usage: scripts/webm-to-mp4.sh iris-afterimage-123.webm [out.mp4]
set -euo pipefail
in="${1:?usage: webm-to-mp4.sh input.webm [output.mp4]}"
out="${2:-${in%.*}.mp4}"
command -v ffmpeg >/dev/null || { echo "ffmpeg is required (brew install ffmpeg)" >&2; exit 1; }
# H.264 high profile, yuv420p for broad player support, constant 60 fps,
# dimensions rounded to even numbers, faststart for streaming.
ffmpeg -y -i "$in" -c:v libx264 -preset slow -crf 18 -profile:v high -pix_fmt yuv420p \
  -vf "fps=60,scale=trunc(iw/2)*2:trunc(ih/2)*2" -movflags +faststart -an "$out"
echo "wrote $out"
