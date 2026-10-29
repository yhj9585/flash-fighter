"""Create game assets from FFDec's original vector exports and embedded audio.

No character is redrawn. Crops only separate objects that share one SWF shape.
Run after tools/extract-assets.ps1. Requires Python 3 and ffmpeg on PATH.
"""
from pathlib import Path
import json
import math
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)
ET.register_namespace('xlink', 'http://www.w3.org/1999/xlink')

# name, source SWF, DefineShape character id, normalized SVG crop, optional clip
VECTORS = [
    ('characters/tuna-idle', 'tuna', 106, None, None),
    ('characters/tuna-walk', 'tuna', 79, None, None),
    ('characters/tuna-jump', 'tuna', 4, [0, 8, 181, 266], None),
    ('characters/tuna-kick', 'tuna', 93, None, None),
    ('characters/tuna-hurt', 'tuna', 81, [0, 0, 232, 320], None),
    ('characters/thief-idle', 'tuna', 126, [77, 93, 174, 221], '77,130 109,130 109,93 251,93 251,314 77,314'),
    ('characters/hacker-idle', 'hacker', 183, [0, 90, 116, 256], None),
    ('characters/hacker-attack', 'hacker', 186, [0, 0, 207, 236.5], None),
    ('characters/hacker-kick', 'hacker', 237, [175, 0, 346, 436.35], None),
    ('characters/hacker-hurt', 'hacker', 152, None, None),
    ('characters/angry-idle', 'hacker', 149, None, None),
    ('characters/angry-fire', 'hacker', 155, None, None),
    ('characters/fries-idle', 'fries', 288, None, None),
    ('characters/fries-dash', 'fries', 290, [54, 0, 66, 82], None),
    ('characters/fries-hurt', 'fries', 291, [54, 0, 66, 82], None),
    ('characters/fries-hold', 'fries', 48, [95, 61, 335, 300], '194,61 430,61 430,361 194,361 194,263 118,263 110,218 96,189 96,179 123,154 181,154 194,140'),
    ('characters/cross-idle', 'cross', 640, None, None),
    ('characters/cross-strum', 'cross', 651, None, None),
    ('characters/cross-jump', 'cross', 690, None, None),
    ('characters/cross-hurt', 'cross', 696, None, None),
    ('characters/cross-magic', 'cross', 480, [150, 155, 207, 172.15], None),
    ('characters/emerald-windup', 'emerald', 233, None, None),
    ('characters/emerald-idle', 'emerald', 101, None, None),
    ('characters/emerald-cast', 'emerald', 177, None, None),
    ('characters/emerald-strike', 'emerald', 236, None, None),
    ('characters/emerald-hurt', 'emerald', 145, None, None),
    ('characters/emerald-sing', 'emerald', 12, None, None),
    ('props/tuna-can', 'tuna', 24, None, None),
    ('props/pepper', 'tuna', 20, None, None),
    ('props/rice', 'tuna', 120, [0, 55, 204, 185], None),
    ('props/note', 'tuna', 9, None, None),
    ('props/file', 'hacker', 38, None, None),
    ('props/fire', 'hacker', 59, None, None),
    ('props/blast', 'hacker', 98, None, None),
    ('props/window', 'hacker', 54, None, None),
    ('props/fries', 'fries', 48, [95, 154, 85, 107], '123,154 173,154 180,174 176,245 157,261 121,260 110,218 96,189 96,180 111,171 123,174'),
    ('props/beans', 'cross', 9, [303, 10, 156, 99], None),
    ('props/magic', 'cross', 480, [153, 217, 66, 90], None),
    ('props/fishcake', 'emerald', 201, None, None),
    ('props/phoenix', 'emerald', 89, None, None),
    ('stages/fridge', 'tuna', 51, None, None),
    ('stages/computer', 'hacker', 91, [0, 0, 241, 292.45], None),
]

