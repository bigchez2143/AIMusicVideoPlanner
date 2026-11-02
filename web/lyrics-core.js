/* Timed lyric import: pure parsing and merge logic, shared by the UI and tests. */
(function(root){
  'use strict';
  const stamp='\\d+(?::\\d+){0,2}(?:[.,]\\d+)?';
  const lone=new RegExp('^'+stamp+'$');
  const pair=new RegExp('^('+stamp+')\\s*(?:-->|→|–|—|-|\\t+|\\s{2,}|\\s+)\\s*('+stamp+')(?:\\s*[:|]\\s*|\\s+)?(.*)$');
  function time(value){
    const s=String(value).trim().replace(',','.');
    if(!/^\d+(?::\d+){0,2}(?:\.\d+)?$/.test(s))throw Error('Use seconds, m:ss or h:mm:ss (decimals are allowed).');
    const parts=s.split(':').map(Number);
    if(parts.slice(1).some(n=>n>=60))throw Error('Minutes and seconds after a colon must be below 60.');
    const n=parts.reduce((a,b)=>a*60+b,0);
    if(!Number.isFinite(n)||n>=86400)throw Error('Time must be below 24 hours.');
    return n;
  }
  function cells(line,delimiter){
    const out=[];let value='',quoted=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(c==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
      else if(c===delimiter&&!quoted){out.push(value.trim());value='';}else value+=c;
    }
    if(quoted)throw Error('Unclosed quote in table row.');
    out.push(value.trim());return out;
  }
  function parse(text,duration=0){
    let lines=String(text).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n');
    const csvTable=/^\s*Start(?: Time)?,\s*End(?: Time)?,\s*(?:Lyrics|Text)(?:,|$)/i.test(lines[0]||'');
    if(csvTable){
      const records=[];let pending='',quoted=false;
      for(const line of lines){
        pending+=(pending?'\n':'')+line;
        for(let j=0;j<line.length;j++)if(line[j]==='"'){if(quoted&&line[j+1]==='"')j++;else quoted=!quoted;}
        if(!quoted){records.push(pending);pending='';}
      }
      if(pending)records.push(pending);lines=records;
    }
    const entries=[],errors=[],warnings=[];let timed=false,duplicates=0;
    function add(start,end,body,line){
      timed=true;
      try{entries.push({start:time(start),end:end===null?null:time(end),text:body.trim(),line});}
      catch(e){errors.push('Line '+line+': '+e.message);}
    }
    const header=s=>/^(?:start(?:\s*time)?|end(?:\s*time)?|lyrics?|text|status)(?:\s*[|,\t]\s*(?:start(?:\s*time)?|end(?:\s*time)?|lyrics?|text|status))*$/i.test(s.replace(/^\|\s*|\s*\|$/g,''));
    const skipped=s=>!s||header(s)||/^\|?\s*:?-{3,}/.test(s)||/^\[(?:ar|ti|al|by|length):/i.test(s)||s==='WEBVTT';
    const hasTiming=lines.some(s=>/\d+:\d+|-->/.test(s)||new RegExp('^\\s*'+stamp+'[\t|,]').test(s)||lone.test(s.trim()));
    if(!hasTiming){
      const clean=lines.filter(s=>s.trim());const step=(duration||clean.length*4)/Math.max(clean.length,1);
      return {lyrics:clean.map((s,i)=>({start:+(i*step).toFixed(3),end:+((i+1)*step).toFixed(3),text:s.trim(),status:'draft'})),errors:[],warnings:clean.length?['No timestamps found. These are estimated timings; review them against the song.']:[],estimated:true};
    }
    for(let i=0;i<lines.length;i++){
      const raw=lines[i].trim(),line=i+1;if(skipped(raw)||(csvTable&&i===0))continue;
      // Caption cue numbers are not timestamps.
      if(/^\d+$/.test(raw)&&lines[i+1]?.includes('-->'))continue;
      const srt=raw.match(new RegExp('^('+stamp+')\\s*-->\\s*('+stamp+')(?:\\s+.*)?$'));
      if(srt){const body=[];while(i+1<lines.length&&lines[i+1].trim()&&!lines[i+1].includes('-->'))body.push(lines[++i]);add(srt[1],srt[2],body.join('\n'),line);continue;}
      const lrc=raw.match(/^((?:\[\d+:\d+(?:[.,]\d+)?\])+)(.*)$/);
      if(lrc){for(const tag of lrc[1].matchAll(/\[([^\]]+)\]/g))add(tag[1],null,lrc[2],line);continue;}
      let row=null;
      try{
        if(raw.includes('\t'))row=cells(raw,'\t');
        else if(raw.includes('|'))row=cells(raw.replace(/^\|\s*|\s*\|$/g,''),'|');
        else if(raw.includes(',')){const c=cells(raw,',');if(c.length>=3&&lone.test(c[0])&&lone.test(c[1]))row=[c[0],c[1],csvTable?c[2]:c.slice(2).join(',')];}
      }catch(e){errors.push('Line '+line+': '+e.message);continue;}
      if(row&&row.length>=3){add(row[0],row[1],row.slice(2).join(' '),line);continue;}
      const range=raw.match(pair);
      if(range&&range[3].trim()){add(range[1],range[2],range[3],line);continue;}
      // A copied table may place each cell on its own line.
      if(lone.test(raw)){
        let next=i+1;while(next<lines.length&&!lines[next].trim())next++;
        if(lone.test(lines[next]?.trim()||'')){
          const end=lines[next].trim(),body=[];i=next;
          while(i+1<lines.length){
            const s=lines[i+1].trim();if(lone.test(s)||s.match(pair)||/^\[\d+:/.test(s))break;
            i++;if(!s||header(s))continue;
            if(body.at(-1)===s){duplicates++;continue;}body.push(s);
          }
          add(raw,end,body.join('\n'),line);continue;
        }
      }
      errors.push('Line '+line+': could not read this timed lyric. Use Start / End / Lyrics columns or “0:35 – 0:38 Words”.');
    }
    entries.sort((a,b)=>a.start-b.start);
    for(let i=0;i<entries.length;i++){
      const l=entries[i];
      if(l.end===null){l.end=entries.slice(i+1).find(n=>n.start>l.start)?.start??(duration>l.start?duration:l.start+4);warnings.push('An LRC end time was inferred from the next line or song end.');}
      if(l.end<=l.start)errors.push('Line '+l.line+': end must be after start.');
      if(!l.text)errors.push('Line '+l.line+': add the lyric text.');
      if(duration>0&&l.end>duration+.001)errors.push('Line '+l.line+': this lyric ends after the song ('+duration.toFixed(3)+' seconds).');
      if(i&&l.start<entries[i-1].end)warnings.push('Some lyric ranges overlap. Review the preview before applying.');
    }
    if(duplicates)warnings.push(duplicates+' repeated clipboard line(s) within the same timestamp were removed.');
    if(!timed&&!errors.length)errors.push('No timed lyrics found.');
    return {lyrics:entries.map(({line,...l})=>({...l,status:'draft'})),errors,warnings:[...new Set(warnings)],estimated:false};
  }
  function merge(existing,incoming,mode,makeId){
    const key=l=>JSON.stringify([l.start,l.end,l.text]);
    const known=new Map(existing.map(l=>[key(l),l]));
    const result=mode==='replace'?[]:existing.map(l=>({...l}));
    const seen=new Set(result.map(key));
    for(const l of incoming){const k=key(l);if(seen.has(k))continue;seen.add(k);result.push(known.has(k)?{...known.get(k)}:{...l,id:makeId()});}
    return result.sort((a,b)=>a.start-b.start);
  }
  const api={time,parse,merge};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.LyricsCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
