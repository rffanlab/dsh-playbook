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


def subtitle_words(text):
    """Display punctuation is not missing speech. Preserve words, numbers and symbols."""
    value = normalized(text)
    def keep(i, c):
        numeric = c in '.,，:：/+-−%％' and ((i > 0 and value[i-1].isdigit()) or (i+1 < len(value) and value[i+1].isdigit()))
        return numeric or c in '%％' or not unicodedata.category(c).startswith('P')
    return ''.join(c for i,c in enumerate(value) if keep(i,c))


def subtitle_check(text, duration, script, format='srt', narration_styles=None):
    events = []
    ignored = 0
    if format == 'ass':
        fields = None
        section = ''
        styles = narration_styles
        require(styles is None or (isinstance(styles, list) and 0 < len(styles) <= 16 and
                all(isinstance(v, str) and v.strip() for v in styles)), 'ASS narrationStyles must be an explicit non-empty string list')
        def ass_time(value):
            m = re.fullmatch(r'(\d+):(\d{2}):(\d{2})[.](\d{2,3})', value.strip())
            require(m is not None, 'SUBTITLE_TIMING: invalid ASS timestamp')
            h, mi, se, fraction = m.groups()
            require(int(mi) < 60 and int(se) < 60, 'SUBTITLE_TIMING: invalid ASS minute/second')
            return int(h)*3600+int(mi)*60+int(se)+int(fraction)/(10**len(fraction))
        for line in text.splitlines():
            line=line.strip()
            if line.startswith('['): section=line.lower()
            if section != '[events]': continue
            if line.lower().startswith('format:'):
                fields=[v.strip().lower() for v in line.split(':',1)[1].split(',')]
            if not line.lower().startswith('dialogue:'): continue
            require(fields and all(k in fields for k in ['start','end','style','text']), 'ASS Events Format must declare Start, End, Style, Text')
            # Text is conventionally last and may contain commas. Reject ambiguous layouts.
            require(fields[-1] == 'text', 'ASS Text must be the last Events field')
            values=line.split(':',1)[1].lstrip().split(',',len(fields)-1)
            require(len(values) == len(fields), 'Malformed ASS Dialogue event')
            row=dict(zip(fields,values))
            if styles is not None and row['style'].strip() not in styles:
                ignored += 1; continue
            words=re.sub(r'\{[^}]*\}', '', row['text']).replace('\\N',' ').replace('\\n',' ').replace('\\h',' ')
            events.append((ass_time(row['start']),ass_time(row['end']),words))
    else:
        require(format == 'srt', 'Unsupported subtitle format; use srt or ass')
        for block in re.split(r'\n\s*\n', text.strip()):
            lines=block.splitlines()
            timing=[i for i,line in enumerate(lines) if '-->' in line]
            require(len(timing)==1, 'SRT block must have exactly one time range')
            index=timing[0]
            m=re.fullmatch(r'\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*',lines[index])
            require(m is not None, 'SUBTITLE_TIMING: invalid SRT time range')
            n=[int(v) for v in m.groups()]
            require(n[1]<60 and n[2]<60 and n[5]<60 and n[6]<60,'SUBTITLE_TIMING: invalid SRT minute/second')
            start=n[0]*3600+n[1]*60+n[2]+n[3]/1000
            end=n[4]*3600+n[5]*60+n[6]+n[7]/1000
            words=re.sub(r'<[^>]+>', '', ''.join(lines[index+1:])).strip()
            events.append((start,end,words))
    require(events, 'SUBTITLE_TIMING: no narration events; specify narrationStyles for layered ASS')
    last=-1.0
    for index,(start,end,words) in enumerate(events):
        require(0<=start<end<=duration+0.15 and start>=last-0.001,
                'SUBTITLE_TIMING: narration event %d overlaps or exceeds media duration; overlays must be separate from narration' % (index+1))
        require(bool(words.strip()), 'Empty subtitle cue')
        last=end
    joined=''.join(words for _,_,words in events)
    wanted,actual=subtitle_words(script),subtitle_words(joined)
    if wanted != actual:
        i=next((i for i,(a,b) in enumerate(zip(wanted,actual)) if a!=b),min(len(wanted),len(actual)))
        raise Invalid('SUBTITLE_COVERAGE: wording differs at character %d; expected=%r actual=%r; fix narration captions, not speech speed' % (i,wanted[max(0,i-8):i+20],actual[max(0,i-8):i+20]))
    return {'events':len(events),'lastEndSeconds':last,'scriptCoverage':True,
            'format':format,'ignoredOverlayEvents':ignored,
            'punctuationNormalized':normalized(joined)!=normalized(script)}


