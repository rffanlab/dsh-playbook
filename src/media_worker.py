"""Read-only validator, launched ONLY through the caller's DSH bash tool.

No pip packages, model, network, or arbitrary commands. Paths are confined to the
session workspace and media protocols to local files. Thresholds below are this
plugin's narrated-video policy, NOT platform rules or speech recognition.
"""
import array
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import unicodedata

VERSION = '0.4.0'
MAX_FILE = 512 * 1024 * 1024
MAX_TEXT = 1024 * 1024
MEDIA_FORMATS = 'mov,matroska,webm,avi,wav,mp3,flac,ogg,aac'
POLICY = {'noiseDb': -40, 'windowSeconds': 0.1, 'minLowSeconds': 0.3,
          'maxLowSeconds': 3.0, 'maxLowRatio': 0.5, 'maxDurationSeconds': 900,
          'avToleranceSeconds': 0.75}


class Invalid(Exception):
    pass


class Unavailable(Exception):
    pass


def require(condition, message):
    if not condition:
        raise Invalid(message)


def normalized(text):
    # Preserve punctuation and words; only whitespace and canonical Unicode differ.
    return re.sub(r'\s+', '', unicodedata.normalize('NFC', text.replace('\r\n', '\n')))


def text_hash(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def json_hash(value):
    return text_hash(json.dumps(value, ensure_ascii=False, separators=(',', ':')))


def prepare_workspace(isolation):
    require(isinstance(isolation, dict) and isolation.get('protocol') == 1, 'Missing Host isolation contract')
    key = isolation.get('key')
    require(isinstance(key, str) and re.fullmatch(r'[a-f0-9-]{36}', key), 'Invalid allocated workspace key')
    workspace = Path(isolation['workspace']).resolve(strict=True)
    require(Path.cwd().resolve() == workspace, 'Preparation cwd must be the Host session workspace')
    require(Path(isolation['root']) == Path(isolation['workspace']) / '.dsh-runs' / key, 'Invalid run root allocation')
    require(isinstance(isolation.get('runId'), str) and 0 < len(isolation['runId']) < 1024, 'Invalid run identity')
    parent = workspace / '.dsh-runs'
    try:
        parent.mkdir(mode=0o700)
    except FileExistsError:
        require(parent.is_dir() and not parent.is_symlink(), 'Managed runs parent is not a real directory')
    root = parent / key
    created = False
    try:
        root.mkdir(mode=0o700)
        created = True
    except FileExistsError:
        require(root.is_dir() and not root.is_symlink(), 'Allocated run root is not a real directory')
    marker = root / '.dsh-run.json'
    identity = {'protocol': 1, 'key': key, 'runId': isolation['runId'], 'sessionId': isolation['sessionId']}
    if created:
        data = {**identity, 'createdAtMs': time.time_ns() // 1000000}
        with marker.open('x', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, sort_keys=True)
            f.flush()
            os.fsync(f.fileno())
    else:
        # Only an earlier successful preparation of this exact allocation is resumable.
        require(marker.is_file() and not marker.is_symlink() and marker.stat().st_size < 4096,
                'NONEMPTY_ROOT: refusing to adopt an existing or partially initialized output directory')
        data = json.loads(marker.read_text(encoding='utf-8'))
        require(all(data.get(k) == v for k, v in identity.items()), 'FOREIGN_RUN_MARKER: do not relabel an old workspace')
    for name in ['brief', 'work', 'evidence', 'artifacts', 'final']:
        directory = root / name
        directory.mkdir(mode=0o700, exist_ok=True)
        require(directory.is_dir() and not directory.is_symlink(), 'Run subdirectory cannot be a symlink')
    return {**identity, 'root': str(root), 'createdAtMs': data['createdAtMs'],
            'markerSha256': hashlib.sha256(marker.read_bytes()).hexdigest(), 'status': 'pass', 'failures': []}


class Reader:
    def __init__(self, root, isolation=None):
        self.root = Path(root).resolve(strict=True)
        self.bindings = {}
        self.ownership = None
        if isolation is not None:
            require(isolation.get('protocol') == 1 and isolation.get('prepared') is True, 'RUN_NOT_PREPARED')
            workspace = Path(isolation['workspace']).resolve(strict=True)
            expected = workspace / '.dsh-runs' / isolation['key']
            require(Path(isolation['root']) == Path(isolation['workspace']) / '.dsh-runs' / isolation['key'], 'Invalid run root')
            require(not expected.parent.is_symlink() and not expected.is_symlink() and expected.is_dir(), 'Run root must not be a symlink')
            require(self.root in [workspace, expected], 'Validator cwd is not this run or its Host workspace')
            self.root = expected
            marker = expected / '.dsh-run.json'
            require(marker.is_file() and not marker.is_symlink() and marker.stat().st_size < 4096, 'Missing run ownership marker')
            raw = marker.read_bytes()
            require(hashlib.sha256(raw).hexdigest() == isolation.get('markerSha256'), 'RUN_MARKER_CHANGED: caller sidecars cannot replace Host ownership')
            data = json.loads(raw)
            require(all(data.get(k) == isolation.get(k) for k in ['runId', 'sessionId', 'key', 'createdAtMs']), 'RUN_MARKER_IDENTITY_MISMATCH')
            require(str(expected) == isolation.get('realRoot'), 'Run canonical root changed')
            self.ownership = {**data, 'root': str(expected), 'markerSha256': isolation['markerSha256']}


    def path(self, name, base=None):
        require(isinstance(name, str) and 0 < len(name) <= 4096 and '\x00' not in name,
                'A non-empty local path is required')
        require(not re.match(r'^[a-z][a-z0-9+.-]*://', name, re.I), 'URLs are not local artifacts')
        p = Path(name)
        if self.ownership:
            require('..' not in p.parts, 'RUN_PATH_TRAVERSAL: use an absolute current-run path')
            raw = p if p.is_absolute() else (base or self.root) / p
            require(raw.is_relative_to(self.root), 'CROSS_RUN_PATH: artifact is outside the allocated current-run root')
            current = self.root
            for part in raw.relative_to(self.root).parts:
                current = current / part
                require(not current.is_symlink(), 'RUN_SYMLINK: symlink artifacts are not accepted as fresh output')
        try:
            p = (p if p.is_absolute() else (base or self.root) / p).resolve(strict=True)
        except FileNotFoundError as exc:
            raise Invalid('Missing artifact: ' + name) from exc
        require(p.is_relative_to(self.root), 'Artifact escapes the session workspace (including symlinks)')
        require(p.is_file(), 'Artifact must be a regular file')
        if self.ownership:
            require(p.stat().st_nlink == 1, 'RUN_HARDLINK: linked old artifacts are not independent output')
            require(p.stat().st_mtime_ns // 1000000 >= self.ownership['createdAtMs'] - 2000,
                    'ARTIFACT_PREDATES_RUN: preserved old modification time; timestamps alone never establish origin')
        require(0 < p.stat().st_size <= MAX_FILE, 'Artifact is empty or exceeds the 512 MiB limit')
        return p

    def fingerprint(self, p):
        before = p.stat()
        h = hashlib.sha256()
        with p.open('rb') as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b''):
                h.update(chunk)
        after = p.stat()
        require((before.st_size, before.st_mtime_ns, before.st_ino) ==
                (after.st_size, after.st_mtime_ns, after.st_ino), 'Artifact changed while hashing')
        value = {'path': str(p), 'sha256': h.hexdigest(), 'bytes': before.st_size}
        if self.ownership:
            value.update({'mtimeNs': str(before.st_mtime_ns), 'ctimeNs': str(before.st_ctime_ns),
                          'runId': self.ownership['runId']})
        self.bindings[str(p)] = value
        return value

    def text(self, name, base=None):
        p = self.path(name, base)
        require(p.stat().st_size <= MAX_TEXT, 'Text/manifest exceeds 1 MiB')
        digest = self.fingerprint(p)
        text = p.read_text(encoding='utf-8-sig')
        require(self.fingerprint(p) == digest, 'Text changed while reading')
        return p, text

    def unchanged(self):
        for p, old in list(self.bindings.items()):
            require(self.fingerprint(Path(p)) == old, 'Artifact changed during validation: ' + p)


def run(command, timeout=45, limit=1024 * 1024):
    # Never use shell=True. Temporary logs bound memory and cannot be read as user evidence.
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        try:
            p = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                               timeout=timeout, check=False)
        except FileNotFoundError as exc:
            raise Unavailable('Required executable unavailable: ' + command[0]) from exc
        except subprocess.TimeoutExpired as exc:
            raise Unavailable('Validator timed out; result is unverified') from exc
        err.seek(0)
        detail = err.read(2000).decode('utf-8', 'replace')
        require(p.returncode == 0, 'Decoder/check failed (exit %s): %s' % (p.returncode, detail))
        size = out.tell()
        require(size <= limit, 'Validator output exceeds bounded capacity')
        out.seek(0)
        return out.read()


