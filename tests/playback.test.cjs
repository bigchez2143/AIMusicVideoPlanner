const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../web/app.js'),'utf8');
const helpers=source.slice(source.indexOf('let audioPlayRequest='),source.indexOf('const fmt='));
const errors=[],requests=[];
const failure=(name,message)=>Object.assign(new Error(message),{name});
const audio={paused:true,play(){this.paused=false;return new Promise((resolve,reject)=>requests.push({resolve,reject}));},pause(){this.paused=true;for(const request of requests)request.reject(failure('AbortError','The play() request was interrupted by a call to pause().'));}};
const context=vm.createContext({audio,toast:message=>errors.push(message)});
vm.runInContext(helpers,context);
const run=code=>vm.runInContext(code,context);
(async()=>{
  const first=run('playAudio()');
  run('pauseAudio()');
  assert.equal(await first,false);
  assert.deepEqual(errors,[]);
  assert.equal(audio.paused,true);
  const resumed=run('playAudio()');requests.at(-1).resolve();
  assert.equal(await resumed,true);assert.equal(audio.paused,false);

  const old=run('playAudio()'),oldRequest=requests.at(-1);
  const latest=run('playAudio()');requests.at(-1).resolve();
  oldRequest.reject(failure('NotSupportedError','Stale source error'));
  await Promise.all([old,latest]);assert.deepEqual(errors,[]);

  const reset=run('playAudio()');
  requests.at(-1).reject(failure('AbortError','Interrupted by a new load request'));
  assert.equal(await reset,false);assert.deepEqual(errors,[]);

  const broken=run('playAudio()');
  requests.at(-1).reject(failure('NotSupportedError','Unsupported media'));
  assert.equal(await broken,false);assert.deepEqual(errors,['Unsupported media']);
  audio.play=()=>{throw failure('NotAllowedError','Playback permission required');};
  assert.equal(await run('playAudio()'),false);
  assert.deepEqual(errors,['Unsupported media','Playback permission required']);
  assert.equal((source.match(/audio\.play\(/g)||[]).length,1,'All song play controls must use the cancellation-aware helper');
  assert.equal((source.match(/audio\.pause\(/g)||[]).length,1,'All song pause controls must invalidate old requests');
  console.log('Playback: rapid Play/Pause, resume, source reset, stale failures and genuine playback errors passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
