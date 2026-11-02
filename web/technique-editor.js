'use strict';

function techniqueSection(s,p){
 const selectedTechniques=s.techniques||[],plan=s.shotPlan||{};
 return `<section class="inspector-section scene-techniques" data-technique-scene="${esc(s.id)}" aria-label="Camera, lighting & color"><div class="technique-heading"><div><h3>Camera, lighting &amp; color</h3><p class="field-help">Choose techniques, read what they do, then describe how to use them in this scene. Saved with your storyboard and export package.</p></div><span class="badge">${selectedTechniques.length} selected</span></div>
 <div class="technique-columns">${Object.entries(SceneTechniques.categories).map(([category,title])=>{
   const list=selectedTechniques.map((t,i)=>({t,i})).filter(({t})=>t.category===category);
   return `<div class="technique-group" data-technique-group="${category}"><h4>${title}</h4><label>Choose a ${category==='color'?'color':category==='lighting'?'lighting':'camera or staging'} technique<select data-technique-select="${category}"><option value="">Explore techniques…</option>${SceneTechniques.catalog.filter(t=>t.category===category&&!selectedTechniques.some(x=>x.techniqueId===t.key)).map(t=>`<option value="${t.key}">${esc(t.title)}</option>`).join('')}<option value="custom">Custom technique…</option></select></label><p class="technique-preview" aria-live="polite">Select a technique to read its description.</p><button data-action="addTechnique" data-category="${category}" disabled>＋ Add technique</button><div class="selected-techniques">${list.map(({t,i})=>`<article class="technique-item"><div class="technique-item-heading"><strong>${esc(t.title||'Untitled technique')}</strong><button class="icon" data-action="removeTechnique" data-index="${i}" aria-label="Remove ${esc(t.title||'technique')}">×</button></div>${t.techniqueId==='custom'?field('Technique name',p+'.techniques.'+i+'.title',t.title)+area('Description',p+'.techniques.'+i+'.description',t.description,'Explain what this technique does.'): `<p class="technique-description">${esc(t.description)}</p>`}${area('Directions for this scene',p+'.techniques.'+i+'.directions',t.directions,'Who, where, how and on which beat or lyric?')}</article>`).join('')||'<p class="field-help technique-empty">No techniques selected yet.</p>'}</div></div>`;
 }).join('')}</div>
 ${selectedTechniques.some(t=>!SceneTechniques.categories[t.category])?`<div class="notice">This scene includes additional imported techniques. Their data is retained in the project and exports.</div>`:''}
 <details class="shot-plan"><summary>Camera route, keyframes &amp; continuity</summary><p class="field-help">Plan the whole move before making pictures or video. These directions sit alongside the Beginning, Middle and Ending pictures in Storyboard.</p><div class="keyframe-plan">${area('Beginning view',p+'.shotPlan.start',plan.start,'Who is featured? Camera position, framing and starting light.')}${area('Middle view / handoff',p+'.shotPlan.middle',plan.middle,'How does the camera reach the next performer? What stays visible?')}${area('Ending view',p+'.shotPlan.end',plan.end,'Where does the camera finish? How does the performance continue?')}</div><div class="form-grid">${area('Beat / lyric cues',p+'.shotPlan.timing',plan.timing,'Camera arrivals, actions and lighting or color changes tied to the music.')}${area('Continuity to preserve',p+'.shotPlan.continuity',plan.continuity,'Performer positions, light sources, skin texture, wardrobe, props and direction of travel.')}</div></details></section>`;
}

function techniqueBoardSummary(s){
 const count=(s.techniques||[]).length,hasPlan=Object.values(s.shotPlan||{}).some(Boolean);
 return `<div class="board-techniques"><p class="small">${count?`${count} technique${count===1?'':'s'} · ${(s.techniques||[]).map(t=>esc(t.title)).join(' · ')}`:'Camera, lighting &amp; color: not planned yet.'}${hasPlan?'<br>Camera route / keyframe notes saved.':''}</p><button class="text-button" data-action="editSceneTechniques" data-id="${esc(s.id)}">Plan camera, lighting &amp; color →</button></div>`;
}

document.addEventListener('change',e=>{
 const select=e.target.closest('[data-technique-select]');if(!select)return;
 const group=select.closest('[data-technique-group]'),technique=SceneTechniques.catalog.find(t=>t.key===select.value);
 group.querySelector('.technique-preview').textContent=technique?.description||(select.value==='custom'?'Add a technique of your own, with a name, description and directions.':'Select a technique to read its description.');
 group.querySelector('[data-action="addTechnique"]').disabled=!select.value;
});

function initSceneTechniques(){
$('#dialog').addEventListener('close',()=>{if(project&&tab==='board')renderBoard();});
Object.assign(actions,{
 addTechnique:el=>{
   const section=el.closest('[data-technique-scene]'),s=project.scenes.find(x=>x.id===section.dataset.techniqueScene);
   const key=el.closest('[data-technique-group]').querySelector('[data-technique-select]').value;
   if(!s||!key)return;
   if(key!=='custom'&&(s.techniques||[]).some(t=>t.techniqueId===key))return;
   rememberEdit();s.techniques??=[];s.techniques.push(SceneTechniques.entry(key,id(),el.dataset.category));changed();refreshTechniqueViews(s.id,el.closest('dialog')!==null);
 },
 removeTechnique:el=>{
   const section=el.closest('[data-technique-scene]'),s=project.scenes.find(x=>x.id===section.dataset.techniqueScene);
   if(!s)return;rememberEdit();s.techniques.splice(Number(el.dataset.index),1);changed();refreshTechniqueViews(s.id,el.closest('dialog')!==null);
 },
 editSceneTechniques:el=>{
   selectTimelineScene(el.dataset.id,true);
   $('#dialog-body .scene-techniques')?.scrollIntoView({block:'start'});
 }
});}

function refreshTechniqueViews(sid,inDialog){
 const container=inDialog?$('#dialog-body'):$('#content'),old=container.querySelector('.scene-techniques');
 const oldTop=old?.getBoundingClientRect().top,open=old?.querySelector('.shot-plan')?.open;
 if(tab==='story')renderStory();else if(tab==='board')renderBoard();
 refreshSceneDialog();
 const next=container.querySelector('.scene-techniques');
 if(open&&next)next.querySelector('.shot-plan').open=true;
 if(next&&oldTop!==undefined){const delta=next.getBoundingClientRect().top-oldTop;if(inDialog)$('#dialog').scrollTop+=delta;else window.scrollBy(0,delta);}
 const focusTarget=next?.querySelector('.technique-item:last-child textarea');
 if(focusTarget)focusTarget.focus({preventScroll:true});
}