def probe(path):
    value = json.loads(run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', MEDIA_FORMATS,
                           '-show_entries', 'format=duration:stream=codec_type,codec_name,duration,start_time,width,height,channels',
                           '-of', 'json', str(path)], timeout=10))
    try:
        duration = float(value['format']['duration'])
    except (KeyError, ValueError, TypeError) as exc:
        raise Invalid('No finite media duration') from exc
    require(math.isfinite(duration) and 0 < duration <= POLICY['maxDurationSeconds'],
            'Media duration must be within 0..900 seconds')
    return duration, value.get('streams', [])


def pcm_measure(path, duration):
    # Decode every sample (stereo, 16kHz); do not infer silence from an audio stream's existence.
    # 900 seconds * 16000 Hz * 2 channels * 2 bytes is <58 MiB on disk, not RAM.
    command = ['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-protocol_whitelist', 'file,pipe',
               '-format_whitelist', MEDIA_FORMATS, '-i', str(path), '-t', '901', '-map', '0:a:0', '-vn', '-sn', '-dn', '-ar', '16000', '-ac', '2',
               '-f', 's16le', 'pipe:1']
    with tempfile.TemporaryFile() as pcm, tempfile.TemporaryFile() as err:
        try:
            process = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=pcm, stderr=err,
                                     timeout=45, check=False)
        except FileNotFoundError as exc:
            raise Unavailable('ffmpeg is unavailable') from exc
        except subprocess.TimeoutExpired as exc:
            raise Unavailable('Audio decode timed out; unverified') from exc
        require(process.returncode == 0, 'Audio decode failed; unverified')
        size = pcm.tell()
        require(0 < size <= 60000000 and size % 4 == 0, 'Empty/oversized/invalid PCM output')
        pcm.seek(0)
        peak, squares, samples, nonzero = 0, 0, 0, 0
        intervals, low_start, offset = [], None, 0.0
        threshold = 32768 * math.pow(10, POLICY['noiseDb'] / 20)
        while True:
            raw = pcm.read(6400)  # 100 ms, interleaved stereo
            if not raw:
                break
            data = array.array('h')
            data.frombytes(raw)
            if sys.byteorder != 'little':
                data.byteswap()
            local_sum = 0
            for n in data:
                peak = max(peak, abs(n))
                nonzero += n != 0
                local_sum += n * n
            squares += local_sum
            samples += len(data)
            length = len(data) / 32000.0
            low = math.sqrt(local_sum / len(data)) < threshold
            if low and low_start is None:
                low_start = offset
            if not low and low_start is not None:
                if offset - low_start >= POLICY['minLowSeconds'] - 0.0001:
                    intervals.append([round(low_start, 4), round(offset, 4)])
                low_start = None
            offset += length
        if low_start is not None and offset - low_start >= POLICY['minLowSeconds'] - 0.0001:
            intervals.append([round(low_start, 4), round(offset, 4)])
    total = sum(b - a for a, b in intervals)
    return {'decodedSeconds': round(offset, 6), 'peakS16': peak, 'nonzeroSamples': nonzero,
            'rmsS16': round(math.sqrt(squares / samples), 5), 'samples': samples,
            'lowIntervals': intervals[:200], 'intervalsTruncated': len(intervals) > 200,
            'longestLowSeconds': round(max((b - a for a, b in intervals), default=0), 4),
            'lowRatio': round(min(1.0, total / offset), 6), 'allZero': nonzero == 0}


