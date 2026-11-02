"""Validation, portable media bindings and readable Directing desk exports."""
import csv
import html
import io
import json
import math
from pathlib import Path


def obj(value, label):
    if not isinstance(value, dict):
        raise ValueError(label + ' must be an object.')
    return value


def rows(value, label):
    if not isinstance(value, list):
        raise ValueError(label + ' must be a list.')
    seen = set()
    for row in value:
        obj(row, label + ' entry')
        if not isinstance(row.get('id'), str) or not row['id'] or row['id'] in seen:
            raise ValueError(label + ' entries need unique string IDs.')
        seen.add(row['id'])
    return value


def number(value, label, low=0, high=86400):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{label} must be a number between {low} and {high}.')


def text_fields(record, keys, label):
    for key in keys.split():
        if key in record and not isinstance(record[key], str):
            raise ValueError(label + ' ' + key + ' must be text.')


def validate_studio(project):
    sd = obj(project.get('studio', {}), 'Directing desk')
    text_fields(sd, 'protectedSuffix', 'Directing desk')
    for key in ('continuityCards', 'cutVersions', 'reviewNotes', 'reviewDrafts', 'lookbook', 'budgets'):
        rows(sd.get(key, []), key)
    music = obj(sd.get('music', {}), 'Music plan')
    for key in ('bpm', 'offset', 'beatsPerBar'):
        if key in music:
            number(music[key], key, 0, 86400)
    for cue in rows(music.get('cues', []), 'Musical cues'):
        number(cue.get('time'), 'Cue time')
        text_fields(cue, 'type label status', 'Cue')
    for point in rows(music.get('energy', []), 'Energy points'):
        number(point.get('time'), 'Energy time')
        number(point.get('energy'), 'Visual energy', 1, 5)
        text_fields(point, 'label', 'Energy point')
    for card in sd.get('continuityCards', []):
        text_fields(card, 'name kind origin details source status assetId sha256', 'Continuity card')
    for cut in sd.get('cutVersions', []):
        text_fields(cut, 'label assetId sha256 createdAt', 'Cut version')
        number(cut.get('offset', 0), 'Cut offset', -86400, 86400)
        for scene in rows(cut.get('sceneMap', []), 'Cut scene map'):
            number(scene.get('start'), 'Captured scene start')
            number(scene.get('end'), 'Captured scene end')
            if scene['end'] <= scene['start']:
                raise ValueError('Captured scene end must follow start.')
    for draft in sd.get('reviewDrafts', []):
        text_fields(draft, 'text endTime', 'Unfinished review note')
        number(draft.get('time', 0), 'Unfinished review time')
    for note in sd.get('reviewNotes', []):
        number(note.get('time'), 'Review time')
        if note.get('endTime') is not None:
            number(note['endTime'], 'Review end')
            if note['endTime'] < note['time']:
                raise ValueError('Review range end must follow its start.')
        text_fields(note, 'versionId assetId sha256 sceneId sceneTitle text status createdAt', 'Review note')
        if not isinstance(note.get('annotations', []), list):
            raise ValueError('Annotations must be a list.')
        for pin in note.get('annotations', []):
            obj(pin, 'Annotation')
            for key in ('x', 'y', 'rx', 'ry'):
                number(pin.get(key), 'Annotation ' + key, 0, 1)
    for entry in sd.get('lookbook', []):
        text_fields(entry, 'title kind director lesson movement lightColor url assetId sourceProject', 'Lookbook entry')
    for budget in sd.get('budgets', []):
        text_fields(budget, 'name provider model resolution balanceAsOf approval notes', 'Budget')
        for key in ('ceiling', 'balance'):
            if key in budget:
                number(budget[key], 'Budget ' + key, 0, 100000000)
    for scene in project.get('scenes', []):
        plan = obj(scene.get('studio', {}), 'Scene directing plan')
        text_fields(plan, 'framing angle featured motion performance visiblePeople visibleProps sourceDescription promptModel selectedTakeId', 'Scene directing plan')
        for key in ('clipIn', 'routeDuration'):
            if key in plan:
                number(plan[key], key)
        camera = obj(plan.get('camera', {}), 'Camera map')
        for key in ('performers', 'points'):
            for marker in rows(camera.get(key, []), 'Camera ' + key):
                number(marker.get('x'), 'Camera map X', 0, 100)
                number(marker.get('y'), 'Camera map Y', 0, 100)
                text_fields(marker, 'name action target framing cue', 'Camera marker')
                if key == 'points':
                    number(marker.get('time'), 'Camera stop time')
        for link in rows(plan.get('continuity', []), 'Scene continuity links'):
            text_fields(link, 'cardId state', 'Continuity link')
        for take in rows(plan.get('takes', []), 'Scene takes'):
            text_fields(take, 'label assetId sha256 status', 'Take')
            number(take.get('startOffset', 0), 'Take source in-point')
        if 'promptDraft' in plan:
            text_fields(obj(plan['promptDraft'], 'Prompt draft'), 'text signature createdAt', 'Prompt draft')
    for job in project.get('jobs', []):
        for key in ('estimatedCredits', 'generatedDuration', 'handles'):
            if key in job:
                number(job[key], key, 0, 100000000)
    return project


def remap_studio_assets(project, remap):
    def walk(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key == 'assetId' and isinstance(item, str):
                    value[key] = remap.get(item, item)
                else:
                    walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)
    walk(project.get('studio', {}))
    for scene in project.get('scenes', []):
        walk(scene.get('studio', {}))