# The intervals are in the audio embedded in the original SWF, in seconds.
# Keep a little lead-in and several seconds of the original passage instead of
# the old 1-2 second snippets. Hurt reactions stay shorter for frequent hits;
# music runs for a minute before repeating. Scene references are unchanged
# root-timeline frames, counted from 1 (not the first frame of each audio cut).
AUDIO = [
    ('tuna-select', 'tuna', 13.75, 3.65, 197),
    ('tuna-special', 'tuna', 43.35, 3.50, 611),
    ('tuna-super', 'tuna', 65.00, 5.00, 916),
    ('tuna-hurt', 'tuna', 64.25, 1.50, 905),
    ('tuna-win', 'tuna', 46.90, 4.80, 664),
    ('thief-select', 'tuna', 44.70, 3.65, 631),
    ('thief-special', 'tuna', 44.70, 3.65, 631),
    ('thief-super', 'tuna', 71.30, 4.80, 1003),
    ('hacker-select', 'hacker', 4.80, 4.20, 51),
    ('hacker-special', 'hacker', 46.75, 4.20, 471),
    ('hacker-super', 'hacker', 101.80, 5.60, 1021),
    ('hacker-hurt', 'hacker', 23.50, 1.50, 237),
    ('hacker-win', 'hacker', 138.25, 4.80, 1386),
    ('angry-select', 'hacker', 74.25, 4.20, 746),
    ('angry-special', 'hacker', 83.90, 4.50, 841),
    ('angry-super', 'hacker', 54.25, 5.40, 546),
    ('fries-select', 'fries', 18.65, 3.80, 226),
    ('fries-special', 'fries', 18.65, 3.80, 226),
    ('fries-super', 'fries', 38.15, 4.80, 460),
    ('fries-hurt', 'fries', 38.40, 1.40, 463),
    ('fries-win', 'fries', 116.57, 4.50, 1401),
    ('cross-select', 'cross', 129.32, 4.20, 1554),
    ('cross-special', 'cross', 101.32, 3.80, 1218),
    ('cross-magic', 'cross', 102.32, 3.80, 1230),
    ('cross-super', 'cross', 133.65, 5.40, 1606),
    ('cross-hurt', 'cross', 137.73, 1.40, 1655),
    ('cross-win', 'cross', 130.23, 4.50, 1565),
    ('emerald-select', 'emerald', 63.48, 4.20, 1557),
    ('emerald-special', 'emerald', 114.69, 4.20, 2786),
    ('emerald-super', 'emerald', 59.98, 5.60, 1473),
    ('emerald-hurt', 'emerald', 95.03, 1.50, 2314),
    ('emerald-win', 'emerald', 102.78, 4.80, 2500),
    ('tuna-loop', 'tuna', 15.80, 60.00, 223),
    ('hacker-loop', 'hacker', 3.50, 60.00, 36),
]

manifest = {'vectors': {}, 'audio': {}, 'sourceFiles': {}}
SOUND_FILES = {'tuna': '-1.mp3', 'hacker': '11.mp3', 'fries': '-1.mp3', 'cross': '-1.mp3', 'emerald': '9.mp3'}
for source in SOUND_FILES:
    root = ET.parse(ROOT / f'tools/{source}.xml').getroot()
    manifest['sourceFiles'][source] = {
        'frameRate': float(root.get('frameRate')),
        'frameCount': int(root.get('frameCount')),
        'version': int(root.get('version')),
    }
    if source == 'emerald':
        # FFDec's sound export skips this movie's nested streaming MP3.
        # SWF MP3 stream blocks prepend a 16-bit sample count and seek value.
        sprite = next(t for t in root.iter('item') if t.get('type') == 'DefineSpriteTag' and t.get('spriteId') == '9')
        sound_dir = ROOT / 'tools/export-emerald/sounds'
        sound_dir.mkdir(parents=True, exist_ok=True)
        with (sound_dir / '9.mp3').open('wb') as output:
            for tag in sprite.find('subTags'):
                if tag.get('type') == 'SoundStreamBlockTag':
                    output.write(bytes.fromhex(tag.get('streamSoundData'))[4:])
        manifest['sourceFiles'][source]['audioSpriteId'] = 9
        manifest['sourceFiles'][source]['audioStartRootFrame'] = 31

for name, source, character, crop, clip in VECTORS:
    root = ET.parse(ROOT / f'tools/export-{source}/shapes/{character}.svg').getroot()
    width = float(root.get('width').replace('px', ''))
    height = float(root.get('height').replace('px', ''))
    box = crop or [0, 0, width, height]
    root.set('viewBox', ' '.join(str(v) for v in box))
    root.set('width', str(box[2]))
    root.set('height', str(box[3]))
    root.set('data-source', f'{source}.swf / DefineShape {character}')
    if clip:
        children = list(root)
        for child in children: root.remove(child)
        defs = ET.SubElement(root, f'{{{NS}}}defs')
        path = ET.SubElement(defs, f'{{{NS}}}clipPath', {'id': 'isolate-character'})
        ET.SubElement(path, f'{{{NS}}}polygon', {'points': clip})
        group = ET.SubElement(root, f'{{{NS}}}g', {'clip-path': 'url(#isolate-character)'})
        for child in children: group.append(child)
    dest = ROOT / f'assets/{name}.svg'
    dest.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(root).write(dest, encoding='utf-8', xml_declaration=True)
    manifest['vectors'][name] = {'source': source, 'characterId': character, 'crop': crop}

VOICE_LUFS = -18.0
MUSIC_LUFS = -20.0
TRUE_PEAK_DBTP = -3.0
LOUDNESS_RANGE_LU = 7.0


