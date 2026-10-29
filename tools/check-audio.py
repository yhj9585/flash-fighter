"""Independently measure the shipped WAVs with ffmpeg's EBU R128 meter.

Run after build-assets.py. Requires Python 3 and ffmpeg on PATH; npm test does
not depend on ffmpeg. The report records measurements of the final PCM files,
not the normalization filter's predicted output.
"""
from pathlib import Path
import argparse
import json
import math
import re
import shutil
import subprocess
import sys
import wave


ROOT = Path(__file__).resolve().parent.parent
LOUDNESS_TOLERANCE = 0.6
TRUE_PEAK_CEILING = -2.7


def measure(path, target):
    result = subprocess.run([
        'ffmpeg', '-hide_banner', '-nostats', '-i', str(path),
        '-af', f'loudnorm=I={target}:TP=-3:LRA=7:print_format=json',
        '-f', 'null', '-',
    ], capture_output=True, text=True, check=True)
    matches = re.findall(r'\{\s*"input_i".*?\}', result.stderr, re.DOTALL)
    if not matches:
        raise ValueError('ffmpeg did not return EBU R128 measurements')
    stats = json.loads(matches[-1])
    values = {key: float(stats[key]) for key in ('input_i', 'input_tp', 'input_lra')}
    if not all(math.isfinite(value) for value in values.values()):
        raise ValueError('audio has non-finite loudness or true-peak measurements')
    return values


def check_clip(name, entry, asset_dir):
    target = -20 if name.endswith('-loop') else -18
    record = {'name': name, 'targetLufs': target, 'errors': []}
    try:
        path = asset_dir / entry['file']
        stats = measure(path, target)
        with wave.open(str(path), 'rb') as audio:
            duration = audio.getnframes() / audio.getframerate()
        record.update({
            'integratedLufs': stats['input_i'],
            'truePeakDbtp': stats['input_tp'],
            'loudnessRangeLu': stats['input_lra'],
            'duration': round(duration, 6),
        })
        if abs(stats['input_i'] - target) > LOUDNESS_TOLERANCE:
            record['errors'].append(f'loudness differs from target by {stats["input_i"] - target:+.2f} LU')
        if stats['input_tp'] > TRUE_PEAK_CEILING:
            record['errors'].append(f'true peak exceeds {TRUE_PEAK_CEILING} dBTP')
        if abs(duration - entry['duration']) >= .001:
            record['errors'].append('PCM duration differs from the recorded source interval')
        normalization = entry.get('normalization', {})
        if normalization.get('method') != 'ebu-r128' or normalization.get('targetLufs') != target:
            record['errors'].append('normalization profile is missing or incorrect')
        for key, actual in (('integratedLufs', stats['input_i']), ('truePeakDbtp', stats['input_tp']), ('loudnessRangeLu', stats['input_lra'])):
            recorded = normalization.get(key)
            if not isinstance(recorded, (int, float)) or not math.isfinite(recorded) or abs(recorded - actual) > .15:
                record['errors'].append(f'{key} metadata does not match the final WAV')
        original = normalization.get('originalIntegratedLufs')
        if not isinstance(original, (int, float)) or not math.isfinite(original):
            record['errors'].append('original loudness measurement is missing')
        else:
            record['originalIntegratedLufs'] = original
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError, wave.Error) as error:
        record['errors'].append(str(error))
    record['passed'] = not record['errors']
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=ROOT / 'assets/manifest.json')
    parser.add_argument('--report', type=Path, default=ROOT / 'artifacts/audio-loudness-results.json')
    args = parser.parse_args()
    if not shutil.which('ffmpeg'):
        parser.exit(2, 'ffmpeg is required for loudness verification. Install it and add it to PATH.\n')
    manifest = json.loads(args.manifest.read_text(encoding='utf-8-sig'))
    clips = [check_clip(name, entry, args.manifest.parent) for name, entry in manifest['audio'].items()]
    profiles = {}
    for label, is_music in (('voices', False), ('music', True)):
        group = [clip for clip in clips if clip['name'].endswith('-loop') == is_music and 'integratedLufs' in clip]
        if group:
            values = [clip['integratedLufs'] for clip in group]
            originals = [clip['originalIntegratedLufs'] for clip in group if 'originalIntegratedLufs' in clip]
            profiles[label] = {
                'count': len(group),
                'targetLufs': group[0]['targetLufs'],
                'minimumLufs': min(values), 'maximumLufs': max(values),
                'spreadLu': round(max(values) - min(values), 2),
                'maximumTruePeakDbtp': max(clip['truePeakDbtp'] for clip in group),
            }
            if originals:
                profiles[label]['originalSpreadLu'] = round(max(originals) - min(originals), 2)
    report = {'passed': bool(clips) and all(clip['passed'] for clip in clips), 'count': len(clips), 'profiles': profiles, 'clips': clips}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for clip in clips:
        if not clip['passed']:
            print(f'{clip["name"]}: {"; ".join(clip["errors"])}', file=sys.stderr)
    print(f'Audio loudness verification: {sum(clip["passed"] for clip in clips)}/{len(clips)} passed. Report: {args.report}')
    for label, profile in profiles.items():
        print(f'{label}: {profile["minimumLufs"]:.2f} to {profile["maximumLufs"]:.2f} LUFS; peak {profile["maximumTruePeakDbtp"]:.2f} dBTP')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
