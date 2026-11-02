"""Hellfire Director: local, versioned music-video planning workspace."""
from __future__ import annotations
import argparse, copy, csv, hashlib, html, io, json, mimetypes, os, re, secrets, socket, sqlite3, threading, time, uuid, webbrowser, zipfile
from datetime import datetime, timezone
from contextlib import contextmanager
from functools import wraps
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote
from scene_techniques import technique_text, scene_direction_html, project_direction_text, PLAN_FIELDS
from studio_support import validate_studio, remap_studio_assets, export_studio

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('DIRECTOR_DATA', ROOT / 'data')).resolve()
DATA.mkdir(parents=True, exist_ok=True)
MEDIA = DATA / 'media'; MEDIA.mkdir(exist_ok=True)
DB = DATA / 'director.sqlite3'
LOCK = threading.RLock()
TOKEN = secrets.token_urlsafe(32)
TRANSCRIPTIONS = {}
IMPORTS = {}
def now(): return datetime.now(timezone.utc).isoformat()
def uid(): return uuid.uuid4().hex
def synchronized(fn):
    @wraps(fn)
    def wrapped(*args,**kwargs):
        with LOCK: return fn(*args,**kwargs)
    return wrapped
@contextmanager
def connection():
    db = sqlite3.connect(DB, timeout=30); db.row_factory = sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL'); db.execute('PRAGMA synchronous=FULL')
    try:
        with db: yield db
    finally: db.close()
def initialize():
    with connection() as db:
        db.executescript('''CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, revision INTEGER, updated TEXT, state TEXT);
        CREATE TABLE IF NOT EXISTS versions(project_id TEXT, revision INTEGER, created TEXT, label TEXT, state TEXT, PRIMARY KEY(project_id,revision));
        CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, hash TEXT UNIQUE, metadata TEXT);''')
def blank(title='Untitled video'):
    return dict(schemaVersion=1, id=uid(), title=title, concept='', storyboardText='', lyricImportText='', genre='', productionNotes='',
        direction=dict(director='', directorStyle='', settings='', lighting='', colors='', camera='', rules=''),
        guide=dict(characters='', outfits='', props='', continuity=''), duration=0, song=None, lyrics=[], sections=[], scenes=[], assets=[], jobs=[], thumbnails=[], reuseExceptions=[], distinctReviews=[], view=dict(tab='story',selected=None,time=0))
def validate(p):
    if not isinstance(p,dict): raise ValueError('A project must be a JSON object.')
    if p.get('schemaVersion',1)!=1: raise ValueError('Unsupported project version. Original file was not changed.')
    for key in ('scenes','lyrics','sections','assets','jobs','reuseExceptions','distinctReviews'):
        if key in p and not isinstance(p[key],list): raise ValueError(key+' must be a list.')
    for key in ('scenes','lyrics','sections'):
        ids=set()
        for item in p.get(key,[]):
            if not isinstance(item,dict): raise ValueError(key+' entries must be objects.')
            item.setdefault('id',uid())
            if item['id'] in ids: raise ValueError('Duplicate '+key+' ID: '+item['id'])
            ids.add(item['id'])
            for k in ('start','end'):
                if not isinstance(item.get(k),(int,float)) or not 0<=item[k]<86400: raise ValueError(key+' require numeric times in seconds, between 0 and 86400.')
            if item['end']<=item['start']: raise ValueError(key+' end must follow start.')
    for scene in p.get('scenes',[]):
        if not isinstance(scene.get('techniques',[]),list): raise ValueError('Scene techniques must be a list.')
        technique_ids=set()
        for technique in scene.get('techniques',[]):
            if not isinstance(technique,dict): raise ValueError('Each scene technique must be an object.')
            technique.setdefault('id',uid())
            if not isinstance(technique['id'],str) or technique['id'] in technique_ids: raise ValueError('Scene technique IDs must be unique strings.')
            technique_ids.add(technique['id'])
            for key in ('category','title','description','directions','techniqueId'):
                if key in technique and not isinstance(technique[key],str): raise ValueError('Technique '+key+' must be text.')
        if not isinstance(scene.get('shotPlan',{}),dict): raise ValueError('Scene camera route must be an object.')
        for key,_ in PLAN_FIELDS:
            if key in scene.get('shotPlan',{}) and not isinstance(scene['shotPlan'][key],str): raise ValueError('Camera route '+key+' must be text.')
        if scene.get('singer')=='GB': scene['singer']='Georgia Belle'
        if not isinstance(scene.get('performers',[]),list): raise ValueError('Scene performers must be a list.')
        for person in scene.get('performers',[]):
            if person.get('name')=='GB': person['name']='Georgia Belle'
    validate_studio(p)
    return p
