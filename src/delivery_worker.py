"""Fixed local IO routines appended to the audited media Reader by the Host.

Not a standalone shell executor. All IO uses the caller's original DSH pipeline.
A command window is an observation, not a proof of creative authorship.
"""

def delivery_reader(req):
    reader = Reader(Path.cwd(), req.get('isolation'), req.get('legacyScope'))
    owner = reader.ownership or reader.legacy_scope
    require(owner and owner.get('runId') == req.get('runId'), 'DELIVERY_OWNER_MISMATCH')
    return reader


def check_bound(reader, binding):
    require(isinstance(binding, dict) and re.fullmatch(r'[a-f0-9]{64}', binding.get('sha256', '')), 'INVALID_ARTIFACT_BINDING')
    p = reader.path(binding.get('path'))
    actual = reader.fingerprint(p)
    require(actual['sha256'] == binding['sha256'] and actual['bytes'] == binding.get('bytes'),
            'DELIVERY_BYTES_CHANGED: source differs from its registered hash; recheck the existing candidate, do not search another final.mp4')
    return p, actual


def production_probe(req):
    reader = delivery_reader(req)
    require(reader.ownership is not None, 'Production witness requires a current isolated run')
    files = req.get('paths')
    require(isinstance(files, list) and 1 <= len(files) <= 8, 'Need 1..8 exact output paths')
    results = []
    for name in files:
        raw = Path(name)
        require(raw.is_absolute() and '..' not in raw.parts and raw.is_relative_to(reader.root), 'CROSS_RUN_PATH')
        current = reader.root
        for part in raw.relative_to(reader.root).parts:
            current /= part
            require(not current.is_symlink(), 'RUN_SYMLINK')
        if not raw.exists():
            require(req.get('allowMissing') is True, 'PRODUCTION_OUTPUT_MISSING: ' + str(raw))
            results.append({'path':str(raw), 'exists':False})
        else:
            actual = reader.fingerprint(reader.path(str(raw)))
            results.append({**actual, 'exists':True})
    reader.unchanged()
    return {'protocol':1, 'passed':True, 'runId':req['runId'], 'outputs':results}


