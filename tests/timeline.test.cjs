const assert=require('node:assert/strict');
const T=require('../web/timeline-core.js');
const original=[
 {id:'a',start:0,end:4,userNotes:'Keep this',media:{begin:'photo-a'},performers:[{name:'Georgia Belle',instrument:'guitar'}]},
 {id:'b',start:4,end:9,userNotes:'Second note',media:{begin:'photo-b'},singer:'Someone else'},
 {id:'c',start:9,end:12,media:{}}
];
const valid=items=>assert.deepEqual(T.issues(items,12),[]);
const split=T.split(original,0,2,{id:'blank',media:{},userNotes:''});valid(split);
assert.equal(split[1].end,4);assert.deepEqual(split[1].media,{});assert.equal(split[0].userNotes,'Keep this');
assert.equal(original.length,3);assert.equal(original[0].end,4);
const resize=T.boundary(original,1,'start',5.26,12,.1);valid(resize);assert.equal(resize[0].end,5.3);assert.equal(resize[1].start,5.3);
const clamp=T.boundary(original,1,'end',99,12,.01);valid(clamp);assert.equal(clamp[1].end,11.95);
assert.throws(()=>T.boundary(original,0,'start',1,12));assert.throws(()=>T.boundary(original,2,'end',14,12));
const moved=T.reorder(original,0,2,12);valid(moved);assert.deepEqual(moved.map(s=>s.id),['b','c','a']);assert.equal(moved[2].end-moved[2].start,4);assert.deepEqual(moved[2].media,original[0].media);assert.deepEqual(moved[2].performers,original[0].performers);
for(let i=0;i<3;i++)valid(T.remove(original,i,12));
assert.throws(()=>T.remove([{id:'one',start:0,end:12}],0,12));
const merged=T.merge(original,0,12);valid(merged);assert.equal(merged[0].userNotes,'Keep this\n\nSecond note');assert.equal(merged[0].mergedScenes[0].singer,'Someone else');assert.deepEqual(Object.values(merged[0].media).sort(),['photo-a','photo-b']);
const gapped=structuredClone(original);gapped[1].start=5;assert(T.issues(gapped,12).length);assert.throws(()=>T.reorder(gapped,0,1,12));
const lyrics=[{id:'approved',start:0,end:3,text:'Human corrected',status:'reviewed'},{id:'bad',start:3,end:6,text:'Wrong draft',status:'draft'}];
const incoming=[{id:'new1',start:0,end:4,text:'Would overlap approved line'},{id:'new2',start:4,end:6,text:'English draft'}];
assert.deepEqual(T.applyTranscript(lyrics,incoming,'replaceDrafts').map(l=>l.id),['approved','new2']);
assert.equal(T.applyTranscript(lyrics,incoming,'append').length,4);assert.deepEqual(T.applyTranscript(lyrics,incoming,'replaceAll'),incoming);
// Exercise hundreds of changes: no drift, no lost scene metadata or duplicated assets.
let many=Array.from({length:81},(_,i)=>({id:'scene-'+i,start:i*4,end:(i+1)*4,media:{begin:'image-'+i}}));
for(let i=0;i<500;i++){many=T.reorder(many,i%81,(i*7)%81,324);many=T.boundary(many,i%80,'end',many[i%80].end+.01,324,.01);assert.deepEqual(T.issues(many,324),[]);}
assert.equal(new Set(many.map(s=>s.media.begin)).size,81);
console.log('Timeline operations: split, resize, clamp, reorder, delete, merge, coverage, metadata preservation, lyric protection and 500-edit stress check passed.');