def read_project(pid):
    with connection() as db: row=db.execute('SELECT * FROM projects WHERE id=?',(pid,)).fetchone()
    if not row: raise KeyError('Project not found')
    return dict(state=json.loads(row['state']), revision=row['revision'], updated=row['updated'])
@synchronized
def save_project(p, expected, label='Autosave'):
    p=validate(copy.deepcopy(p)); pid=p.get('id') or uid(); p['id']=pid
    state=json.dumps(p,ensure_ascii=False); timestamp=now()
    with LOCK, connection() as db:
        row=db.execute('SELECT revision,state FROM projects WHERE id=?',(pid,)).fetchone()
        if row and expected!=row['revision']: raise Conflict('Another window or assistant saved a newer version. Reload before saving; your local recovery copy is retained.')
        if row and row['state']==state and label=='Autosave': return dict(revision=row['revision'],updated=timestamp,state=p)
        rev=(row['revision'] if row else 0)+1
        db.execute('INSERT OR REPLACE INTO projects VALUES(?,?,?,?)',(pid,rev,timestamp,state))
        db.execute('INSERT INTO versions VALUES(?,?,?,?,?)',(pid,rev,timestamp,label,state))
        db.execute("DELETE FROM versions WHERE project_id=? AND label='Autosave' AND revision NOT IN (SELECT revision FROM versions WHERE project_id=? ORDER BY revision DESC LIMIT 200)",(pid,pid))
    backup_dir=DATA/'backups'/pid; backup_dir.mkdir(parents=True,exist_ok=True)
    tmp=backup_dir/'latest.tmp'; tmp.write_text(state,encoding='utf-8'); tmp.replace(backup_dir/'latest.json')
    if label!='Autosave': (backup_dir/f'{rev:06d}.json').write_text(state,encoding='utf-8')
    return dict(state=p,revision=rev,updated=timestamp)
class Conflict(Exception): pass
def asset_by_id(aid):
    with connection() as db: row=db.execute('SELECT metadata FROM assets WHERE id=?',(aid,)).fetchone()
    if not row: raise KeyError('Media file missing')
    return json.loads(row[0])
def add_asset(raw,name,kind=None):
    digest=hashlib.sha256(raw).hexdigest()
    with LOCK, connection() as db:
        row=db.execute('SELECT metadata FROM assets WHERE hash=?',(digest,)).fetchone()
        if row: return json.loads(row[0])
        aid=uid(); suffix=Path(name).suffix.lower()
        allowed={'.png','.jpg','.jpeg','.webp','.gif','.avif','.mp4','.webm','.mov','.m4v','.mp3','.wav','.flac','.m4a','.ogg','.aac'}
        if suffix not in allowed: raise ValueError('Use a picture, audio, or video file.')
        mime=mimetypes.guess_type(name)[0] or 'application/octet-stream'
        kind=kind or ('image' if suffix in {'.png','.jpg','.jpeg','.webp','.gif','.avif'} else 'video' if suffix in {'.mp4','.webm','.mov','.m4v'} else 'audio')
        meta=dict(id=aid,filename=aid+suffix,name=Path(name).name,sha256=digest,kind=kind,mime=mime,size=len(raw),created=now(),contentGroup=digest)
        if kind=='image':
            try:
                from PIL import Image, ImageOps
                im=ImageOps.exif_transpose(Image.open(io.BytesIO(raw))); meta['width'],meta['height']=im.size
                im=im.convert('L').resize((9,8)); pixels=list(im.get_flattened_data() if hasattr(im,'get_flattened_data') else im.getdata()); bits=0
                for y in range(8):
                    for x in range(8): bits=(bits<<1) | (pixels[y*9+x]>pixels[y*9+x+1])
                meta['dhash']=f'{bits:016x}'
            except Exception: meta['dhash']=None
        target=MEDIA/meta['filename']; target.write_bytes(raw)
        db.execute('INSERT INTO assets VALUES(?,?,?)',(aid,digest,json.dumps(meta)))
        return meta
