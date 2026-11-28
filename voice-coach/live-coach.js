/* LiveCoach — Gemini Live API로 이 화면 안에서 실시간 음성 대화
   마이크(16kHz PCM) → WebSocket → Gemini 음성(24kHz PCM) 재생 + 양쪽 말 글자(transcript) */
(function(){
"use strict";
const URL_BASE='wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=';
const MODELS=['gemini-3.8-live','gemini-3.1-flash-live-preview','gemini-2.5-flash-native-audio-latest','gemini-2.5-flash-native-audio-preview-12-2025'];
const VOICES={f:['Kore','Aoede','Leda','Zephyr'],m:['Puck','Charon','Fenrir','Orus']};

function b64FromBuf(buf){const u=new Uint8Array(buf);let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s)}
function bufFromB64(b){const s=atob(b),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u.buffer}

/* 한 번 연결해 보기: setupComplete가 오면 성공 */
function openSession(key,model,setupExtra){
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket((window.__LIVE_URL||URL_BASE)+encodeURIComponent(key));
    let done=false;const t=setTimeout(()=>{if(!done){done=true;try{ws.close()}catch(e){}reject(new Error('timeout'))}},12000);
    ws.onopen=()=>ws.send(JSON.stringify({setup:Object.assign({model:'models/'+model},setupExtra)}));
    ws.onmessage=async ev=>{if(done)return;const txt=typeof ev.data==='string'?ev.data:await ev.data.text();let m;try{m=JSON.parse(txt)}catch(e){return}
      if(m.setupComplete){done=true;clearTimeout(t);resolve(ws)}};
    ws.onclose=ev=>{if(!done){done=true;clearTimeout(t);reject(new Error('closed '+ev.code+' '+(ev.reason||'')))}};
    ws.onerror=()=>{};
  });
}

async function start(o){
  // o: {key, system, gender, voiceIndex, onUser(text,final), onTeacher(text,final), onLevel, onState(s), onModel(name), onError(msg), onEnd()}
  const voiceName=(VOICES[o.gender]||VOICES.f)[(o.voiceIndex||0)%4];
  const base={generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName}}}},
    systemInstruction:{parts:[{text:o.system}]},inputAudioTranscription:{},outputAudioTranscription:{}};
  const noVoice=JSON.parse(JSON.stringify(base));delete noVoice.generationConfig.speechConfig;
  const tries=(o.model?[o.model]:[]).concat(MODELS).map(m=>[m,base]).concat([[MODELS[0],noVoice],[MODELS[2],noVoice]]);
  // 마이크를 먼저 열어 권한 문제를 빨리 알림
  let mic;try{mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}})}
  catch(e){throw new Error('mic')}
  let ws=null,model='',lastErr='';
  for(const [m,cfg] of tries){try{ws=await openSession(o.key,m,cfg);model=m;break}catch(e){lastErr=e.message}}
  if(!ws){mic.getTracks().forEach(t=>t.stop());throw new Error('connect '+lastErr)}
  o.onModel&&o.onModel(model);

  // 재생(24kHz)
  const out=new (window.AudioContext||window.webkitAudioContext)({sampleRate:24000});
  const an=out.createAnalyser();an.fftSize=512;an.connect(out.destination);
  let playAt=0;const playing=new Set();
  function play(b64){const i16=new Int16Array(bufFromB64(b64)),f=new Float32Array(i16.length);for(let i=0;i<i16.length;i++)f[i]=i16[i]/0x8000;
    const ab=out.createBuffer(1,f.length,24000);ab.copyToChannel(f,0);const s=out.createBufferSource();s.buffer=ab;s.connect(an);
    const now=out.currentTime;if(playAt<now+0.04)playAt=now+0.04;s.start(playAt);playAt+=ab.duration;playing.add(s);s.onended=()=>playing.delete(s)}
  function flush(){playing.forEach(s=>{try{s.stop()}catch(e){}});playing.clear();playAt=0}
  const lv=new Float32Array(an.fftSize);
  o.onLevel&&o.onLevel(()=>{an.getFloatTimeDomainData(lv);let s=0;for(let i=0;i<lv.length;i++)s+=lv[i]*lv[i];return Math.min(1,Math.max(0,(Math.sqrt(s/lv.length)-0.005)*9))});

  // 마이크(16kHz) → 서버
  const inp=new (window.AudioContext||window.webkitAudioContext)({sampleRate:16000});
  await inp.audioWorklet.addModule('pcm-worklet.js');
  const node=new AudioWorkletNode(inp,'pcm-capture');inp.createMediaStreamSource(mic).connect(node);
  let muted=false;
  node.port.onmessage=e=>{if(muted||ws.readyState!==1)return;ws.send(JSON.stringify({realtimeInput:{audio:{data:b64FromBuf(e.data),mimeType:'audio/pcm;rate=16000'}}}))};

  // 서버 → 화면
  let userBuf='',teachBuf='';
  ws.onmessage=async ev=>{const txt=typeof ev.data==='string'?ev.data:await ev.data.text();let m;try{m=JSON.parse(txt)}catch(e){return}
    const sc=m.serverContent;if(!sc)return;
    if(sc.interrupted){flush();if(teachBuf){o.onTeacher(teachBuf,true);teachBuf=''}}
    if(sc.inputTranscription&&sc.inputTranscription.text){userBuf+=sc.inputTranscription.text;o.onUser(userBuf,false)}
    if(sc.outputTranscription&&sc.outputTranscription.text){if(userBuf){o.onUser(userBuf,true);userBuf=''}teachBuf+=sc.outputTranscription.text;o.onTeacher(teachBuf,false)}
    const parts=sc.modelTurn&&sc.modelTurn.parts||[];
    for(const p of parts){if(p.inlineData&&p.inlineData.data)play(p.inlineData.data)}
    if(sc.turnComplete||sc.generationComplete){if(userBuf){o.onUser(userBuf,true);userBuf=''}if(teachBuf){o.onTeacher(teachBuf,true);teachBuf=''}}
  };
  let ended=false;
  function stop(){if(ended)return;ended=true;try{ws.close()}catch(e){}flush();try{node.disconnect()}catch(e){}mic.getTracks().forEach(t=>t.stop());try{inp.close()}catch(e){}try{out.close()}catch(e){}o.onEnd&&o.onEnd()}
  ws.onclose=ev=>{if(!ended){o.onError&&o.onError('연결이 끊겼어요 ('+ev.code+(ev.reason?' '+ev.reason:'')+').');stop()}};
  // 선생님이 먼저 인사하도록
  ws.send(JSON.stringify({clientContent:{turns:[{role:'user',parts:[{text:'(The learner just joined the voice call. Greet them briefly by name and ask your first question.)'}]}],turnComplete:true}}));
  return {stop,model,setMuted:v=>{muted=!!v}};
}
window.LiveCoach={start,VOICES,MODELS};
})();
