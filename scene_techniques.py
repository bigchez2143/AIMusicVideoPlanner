"""Readable scene direction exports; project JSON remains the source of truth."""
import html

PLAN_FIELDS = [('start', 'Beginning view'), ('middle', 'Middle view / handoff'),
               ('end', 'Ending view'), ('timing', 'Beat / lyric cues'),
               ('continuity', 'Continuity to preserve')]


def technique_text(scene):
    blocks = []
    for technique in scene.get('techniques', []):
        blocks.append('\n'.join(filter(None, [
            f"{technique.get('category', 'Technique').title()}: {technique.get('title', 'Untitled technique')}",
            technique.get('description', ''),
            'Scene directions: ' + technique['directions'] if technique.get('directions') else '',
        ])))
    return '\n\n'.join(blocks)


def scene_direction_text(scene):
    blocks = [technique_text(scene)]
    for key, label in PLAN_FIELDS:
        value = scene.get('shotPlan', {}).get(key)
        if value:
            blocks.append(f'{label}:\n{value}')
    return '\n\n'.join(filter(None, blocks))


def scene_direction_html(scene):
    esc = lambda value: html.escape(str(value or ''))
    if not scene.get('techniques') and not any(scene.get('shotPlan', {}).values()):
        return ''
    blocks = ['<section><h3>Camera, lighting &amp; color</h3>']
    for technique in scene.get('techniques', []):
        blocks.append('<h4>' + esc(technique.get('category', '').title()) + ' · ' + esc(technique.get('title')) + '</h4>')
        if technique.get('description'):
            blocks.append('<p>' + esc(technique['description']) + '</p>')
        if technique.get('directions'):
            blocks.append('<p><b>Scene directions</b><br>' + esc(technique['directions']) + '</p>')
    for key, label in PLAN_FIELDS:
        value = scene.get('shotPlan', {}).get(key)
        if value:
            blocks.append('<p><b>' + label + '</b><br>' + esc(value) + '</p>')
    return ''.join(blocks) + '</section>'


def project_direction_text(project):
    direction = project.get('direction', {})
    lines = [project.get('title', 'Untitled video'),
             'Director / reference: ' + direction.get('director', ''),
             'Director style / approach: ' + direction.get('directorStyle', '')]
    for number, scene in enumerate(project.get('scenes', []), 1):
        lines.extend(['', f"Scene {number:02d} · {scene.get('title', '')} · {scene['start']:.3f}–{scene['end']:.3f}s",
                      scene_direction_text(scene) or 'No scene techniques selected yet.'])
    return '\n'.join(lines) + '\n'
