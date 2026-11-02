const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../web/lyrics-core.js');
test('timestamp table formats retain exact timing and words',()=>{
  for(const text of ['Start Time\tEnd Time\tLyrics\n0:35\t0:38\tWalls breathe, closer.','| Start | End | Lyrics |\n| --- | --- | --- |\n| 0:35 | 0:38 | Walls breathe, closer. |','Start,End,Lyrics\n0:35,0:38,"Walls breathe, closer."','0:35 – 0:38 Walls breathe, closer.']){
    const r=L.parse(text,100);assert.deepEqual(r.errors,[],text);assert.deepEqual(r.lyrics,[{start:35,end:38,text:'Walls breathe, closer.',status:'draft'}]);
  }
});
test('vertical copied table removes duplicate display lines, preserves repeated chorus',()=>{
  const r=L.parse('Start Time\nEnd Time\nLyrics\n0:35\n0:38\nLet it collapse.\n\nLet it collapse.\n1:35\n1:38\nLet it collapse.',120);
  assert.deepEqual(r.errors,[]);assert.equal(r.lyrics.length,2);assert.equal(r.lyrics[0].text,'Let it collapse.');assert.equal(r.lyrics[1].start,95);
});
test('SRT and multi-timestamp LRC retain precision',()=>{
  let r=L.parse('1\n00:00:35,255 --> 00:00:38,500\nFirst line\nSecond line\n\n2\n00:00:39,000 --> 00:00:40,000\nNext',100);
  assert.deepEqual(r.errors,[]);assert.equal(r.lyrics[0].start,35.255);assert.equal(r.lyrics[0].text,'First line\nSecond line');assert.equal(r.lyrics[1].end,40);
  r=L.parse('[ar:Band]\n[00:35.25][01:35.25]Chorus\n[00:38.00]Verse',100);assert.deepEqual(r.errors,[]);assert.equal(r.lyrics.length,3);assert.deepEqual(r.lyrics.map(l=>l.end),[38,95.25,100]);
});
test('exported CSV with quoted multiline lyrics and metadata can be pasted back',()=>{
  const r=L.parse('Start,End,Lyrics,Status,ID\n00:01.125,00:03.500,"First, \"\"quoted\"\" line\nSecond line",reviewed,abc',10);
  assert.deepEqual(r.errors,[]);assert.equal(r.lyrics[0].text,'First, "quoted" line\nSecond line');assert.equal(r.lyrics[0].end,3.5);
});
test('invalid or mixed timestamp input is not silently estimated or dropped',()=>{
  for(const s of ['0:38 – 0:35 Backwards','0:35 – 0:35 Zero','0:99 – 2:00 Invalid','0:35 – 0:38 Okay\nbad timing row','0:35 – 1:55 Past end'])assert.ok(L.parse(s,100).errors.length,s);
  assert.throws(()=>L.time('-2'));assert.throws(()=>L.time('1:60'));assert.equal(L.time('1:02.125'),62.125);assert.equal(L.time('62.125'),62.125);
  assert.equal(L.parse('First lyric\nSecond lyric',100).estimated,true);
});
test('append/replace preserve identities, avoid duplicates and never change scenes',()=>{
  const project={scenes:[{id:'s',start:0,end:50,userNotes:'keep',media:{begin:'a'}}],lyrics:[{id:'original',start:35,end:38,text:'First',status:'reviewed'}]};
  const before=JSON.stringify(project);let count=0;const incoming=L.parse('0:35 - 0:38 First\n0:38 - 0:41 Second',100).lyrics;
  const merged=L.merge(project.lyrics,incoming,'append',()=>String(++count));assert.equal(merged.length,2);assert.equal(merged[0].id,'original');assert.equal(merged[0].status,'reviewed');assert.equal(JSON.stringify(project),before);
  assert.deepEqual(L.merge(merged,incoming,'append',()=>String(++count)),merged);
  const replaced=L.merge(merged,[incoming[1]],'replace',()=>String(++count));assert.equal(replaced.length,1);assert.equal(replaced[0].id,merged[1].id);assert.equal(JSON.stringify(project),before);
});