def media(reader, name, base, video=True):
    p = reader.path(name, base)
    binding = reader.fingerprint(p)
    duration, streams = probe(p)
    require(any(s.get('codec_type') == 'audio' for s in streams), 'Required audio track is missing')
    if video:
        require(any(s.get('codec_type') == 'video' for s in streams), 'Required video track is missing')
        run(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-protocol_whitelist', 'file,pipe',
             '-format_whitelist', MEDIA_FORMATS, '-i', str(p), '-map', '0:v:0', '-an', '-sn', '-dn', '-f', 'null', '-'], timeout=45)
    measure = pcm_measure(p, duration)
    return {'binding': binding, 'durationSeconds': duration, 'streams': streams, 'audio': measure}


def audio_failures(value, label):
    a = value['audio']
    errors = []
    if a['allZero']:
        errors.append(label + ': full decoded audio is zero; audio-track presence is not a pass')
    if a['longestLowSeconds'] > POLICY['maxLowSeconds']:
        errors.append(label + ': low-level gap %.2fs exceeds narrated-video policy %.2fs' %
                      (a['longestLowSeconds'], POLICY['maxLowSeconds']))
    if a['lowRatio'] > POLICY['maxLowRatio']:
        errors.append(label + ': low-level ratio %.1f%% exceeds narrated-video policy %.1f%%' %
                      (a['lowRatio'] * 100, POLICY['maxLowRatio'] * 100))
    if abs(value['durationSeconds'] - a['decodedSeconds']) > POLICY['avToleranceSeconds']:
        errors.append(label + ': audio/video duration mismatch')
    for s in value['streams']:
        if s.get('codec_type') == 'audio':
            try:
                if abs(float(s.get('start_time', 0))) > POLICY['avToleranceSeconds']:
                    errors.append(label + ': audio starts too late')
            except (ValueError, TypeError):
                errors.append(label + ': invalid audio start time')
    return errors