def snapshot_bundle(req):
    reader = delivery_reader(req)
    require(re.fullmatch(r'[a-f0-9-]{36}', req.get('deliveryId', '')), 'Invalid delivery id')
    require(re.fullmatch(r'[a-f0-9]{64}', req.get('candidateKey', '')), 'Invalid candidate identity')
    bindings = req.get('bindings')
    require(isinstance(bindings, dict) and 1 <= len(bindings) <= 512, 'Invalid current candidate bindings')
    manifest_binding = bindings.get(req.get('manifestPath'))
    manifest_path, _ = check_bound(reader, manifest_binding)
    manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    base = manifest_path.parent
    video_binding = req.get('video')
    require(isinstance(video_binding,dict), 'No verified video binding')
    selected = []
    for role, name in [('video',manifest.get('video')),('cover',manifest.get('cover')),
                       ('narration',manifest.get('script')),('title',manifest.get('title')),
                       ('subtitles',manifest.get('subtitles',{}).get('path') if isinstance(manifest.get('subtitles'),dict) else manifest.get('subtitles'))]:
        path = reader.path(name, base)
        binding = bindings.get(str(path))
        require(binding is not None, 'UNREGISTERED_ARTIFACT: ' + role + ' was not part of this candidate')
        _, actual = check_bound(reader,binding)
        if role == 'video':
            require(actual['path'] == video_binding['path'] and actual['sha256'] == video_binding['sha256'], 'CANDIDATE_VIDEO_MISMATCH')
            require(actual['sha256'] not in req.get('excludedVideoDigests',[]), 'CROSS_RUN_DUPLICATE: known prior final bytes cannot become this delivery')
        selected.append((role,path,actual))
    # Additional document reports are measured, not treated as QA or producer authority.
    extra = req.get('extraPaths',[])
    require(isinstance(extra,list) and len(extra) <= 1, 'At most one auxiliary report per bundle')
    for name in extra:
        path = reader.path(name)
        require(path.suffix.lower() in ['.md','.txt','.json'], 'Auxiliary attachment must be a local report')
        selected.append(('auxiliary-report',path,reader.fingerprint(path)))
    root = reader.root if reader.ownership else manifest_path.parent
    parent = root / '.deliveries'
    require(not parent.is_symlink(), 'DELIVERY_SYMLINK')
    parent.mkdir(mode=0o700,exist_ok=True)
    require(parent.is_dir(), 'DELIVERY_DIRECTORY_INVALID')
    dest = parent / req['deliveryId']
    dest.mkdir(mode=0o700,exist_ok=False)  # Never overwrite an earlier delivered snapshot.
    entries = []
    for role, source, binding in selected:
        identity = req.get('artifactIds',{}).get(str(source))
        if role != 'auxiliary-report':
            require(isinstance(identity,str) and identity.startswith('artifact-'), 'Artifact id missing')
        else:
            identity = 'auxiliary-' + text_hash(req['runId'] + str(source) + binding['sha256'])
        suffix = source.suffix.lower()
        require(re.fullmatch(r'\.[a-z0-9]{1,10}',suffix or ''), 'Unsupported artifact extension')
        target = dest / (role + '-' + binding['sha256'][:12] + suffix)
        h = hashlib.sha256()
        size = 0
        with source.open('rb') as inp, target.open('xb') as out:
            while True:
                chunk = inp.read(1024*1024)
                if not chunk:
                    break
                size += len(chunk)
                require(size <= MAX_FILE, 'File grew while snapshotting')
                h.update(chunk)
                out.write(chunk)
            out.flush()
            os.fsync(out.fileno())
        require(size == binding['bytes'] and h.hexdigest() == binding['sha256'], 'DELIVERY_BYTES_CHANGED: file changed during copy')
        target.chmod(0o444)
        entries.append({'artifactId':identity,'role':role,'sourcePath':str(source),'path':str(target),
                        'sha256':binding['sha256'],'bytes':binding['bytes']})
    reader.unchanged()
    receipt = {'protocol':1,'passed':True,'deliveryId':req['deliveryId'],'candidateKey':req['candidateKey'],
               'runId':req['runId'],'revision':req['revision'],'files':entries,'createdAtMs':time.time_ns()//1000000,
               'sourceMode':'legacy-same-run' if reader.legacy_scope else 'isolated-run',
               'creationAttested':False,'warning':'Fixed copies and command-window observations are not an OS sandbox or proof of model authorship.'}
    report = req.get('systemReport','')
    require(isinstance(report,str) and len(report) <= 1000000, 'System report too large')
    for role, name, text in [('system-report','execution-report.system.md',report),
                             ('delivery-receipt','delivery-receipt.json',json.dumps(receipt,ensure_ascii=False,indent=2))]:
        target = dest/name
        with target.open('x',encoding='utf-8') as out:
            out.write(text)
            out.flush()
            os.fsync(out.fileno())
        target.chmod(0o444)
        raw=target.read_bytes()
        entries.append({'artifactId':'receipt-'+text_hash(req['deliveryId']+role),'role':role,
                        'path':str(target),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)})
    dest.chmod(0o555)
    receipt['files']=entries
    return receipt


def verify_delivery(req):
    reader = delivery_reader(req)
    rows=req.get('files')
    require(isinstance(rows,list) and 1<=len(rows)<=8, 'Invalid delivery files')
    for row in rows:
        check_bound(reader,row)
    reader.unchanged()
    return {'protocol':1,'passed':True,'runId':req['runId'],'files':rows}


def delivery_main(req):
    try:
        mode = req.get('mode')
        if mode == 'probe':
            return production_probe(req)
        if mode == 'bundle':
            return snapshot_bundle(req)
        if mode == 'verify':
            return verify_delivery(req)
        raise Invalid('Unknown fixed delivery operation')
    except (Invalid,Unavailable,KeyError,ValueError,TypeError,OSError) as error:
        return {'protocol':1,'passed':False,'error':str(error)}


if __name__ == '__main__':
    try:
        require(len(sys.argv)==2 and len(sys.argv[1])<120000, 'One bounded request required')
        request=json.loads(base64.b64decode(sys.argv[1],validate=True).decode('utf-8'))
        print(json.dumps(delivery_main(request),ensure_ascii=False,allow_nan=False))
    except Exception as error:
        print(json.dumps({'protocol':1,'passed':False,'error':str(error)}))