def export_studio(project, archive):
    esc = lambda value: html.escape(str(value if value is not None else ''))
    sd = project.get('studio', {})
    assets = {a['id']: a for a in project.get('assets', [])}
    def media(aid):
        a = assets.get(aid)
        if not a:
            return ''
        src = 'media/' + esc(Path(a.get('filename', '')).name)
        if a.get('kind') == 'image':
            return f'<img src="{src}" alt="{esc(a.get("name"))}">'
        if a.get('kind') == 'video':
            return f'<video src="{src}" controls preload="metadata"></video>'
        return ''
    def record(value):
        return '<pre>' + esc(json.dumps(value, ensure_ascii=False, indent=2)) + '</pre>'
    def table(items, fields):
        return '<table><tr>' + ''.join('<th>' + esc(k) + '</th>' for k in fields) + '</tr>' + ''.join('<tr>' + ''.join('<td>' + esc(row.get(k, '')) + '</td>' for k in fields) + '</tr>' for row in items) + '</table>'
    sections = ['<h1>' + esc(project.get('title')) + ' · Directing desk</h1>', '<h2>Director and approach</h2>', record(project.get('direction', {})), '<h2>Music and visual energy</h2>', record(sd.get('music', {}))]
    for n, scene in enumerate(project.get('scenes', []), 1):
        plan = scene.get('studio', {})
        sections.append(f'<article><h2>Scene {n}: {esc(scene.get("title"))}</h2><p>{scene["start"]:.3f}–{scene["end"]:.3f} seconds</p>')
        camera = plan.get('camera', {})
        points = camera.get('points', [])
        if points or camera.get('performers'):
            coords = ' '.join(f'{p["x"]*6},{p["y"]*3.6}' for p in points)
            sections.append(f'<svg viewBox="0 0 600 360"><rect width="600" height="360" fill="#14232b"/><polyline points="{coords}" fill="none" stroke="#edbd75" stroke-width="3"/>')
            for i, p in enumerate(points, 1):
                previous = sum(abs(q['x']-p['x'])<.1 and abs(q['y']-p['y'])<.1 for q in points[:i-1])
                sections.append(f'<circle cx="{p["x"]*6}" cy="{p["y"]*3.6}" r="10" fill="#edbd75"/><text x="{p["x"]*6+12}" y="{p["y"]*3.6+previous*18}" fill="white">{i} · {p["time"]:.3f}s</text>')
            for p in camera.get('performers', []):
                sections.append(f'<circle cx="{p["x"]*6}" cy="{p["y"]*3.6}" r="10" fill="#77bbca"/><text x="{p["x"]*6+12}" y="{p["y"]*3.6}" fill="white">{esc(p.get("name"))}</text>')
            sections.append('</svg>')
        sections.append('<h3>Shot direction</h3>' + record({k:v for k,v in plan.items() if k not in ('promptDraft','draftHistory','camera','takes')}))
        sections.append('<h3>Camera arrivals</h3>'+table(points,['time','target','framing','cue']))
        sections.append('<h3>Continuing performance</h3>'+table(camera.get('performers',[]),['name','action','x','y']))
        sections.append('<h3>Takes</h3>'+table(plan.get('takes',[]),['label','status','startOffset','sha256']))
        if plan.get('promptDraft'):
            sections.append('<h3>Editable prompt draft</h3><pre>'+esc(plan['promptDraft'].get('text',''))+'</pre>')
        sections.append('</article>')
    for key, title in [('continuityCards', 'Visual continuity'), ('lookbook', 'Director lookbook and lessons'), ('cutVersions', 'Full video versions')]:
        sections.append('<h2>' + title + '</h2>')
        for item in sd.get(key, []):
            sections.append('<article>' + media(item.get('assetId')) + record(item) + '</article>')
    sections.extend(['<h2>Exact-frame review and repair notes</h2>', record(sd.get('reviewNotes', [])), '<h2>Unfinished review notes</h2>', record(sd.get('reviewDrafts', [])), '<h2>Provider budgets</h2>', record(sd.get('budgets', [])), '<h2>Job ledger</h2>', record(project.get('jobs', []))])
    archive.writestr('directing-desk.html', '<!doctype html><meta charset="utf-8"><title>Directing desk</title><style>body{font:16px system-ui;max-width:1100px;margin:40px auto;padding:20px}article{padding:20px 0;border-top:1px solid #aaa}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f3f3;padding:20px}img,video,svg{max-width:100%;max-height:480px}td,th{text-align:left;padding:10px;border:1px solid #ddd}table{border-collapse:collapse}</style>' + ''.join(sections))
    archive.writestr('directing-desk.json', json.dumps(dict(studio=sd, scenes=[dict(id=s['id'], title=s.get('title'), studio=s.get('studio', {})) for s in project.get('scenes', [])]), ensure_ascii=False, indent=2))
    out = io.StringIO()
    fields = ['id', 'versionId', 'assetId', 'sha256', 'time', 'endTime', 'sceneNumber', 'sceneId', 'sceneTitle', 'status', 'text', 'annotations']
    writer = csv.DictWriter(out, fields)
    writer.writeheader()
    for note in sd.get('reviewNotes', []):
        row = {key: note.get(key, '') for key in fields}
        row['annotations'] = json.dumps(row['annotations'])
        writer.writerow({key: "'" + value if isinstance(value, str) and value.lstrip().startswith(('=', '+', '-', '@')) else value for key, value in row.items()})
    archive.writestr('review-notes.csv', '\ufeff' + out.getvalue())