def audit(p):
    assets={a['id']:a for a in p.get('assets',[])}; used=[]; issues=[]; ledger=[]
    exceptions=p.get('reuseExceptions',[]); reviews=p.get('distinctReviews',[])
    for num,s in enumerate(p.get('scenes',[]),1):
        for slot,aid in s.get('media',{}).items():
            if not aid: continue
            a=assets.get(aid)
            if not a:
                issues.append(dict(type='missing',scene=num,message=f'Scene {num}: missing {slot} asset metadata.')); continue
            if not (MEDIA/a.get('filename','')).is_file(): issues.append(dict(type='missing',scene=num,message=f'Scene {num}: {a.get("name","asset")} is not on disk.'))
            if a.get('kind')!='image': continue
            ledger.append(dict(scene=num,sceneId=s['id'],slot=slot,assetId=aid,source=a.get('name',''),path='media/'+a.get('filename',''),sha256=a.get('sha256',''),contentGroup=a.get('contentGroup','')))
            for prev,ps,pnum in used:
                if ps==s['id']: continue
                exact=bool(a.get('sha256') and a.get('sha256')==prev.get('sha256')) or bool(a.get('contentGroup') and a.get('contentGroup')==prev.get('contentGroup'))
                near=bool(a.get('dhash') and prev.get('dhash') and (int(a['dhash'],16)^int(prev['dhash'],16)).bit_count()<=8)
                if not (exact or near): continue
                key=sorted([aid,prev['id']]); scenes=sorted([s['id'],ps])
                allowed=any(sorted(e.get('scenes',[]))==scenes and sorted(e.get('assets',[]))==key and e.get('reason') for e in exceptions)
                distinct=not exact and any(sorted(e.get('assets',[]))==key and e.get('note') for e in reviews)
                if allowed or distinct: continue
                issues.append(dict(type='repeat' if exact else 'review',scene=num,otherScene=pnum,assets=key,scenes=scenes,message=f'Scenes {pnum} and {num}: '+('same underlying picture.' if exact else 'visually similar pictures; inspect for crop, mirror or re-export.')))
            used.append((a,s['id'],num))
    for num,s in enumerate(p.get('scenes',[]),1):
        if not any(s.get('media',{}).values()): issues.append(dict(type='missing',scene=num,message=f'Scene {num}: no picture or clip attached.'))
    return dict(ledger=ledger,issues=issues,exceptions=exceptions,scope='Only the scenes and assets in this saved project. Perceptual checks flag candidates; crops and transformations need human visual review.')
def merge_with_review(current,incoming,choices=None,path=''):
    choices=choices or {}; changes=[]
    def merge(a,b,p):
        if isinstance(a,dict) and isinstance(b,dict):
            out=copy.deepcopy(a)
            for k,v in b.items():
                if not p and k in ('id','schemaVersion','view'): continue
                q=p+'/'+k
                if k not in a: out[k]=copy.deepcopy(v)
                else: out[k]=merge(a[k],v,q)
            return out
        if isinstance(a,list) and isinstance(b,list) and all(isinstance(x,dict) and x.get('id') for x in a+b):
            out=copy.deepcopy(a); index={x['id']:i for i,x in enumerate(out)}
            for item in b:
                q=p+'/'+item['id']
                if item['id'] in index: out[index[item['id']]]=merge(out[index[item['id']]],item,q)
                else: out.append(copy.deepcopy(item))
            return out
        if a==b: return copy.deepcopy(a)
        changes.append(dict(path=p,before=a,after=b))
        return copy.deepcopy(b if choices.get(p) else a)
    result=merge(current,incoming,path)
    return result,changes
def decode_import(raw,name):
    if name.lower().endswith('.zip'):
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            if sum(i.file_size for i in z.infolist())>6*1024**3: raise ValueError('Archive expands beyond 6 GB.')
            p=json.loads(z.read('project.json')); validate(p)
            remap={}
            for a in p.get('assets',[]):
                member='media/'+Path(a.get('filename','')).name
                if member not in z.namelist(): continue
                real=add_asset(z.read(member),a.get('name',a['filename']))
                old=a['id']; group=a.get('contentGroup'); remap[old]=real['id']; a.update(real)
                if group: a['contentGroup']=group
            remap_studio_assets(p, remap)
            if p.get('song') in remap: p['song']=remap[p['song']]
            for s in p.get('scenes',[]): s['media']={k:remap.get(v,v) for k,v in s.get('media',{}).items()}
            for key in ('reuseExceptions','distinctReviews'):
                for item in p.get(key,[]): item['assets']=[remap.get(x,x) for x in item.get('assets',[])]
            return p
    p=json.loads(raw.decode('utf-8-sig'))
    if 'project' in p and isinstance(p['project'],dict): p=p['project']
    return validate(p)
