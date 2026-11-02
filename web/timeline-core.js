/* Timeline operations are pure: callers commit one undoable result at a time. */
(function(root) {
  'use strict';
  const copy = value => structuredClone(value);
  const round = value => Math.round(value * 1000) / 1000;
  const MIN = 0.05, EPS = 0.002;
  function issues(scenes, duration) {
    if (!scenes.length) return ['Add a scene to cover the song.'];
    const problems = [];
    let end = 0;
    for (const scene of scenes) {
      if (!Number.isFinite(scene.start) || !Number.isFinite(scene.end) || scene.end <= scene.start) problems.push('Invalid scene timing.');
      if (Math.abs(scene.start - end) > EPS) problems.push(scene.start > end ? 'A gap needs review.' : 'An overlap needs review.');
      end = scene.end;
    }
    if (Math.abs(end - duration) > EPS) problems.push('Scenes do not end with the song.');
    return [...new Set(problems)];
  }
  function requireCoverage(scenes, duration) {
    if (issues(scenes, duration).length) throw Error('Review timeline coverage first. Existing timings have been preserved.');
  }
  function split(scenes, index, at, blank) {
    const out = copy(scenes), s = out[index];
    if (!s) throw Error('Select a scene first.');
    if (!Number.isFinite(at)) throw Error('Place the playhead inside a scene.');
    at = round(at);
    if (round(at - s.start) < MIN || round(s.end - at) < MIN) throw Error('Each part needs at least 0.05 seconds.');
    out.splice(index + 1, 0, {...copy(blank), start:at, end:s.end});
    s.end = at;
    return out;
  }
  function splitTarget(scenes, time) {
    if (!Number.isFinite(time)) throw Error('Place the playhead inside a scene.');
    const at = round(time);
    if (scenes.some(s => at === round(s.start) || at === round(s.end))) throw Error('The playhead is already on a scene boundary. Move it inside a scene to split.');
    const index = scenes.findIndex(s => at > s.start && at < s.end);
    if (index < 0) throw Error('Place the playhead inside a scene to split.');
    return {index, at};
  }
  function boundary(scenes, index, side, time, duration, snap = 0.1) {
    requireCoverage(scenes, duration);
    if (!Number.isFinite(time)) throw Error('Enter a valid time.');
    const out = copy(scenes), edge = side === 'start' ? index : index + 1;
    if (edge <= 0 || edge >= out.length) throw Error('The start and end of the song stay fixed. Adjust an interior boundary.');
    const lo = out[edge-1].start + MIN, hi = out[edge].end - MIN;
    const rounded = snap > 0 ? Math.round(time / snap) * snap : time;
    const value = round(Math.max(lo, Math.min(hi, rounded)));
    out[edge-1].end = value; out[edge].start = value;
    return out;
  }
  function reorder(scenes, from, to, duration) {
    requireCoverage(scenes, duration);
    if (from < 0 || from >= scenes.length || to < 0 || to >= scenes.length) throw Error('Invalid scene position.');
    const out = copy(scenes), [item] = out.splice(from, 1); out.splice(to, 0, item);
    let cursor = 0;
    for (const s of out) {const length = s.end-s.start; s.start=cursor; cursor=round(cursor+length); s.end=cursor;}
    out[out.length-1].end = duration;
    return out;
  }
  function remove(scenes, index, duration) {
    requireCoverage(scenes, duration);
    if (scenes.length === 1) throw Error('Keep one scene covering the song. Clear its notes or start a new project instead.');
    const out = copy(scenes), [item] = out.splice(index,1);
    if (index > 0) out[index-1].end=item.end;
    else out[0].start=0;
    return out;
  }
  function merge(scenes, index, duration) {
    requireCoverage(scenes, duration);
    const out=copy(scenes), s=out[index], n=out[index+1];
    if (!n) throw Error('There is no next scene to merge.');
    s.end=n.end;
    for (const key of ['userNotes','assistantNotes','reviewNotes']) s[key]=[s[key],n[key]].filter(Boolean).join('\n\n');
    if(s.techniques||n.techniques){
      s.techniques=s.techniques||[];
      for(const technique of n.techniques||[]){
        const existing=s.techniques.find(t=>t.id===technique.id);
        if(existing&&JSON.stringify(existing)===JSON.stringify(technique))continue;
        const item={...technique};
        if(existing){let suffix=1;do{item.id=technique.id+'-merged-'+n.id+'-'+suffix++;}while(s.techniques.some(t=>t.id===item.id));}
        s.techniques.push(item);
      }
    }
    if(n.shotPlan){
      s.shotPlan=s.shotPlan||{};
      for(const [key,value] of Object.entries(n.shotPlan)){
        if(!s.shotPlan[key])s.shotPlan[key]=value;
        else if(value&&s.shotPlan[key]!==value)s.shotPlan[key]+='\n\nFrom '+(n.title||'next scene')+':\n'+value;
      }
    }
    s.performers=[...(s.performers||[]),...(n.performers||[])];
    s.mergedScenes=[...(s.mergedScenes||[]),n];
    s.media={...s.media};
    for (const [key,value] of Object.entries(n.media||{})) s.media[s.media[key] ? 'merged_'+n.id+'_'+key : key]=value;
    if (s.motionPrompt) s.promptHistory=[...(s.promptHistory||[]),{prompt:s.motionPrompt,reason:'Scene merge'}];
    s.motionPrompt='';s.motionPromptStatus='needs rewrite';
    out.splice(index+1,1);return out;
  }
  // Preserve all current lines by default; replacement is an explicit review choice.
  function applyTranscript(current, incoming, mode) {
    const keep=mode==='replaceDrafts'?current.filter(l=>l.status==='reviewed'):mode==='replaceAll'?[]:current;
    const protectedLines=mode==='replaceDrafts'?keep:[];
    const added=incoming.filter(l=>!protectedLines.some(k=>l.start<k.end&&l.end>k.start));
    return copy([...keep,...added].sort((a,b)=>a.start-b.start));
  }
  const api={issues,requireCoverage,split,splitTarget,boundary,reorder,remove,merge,applyTranscript,MIN};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.TimelineCore=api;
})(typeof window==='undefined'?globalThis:window);
