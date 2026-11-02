'use strict';
let undoStack=[], redoStack=[], sceneDialog=false, timelineDrag=null, suppressTimelineClick=false, transcriptDraft=null;

function rememberEdit() {
  if(!project)return;
  const snapshot={project:structuredClone(project),selected};
  const last=undoStack.at(-1);
  if(!last||JSON.stringify(last.project)!==JSON.stringify(snapshot.project))undoStack.push(snapshot);
  if(undoStack.length>80)undoStack.shift();
  redoStack=[];updateUndoButtons();
}
function updateUndoButtons(){if($('#timeline-undo')){$('#timeline-undo').disabled=!undoStack.length;$('#timeline-redo').disabled=!redoStack.length;}}
function undoEdit(redo=false){
  const source=redo?redoStack:undoStack,dest=redo?undoStack:redoStack,snapshot=source.pop();
  if(!snapshot)return;
  dest.push({project:structuredClone(project),selected});
  project=snapshot.project;selected=snapshot.selected;loopRange=null;changed();render();refreshSceneDialog();updateUndoButtons();
  toast(redo?'Edit restored.':'Edit undone.');
}
function commitScenes(next,selection=selected){rememberEdit();project.scenes=next;selected=selection;loopRange=null;changed();render();refreshSceneDialog();}
function refreshSceneDialog(){if(sceneDialog&&$('#dialog').open&&scene()){$('#dialog-title').textContent='Edit scene '+(sceneIndex()+1);$('#dialog-body').innerHTML=inspector(scene());}}
function selectTimelineScene(sid,popup=false){selected=sid;changed();if(tab==='story')renderStory();renderTimeline();if(popup){sceneDialog=true;modal('Edit scene '+(sceneIndex()+1),inspector(scene()));}}
function sceneNavigation(s){const i=sceneIndex();return `<div class="writing-navigation"><button data-action="previousScene" ${i===0?'disabled':''}>← Previous scene</button><button data-action="nextScene" ${i===project.scenes.length-1?'disabled':''}>Next scene →</button><label>Go to scene <input type="number" aria-label="Go to scene" data-go-scene min="1" max="${project.scenes.length}" value="${i+1}"></label><button class="primary" data-action="playScene">▶ Listen scene</button><button data-action="loop">↻ Loop scene</button><button data-action="picturePreview">Show picture preview</button></div>`;}
function sceneTimingFields(s){const i=sceneIndex();return `<div class="scene-timing"><label>Start<input aria-label="Scene start" data-timing="start" value="${fmt(s.start)}" ${i===0?'readonly':''}></label><label>End<input aria-label="Scene end" data-timing="end" value="${fmt(s.end)}" ${i===project.scenes.length-1?'readonly':''}></label><label>Duration (s)<input aria-label="Scene duration" data-timing="duration" type="number" min="0.05" step="0.01" value="${(s.end-s.start).toFixed(3)}" ${i===project.scenes.length-1?'readonly':''}></label></div><p class="field-help full">Times accept mm:ss.sss or seconds. Editing a boundary adjusts the adjoining scene; song length stays fixed. For the last scene, adjust its start.</p>`;}
function renderStory(){
  if(!scene()&&project.scenes.length)selected=project.scenes[0].id;
  $('#content').innerHTML=`<div class="section-toolbar"><div><h2>Write the video, one scene at a time</h2><p>Your notes and assistant proposals stay separate.</p></div><div class="button-group"><button data-action="templates">◇ Templates</button><button data-action="sections">Song sections</button></div></div><div class="summary">${sceneStats()}</div>${scene()?inspector(scene()):`<div class="empty"><h2>Start with your song</h2><p>Load audio, review English lyric drafts, then add your first scene across the song. Add scene divides the selected scene into a new blank picture slot.</p><div class="button-group"><button data-action="loadSong">♪ Load song</button><button data-action="addScene">＋ Add first scene</button><button data-action="import">Import a plan</button></div></div>`}`;
}
function renderTimeline(){
  if(!project)return;
  const d=duration(),track=$('#wave-inner'),zoom=Number($('#zoom').value);
  track.style.width=(zoom*100)+'%';
  $('#scene-track').innerHTML=project.scenes.map((s,i)=>{
    const picture=Object.values(s.media||{}).map(asset).find(a=>a?.kind==='image');
    return `<button class="timeline-item scene-clip ${s.id===selected?'selected':''}" style="left:${s.start/d*100}%;width:${(s.end-s.start)/d*100}%" data-scene-id="${esc(s.id)}" data-action="editTimelineScene" data-id="${esc(s.id)}" title="${esc(s.title)} · ${fmt(s.start)} – ${fmt(s.end)}" aria-label="Scene ${i+1}: ${esc(s.title)}. Click to edit; drag middle to reorder.">${picture?`<img draggable="false" src="${mediaUrl(picture)}" alt="">`:''}<span class="clip-text"><b>${String(i+1).padStart(2,'0')}</b><span>${esc(s.title)}</span><small>${(s.end-s.start).toFixed(2)}s</small></span>${i>0?'<span class="resize-edge left" data-edge="start" title="Drag start boundary"></span>':''}${i<project.scenes.length-1?'<span class="resize-edge right" data-edge="end" title="Drag end boundary"></span>':''}</button>`;
  }).join('');
  $('#section-track').innerHTML=project.sections.map(s=>`<button class="timeline-item" style="left:${s.start/d*100}%;width:${(s.end-s.start)/d*100}%" data-action="playSection" data-id="${esc(s.id)}" title="Play / loop ${esc(s.title)}">${esc(s.title)}</button>`).join('');
  $('#lyric-track').innerHTML=project.lyrics.map((l,i)=>`<button class="timeline-item lyric-clip" style="left:${l.start/d*100}%;width:${(l.end-l.start)/d*100}%" data-action="playLyric" data-index="${i}" title="${fmt(l.start)} · ${esc(l.text)}">${esc(l.text)}</button>`).join('');
  const problems=TimelineCore.issues(project.scenes,d);
  $('#coverage').textContent=problems.length?problems.join(' '):'Continuous coverage · song timing stays fixed';
  $('#coverage').classList.toggle('error',!!problems.length);
  $('#selection-hint').textContent=scene()?`Selected scene ${sceneIndex()+1} · Add scene creates a black placeholder using half of this scene’s time.`:'Load your song, then add your first scene.';
  for(const name of ['editSelected','playScene','deleteScene'])$(`#timeline [data-action="${name}"]`).disabled=!scene();
  $('#timeline [data-action="splitScene"]').disabled=!project.scenes.length;
  $('#overview-window').style.width=(100/zoom)+'%';
  drawWaveform();updatePlayhead();updateUndoButtons();updateOverview();
}
function drawWaveform(){
  const canvas=$('#waveform'),w=Math.max(1,canvas.clientWidth),h=72,scale=devicePixelRatio||1;
  canvas.width=w*scale;canvas.height=h*scale;
  const c=canvas.getContext('2d');c.scale(scale,scale);c.fillStyle='#102126';c.fillRect(0,0,w,h);
  if(peaks){const dw=w/peaks.length;c.fillStyle='#5c9da2';for(let i=0;i<peaks.length;i++){const a=Math.max(1,peaks[i]*64);c.fillRect(i*dw,(h-a)/2,Math.max(.7,dw*.75),a);}}
  else{c.fillStyle='#b6c6c9';c.font='12px Segoe UI';c.fillText(project?.song?'Preparing waveform…':'Load a song to see its waveform',16,40);}
  const d=duration(),step=Math.max(1,Math.ceil(d/(w/90)/5)*5),ticks=[];
  for(let t=0;t<d;t+=step)ticks.push(`<span style="left:${t/d*100}%">${fmt(t).slice(0,5)}</span>`);
  $('#ruler').innerHTML=ticks.join('');
}
function updateOverview(){const scroll=$('#wave-scroll');$('#overview-window').style.left=(scroll.scrollLeft/Math.max(1,scroll.scrollWidth)*100)+'%';}
function updatePlayhead(){
  const t=audio.currentTime||0,d=duration();$('#clock').textContent=fmt(t)+' / '+fmt(d);
  $('#playhead').style.left=t/d*100+'%';$('#play').textContent=audio.paused?'▶ Play song':'Ⅱ Pause song';
  $('#play').setAttribute('aria-label',audio.paused?'Play song':'Pause song');
  $('#loop').classList.toggle('active',!!loopRange?.repeat);
  $$('[data-lyric]').forEach(el=>{const l=project?.lyrics.find(l=>l.id===el.dataset.lyric);el.classList.toggle('active',!!l&&t>=l.start&&t<l.end);});
  if(!audio.paused&&$('#follow').checked&&!timelineDrag){const scroll=$('#wave-scroll'),x=t/d*$('#wave-inner').clientWidth;if(x<scroll.scrollLeft||x>scroll.scrollLeft+scroll.clientWidth-30)scroll.scrollLeft=Math.max(0,x-scroll.clientWidth*.2);}
  updatePreview();
}
function addScene(){
  if(!project.song||!project.duration)return toast('Load your song first so its length stays fixed.');
  if(!project.scenes.length){const s=newScene(0,project.duration);commitScenes([s],s.id);return;}
  const s=scene();if(!s)return toast('Select a scene first.');
  const n=newScene((s.start+s.end)/2,s.end,'New scene — picture to add');
  commitScenes(TimelineCore.split(project.scenes,sceneIndex(),n.start,n),n.id);
}
function seekFromTimeline(e){loopRange=null;const rect=e.currentTarget.getBoundingClientRect();audio.currentTime=Math.max(0,Math.min(duration(),(e.clientX-rect.left)/rect.width*duration()));updatePlayhead();}
function beginTimelineDrag(e){
  const clip=e.target.closest('[data-scene-id]');if(!clip||e.button!==0)return;
  const index=project.scenes.findIndex(s=>s.id===clip.dataset.sceneId);
  timelineDrag={pointer:e.pointerId,x:e.clientX,index,side:e.target.dataset.edge,scenes:structuredClone(project.scenes),moved:false,preview:null,to:index};
  clip.setPointerCapture(e.pointerId);
}
function moveTimelineDrag(e){
  const drag=timelineDrag;if(!drag||drag.pointer!==e.pointerId)return;
  if(!drag.moved&&Math.abs(e.clientX-drag.x)<5)return;
  drag.moved=true;e.preventDefault();
  const scroll=$('#wave-scroll'),bounds=scroll.getBoundingClientRect();
  if(e.clientX>bounds.right-25)scroll.scrollLeft+=20;
  if(e.clientX<bounds.left+25)scroll.scrollLeft-=20;
  const rect=$('#wave-inner').getBoundingClientRect(),time=Math.max(0,Math.min(duration(),(e.clientX-rect.left)/rect.width*duration()));
  try{
    if(drag.side){drag.preview=TimelineCore.boundary(drag.scenes,drag.index,drag.side,time,duration(),Number($('#snap').value));
      for(const [i,s]of drag.preview.entries()){const node=$$('#scene-track .scene-clip')[i];node.style.left=s.start/duration()*100+'%';node.style.width=(s.end-s.start)/duration()*100+'%';node.querySelector('small').textContent=(s.end-s.start).toFixed(2)+'s';}
      $('#selection-hint').textContent='Boundary: '+fmt(drag.preview[drag.index][drag.side]);
    }else{drag.to=drag.scenes.findIndex(s=>time>=s.start&&time<s.end);if(drag.to<0)drag.to=drag.scenes.length-1;
      $$('#scene-track .scene-clip').forEach((n,i)=>n.classList.toggle('drop-target',i===drag.to));$('#selection-hint').textContent=`Move scene ${drag.index+1} to position ${drag.to+1}`;
    }
  }catch(err){$('#selection-hint').textContent=err.message;}
}
function endTimelineDrag(e,cancel=false){
  const drag=timelineDrag;if(!drag||drag.pointer!==e.pointerId)return;timelineDrag=null;
  if(!drag.moved)return;
  suppressTimelineClick=true;setTimeout(()=>suppressTimelineClick=false,200);
  if(cancel){renderTimeline();return;}
  try{if(drag.side&&drag.preview)commitScenes(drag.preview,drag.scenes[drag.index].id);
    else if(!drag.side&&drag.to!==drag.index)commitScenes(TimelineCore.reorder(drag.scenes,drag.index,drag.to,duration()),drag.scenes[drag.index].id);
    else renderTimeline();
  }catch(err){toast(err.message);renderTimeline();}
}
async function transcribe(){
  if(!project.song)return toast('Load a song first.');
  modal('Draft lyrics in English',`<p>Audio stays on this computer. Model weights download on first use.</p><div class="form-grid"><label>Song language<select id="transcription-language"><option value="en">English (default)</option value="auto">Detect language automatically</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="pt">Portuguese</option><option value="it">Italian</option><option value="ja">Japanese</option></select></label><label>Transcription model<select id="transcription-model">${opts(['tiny','base','small','medium','large-v3'],'small')}</select></label></div><p class="small">English is forced by default to prevent language guessing on music. Larger models need more time and memory. Metal vocals still need word and timing review. A new draft never replaces lyrics until you review it.</p><div class="dialog-actions"><button data-action="closeDialog">Cancel</button><button class="primary" data-action="runTranscription">Start transcription</button></div>`);
}
async function runTranscription(){
  const model=$('#transcription-model').value,language=$('#transcription-language').value,pid=project.id;closeModal();
  const job=await api('/api/transcribe',{assetId:project.song,model,language,projectId:pid});toast('Local transcription started · '+(language==='en'?'English':language));
  const poll=async()=>{try{const r=await api('/api/transcribe/'+job.id);if(project.id===pid&&$('#transcription-status'))$('#transcription-status').innerHTML=`<div class="notice">${esc(r.message)}</div>`;
    if(r.status==='complete'){
      transcriptDraft={...r,projectId:pid};
      if(project.id===pid){if($('#dialog').open)toast('Transcription is ready. Open Timed lyrics → Review transcription draft.');else reviewTranscript();}
      else{downloadBlob(JSON.stringify({schemaVersion:1,lyrics:r.lyrics},null,2),'transcription-draft-'+pid+'.json','application/json');toast('Draft downloaded for its original project.');}
      return;
    }if(r.status==='failed'){toast('Transcription failed: '+r.message);return;}setTimeout(poll,2500);
  }catch(e){toast(e.message);}};poll();
}
function reviewTranscript(){
  const r=transcriptDraft;if(!r||r.projectId!==project.id)return toast('No new transcription draft for this project.');
  modal('Review transcription · '+(r.language==='en'?'English':r.language),`<p>${r.lyrics.length} draft lines. Listen and correct words and timing after applying.</p><label>How to use this draft<select id="transcript-mode"><option value="replaceDrafts">Replace draft lines; protect reviewed lyrics</option><option value="append">Keep every current line and append this draft</option><option value="replaceAll">Replace all lyrics, including reviewed lines</option></select></label><p class="small">Replacing draft lines keeps reviewed lyrics and skips new lines that overlap them. A named backup is saved before replacement.</p><div class="transcript-review">${r.lyrics.map(l=>`<p><time>${fmt(l.start)} – ${fmt(l.end)}</time> ${esc(l.text)}</p>`).join('')||'<p>No words were recognized. Current lyrics will be kept.</p>'}</div><div class="dialog-actions"><button data-action="closeDialog">Keep current lyrics</button><button class="primary" data-action="applyTranscript" ${r.lyrics.length?'':'disabled'}>Apply reviewed draft</button></div>`);
}
function initTimeline(){
  Object.assign(actions,{
    editTimelineScene:el=>{if(!suppressTimelineClick)selectTimelineScene(el.dataset.id,true);},
    editSelected:()=>{if(scene())selectTimelineScene(selected,true);},
    previousScene:()=>{if(sceneIndex()>0)selectTimelineScene(project.scenes[sceneIndex()-1].id,sceneDialog);},
    nextScene:()=>{if(sceneIndex()<project.scenes.length-1)selectTimelineScene(project.scenes[sceneIndex()+1].id,sceneDialog);},
    fitSong:()=>{$('#zoom').value=1;project.view.zoom=1;changed();renderTimeline();},
    undo:()=>undoEdit(),redo:()=>undoEdit(true),
    splitScene:()=>{const {index,at:t}=TimelineCore.splitTarget(project.scenes,audio.currentTime),s=project.scenes[index];
      const n={...structuredClone(s),id:id(),start:t,title:s.title+' · part 2',media:{},assetStatus:'missing',motionPrompt:'',motionPromptStatus:'needs rewrite'};
      delete n.promptHistory;delete n.replacements;
      n.assistantNotes=(n.assistantNotes||'')+'\nNew picture needed after split; do not reuse the first scene’s picture.';
      commitScenes(TimelineCore.split(project.scenes,index,t,n),n.id);
      toast('Scene '+(index+1)+' split at '+fmt(t)+'.');
    },
    mergeScene:()=>{commitScenes(TimelineCore.merge(project.scenes,sceneIndex(),duration()));},
    deleteScene:()=>{const i=sceneIndex(),next=TimelineCore.remove(project.scenes,i,duration());commitScenes(next,next[Math.max(0,i-1)].id);toast('Scene removed; its time goes to the adjoining scene. Undo restores it.');},
    moveEarlier:()=>commitScenes(TimelineCore.reorder(project.scenes,sceneIndex(),sceneIndex()-1,duration())),
    moveLater:()=>commitScenes(TimelineCore.reorder(project.scenes,sceneIndex(),sceneIndex()+1,duration())),
    picturePreview:()=>{const s=scene();if(s)actions.sceneAssets({dataset:{id:s.id}});sceneDialog=false;},
    addPerformer:()=>{rememberEdit();scene().performers??=[];scene().performers.push({name:'',instrument:''});changed();renderStory();refreshSceneDialog();},
    removePerformer:el=>{rememberEdit();scene().performers.splice(Number(el.dataset.index),1);changed();renderStory();refreshSceneDialog();},
    reviewTranscript,
    applyTranscript:async()=>{if(!transcriptDraft||transcriptDraft.projectId!==project.id)throw Error('This draft belongs to another project.');const mode=$('#transcript-mode').value;
      if(mode==='replaceAll'&&!confirm('Replace reviewed lyrics too? A named backup will keep the current lyrics.'))return;
      await save('Before transcription replacement');rememberEdit();
      project.lyrics=TimelineCore.applyTranscript(project.lyrics,transcriptDraft.lyrics,mode);
      project.transcription={language:transcriptDraft.language,model:transcriptDraft.model,at:new Date().toISOString()};
      transcriptDraft=null;closeModal();changed();render();await save('Applied transcription draft');toast('Draft applied. Review the English words while listening.');
    }
  });
  const oldTemplate=actions.applyTemplate;
  actions.applyTemplate=el=>{if(project.scenes.length)return toast('Templates start an empty timeline. Create a new project to try a template without changing this plan.');if(!project.song)return toast('Load a song first.');rememberEdit();oldTemplate(el);};
  // Remember edits before they happen. Native text undo remains available while typing.
  document.addEventListener('focusin',e=>{if(e.target.dataset.path)rememberEdit();});
  document.addEventListener('change',e=>{
    if(e.target.matches('[data-go-scene]')){const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=project.scenes.length)selectTimelineScene(project.scenes[n-1].id,sceneDialog);return;}
    if(e.target.dataset.timing){const s=scene(),side=e.target.dataset.timing;try{const time=side==='duration'?s.start+Number(e.target.value):parseTime(e.target.value);commitScenes(TimelineCore.boundary(project.scenes,sceneIndex(),side==='duration'?'end':side,time,duration(),Number($('#snap').value)));}catch(err){toast(err.message);renderStory();refreshSceneDialog();}}
    if(e.target.id==='snap'||e.target.id==='follow'){project.view.snap=Number($('#snap').value);project.view.follow=$('#follow').checked;changed();}
  });
  $('#dialog').addEventListener('close',()=>{if(sceneDialog){sceneDialog=false;if(tab==='story')renderStory();renderTimeline();}});
  $('#scene-track').addEventListener('pointerdown',beginTimelineDrag);
  $('#scene-track').addEventListener('pointermove',moveTimelineDrag);
  $('#scene-track').addEventListener('pointerup',endTimelineDrag);
  $('#scene-track').addEventListener('pointercancel',e=>endTimelineDrag(e,true));
  $('#ruler').addEventListener('click',seekFromTimeline);
  $('#wave-scroll').addEventListener('scroll',updateOverview);
  $('#overview').addEventListener('click',e=>{const rect=e.currentTarget.getBoundingClientRect(),scroll=$('#wave-scroll');scroll.scrollLeft=(e.clientX-rect.left)/rect.width*scroll.scrollWidth-scroll.clientWidth/2;});
  $('#zoom').addEventListener('input',()=>{project.view.zoom=Number($('#zoom').value);changed();});
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&!e.altKey&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();undoEdit(e.shiftKey||e.key.toLowerCase()==='y');}});
}