def export_zip(p):
    report=audit(p); buf=io.BytesIO(); esc=lambda v:html.escape(str(v or ''))
    with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED,compresslevel=1) as z:
        z.writestr('project.json',json.dumps(p,ensure_ascii=False,indent=2))
        z.writestr('picture-use-ledger.json',json.dumps(report,ensure_ascii=False,indent=2))
        out=io.StringIO(); fields=['scene','id','start','end','duration','section','title','lyrics','userNotes','assistantNotes','singer','primaryInstrument','lipSync','performers','role','status','location','emotion','motionPrompt','media','reviewNotes','techniques','beginningView','middleView','endingView','beatCues','continuityPlan']
        writer=csv.DictWriter(out,fields); writer.writeheader()
        cards=[]; assets={a['id']:a for a in p.get('assets',[])}
        for n,s in enumerate(p.get('scenes',[]),1):
            lyrics=' / '.join(l['text'] for l in p.get('lyrics',[]) if l['start']<s['end'] and l['end']>s['start'])
            row={k:s.get(k,'') for k in fields}; row.update(scene=n,duration=s['end']-s['start'],lyrics=lyrics)
            row['techniques']=technique_text(s)
            for column,key in [('beginningView','start'),('middleView','middle'),('endingView','end'),('beatCues','timing'),('continuityPlan','continuity')]:
                row[column]=s.get('shotPlan',{}).get(key,'')
            for k in ('performers','media'): row[k]=json.dumps(row[k],ensure_ascii=False)
            row={k:("'"+v if isinstance(v,str) and v.lstrip().startswith(('=','+','-','@','\t','\r')) else v) for k,v in row.items()}
            writer.writerow(row)
            images=''.join(f'<figure><img src="media/{esc(assets[a]["filename"])}"><figcaption>{esc(slot)} · {esc(assets[a]["name"])}</figcaption></figure>' for slot,a in s.get('media',{}).items() if a in assets and assets[a].get('kind')=='image')
            cards.append(f'<article><h2>{n:02d} · {esc(s.get("title"))}</h2><p>{s["start"]:.3f} → {s["end"]:.3f}s · {esc(s.get("role"))} · {esc(s.get("status"))}</p><div class="pictures">{images}</div><p><b>Lyrics</b> {esc(lyrics)}</p>'+''.join(f'<p><b>{esc(k)}</b><br>{esc(s.get(k))}</p>' for k in ['userNotes','assistantNotes','location','emotion','singer','primaryInstrument','lipSync','motionPrompt','reviewNotes'])+scene_direction_html(s)+f'<pre>{esc(json.dumps(s.get("performers",[]),ensure_ascii=False,indent=2))}</pre></article>')
        z.writestr('scenes.csv','\ufeff'+out.getvalue())
        z.writestr('scene-techniques.txt',project_direction_text(p))
        export_studio(p, z)
        z.writestr('video-vision.txt',p.get('concept',''))
        z.writestr('storyboard.txt',p.get('storyboardText',''))
        z.writestr('production-notes.txt',p.get('productionNotes',''))
        lyric_out=io.StringIO(); lyric_writer=csv.writer(lyric_out); lyric_writer.writerow(['Start','End','Lyrics','Status','ID'])
        def clock(seconds):
            millis=round(seconds*1000); minutes,millis=divmod(millis,60000); seconds,millis=divmod(millis,1000)
            return f'{minutes:02d}:{seconds:02d}.{millis:03d}'
        lyric_rows=[]
        for lyric in sorted(p.get('lyrics',[]),key=lambda l:l['start']):
            values=[clock(lyric['start']),clock(lyric['end']),lyric.get('text',''),lyric.get('status','draft'),lyric['id']]
            lyric_writer.writerow(["'"+v if isinstance(v,str) and v.lstrip().startswith(('=','+','-','@')) else v for v in values])
            lyric_rows.append(f"<tr><td>{esc(values[0])}</td><td>{esc(values[1])}</td><td>{esc(values[2])}</td></tr>")
        z.writestr('timed-lyrics.csv','\ufeff'+lyric_out.getvalue())
        planning='<h2>Video vision</h2><p>'+esc(p.get('concept'))+'</p><h2>Production notes</h2><p>'+esc(p.get('productionNotes'))+'</p><h2>Pasted storyboard</h2><pre>'+esc(p.get('storyboardText'))+'</pre><h2>Timed lyrics</h2><table><tr><th>Start</th><th>End</th><th>Lyrics</th></tr>'+''.join(lyric_rows)+'</table>'

        z.writestr('storyboard.html','<!doctype html><meta charset="utf-8"><title>'+esc(p.get('title'))+'</title><style>body{font:16px system-ui;max-width:1100px;margin:40px auto;padding:20px;color:#202020}article{border-top:2px solid #aaa;break-inside:avoid;padding:24px 0}p,pre,td{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #ccc;padding:10px}b{color:#8a3d24}.pictures{display:flex;gap:10px}figure{margin:0;max-width:32%}img{width:100%}figcaption{font-size:12px}</style><h1>'+esc(p.get('title'))+'</h1>'+planning+'<h2>Visual direction</h2><pre>'+esc(json.dumps(p.get('direction',{}),ensure_ascii=False,indent=2))+'</pre><h2>Continuity guide</h2><pre>'+esc(json.dumps(p.get('guide',{}),ensure_ascii=False,indent=2))+'</pre><p>Picture audit: '+str(len(report['issues']))+' outstanding items. See picture-use-ledger.json. Draft assets and missing assets remain explicitly recorded.</p>'+''.join(cards))
        missing=[]
        for a in p.get('assets',[]):
            path=MEDIA/Path(a.get('filename','')).name
            if path.is_file(): z.write(path,'media/'+path.name)
            else: missing.append(a.get('name',a.get('id')))
        z.writestr('READ ME.txt','Hellfire Director project package\nOpen storyboard.html for the full readable plan, video vision, pasted storyboard and timed lyrics. video-vision.txt, storyboard.txt and production-notes.txt preserve your writing. timed-lyrics.csv and scenes.csv open in Excel. scene-techniques.txt contains director, technique descriptions and camera-route notes. directing-desk.html/json includes music cues, route diagrams, continuity, lookbook, exact-version reviews and budgets; review-notes.csv lists repair notes.\nImport this ZIP to restore the structured project and included media. All project fields, notes, jobs, assignments, decisions, and reference frames are in project.json.\nMissing files: '+json.dumps(missing)+'\nAudit scope: '+report['scope'])
    return buf.getvalue()
