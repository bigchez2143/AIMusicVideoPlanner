const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const T=require('../web/timeline-core.js');

// Exercise the actual toolbar/inspector action with isolated project state.
// In particular, selection belongs to a different scene from the playhead.
const fixture={duration:38,lyrics:[{start:30,end:33,text:'Keep lyric timing'}],scenes:[
  {id:'selected',start:0,end:30,title:'Earlier scene',userNotes:'Do not change',media:{begin:'earlier-photo'}},
  {id:'under-bar',start:30,end:34,title:'Vocal',userNotes:'Keep this note',role:'singing',lipSync:'Lip Sync',singer:'Georgia Belle',performers:[{name:'Georgia Belle',instrument:'vocals'}],media:{begin:'vocal-photo'},motionPrompt:'Old picture prompt',promptHistory:['old'],replacements:['old-photo'],customField:'keep'},
  {id:'following',start:34,end:38,title:'Next scene',media:{begin:'next-photo'}}
]};
const nodes=new Map();
const sandbox={structuredClone,TimelineCore:T,project:structuredClone(fixture),selected:'selected',audio:{currentTime:30.654321},actions:{},loopRange:null,
  $:selector=>{if(!nodes.has(selector))nodes.set(selector,{addEventListener(){}});return nodes.get(selector);},
  document:{addEventListener(){}},changed(){},render(){},toast(){},id:()=> 'new-part',fmt:t=>t.toFixed(3)};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(require.resolve('../web/timeline-editor.js'),'utf8'),sandbox);
vm.runInContext('initTimeline(); actions.splitScene();',sandbox);
const plain=value=>JSON.parse(JSON.stringify(value));
let scenes=plain(sandbox.project.scenes);
assert.deepEqual(scenes[0],fixture.scenes[0]);
assert.equal(scenes[1].end,30.654);
assert.equal(scenes[2].start,30.654);
assert.equal(scenes[2].end,34);
assert.equal(sandbox.audio.currentTime,30.654321);
assert.equal(sandbox.selected,'new-part');
assert.deepEqual(T.issues(scenes,38),[]);
assert.deepEqual(sandbox.project.lyrics,fixture.lyrics);
assert.deepEqual(scenes[1].media,{begin:'vocal-photo'});
assert.deepEqual(scenes[2].media,{});
assert.equal(scenes[2].motionPrompt,'');
assert.equal(scenes[2].promptHistory,undefined);
assert.equal(scenes[2].replacements,undefined);
for(const key of ['userNotes','role','lipSync','singer','performers','customField'])assert.deepEqual(scenes[2][key],fixture.scenes[1][key]);
assert.deepEqual(scenes[3],fixture.scenes[2]);
vm.runInContext('undoEdit();',sandbox);
assert.deepEqual(plain(sandbox.project),fixture);
assert.equal(sandbox.selected,'selected');
vm.runInContext('undoEdit(true);',sandbox);
assert.deepEqual(plain(sandbox.project.scenes),scenes);
vm.runInContext('undoEdit();',sandbox);

// Boundaries, gaps, and tiny pieces never silently split the selected midpoint.
for(const at of [0,30,34,38,-1,39,NaN,Infinity,30.01,33.99]){
  sandbox.audio.currentTime=at;
  assert.throws(()=>vm.runInContext('actions.splitScene();',sandbox));
  assert.deepEqual(plain(sandbox.project),fixture);
  assert.equal(vm.runInContext('undoStack.length',sandbox),0);
}
assert.throws(()=>T.splitTarget([{start:0,end:4},{start:6,end:9}],5));
assert.throws(()=>T.splitTarget([],2));
assert.throws(()=>T.split(fixture.scenes,1,NaN,{}));
// Split does not require a selection and does not snap to 0.1-second grid.
sandbox.selected=null;sandbox.audio.currentTime=31.237;
vm.runInContext('actions.splitScene();',sandbox);
assert.equal(sandbox.project.scenes[1].end,31.237);
vm.runInContext('undoEdit();',sandbox);
// The documented minimum of exactly 50 milliseconds is valid at either end.
for(const at of [30.05,33.95]){
  sandbox.audio.currentTime=at;
  vm.runInContext('actions.splitScene();',sandbox);
  assert.equal(sandbox.project.scenes[1].end,at);
  vm.runInContext('undoEdit();',sandbox);
}
console.log('Playhead split: exact bar time, different/no selection, protected notes/lyrics/assets, boundary rejection and undo/redo passed.');
