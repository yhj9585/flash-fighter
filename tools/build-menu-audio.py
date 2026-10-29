"""Build the full-length, loudness-matched menu playlist from ost-1/.

Requires Python 3 and ffmpeg/ffprobe on PATH. Source WebM files are preserved.
The game serves the compact MP3 copies from assets/audio/menu/.
"""
from pathlib import Path
import hashlib
import json
import math
import re
import shutil
import subprocess
import tempfile
import wave


ROOT = Path(__file__).resolve().parent.parent
TARGET_LUFS = -20.0
# Leave a little room for MP3 reconstruction peaks after encoding.
ENCODER_PEAK_DBTP = -3.5
MAX_FINAL_PEAK_DBTP = -2.7
TRACKS = [
    ('menu-tuna-mr', 'tuna-mr', '고추참치 MR', '[음원] 고추참치 MR [rQpKRqyHxg4].webm'),
    ('menu-shiho', 'shiho', "The Queen of Heart'99 · 長岡志保", "The Queen of Heart'99 BGM 長岡志保 [wKShHtnhdlQ].webm"),
    ('menu-blue-sky', 'blue-sky', 'Virtual On · Into the Blue Sky', 'Virtual On - Into the Blue Sky Music [nfqhwP2_T4g].webm'),
]


def run(*args, capture=False):
    return subprocess.run(list(args), check=True, capture_output=capture,
                          text=capture, encoding='utf-8' if capture else None,
                          errors='replace' if capture else None)


def probe(path):
    result = run('ffprobe', '-v', 'error', '-show_entries',
                 'format=duration:stream=codec_name,sample_rate,channels',
                 '-of', 'json', str(path), capture=True)
    return json.loads(result.stdout)


def measure(path):
    result = run('ffmpeg', '-hide_banner', '-nostats', '-i', str(path), '-af',
                 f'loudnorm=I={TARGET_LUFS}:TP={ENCODER_PEAK_DBTP}:LRA=7:print_format=json',
                 '-f', 'null', '-', capture=True)
    match = re.search(r'\{\s*"input_i".*?\}', result.stderr, re.DOTALL)
    if not match:
        raise RuntimeError(f'No EBU R128 measurements for {path}')
    stats = json.loads(match.group())
    for key in ('input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'):
        if not math.isfinite(float(stats[key])):
            raise ValueError(f'Silent or invalid source: {path} ({key})')
    return stats


def encode(raw, destination, filters):
    run('ffmpeg', '-v', 'error', '-y', '-i', str(raw), '-map_metadata', '-1',
        '-af', filters, '-ar', '44100', '-ac', '2', '-codec:a', 'libmp3lame',
        '-q:a', '3', str(destination))


def main():
    for binary in ('ffmpeg', 'ffprobe'):
        if not shutil.which(binary):
            raise SystemExit(f'{binary} is required. Install it and add it to PATH.')
    output_dir = ROOT / 'assets/audio/menu'
    output_dir.mkdir(parents=True, exist_ok=True)
    records = []
    with tempfile.TemporaryDirectory(prefix='.menu-audio-build-', dir=ROOT / 'tools') as temporary:
        temporary = Path(temporary).resolve()
        if temporary.parent != (ROOT / 'tools').resolve():
            raise ValueError('Temporary menu-audio files must stay inside tools/')
        for name, stem, title, filename in TRACKS:
            source = ROOT / 'ost-1' / filename
            source_duration = float(probe(source)['format']['duration'])
            raw = temporary / f'{stem}.wav'
            # Decode every source sample; only the outer edges get short fades.
            run('ffmpeg', '-v', 'error', '-y', '-i', str(source), '-vn', '-af',
                f'aformat=sample_rates=44100:channel_layouts=stereo,afade=t=in:d=0.08,afade=t=out:st={max(0,source_duration-.35)}:d=0.35',
                '-ar', '44100', '-ac', '2', '-codec:a', 'pcm_f32le', str(raw))
            measured = measure(raw)
            normalization = (
                f'loudnorm=I={TARGET_LUFS}:TP={ENCODER_PEAK_DBTP}:LRA=7'
                f':measured_I={measured["input_i"]}:measured_TP={measured["input_tp"]}'
                f':measured_LRA={measured["input_lra"]}:measured_thresh={measured["input_thresh"]}'
                f':offset={measured["target_offset"]}:linear=true'
            )
            output = output_dir / f'{stem}.mp3'
            encode(raw, output, normalization)
            actual = measure(output)
            # If dynamic loudnorm undershoots, correct using the original float
            # PCM and a limiter rather than successively re-encoding the MP3.
            if abs(float(actual['input_i'])-TARGET_LUFS) > .3 or float(actual['input_tp']) > MAX_FINAL_PEAK_DBTP:
                gain = TARGET_LUFS-float(measured['input_i'])
                for _ in range(4):
                    filters = (
                        f'volume={gain}dB,aresample=192000,'
                        f'alimiter=limit={10**(ENCODER_PEAK_DBTP/20)}:level=false:latency=true,aresample=44100'
                    )
                    encode(raw, output, filters)
                    actual = measure(output)
                    if abs(float(actual['input_i'])-TARGET_LUFS) <= .3 and float(actual['input_tp']) <= MAX_FINAL_PEAK_DBTP:
                        break
                    gain += TARGET_LUFS-float(actual['input_i'])
            integrated, peak = float(actual['input_i']), float(actual['input_tp'])
            if abs(integrated-TARGET_LUFS) > .6 or peak > MAX_FINAL_PEAK_DBTP:
                raise ValueError(f'Final menu music outside target: {name}: {integrated} LUFS, {peak} dBTP')
            decoded = temporary / f'{stem}-decoded.wav'
            run('ffmpeg', '-v', 'error', '-y', '-i', str(output), '-codec:a', 'pcm_s16le', str(decoded))
            with wave.open(str(decoded), 'rb') as audio:
                duration = audio.getnframes()/audio.getframerate()
                if audio.getframerate() != 44100 or audio.getnchannels() != 2:
                    raise ValueError(f'Unexpected menu music format: {name}')
            if abs(duration-source_duration) > .05:
                raise ValueError(f'Menu music was truncated: {name}: source {source_duration}, output {duration}')
            records.append({
                'name': name, 'file': f'audio/menu/{stem}.mp3', 'title': title,
                'sourceFile': f'ost-1/{filename}',
                'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                'sourceDuration': source_duration, 'duration': duration,
                'bytes': output.stat().st_size, 'sampleRate': 44100, 'channels': 2,
                'normalization': {
                    'method': 'ebu-r128', 'targetLufs': TARGET_LUFS,
                    'integratedLufs': integrated, 'truePeakDbtp': peak,
                    'loudnessRangeLu': float(actual['input_lra']),
                    'originalIntegratedLufs': float(measured['input_i']),
                },
            })
            print(f'{name}: {duration:.3f}s, {integrated:.2f} LUFS, {peak:.2f} dBTP, {output.stat().st_size:,} bytes')
    manifest = ROOT / 'assets/menu-music.json'
    manifest.write_text(json.dumps({'tracks': records}, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(f'Built {len(records)} full-length menu tracks ({sum(track["duration"] for track in records):.3f}s total).')


if __name__ == '__main__':
    main()