def transcribe_task(job,aid,model,language="en"):
    try:
        from faster_whisper import WhisperModel
        TRANSCRIPTIONS[job].update(status='loading',message='Loading local transcription model. First use downloads model weights; audio stays on this computer.')
        engine=WhisperModel(model,device='cpu',compute_type='int8',download_root=str(DATA/'models'))
        a=asset_by_id(aid); segments,info=engine.transcribe(str(MEDIA/a['filename']),language=None if language=='auto' else language,task='transcribe',beam_size=5,word_timestamps=True,vad_filter=False,condition_on_previous_text=False)
        lines=[]
        for s in segments:
            if not s.text.strip() or round(s.end,3)<=round(s.start,3): continue
            lines.append(dict(id=uid(),start=round(s.start,3),end=round(s.end,3),text=s.text.strip(),status='draft',words=[dict(start=w.start,end=w.end,text=w.word) for w in s.words or []]))
            TRANSCRIPTIONS[job].update(status='running',message=f'Transcribed through {s.end:.1f}s',progress=s.end/max(info.duration,1))
        TRANSCRIPTIONS[job].update(status='complete',lyrics=lines,language=info.language,requestedLanguage=language,model=model,message='Draft ready. Review words and timing, especially distorted vocals.')
    except Exception as e: TRANSCRIPTIONS[job].update(status='failed',message=str(e))

