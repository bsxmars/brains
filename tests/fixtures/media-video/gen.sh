#!/bin/bash
# Стенд темы «Видео в браузере» (src/content/lessons/media-video). Перегенерировать: bash gen.sh
# Картинка — testsrc2 (номер кадра и бегущая полоса), 10 к/с; звук — тон 440 Гц.
set -e
cd "$(dirname "$0")"
Q=(-hide_banner -loglevel error -y)
V2=(-f lavfi -i testsrc2=size=160x90:rate=10:duration=2)
A2=(-f lavfi -i sine=frequency=440:duration=2)

# Обычные файлы по 2 с: webm (VP9 + Opus), mp4 (H.264 + AAC, индекс в начале), webm без звука.
ffmpeg "${Q[@]}" "${V2[@]}" "${A2[@]}" -c:v libvpx-vp9 -b:v 60k -g 10 -c:a libopus -b:a 24k clip.webm
ffmpeg "${Q[@]}" "${V2[@]}" "${A2[@]}" -c:v libx264 -profile:v baseline -level 3.0 -pix_fmt yuv420p -b:v 60k -g 10 \
  -c:a aac -b:a 32k -movflags +faststart clip.mp4
ffmpeg "${Q[@]}" "${V2[@]}" -c:v libvpx-vp9 -b:v 60k -g 10 silent.webm

# HLS из фрагментированного mp4: 4 с, куски по 1 с, два качества с одним кодеком (avc1.42C01E).
for q in 160x90:low:50k 320x180:high:150k; do
  IFS=: read -r size name rate <<< "$q"
  mkdir -p "hls/$name"
  ffmpeg "${Q[@]}" -f lavfi -i "testsrc2=size=$size:rate=10:duration=4" \
    -c:v libx264 -profile:v baseline -level 3.0 -pix_fmt yuv420p -b:v "$rate" -g 10 -keyint_min 10 -sc_threshold 0 -an \
    -f hls -hls_time 1 -hls_playlist_type vod -hls_segment_type fmp4 \
    -hls_fmp4_init_filename init.mp4 -hls_segment_filename "hls/$name/%d.m4s" "hls/$name/index.m3u8"
done
cat > hls/index.m3u8 <<'M3U8'
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=60000,RESOLUTION=160x90,CODECS="avc1.42C01E"
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=160000,RESOLUTION=320x180,CODECS="avc1.42C01E"
high/index.m3u8
M3U8