def manifest_signature(manifest):
    # Unrelated report metadata must not make unchanged media stale.
    keys=['schemaVersion','script','segments','video','cover','title','subtitles',
          'durationSeconds','coverForVideoSha256']
    value = {k:manifest.get(k) for k in keys}
    if isinstance(value.get('segments'), list):
        value['segments'] = [{k:segment.get(k) for k in ['id','text','audio','start','end']} if isinstance(segment,dict) else segment for segment in value['segments']]
    return json_hash(value)


def cached_handoff(reader, manifest_path, manifest, previous, result):
    if not previous or not previous.get('passed') or not previous.get('manifestSignature'):
        return None  # Older QA snapshots need one ordinary full validation.
    require(previous['manifestSignature']==manifest_signature(manifest), 'QA_STALE: media references/timeline changed; recheck qa, do not regenerate every asset')
    old_manifest=previous.get('manifestPath')
    require(old_manifest and previous.get('bindings'), 'QA_STALE: prior artifact bindings unavailable')
    for path,binding in previous['bindings'].items():
        if path==old_manifest: continue
        current=reader.fingerprint(reader.path(path))
        require(current['sha256']==binding['sha256'] and current['bytes']==binding['bytes'],
                'QA_STALE: changed artifact '+path+'; recheck qa before delivery')
    reader.unchanged()
    for key in ['coverage','narration','segmentAudio','video','cover','subtitles','timing']:
        if key in previous: result[key]=previous[key]
    result.update(passed=True,status='pass',manifestPath=str(manifest_path),manifestSignature=manifest_signature(manifest),
                  bindings=reader.bindings,warnings=previous.get('warnings',[]),
                  cache={'mode':'hash-revalidated','decodedAgain':False,'note':'Every previously checked artifact was rehashed; technical measurements are reused only for identical bytes and media references.'})
    return result


def validate(request, root=None):
    result = {'validatorVersion': VERSION, 'kind': request.get('kind'), 'passed': False,
              'status': 'fail', 'failures': [], 'bindings': {}, 'policy': POLICY.copy(),
              'semanticVerification': False, 'speechRecognition': False, 'warnings': []}
    try:
        if request.get('kind') == 'prepare':
            return prepare_workspace(request.get('isolation'))
        reader = Reader(root or Path.cwd(), request.get('isolation'))
        if reader.ownership:
            result['ownership'] = reader.ownership
        kind = request['kind']
        require(kind in ['narration', 'pilot', 'video', 'handoff', 'diagnose'], 'Unsupported validator kind')
        if kind == 'diagnose':
            result['video'] = media(reader, request.get('video'), reader.root, video=True)
            result['failures'].extend(audio_failures(result['video'], 'diagnostic'))
            reader.unchanged()
            result.update(bindings=reader.bindings, passed=not result['failures'], status='pass' if not result['failures'] else 'fail', notAGate=True)
            return result
        manifest_path, manifest_text = reader.text(request['manifest'])
        manifest = json.loads(manifest_text)
        require(manifest.get('schemaVersion') == 1, 'Manifest requires schemaVersion=1')
        base = manifest_path.parent
        result['manifestPath'] = str(manifest_path)
        result['manifestSignature'] = manifest_signature(manifest)
        if kind == 'handoff':
            cached = cached_handoff(reader, manifest_path, manifest, request.get('previousQa'), result)
            if cached is not None:
                return cached
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
                spec = manifest.get('subtitles')
                subtitle_path = spec.get('path') if isinstance(spec, dict) else spec
                fmt = spec.get('format') if isinstance(spec, dict) else None
                styles = spec.get('narrationStyles') if isinstance(spec, dict) else None
                _, subs = reader.text(subtitle_path, base)
                fmt = fmt or ('ass' if str(subtitle_path).lower().endswith('.ass') else 'srt')
                result['subtitles'] = subtitle_check(subs, duration, script, fmt, styles)
                result['timing'] = {'narrationEndSeconds': last, 'videoSeconds': duration,
                                    'extraTailSeconds': round(max(0,duration-last),4),
                                    'master': 'measured narration; visual cuts and quote overlays have independent timing'}
                if duration-last > POLICY['avToleranceSeconds']:
                    result['warnings'].append('AUDIO_MASTER_TAIL: video extends %.3fs beyond the declared narration end; remove accidental tpad/apad/loop padding. Intentional outros must be reported, not disguised as natural speech.' % (duration-last))
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
        require(len(sys.argv) == 2 and len(sys.argv[1]) < 524288, 'One bounded base64 request is required')
        req = json.loads(base64.b64decode(sys.argv[1], validate=True).decode('utf-8'))
        print(json.dumps(validate(req), ensure_ascii=False, allow_nan=False))
    except Exception as error:
        print(json.dumps({'validatorVersion': VERSION, 'passed': False, 'status': 'unavailable', 'failures': [str(error)]}))