def measure_loudness(path, target):
    """Read EBU R128 measurements from the actual PCM, not peak amplitude."""
    result = subprocess.run([
        'ffmpeg', '-hide_banner', '-nostats', '-i', str(path),
        '-af', f'loudnorm=I={target}:TP={TRUE_PEAK_DBTP}:LRA={LOUDNESS_RANGE_LU}:print_format=json',
        '-f', 'null', '-'
    ], check=True, capture_output=True, text=True, encoding='utf-8', errors='replace')
    match = re.search(r'\{\s*"input_i".*?\}', result.stderr, re.DOTALL)
    if not match:
        raise RuntimeError(f'No loudness measurement for {path}')
    stats = json.loads(match.group())
    for key in ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']:
        if not math.isfinite(float(stats[key])):
            raise ValueError(f'Cannot normalize silent or invalid audio: {path} ({key})')
    return stats


audio_dir = ROOT / 'assets/audio'
audio_dir.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='.audio-build-', dir=ROOT / 'tools') as temporary:
    if Path(temporary).resolve().parent != (ROOT / 'tools').resolve():
        raise ValueError('Audio build temporary directory must remain inside tools/')
    for name, source, start, duration, frame in AUDIO:
        source_file = ROOT / f'tools/export-{source}/sounds/{SOUND_FILES[source]}'
        target = MUSIC_LUFS if name.endswith('-loop') else VOICE_LUFS
        fade_in = 0.08 if name.endswith('-loop') else 0.015
        fade_out = 0.35 if name.endswith('-loop') else 0.12
        raw_clip = Path(temporary) / f'{name}.wav'
        # Keep float PCM until normalization so loud original MP3s do not clip
        # during an intermediate conversion to 16-bit samples.
        subprocess.run([
            'ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-i', str(source_file),
            '-t', str(duration), '-af',
            f'aformat=sample_rates=44100:channel_layouts=mono,afade=t=in:d={fade_in},afade=t=out:st={duration-fade_out}:d={fade_out}',
            '-ar', '44100', '-ac', '1', '-codec:a', 'pcm_f32le', str(raw_clip)
        ], check=True)
        measured = measure_loudness(raw_clip, target)
        normalization = (
            f'loudnorm=I={target}:TP={TRUE_PEAK_DBTP}:LRA={LOUDNESS_RANGE_LU}'
            f':measured_I={measured["input_i"]}:measured_TP={measured["input_tp"]}'
            f':measured_LRA={measured["input_lra"]}:measured_thresh={measured["input_thresh"]}'
            f':offset={measured["target_offset"]}:linear=true'
        )
        output = audio_dir / f'{name}.wav'
        subprocess.run([
            'ffmpeg', '-v', 'error', '-y', '-i', str(raw_clip),
            '-t', str(duration), '-af', normalization,
            '-ar', '44100', '-ac', '1', '-codec:a', 'pcm_s16le', str(output)
        ], check=True)
        # Verify again after resampling and quantization; record final-file
        # measurements so future rebuilds and QA can audit the same targets.
        actual = measure_loudness(output, target)
        integrated, peak = float(actual['input_i']), float(actual['input_tp'])
        # On a short passage with large transient peaks, loudnorm's dynamic
        # mode can undershoot its own target. Use measured gain and a peak-only
        # limiter in that case, always rendering from the unmodified float cut.
        if abs(integrated-target) > 0.6 or peak > TRUE_PEAK_DBTP+0.3:
            gain = target-float(measured['input_i'])
            for attempt in range(4):
                limiter = (
                    f'volume={gain}dB,aresample=192000,'
                    f'alimiter=limit={10**(TRUE_PEAK_DBTP/20)}:level=false:latency=true,aresample=44100'
                )
                subprocess.run([
                    'ffmpeg', '-v', 'error', '-y', '-i', str(raw_clip), '-t', str(duration),
                    '-af', limiter, '-ar', '44100', '-ac', '1', '-codec:a', 'pcm_s16le', str(output)
                ], check=True)
                actual = measure_loudness(output, target)
                integrated, peak = float(actual['input_i']), float(actual['input_tp'])
                if abs(integrated-target) <= 0.3 and peak <= TRUE_PEAK_DBTP+0.3:
                    break
                gain += target-integrated
        if abs(integrated-target) > 0.6 or peak > TRUE_PEAK_DBTP+0.3:
            raise ValueError(f'Audio normalization outside target: {name}, {integrated} LUFS / {peak} dBTP')
        manifest['audio'][name] = {
            'source': source, 'file': f'audio/{name}.wav', 'start': start,
            'duration': duration, 'sceneFrame': frame,
            'normalization': {
                'method': 'ebu-r128', 'targetLufs': target,
                'integratedLufs': integrated, 'truePeakDbtp': peak,
                'loudnessRangeLu': float(actual['input_lra']),
                'originalIntegratedLufs': float(measured['input_i']),
            },
        }

(ROOT / 'assets/manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'Built {len(VECTORS)} original vector assets and {len(AUDIO)} loudness-normalized original audio clips.')