class Handler(BaseHTTPRequestHandler):
    server_version='HellfireDirector/1.0'
    def log_message(self,*args): pass
    def send(self,data,status=200,mime='application/json',extra=None):
        if mime=='application/json': data=json.dumps(data,ensure_ascii=False).encode()
        if isinstance(data,str): data=data.encode()
        self.send_response(status); self.send_header('Content-Type',mime); self.send_header('Content-Length',str(len(data)))
        self.send_header('X-Content-Type-Options','nosniff'); self.send_header('Cache-Control','no-store')
        for k,v in (extra or {}).items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(data)
    def allowed(self):
        host=self.headers.get('Host','')
        valid={f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
        if host not in valid: return False
        origin=self.headers.get('Origin')
        if origin and origin not in {'http://'+h for h in valid}: return False
        if self.path.startswith(('/api/','/media/')):
            cookie=self.headers.get('Cookie',''); supplied=self.headers.get('X-Director-Token','')
            return secrets.compare_digest(supplied,TOKEN) or f'director_session={TOKEN}' in cookie
        return True
    def do_GET(self):
        try:
            if not self.allowed(): return self.send({'error':'Local authorization required'},403)
            path=unquote(urlparse(self.path).path); query=parse_qs(urlparse(self.path).query)
            if path=='/api/projects':
                with connection() as db: rows=db.execute('SELECT id,revision,updated,state FROM projects ORDER BY updated DESC').fetchall()
                return self.send([dict(id=r['id'],revision=r['revision'],updated=r['updated'],title=json.loads(r['state']).get('title'),scenes=len(json.loads(r['state']).get('scenes',[]))) for r in rows])
            if path=='/api/connection': return self.send(dict(url=f'http://127.0.0.1:{self.server.server_port}',bridge=str(ROOT/'assistant_bridge.py'),data=str(DATA),capabilities=['read projects','propose imports','version-checked edits','export packages'],transcription=True))
            if path.startswith('/api/transcribe/'): return self.send(TRANSCRIPTIONS[path.split('/')[-1]])
            match=re.fullmatch('/api/projects/([^/]+)(?:/(versions|export|audit))?',path)
            if match:
                pid,action=match.groups(); data=read_project(pid)
                if action=='versions':
                    with connection() as db: rows=db.execute('SELECT revision,created,label FROM versions WHERE project_id=? ORDER BY revision DESC',(pid,)).fetchall()
                    return self.send([dict(r) for r in rows])
                if action=='audit': return self.send(audit(data['state']))
                if action=='export': return self.send(export_zip(data['state']),mime='application/zip',extra={'Content-Disposition':'attachment; filename="'+re.sub(r'[^A-Za-z0-9 _-]','',data['state']['title'])[:80]+'-project.zip"'})
                return self.send(data)
            if path.startswith('/media/'):
                fname=path.split('/')[-1]
                if not re.fullmatch(r'[a-f0-9]{32}\.[a-z0-9]+',fname): raise ValueError('Invalid asset')
                file=MEDIA/fname
                if not file.is_file(): return self.send({'error':'Missing file'},404)
                size=file.stat().st_size; start=0; end=size-1; status=200
                rng=self.headers.get('Range',''); m=re.fullmatch(r'bytes=(\d+)-(\d*)',rng)
                if m:
                    start=int(m[1]); end=min(int(m[2]) if m[2] else end,end); status=206
                    if start>end: return self.send('',416,mime='text/plain',extra={'Content-Range':f'bytes */{size}'})
                self.send_response(status); self.send_header('Content-Type',mimetypes.guess_type(fname)[0] or 'application/octet-stream'); self.send_header('Accept-Ranges','bytes'); self.send_header('Content-Length',str(end-start+1))
                if status==206: self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
                self.end_headers()
                with file.open('rb') as f:
                    f.seek(start); remain=end-start+1
                    while remain:
                        chunk=f.read(min(remain,1024*1024)); self.wfile.write(chunk); remain-=len(chunk)
                return
            files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/studio.js':'studio.js','/studio-core.js':'studio-core.js','/studio.css':'studio.css','/scene-techniques.js':'scene-techniques.js','/technique-editor.js':'technique-editor.js','/lyrics-core.js':'lyrics-core.js','/timeline-core.js':'timeline-core.js','/timeline-editor.js':'timeline-editor.js','/styles.css':'styles.css','/icon.svg':'icon.svg'}
            if path in files:
                file=ROOT/'web'/files[path]; headers={}
                if path in ('/','/index.html'): headers['Set-Cookie']=f'director_session={TOKEN}; HttpOnly; SameSite=Strict; Path=/'
                return self.send(file.read_bytes(),mime=mimetypes.guess_type(str(file))[0] or 'text/plain',extra=headers)
            self.send({'error':'Not found'},404)
        except (BrokenPipeError,ConnectionResetError): pass
        except KeyError as e: self.send({'error':str(e)},404)
        except Exception as e: self.send({'error':str(e)},400)
    def do_POST(self):
        try:
            if not self.allowed(): return self.send({'error':'Local authorization required'},403)
            size=int(self.headers.get('Content-Length',0))
            if size>3*1024**3: raise ValueError('File too large (3 GB maximum per upload).')
            raw=self.rfile.read(size); path=urlparse(self.path).path
            if path=='/api/upload': return self.send(add_asset(raw,unquote(self.headers.get('X-Filename','asset.bin'))))
            if path=='/api/import/prepare':
                incoming=decode_import(raw,unquote(self.headers.get('X-Filename','project.json'))); token=uid(); IMPORTS[token]=incoming
                return self.send(dict(token=token,incoming=incoming))
            body=json.loads(raw or b'{}')
            if path=='/api/projects': return self.send(save_project(blank(body.get('title','Untitled video')),0,'Created'))
            if path=='/api/import/review':
                incoming=IMPORTS[body['token']]; current=read_project(body['projectId'])['state']
                merged,changes=merge_with_review(current,incoming)
                return self.send(dict(changes=changes,newScenes=len(merged.get('scenes',[]))-len(current.get('scenes',[])),incoming=incoming))
            if path=='/api/import/apply':
                incoming=IMPORTS[body['token']]
                if body.get('mode')=='new':
                    state=blank(incoming.get('title','Imported project')); state.update(copy.deepcopy(incoming)); state['id']=uid(); expected=0
                else:
                    record=read_project(body['projectId']); expected=body['expectedRevision']
                    if record['revision']!=expected: raise Conflict('Project changed during import review. Review the import again.')
                    state,_=merge_with_review(record['state'],incoming,body.get('choices',{}))
                result=save_project(state,expected,'Imported package'); return self.send(result)
            if path=='/api/transcribe':
                aid=body['assetId']; asset_by_id(aid); model=body.get('model','small')
                if model not in ['tiny','base','small','medium','large-v3']: raise ValueError('Unsupported transcription model')
                language=body.get('language','en')
                if language not in ['en','auto','es','fr','de','pt','it','ja']: raise ValueError('Unsupported transcription language')
                job=uid(); TRANSCRIPTIONS[job]=dict(status='queued',message='Starting transcription',projectId=body.get('projectId'))
                threading.Thread(target=transcribe_task,args=(job,aid,model,language),daemon=True).start(); return self.send(dict(id=job))
            match=re.fullmatch('/api/projects/([^/]+)(?:/(restore))?',path)
            if match:
                pid,action=match.groups()
                if action=='restore':
                    with connection() as db: row=db.execute('SELECT state FROM versions WHERE project_id=? AND revision=?',(pid,body['revision'])).fetchone()
                    if not row: raise KeyError('Version not found')
                    return self.send(save_project(json.loads(row[0]),body['expectedRevision'],'Restored version '+str(body['revision'])))
                body['state']['id']=pid; return self.send(save_project(body['state'],body['expectedRevision'],body.get('label','Autosave')))
            self.send({'error':'Not found'},404)
        except Conflict as e: self.send({'error':str(e)},409)
        except KeyError as e: self.send({'error':str(e)},404)
        except Exception as e: self.send({'error':str(e)},400)
class DirectorServer(ThreadingHTTPServer):
    """One app per port. HTTPServer enables SO_REUSEADDR, which on Windows lets a second launch bind the same
    port instead of failing, so several copies ran at once with different tokens and requests hit them at random."""
    allow_reuse_address = False
    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()
def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--port',type=int,default=47831); parser.add_argument('--open',action='store_true'); args=parser.parse_args()
    initialize()
    try: server=DirectorServer(('127.0.0.1',args.port),Handler)
    except OSError:
        if args.open: webbrowser.open(f'http://127.0.0.1:{args.port}')
        return
    url=f'http://127.0.0.1:{server.server_port}'
    (DATA/'connection.json').write_text(json.dumps(dict(url=url,token=TOKEN,pid=os.getpid()),indent=2),encoding='utf-8')
    print('Hellfire Director: '+url,flush=True)
    if args.open: webbrowser.open(url)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
if __name__=='__main__': main()