def subtitle_check(text, duration, script):
    stamps = re.findall(r'(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})', text)
    require(len(stamps) > 0, 'SRT has no valid timed events')
    last = -1.0
    for row in stamps:
        numbers = [int(n) for n in row]
        start = numbers[0] * 3600 + numbers[1] * 60 + numbers[2] + numbers[3] / 1000
        end = numbers[4] * 3600 + numbers[5] * 60 + numbers[6] + numbers[7] / 1000
        require(0 <= start < end <= duration + 0.15 and start >= last,
                'SRT time ranges are invalid, overlapping or beyond the video')
        last = end
    words = []
    for block in re.split(r'\n\s*\n', text.strip()):
        lines = block.splitlines()
        timing = [i for i, line in enumerate(lines) if '-->' in line]
        require(len(timing) == 1, 'SRT block must have exactly one time range')
        spoken = re.sub(r'<[^>]+>', '', ''.join(lines[timing[0] + 1:])).strip()
        require(bool(spoken), 'Empty subtitle cue')
        words.append(spoken)
    require(normalized(''.join(words)) == normalized(script), 'SUBTITLE_COVERAGE: cue text differs from the full spoken script')
    return {'events': len(stamps), 'lastEndSeconds': last, 'scriptCoverage': True}


def validate(request, root=None):
    result = {'validatorVersion': VERSION, 'kind': request.get('kind'), 'passed': False,
              'status': 'fail', 'failures': [], 'bindings': {}, 'policy': POLICY.copy(),
              'semanticVerification': False, 'speechRecognition': False}
    try:
        if request.get('kind') == 'prepare':
            return prepare_workspace(request.get('isolation'))
        reader = Reader(root or Path.cwd(), request.get('isolation'))
        if reader.ownership:
            result['ownership'] = reader.ownership
        kind = request['kind']
        require(kind in ['narration', 'pilot', 'video', 'handoff'], 'Unsupported validator kind')
        manifest_path, manifest_text = reader.text(request['manifest'])
        manifest = json.loads(manifest_text)
        require(manifest.get('schemaVersion') == 1, 'Manifest requires schemaVersion=1')
        base = manifest_path.parent
        script_path, script = reader.text(manifest.get('script'), base)
        segments = manifest.get('segments')
        require(isinstance(segments, list) and 1 <= len(segments) <= 120, 'Need 1..120 narration segments')
        ids, texts = [], []
        for segment in segments:
            require(isinstance(segment, dict), 'Segment must be an object')
            sid, text = segment.get('id'), segment.get('text')
            require(isinstance(sid, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,64}', sid), 'Invalid segment ID')
            require(sid not in ids, 'Duplicate narration segment: ' + sid)
            require(isinstance(text, str) and len(text) <= 32000 and normalized(text), 'Segment needs exact spoken text')
            ids.append(sid)
            texts.append(text)
        full, joined = normalized(script), normalized(''.join(texts))
        result['coverage'] = {'scriptCharacters': len(full), 'segmentCharacters': len(joined), 'segmentCount': len(ids)}
        require(bool(full) and full == joined, 'NARRATION_COVERAGE: joined exact segment texts differ from the canonical script; summaries/omissions cannot substitute for full narration')
        result['narration'] = {'scriptPath': str(script_path), 'scriptSha256': text_hash(full),
                               'segmentSha256': json_hash(list(zip(ids, [normalized(t) for t in texts]))),
                               'segments': [{'id': sid, 'textSha256': text_hash(text)} for sid, text in zip(ids, texts)]}
        if kind != 'narration':
            chosen = segments[:1] if kind == 'pilot' else segments
            checked = []
            for segment in chosen:
                a = media(reader, segment.get('audio'), base, video=False)
                result['failures'].extend(audio_failures(a, 'segment ' + segment['id']))
                require(not any(old['binding']['sha256'] == a['binding']['sha256'] and old['textSha256'] != text_hash(segment['text']) for old in checked), 'Duplicate audio bytes assigned to different narration segments; verify actual TTS outputs')
                checked.append({'id': segment['id'], 'textSha256': text_hash(segment['text']), 'durationSeconds': a['durationSeconds'], 'binding': a['binding'],
                                'allZero': a['audio']['allZero']})
            result['segmentAudio'] = checked
            path = manifest.get('pilotVideo') if kind == 'pilot' else manifest.get('video')
            result['video'] = media(reader, path, base, video=True)
            result['failures'].extend(audio_failures(result['video'], kind))
            duration = result['video']['durationSeconds']
            if kind == 'pilot':
                require(abs(duration - checked[0]['durationSeconds']) <= 1.5, 'Pilot must use the first complete natural segment, not padding/summary')
            else:
                last = 0.0
                for segment, audio in zip(segments, checked):
                    start, end = segment.get('start'), segment.get('end')
                    require(all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in [start, end]), 'Each segment needs numeric start/end in final video')
                    require(last <= start < end <= duration + 0.15, 'Narration timeline is out of order/overlaps/out of range')
                    require(abs(end - start - audio['durationSeconds']) <= 0.75, 'Narration timeline does not match measured audio; do not pad every segment with long holds')
                    require(start - last <= POLICY['maxLowSeconds'], 'Unexplained gap between narration segments')
                    last = end
                require(duration - last <= POLICY['maxLowSeconds'], 'Long unexplained tail after narration')
                require(abs(float(manifest['durationSeconds']) - duration) <= 0.15, 'Declared duration is stale; use measured final duration')
                require(manifest.get('coverForVideoSha256') == result['video']['binding']['sha256'], 'Cover binding is missing/stale; update against the measured video hash')
                cover = reader.path(manifest.get('cover'), base)
                require(cover.suffix.lower() in ['.png', '.jpg', '.jpeg', '.webp'], 'Cover must be PNG/JPEG/WebP')
                result['cover'] = reader.fingerprint(cover)
                # A real image decode, not filename-only validation. Does not read its text.
                run(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-protocol_whitelist', 'file,pipe',
                     '-format_whitelist', 'image2,png_pipe,jpeg_pipe,webp_pipe', '-i', str(cover), '-frames:v', '1', '-f', 'null', '-'], timeout=15)
                _, title = reader.text(manifest.get('title'), base)
                require(bool(title.strip()), 'Title is empty')
                _, subs = reader.text(manifest.get('subtitles'), base)
                result['subtitles'] = subtitle_check(subs, duration, script)
        reader.unchanged()
        result['bindings'] = reader.bindings
        result['passed'] = not result['failures']
        result['status'] = 'pass' if result['passed'] else 'fail'
    except (Unavailable, FileNotFoundError, PermissionError) as exc:
        result['status'] = 'unavailable'
        result['failures'].append(str(exc))
    except (Invalid, KeyError, ValueError, TypeError, OSError, OverflowError) as exc:
        result['failures'].append(str(exc))
    return result


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 2 and len(sys.argv[1]) < 32000, 'One bounded base64 request is required')
        req = json.loads(base64.b64decode(sys.argv[1], validate=True).decode('utf-8'))
        print(json.dumps(validate(req), ensure_ascii=False, allow_nan=False))
    except Exception as error:
        print(json.dumps({'validatorVersion': VERSION, 'passed': False, 'status': 'unavailable', 'failures': [str(error)]}))
