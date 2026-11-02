(function(root){
 'use strict';
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number(n)||0));
 const people=s=>[...new Set([s.singer,...(s.performers||[]).map(p=>p.name),...(s.studio?.featured||'').split(/[,;\n]/)].filter(Boolean).map(x=>x.trim().replace(/\bGB\b/g,'Georgia Belle')).filter(Boolean))];
 function atScene(scenes,time){return scenes.find(s=>time>=s.start&&time<s.end)||null;}
 function beatGrid(bpm,offset,length){
  bpm=Number(bpm);offset=Number(offset)||0;
  if(!Number.isFinite(bpm)||bpm<20||bpm>400)return [];
  const step=60/bpm,out=[];let n=Math.max(0,Math.ceil(-offset/step));
  for(;out.length<5000;n++){const time=offset+n*step;if(time>length)break;out.push({time:Math.round(time*1000)/1000,beat:n});}
  return out;
 }
 function estimateTempo(samples,rate){
  if(!samples.length||!rate)throw Error('Load a decodable song first.');
  const hop=Math.max(1,Math.floor(rate*.01)),envelope=[];
  for(let i=0;i<samples.length;i+=hop){let sum=0;for(let j=i;j<Math.min(samples.length,i+hop);j++)sum+=samples[j]*samples[j];envelope.push(Math.sqrt(sum/hop));}
  const onset=envelope.map((v,i)=>Math.max(0,v-(envelope[i-1]||0))),hz=rate/hop;
  let best={bpm:120,score:0};
  for(let bpm=60;bpm<=200;bpm++){const lag=Math.round(60*hz/bpm);let sum=0;for(let i=lag;i<onset.length;i++)sum+=onset[i]*onset[i-lag];const score=sum/Math.max(1,onset.length-lag);if(score>best.score)best={bpm,score};}
  if(!best.score)throw Error('No clear pulse found. Enter a tempo or tap along.');
  return best.bpm;
 }
 function shotMotion(s){return s.studio?.motion||((s.studio?.camera?.points?.length||0)>1?'moving':(s.techniques||[]).some(t=>t.category==='camera'&&['tracking','orbit','push-pull','pan-tilt','boom','handheld','whip-pan','continuous-reframe'].includes(t.techniqueId))?'moving':'unplanned');}
 function variety(scenes,absence=30){
  const alerts=[],names=[...new Set(scenes.flatMap(people))],coverage={};
  for(const name of names){let last=null;coverage[name]=0;for(let i=0;i<scenes.length;i++){const s=scenes[i];if(people(s).includes(name)){coverage[name]+=s.end-s.start;if(last!==null&&s.start-last>=absence)alerts.push(`${name} returns after ${(s.start-last).toFixed(1)} seconds without a featured shot.`);last=s.end;}}}
  for(const key of ['framing','angle']){let last='',start=0,count=0;for(let i=0;i<=scenes.length;i++){const value=scenes[i]?.studio?.[key]||'';if(value&&value===last)count++;else{if(last&&count>=4)alerts.push(`Scenes ${start+1}–${i}: ${count} consecutive ${last} ${key==='framing'?'framings':'angles'}. Check whether the repetition is intentional.`);last=value;start=i;count=value?1:0;}}}
  for(let i=1;i<scenes.length;i++){const a=scenes[i-1].primaryInstrument,b=scenes[i].primaryInstrument;if(a&&b&&a.trim().toLowerCase()===b.trim().toLowerCase())alerts.push(`Scenes ${i} and ${i+1} feature the same instrument (${b}). Review the cutaway coverage.`);}
  return {alerts,coverage};
 }
 function routeWarnings(scene){
  const c=scene.studio?.camera||{},points=c.points||[],len=scene.end-scene.start,w=[];
  for(let i=0;i<points.length;i++){const p=points[i];if(p.time<0||p.time>len)w.push(`Camera stop ${i+1} is outside this scene's ${len.toFixed(3)} seconds.`);if(i&&p.time<=points[i-1].time)w.push(`Camera stop ${i+1} must arrive after the preceding stop.`);if(p.target&&!c.performers?.some(x=>x.id===p.target))w.push(`Camera stop ${i+1} has a missing focus target.`);}
  if(scene.studio?.routeDuration!==undefined&&Math.abs(scene.studio.routeDuration-len)>.001)w.push('Scene duration changed after route planning. Review stop timings; they were preserved.');
  return w;
 }
 function sourceSignature(p,s){return JSON.stringify({media:Object.entries(s.media||{}).map(([slot,id])=>[slot,id,p.assets.find(a=>a.id===id)?.sha256||'']),direction:p.direction,role:s.lipSync,singer:s.singer,performers:s.performers,techniques:s.techniques,shotPlan:s.shotPlan,studio:{...s.studio,promptDraft:undefined,draftHistory:undefined,takes:undefined,selectedTakeId:undefined,clipIn:undefined},cards:(p.studio?.continuityCards||[]).filter(c=>(s.studio?.continuity||[]).some(x=>x.cardId===c.id)),start:s.start,end:s.end,suffix:p.studio?.protectedSuffix});}
 function draftPrompt(p,s){
  const d=s.studio||{},w=routeWarnings(s),visible=(d.visiblePeople||'').split(/[,;\n]/).map(x=>x.trim().replace(/\bGB\b/g,'Georgia Belle')).filter(Boolean),required=people(s),c=d.camera||{},lines=[];
  const sources=Object.values(s.media||{}).map(id=>p.assets.find(a=>a.id===id)).filter(a=>a?.kind==='image');
  if(!sources.length)w.push('No scene picture is attached. Add and inspect the source before using this draft.');
  if(!d.sourceDescription)w.push('Describe the actual source picture; this builder does not inspect images automatically.');
  if(!d.performance)w.push('Write a concrete sustained performance or practical action.');
  for(const name of required)if(!visible.some(n=>n.toLowerCase()===name.toLowerCase()))w.push(`${name} is assigned to this scene but is not in the confirmed visible-people list.`);
  for(const t of c.performers||[])if(t.name&&!visible.some(n=>n.toLowerCase()===t.name.toLowerCase()))w.push(`Camera-map performer ${t.name} is not in the confirmed visible-people list.`);
  if(s.lipSync)lines.push('Georgia Belle'.replace('Georgia Belle',s.singer||'The lead singer')+' continuously articulates every audible lead-vocal sound throughout the retained shot, including the final audible syllable. Gestures and camera movement never replace continuing vocals. Keep the mouth readable, with micro-saccades and occasional unforced blinks.');
  lines.push(`Scene: ${s.title||''}. Duration: ${(s.end-s.start).toFixed(3)} seconds. Role: ${s.lipSync?'Lip Sync':'Cut; do not invent singing'}.`);
  const put=(name,value)=>{if(value)lines.push(name+': '+value);};
  put('Director / reference',p.direction?.director);put('Directing approach',p.direction?.directorStyle);put('Source picture',d.sourceDescription);put('Visible people',d.visiblePeople);put('Visible props',d.visibleProps);put('Sustained action',d.performance);put('Framing',d.framing);put('Angle',d.angle);put('Setting',s.location||p.direction?.settings);put('Lighting',p.direction?.lighting);put('Palette',p.direction?.colors);
  for(const t of s.techniques||[])put(t.title,t.directions||t.description);
  for(const [key,label] of [['start','Beginning view'],['middle','Middle view'],['end','Ending view'],['timing','Musical cues'],['continuity','Continuity']])put(label,s.shotPlan?.[key]);
  for(const [i,stop] of (c.points||[]).entries()){const target=c.performers?.find(x=>x.id===stop.target);lines.push(`Camera stop ${i+1} at ${stop.time.toFixed(3)}s: ${stop.framing||'framing to confirm'}; feature ${target?.name||'target to confirm'}; ${stop.cue||'movement cue to confirm'}.`);}
  for(const person of c.performers||[])put(person.name+' keeps performing',person.action);
  for(const link of d.continuity||[]){const card=p.studio?.continuityCards?.find(x=>x.id===link.cardId);if(!card)w.push('A linked continuity card is missing. Review the scene references.');if(card){put('Preserve '+card.name,[card.details,link.state].filter(Boolean).join(' · '));if(card.status!=='accepted')w.push(`Continuity reference ${card.name} is not accepted.`);}}
  let text=lines.join('\n\n').replace(/\bGB\b/g,'Georgia Belle');if(p.studio?.protectedSuffix)text+='\n\n'+p.studio.protectedSuffix;
  return {text,warnings:w,signature:sourceSignature(p,s)};
 }
 function budgetReport(budgets,jobs){return budgets.map(b=>{const assigned=jobs.filter(j=>j.budgetId===b.id),mismatch=assigned.filter(j=>j.provider!==b.provider),valid=assigned.filter(j=>j.provider===b.provider);let actual=0,planned=0,unknown=0;for(const j of valid){if(j.chargeRecorded===true||(j.chargeRecorded===undefined&&Number(j.credits)>0))actual+=Number(j.credits)||0;else {planned+=Number(j.estimatedCredits)||0;if(j.status==='failed')unknown++;}}return {...b,actual,planned,committed:actual+planned,remaining:(Number(b.ceiling)||0)-actual-planned,mismatch:mismatch.length,unknown};});}
 function canUseTake(t,a){return !!(t&&a&&a.kind==='video'&&t.status==='accepted'&&t.sha256&&t.sha256===a.sha256);}
 const api={clamp,people,atScene,beatGrid,estimateTempo,shotMotion,variety,routeWarnings,sourceSignature,draftPrompt,budgetReport,canUseTake};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.StudioCore=api;
})(typeof window==='undefined'?globalThis:window);
