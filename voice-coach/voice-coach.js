/* Edward English Coach · 음성 모듈 (voice-coach/)
   - 로그인: 달력 사이트 로그인(eng-class-gh-auth)을 그대로 사용
   - AI: coach.js 와 같은 키(edward-coach-secret-v1) + 마스터가 공유한 무료 키(english-class-share/coach-ai.json)
   - 한도: limits.html 이 정한 coach-limits.json, 사용 횟수는 coach.js 와 같은 state.aiUse 에 더함
   - 유료 구독(Claude·ChatGPT·Gemini)은 API로 연결할 수 없어 앱 음성 모드로 넘겨 줌 */
(function(){
"use strict";
const $=s=>document.querySelector(s);
const esc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store={get(k,d){try{const v=localStorage.getItem('eec_'+k);return v===null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem('eec_'+k,JSON.stringify(v))}catch(e){}}};

/* ---- 로그인 (app.js / coach.js 와 같은 규칙) ---- */
const AUTHKEY="eng-class-gh-auth",SHARE_REPO="english-class-share",BRANCH="main";
let auth=null;try{auth=JSON.parse(localStorage.getItem(AUTHKEY)||"null")}catch(e){}
const loggedIn=()=>!!(auth&&auth.token&&auth.owner);
const isMaster=()=>loggedIn()&&auth.role!=="sub";
const isSub=()=>loggedIn()&&auth.role==="sub";
const COACH_EXTRA={"edward1004":"edward","uihee":"student"};
const loginId=()=>String((auth&&auth.login)||"master");
const extraOf=()=>isSub()?COACH_EXTRA[loginId().toLowerCase()]:"";
const isStudent=()=>isSub()&&(auth.kind==="student"||extraOf()==="student");
const isTeacher=()=>isSub()&&!isStudent()&&extraOf()!=="edward";
const whoLabel=()=>isMaster()?"마스터 · "+loginId():extraOf()==="edward"?"Edward · "+loginId():(isTeacher()?"선생님 · ":"학생 · ")+(auth.name||loginId());
const b64dec=s=>decodeURIComponent(escape(atob(String(s).replace(/\n/g,""))));
async function ghGetJSON(repo,path){
  const r=await fetch("https://api.github.com/repos/"+encodeURIComponent(auth.owner)+"/"+encodeURIComponent(repo)+"/contents/"+path+"?ref="+BRANCH+"&t="+Date.now(),{headers:{Accept:"application/vnd.github+json",Authorization:"Bearer "+auth.token},cache:"no-store"});
  if(r.status===404)return null;if(!r.ok)throw new Error("HTTP "+r.status);
  const j=await r.json();return JSON.parse(b64dec(j.content));
}

/* ---- AI 키 (coach.js 와 공유) ---- */
const LS_SECRET="edward-coach-secret-v1",LS_STATE="edward-coach-state-v1",MODEL_CACHE="edward-coach-models-v2";
let secret={geminiKey:"",geminiModel:"",groqKey:"",groqModel:"",orKey:"",orModel:""};
try{Object.assign(secret,JSON.parse(localStorage.getItem(LS_SECRET)||"{}"))}catch(e){}
let shared=null;
const unmask=t=>{try{return atob(String(t).split("").reverse().join("")).split("").reverse().join("")}catch(e){return ""}};
async function loadShared(){
  if(isMaster()||!loggedIn())return;
  try{const d=await ghGetJSON(SHARE_REPO,"coach-ai.json");if(d&&d.k){shared={};Object.keys(d.k).forEach(f=>{shared[f]=/Key$/.test(f)?unmask(d.k[f]):String(d.k[f])});
    ["geminiKey","geminiModel","groqKey","groqModel","orKey","orModel"].forEach(f=>{if(!secret[f]&&shared[f])secret[f]=shared[f]})}}catch(e){}
}
function cachedModel(id){try{const c=JSON.parse(localStorage.getItem(MODEL_CACHE)||"{}")[id];return c&&c.ids&&c.ids[0]||""}catch(e){return ""}}
const model=(id,saved,def)=>saved||cachedModel(id)||def;

/* ---- 한도 (limits.html 의 coach-limits.json) ---- */
let LIM=null;
const kstDay=()=>new Date(Date.now()+9*3600e3).toISOString().slice(0,10);
function readState(){try{return JSON.parse(localStorage.getItem(LS_STATE)||"{}")||{}}catch(e){return {}}}
const usedToday=()=>{const u=readState().aiUse||{};return u.d===kstDay()?(u.n||0):0};
function countUse(){const s=readState();s.aiUse={d:kstDay(),n:usedToday()+1};s.updatedAt=Date.now();try{localStorage.setItem(LS_STATE,JSON.stringify(s))}catch(e){}}
function myLimit(){
  if(isMaster()||!isSub())return Infinity;
  const c=Object.assign({base:10,enrolled:30,teacherDefault:5,unlimited:["edward100","edward1004"],people:{}},LIM||{});
  const id=loginId();
  if((c.unlimited||[]).some(x=>String(x).toLowerCase()===id.toLowerCase()))return Infinity;
  const p=(c.people||{})[id]||{};
  if(isTeacher())return(p.lim!==undefined&&p.lim!==null&&isFinite(+p.lim))?+p.lim:+c.teacherDefault;
  return p.enr?+c.enrolled:+c.base;
}
async function loadLimits(){if(!isSub())return;try{LIM=await ghGetJSON(SHARE_REPO,"coach-limits.json")}catch(e){}renderQuota()}

const TEACHERS=[
 {k:'emma',n:'Emma',g:'f',lang:'en-US',d:'미국 · 밝고 친절한 회화 코치',bg:'#ffd9c7',skin:'#f6d2b8',hair:'#d9b36a',hs:'long',shirt:'#1fb5a0',lip:'#d8636b',p:'Your name is Emma, a warm, upbeat American conversation coach. Lots of encouragement, natural everyday expressions.'},
 {k:'sophie',n:'Sophie',g:'f',lang:'en-GB',d:'영국 · 우아하고 정확한 발음 코치',bg:'#d6e6ff',skin:'#f8dcc8',hair:'#e6cf9a',hs:'long',shirt:'#9fc4e8',lip:'#c9505d',p:'Your name is Sophie, an elegant British coach from London. Precise, polished British English; you gently point out pronunciation and word choice.'},
 {k:'clara',n:'Clara',g:'f',lang:'en-CA',d:'캐나다 · 차분한 이메일·작문 코치',bg:'#f3e3d3',skin:'#f6d6c0',hair:'#5a3622',hs:'long',shirt:'#f4efe6',lip:'#c96a6a',p:'Your name is Clara, a calm, gentle Canadian coach. You help turn spoken ideas into clear, polite business emails and messages.'},
 {k:'luna',n:'Luna',g:'f',lang:'en-AU',d:'호주 · 밝은 억양·리듬 코치',bg:'#dbe9f7',skin:'#fbe3d6',hair:'#eef1f6',hs:'long',shirt:'#cfe0f0',lip:'#e07a7a',p:'Your name is Luna, a bright, cheerful Australian coach. You focus on rhythm, stress and intonation so the learner sounds natural.'},
 {k:'james',n:'James',g:'m',lang:'en-GB',d:'영국 · 반도체 업계 출신 비즈니스 코치',bg:'#d9efe6',skin:'#eec8a8',hair:'#4a3a2c',hs:'part',shirt:'#1f2430',tie:'#3b4a6b',lip:'#b55a50',p:'Your name is James, a confident British business coach who used to work in the semiconductor industry. You push for concise, professional phrasing for customer meetings.'},
 {k:'noah',n:'Noah',g:'m',lang:'en-CA',d:'캐나다 · 회의 진행·발표 코치',bg:'#e7e1d8',skin:'#f3d9c8',hair:'#111111',hs:'short',shirt:'#f4efe6',lip:'#b5655a',p:'Your name is Noah, a composed Canadian coach for presentations and meeting facilitation. You help structure answers: point, reason, example, next step.'},
 {k:'ryan',n:'Ryan',g:'m',lang:'en-US',d:'미국 · 편안한 엔지니어 출신 코치',bg:'#dfe5ee',skin:'#ecc8ac',hair:'#b8743a',hs:'part',shirt:'#1f2a3d',lip:'#a85548',p:'Your name is Ryan, a relaxed American former hardware engineer. Friendly, casual, good at explaining tech in simple words.'},
 {k:'leo',n:'Leo',g:'m',lang:'en-AU',d:'호주 · 여행·일상 회화 코치',bg:'#d8ecf5',skin:'#f6dccd',hair:'#e9edf2',hs:'short',shirt:'#f2f2ee',lip:'#c06a62',p:'Your name is Leo, an easygoing Australian coach. You keep things light with travel and everyday small talk, and you love useful idioms.'}];
const TT=()=>TEACHERS.find(t=>t.k===teacherK)||TEACHERS[0];
function avatar(t){const H={
 long:['M56 98Q52 38 100 40Q148 38 144 98L150 168Q100 182 50 168Z','M63 90Q64 50 100 50Q137 50 137 90Q124 64 98 66Q76 68 63 90Z'],
 bob:['M58 96Q56 42 100 42Q144 42 142 96L144 132Q100 142 56 132Z','M63 88Q66 50 100 50Q134 50 137 88Q126 70 110 73Q100 64 88 73Q72 70 63 88Z'],
 part:['','M65 88Q58 44 102 43Q143 45 136 86Q130 62 110 58Q92 74 65 88Z'],
 short:['','M66 86Q61 46 100 45Q140 46 134 86Q130 64 116 62Q100 56 82 64Q70 68 66 86Z']}[t.hs];
 return `<svg viewBox="0 0 200 200" aria-hidden="true"><rect width="200" height="200" fill="${t.bg}"/>
 ${H[0]?`<path d="${H[0]}" fill="${t.hair}"/>`:''}
 <path d="M38 200Q40 152 100 146Q160 152 162 200Z" fill="${t.shirt}"/>
 <path d="M88 128h24v22q-12 8-24 0Z" fill="${t.skin}" opacity=".9"/><path d="M88 138q12 7 24 0v4q-12 8-24 0Z" fill="#000" opacity=".08"/>
 ${t.shirt==='#ffffff'?'<path d="M38 200Q40 152 100 146Q160 152 162 200" fill="none" stroke="#e2e6e8" stroke-width="2"/>':''}
 <path d="M84 147l16 16 16-16" fill="none" stroke="${t.shirt==='#ffffff'?'#d0d6d9':'rgba(255,255,255,.55)'}" stroke-width="4" stroke-linejoin="round"/>
 ${t.tie?`<path d="M96 160h8l3 30-7 8-7-8Z" fill="${t.tie}"/>`:''}
 <ellipse cx="65" cy="100" rx="6" ry="9" fill="${t.skin}"/><ellipse cx="135" cy="100" rx="6" ry="9" fill="${t.skin}"/>
 <ellipse cx="100" cy="94" rx="35" ry="41" fill="${t.skin}"/>
 <path d="${H[1]}" fill="${t.hair}"/>
 <path d="M80 84q7-5 14-1M106 83q7-4 14 1" fill="none" stroke="${t.hair}" stroke-width="3" stroke-linecap="round"/>
 <ellipse class="ey" cx="87" cy="96" rx="3.6" ry="4.6" fill="#2a1d18"/><ellipse class="ey" cx="113" cy="96" rx="3.6" ry="4.6" fill="#2a1d18"/>
 <circle cx="88.2" cy="94.6" r="1.2" fill="#fff"/><circle cx="114.2" cy="94.6" r="1.2" fill="#fff"/>
 ${t.g==='f'?'<path d="M82.5 92.5q4.5-3 9 0M108.5 92.5q4.5-3 9 0" fill="none" stroke="#2a1d18" stroke-width="1.8" stroke-linecap="round"/><circle cx="65" cy="112" r="2.6" fill="#ffd36e"/><circle cx="135" cy="112" r="2.6" fill="#ffd36e"/>':''}
 ${t.glasses?'<g fill="none" stroke="#1d2a2c" stroke-width="2.4"><rect x="76" y="88" width="21" height="16" rx="6"/><rect x="103" y="88" width="21" height="16" rx="6"/><path d="M97 95h6M76 94l-9-3M124 94l9-3"/></g>':''}
 <path d="M100 100q-3 8 0 10q3 1 4-1" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="2" stroke-linecap="round"/>
 <ellipse cx="78" cy="110" rx="7" ry="4" fill="#ff8a8a" opacity=".22"/><ellipse cx="122" cy="110" rx="7" ry="4" fill="#ff8a8a" opacity=".22"/>
 <path class="sm" d="M90 117q10 8 20 0" fill="none" stroke="${t.lip}" stroke-width="3" stroke-linecap="round"/>
 <ellipse class="mo" cx="100" cy="119" rx="8" ry="5.5" fill="#5a2026" stroke="${t.lip}" stroke-width="2"/>
 </svg>`}
const repo={};
function face(t){const p=store.get('photo_'+t.k,'')||repo[t.k];return p?`<img src="${esc(p)}" alt="">`:avatar(t)}
function probeRepo(){TEACHERS.forEach(t=>{const im=new Image();im.onload=()=>{repo[t.k]=im.src;renderTeacher()};im.src=`teachers/${t.k}.jpg?v=2`})}
function renderTeacher(){const t=TT(),hasP=!!(store.get('photo_'+t.k,'')||repo[t.k]);
 const av=$('#orb');av.innerHTML=face(t)+'<span class="wave"><i></i><i></i><i></i><i></i><i></i></span>';av.classList.toggle('photo',hasP);
 $('#tname').innerHTML=`${esc(t.n)}<span>${esc(t.d)}</span>`;
 $('#teachers').innerHTML=TEACHERS.map(x=>`<button class="tc" data-k="${x.k}" aria-pressed="${x.k===t.k}">${face(x)}<b>${x.n}</b><span>${x.d}</span></button>`).join('')}

/* ---- 상황 · 코치 지침 ---- */
const SCENES=[
 {k:'free',n:'자유 회화',d:'일상 이야기로 몸풀기',q:["How was your week?","What did you do last weekend?","What are you looking forward to this month?","Tell me about a small win you had recently."]},
 {k:'cust',n:'고객 미팅',d:'LPDDR5X 이슈 대응 통화',q:["The customer saw a failure at high temperature. How would you open the call?","How would you explain the root-cause analysis timeline?","The customer wants a workaround this week. What do you say?","How do you close the meeting with clear next steps?"]},
 {k:'jedec',n:'JEDEC 표준 설명',d:'기술을 쉽게 말하기',q:["Can you explain what JEDEC does in one or two sentences?","How is LPDDR5X different from LPDDR5?","Why do automotive customers care about AEC-Q100?","How would you explain refresh to a non-engineer?"]},
 {k:'class',n:'Daniel 수업 예습',d:'일요일 수업 전 준비',q:["What topic do you want to cover with Daniel this Sunday?","Describe your job to someone you just met.","What is the hardest part of speaking English at work?","Tell me about a recent email you had to answer in English."]}];
const COACH=`You are "Edward English Coach", a friendly spoken-English coach for a Korean semiconductor technical-marketing professional (memory and automotive chips, China market).
Rules:
- Keep each reply short (2-4 sentences) so it works as spoken conversation.
- After the learner speaks: (1) respond naturally, (2) if needed give ONE more natural version of what they said, (3) ask one follow-up question.
- Focus on business English: customer calls, issue reports (e.g. LPDDR5X), JEDEC standards, emails, meetings.
- Give the short tip about the correction in Korean; everything else in English.
- Be honest about mistakes, but encouraging.
- When the learner says "end session", give a short report: what went well, top 3 corrections, one phrase to practise.`;
const JSONRULE=`\nReturn ONLY JSON: {"reply":"spoken English reply incl. follow-up question","better":"more natural version of the learner's sentence, or empty","tip_ko":"one short Korean tip, or empty"}`;
const RULES=[[/\bdiscuss about\b/gi,'discuss','discuss 뒤에는 about을 쓰지 않아요.'],[/\bI am agree\b/gi,'I agree','agree는 동사라 am 없이 씁니다.'],[/\bexplain me\b/gi,'explain to me','explain은 "to + 사람"을 씁니다.'],[/\bmore better\b/gi,'better','better 자체가 비교급이에요.'],[/\bcan able to\b/gi,'can','can과 be able to 중 하나만 씁니다.'],[/\bquestion to you\b/gi,'question for you','질문은 "for you"가 자연스러워요.'],[/\bdepend of\b/gi,'depend on','depend는 on과 함께 씁니다.'],[/\bcontact to\b/gi,'contact','contact 뒤에는 바로 사람이 옵니다.'],[/\bsend me the mail\b/gi,'send me an email','업무 메일은 an email이 자연스러워요.'],[/\bhow do you think\b/gi,'what do you think','의견은 what do you think로 묻습니다.'],[/\bi\b/g,'I','나를 뜻하는 I는 항상 대문자예요.']];

let teacherK=store.get('teacher','sophie'),sceneK='cust',hist=[],qi=0,rec=null,listening=false,micBlocked=false,t0=0,tick=null,rate=1;
const RATES=[0.85,1,1.15];
const scene=()=>SCENES.find(s=>s.k===sceneK);
const nextQ=()=>{const q=scene().q;return q[qi++%q.length]};
const STATES={idle:'대기 중 · 선생님을 누르면 듣기 시작',listen:'듣는 중 · 말을 마치면 잠시 멈추세요',think:'선생님이 생각하는 중',speak:'선생님이 말하는 중'};
function setS(s){$('#call').dataset.s=s;$('#stateTx').textContent=STATES[s]}
function cap(who,t){$('#cap').innerHTML=`<small>${esc(who)}</small>${esc(t)}`}
function note(t){$('#note').textContent=t;$('#note').style.display=t?'block':'none'}
function renderWho(){$('#who').textContent=whoLabel();renderQuota()}
function renderQuota(){const l=myLimit(),n=usedToday();$('#quota').innerHTML=`<b>${esc(whoLabel())}</b><br>`+(l===Infinity?`오늘 AI 사용 ${n}회 · 무제한`:`오늘 AI 사용 ${n} / ${l}회<div class="bar"><i style="width:${Math.min(100,n/l*100)}%"></i></div>`)}
function renderScenes(){$('#scenes').innerHTML=SCENES.map(s=>`<button class="sc" data-k="${s.k}" aria-pressed="${s.k===sceneK}"><b>${s.n}</b><span>${s.d}</span></button>`).join('')}
function renderTx(){$('#tx').innerHTML=hist.map(m=>`<p><b>${m.role==='user'?esc(loginId()):esc(TT().n)}</b> ${esc(m.text)}</p>`).join('')}
function showFix(m){const box=$('#fixes');if(!m.better&&!m.tip){box.innerHTML='';return}
 const last=[...hist].reverse().find(h=>h.role==='user');
 box.innerHTML=`<div class="fixc">${m.better?`<s>${esc(last?last.text:'')}</s><br>→ <b>${esc(m.better)}</b>`:''}${m.tip?`<div>${esc(m.tip)}</div>`:''}</div>`}

/* ---- 목소리: 자연스러운 영어 음성 우선 ---- */
const NAT=/natural|online|neural|google|premium|enhanced|siri/i;
function enVoices(lang){try{return speechSynthesis.getVoices().filter(v=>v.lang.replace('_','-').toLowerCase().startsWith((lang||'en').toLowerCase()))}catch(e){return []}}
function score(v,t){const F=/female|samantha|victoria|karen|serena|moira|tessa|aria|jenny|sonia|libby|emma|ava|allison|susan|zira|hazel|kate|fiona|maisie|natasha|michelle|clara/i,M=/\bmale|daniel|alex|fred|tom|guy|davis|ryan|thomas|george|arthur|oliver|david|mark|james|aaron|andrew|brian|christopher|eric|liam|william|steffan|roger/i;
 let s=0;if(NAT.test(v.name))s+=10;if(t.g==='f'?F.test(v.name):(M.test(v.name)&&!/female/i.test(v.name)))s+=5;if(v.lang.replace('_','-')===t.lang)s+=2;return s}
function pickVoice(t){const saved=store.get('voice_'+t.k,'');let all=[];try{all=speechSynthesis.getVoices()}catch(e){}
 if(saved){const v=all.find(v=>v.name===saved);if(v)return v}
 let vs=enVoices(t.lang);if(!vs.length)vs=enVoices('en');return vs.sort((a,b)=>score(b,t)-score(a,t))[0]}
function voiceCheck(){const en=enVoices('en'),nat=en.filter(v=>NAT.test(v.name)),w=$('#voiceWarn');
 if(!en.length)w.innerHTML='<b>이 기기에 영어 음성이 없어요.</b> 그래서 한국어 음성이 영어를 읽어 어색하게 들립니다. <b>Microsoft Edge</b>로 열면 원어민 수준의 자연스러운 음성을 무료로 쓸 수 있어요.';
 else if(!nat.length)w.innerHTML='기본(로봇) 영어 음성뿐이에요. <b>Microsoft Edge</b>에서 열면 훨씬 자연스러운 "Natural" 음성을 쓸 수 있어요.';
 else w.innerHTML='';w.style.display=w.innerHTML?'block':'none';renderVoiceSel()}
function renderVoiceSel(){const sel=$('#voiceSel'),t=TT(),en=enVoices('en').sort((a,b)=>score(b,t)-score(a,t)),cur=pickVoice(t);
 sel.innerHTML=en.length?en.map(v=>`<option ${cur&&v.name===cur.name?'selected':''}>${esc(v.name)}</option>`).join(''):'<option>영어 음성 없음</option>'}
function speak(t,after){try{speechSynthesis.cancel();const T=TT(),u=new SpeechSynthesisUtterance(t);u.lang=T.lang;u.rate=rate;u.pitch=T.g==='f'?1.12:0.88;
 const v=pickVoice(T);if(v){u.voice=v;u.lang=v.lang;if(NAT.test(v.name))u.pitch=1}
 u.onstart=()=>setS('speak');u.onend=()=>{setS('idle');after&&after()};u.onerror=()=>setS('idle');speechSynthesis.speak(u)}catch(e){setS('idle')}}
function startTimer(){if(tick)return;t0=Date.now();tick=setInterval(()=>{const s=Math.floor((Date.now()-t0)/1000);$('#timer').textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')},1000)}

/* ---- AI 답변: Gemini → Groq → OpenRouter → 오프라인 채점 ---- */
function offline(text){let f=text.trim(),tips=[];
 for(const[r,to,tip]of RULES){if(r.test(f)){f=f.replace(r,to);tips.push(tip)}r.lastIndex=0}
 f=f.charAt(0).toUpperCase()+f.slice(1);if(!/[.!?]$/.test(f))f+='.';const ch=tips.length>0;
 return{reply:(ch?'Good try! ':'Nice, that sounds natural. ')+nextQ(),better:ch?f:'',tip_ko:tips.join(' ')}}
function parse(t){try{const j=JSON.parse(String(t).slice(t.indexOf('{'),t.lastIndexOf('}')+1));if(j.reply)return j}catch(e){}return{reply:String(t),better:'',tip_ko:''}}
async function post(url,headers,body){const c=new AbortController(),tm=setTimeout(()=>c.abort(),20000);
 try{const r=await fetch(url,{method:'POST',headers:Object.assign({'Content-Type':'application/json'},headers),body:JSON.stringify(body),signal:c.signal});if(!r.ok)throw new Error(r.status);return await r.json()}finally{clearTimeout(tm)}}
const msgs=sys=>[{role:'system',content:sys}].concat(hist.slice(-12).map(m=>({role:m.role==='user'?'user':'assistant',content:m.text})));
async function ask(){const sys=COACH+'\n'+TT().p+`\nCurrent scenario: ${scene().n} — ${scene().d}.`+JSONRULE,k=secret;
 const chain=[
  ['Gemini',k.geminiKey,async()=>{const m=model('gemini',k.geminiModel,'gemini-2.5-flash').replace(/^models\//,'');const d=await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(k.geminiKey)}`,{},{systemInstruction:{parts:[{text:sys}]},contents:hist.slice(-12).map(x=>({role:x.role==='user'?'user':'model',parts:[{text:x.text}]})),generationConfig:{responseMimeType:'application/json'}});return d.candidates[0].content.parts[0].text}],
  ['Groq',k.groqKey,async()=>(await post('https://api.groq.com/openai/v1/chat/completions',{Authorization:'Bearer '+k.groqKey},{model:model('groq',k.groqModel,'llama-3.3-70b-versatile'),messages:msgs(sys),temperature:.7})).choices[0].message.content],
  ['OpenRouter',k.orKey,async()=>(await post('https://openrouter.ai/api/v1/chat/completions',{Authorization:'Bearer '+k.orKey},{model:model('openrouter',k.orModel,'meta-llama/llama-3.3-70b-instruct:free'),messages:msgs(sys),temperature:.7})).choices[0].message.content]];
 for(const[name,key,fn]of chain){if(!key)continue;try{const r=parse(await fn());return Object.assign(r,{by:name,ai:true})}catch(e){}}
 return Object.assign(offline(hist[hist.length-1].text),{by:'오프라인 채점',ai:false})}
async function send(text){text=String(text||'').trim();if(!text)return;
 const l=myLimit(),hasAI=!!(secret.geminiKey||secret.groqKey||secret.orKey);
 if(hasAI&&usedToday()>=l){note(`오늘 AI 사용 한도(${l}회)를 다 썼어요. 오프라인 채점으로 계속하거나, 마스터에게 "AI 한도 설정"에서 늘려 달라고 하세요.`)}
 startTimer();hist.push({role:'user',text});cap(loginId(),text);renderTx();setS('think');
 let r;if(hasAI&&usedToday()<l){r=await ask();if(r.ai){countUse();renderQuota()}}else r=Object.assign(offline(text),{by:'오프라인 채점'});
 hist.push({role:'coach',text:r.reply,better:r.better,tip:r.tip_ko,by:r.by});renderTx();
 cap(TT().n+' · '+r.by,r.reply);showFix(r);
 speak(r.reply,()=>{if($('#hfBtn').getAttribute('aria-pressed')==='true'&&!micBlocked&&tick)listen()})}

/* ---- 음성 인식 ---- */
function openKb(msg){if(msg)note(msg);$('#kb').classList.add('on');$('#kbBtn').setAttribute('aria-pressed','true');$('#kbIn').focus()}
function listen(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!SR||micBlocked){openKb('이 브라우저는 음성 인식을 지원하지 않아요. 크롬이나 엣지에서 열거나 자판으로 입력하세요.');return}
 if(listening){rec&&rec.stop();return}
 try{speechSynthesis.cancel()}catch(e){}rec=new SR();rec.lang='en-US';rec.interimResults=true;let fin='';
 rec.onstart=()=>{listening=true;setS('listen');note('')};
 rec.onresult=e=>{let s='';for(const r of e.results){s+=r[0].transcript;if(r.isFinal)fin=s}cap(loginId(),s)};
 rec.onerror=e=>{if(['not-allowed','service-not-allowed','audio-capture'].includes(e.error)){micBlocked=true;openKb('마이크가 막혀 있어요. 주소창 왼쪽의 자물쇠 아이콘에서 마이크를 허용한 뒤 새로고침하세요. 지금은 자판으로 연습할 수 있어요.')}};
 rec.onend=()=>{listening=false;if($('#call').dataset.s==='listen')setS('idle');if(fin)send(fin)};
 try{rec.start()}catch(e){openKb('마이크를 시작하지 못했어요. 자판으로 입력하세요.')}}

function greet(){hist=[];qi=0;$('#fixes').innerHTML='';const g=`Hi ${loginId()}, I'm ${TT().n}! Today: ${scene().n}. ${nextQ()}`;hist.push({role:'coach',text:g,by:'코치'});cap(TT().n,g);renderTx();setS('idle');$('#appTeacher').textContent=TT().n;$('#promptBox').value=appPrompt()}
function report(){const me=hist.filter(m=>m.role==='user'),fx=hist.filter(m=>m.role==='coach'&&(m.better||m.tip));
 const words=me.reduce((a,m)=>a+m.text.split(/\s+/).filter(Boolean).length,0),dur=$('#timer').textContent,r=$('#report');r.classList.add('on');
 r.innerHTML=`<h3>오늘 연습 리포트 · ${esc(TT().n)} · ${esc(scene().n)}</h3>
 <div class="stats"><div><b>${me.length}</b><span>말한 문장</span></div><div><b>${words}</b><span>말한 단어</span></div><div><b>${esc(dur)}</b><span>연습 시간</span></div></div>
 ${fx.length?`<ul class="rl">${fx.map(m=>`<li>${m.better?`<b>${esc(m.better)}</b><br>`:''}<span class="small">${esc(m.tip||'')}</span></li>`).join('')}</ul>`:'<p class="small">고칠 문장이 없었어요. 다음엔 더 긴 문장으로 도전해 보세요.</p>'}
 <div class="row"><button class="btn pri" id="again">같은 상황 다시</button><button class="btn" id="copyRep">리포트 복사 (Daniel에게 공유)</button></div>`;
 $('#again').addEventListener('click',()=>{r.classList.remove('on');greet()});
 $('#copyRep').addEventListener('click',async e=>{const t=`[${loginId()}] ${TT().n} · ${scene().n} · ${dur} · ${me.length}문장\n`+fx.map(m=>'- '+(m.better||'')+' '+(m.tip||'')).join('\n');try{await navigator.clipboard.writeText(t);e.target.textContent='복사했어요'}catch(x){e.target.textContent='복사가 막혀 있어요'}});
 r.scrollIntoView({behavior:'smooth',block:'start'})}

/* ---- 유료 구독 앱 음성 모드로 넘기기 ---- */
function appPrompt(){const t=TT(),s=scene();
 return COACH+'\n'+t.p+`\nSpeak with a natural ${t.lang==='en-GB'?'British':t.lang==='en-AU'?'Australian':t.lang==='en-CA'?'Canadian':'American'} accent.\nToday's practice scenario: ${s.n} (${s.d}). Start by greeting me as ${t.n} and asking the first question. We will talk in voice mode, so keep every turn short.`}
const APPS={claude:{n:'Claude',url:q=>'https://claude.ai/new?q='+encodeURIComponent(q)},chatgpt:{n:'ChatGPT',url:q=>'https://chatgpt.com/?q='+encodeURIComponent(q)},gemini:{n:'Gemini',url:()=>'https://gemini.google.com/app'}};
document.addEventListener('click',async e=>{const b=e.target.closest('[data-app]');if(!b)return;const a=APPS[b.dataset.app],p=appPrompt();let copied=false;
 try{await navigator.clipboard.writeText(p);copied=true}catch(x){}
 window.open(a.url(p),'_blank','noopener');
 $('#appMsg').textContent=`${a.n}을(를) 열었어요. ${copied?'코치 지침이 복사돼 있으니, 입력칸이 비어 있으면 붙여 넣어 보내세요.':'복사가 막혀서 아래 "코치 지침 전문"에서 직접 복사하세요.'} 보낸 뒤 앱의 음성 대화 단추를 누르면 ${TT().n} 선생님처럼 말로 연습할 수 있어요.`});

/* ---- 시작 ---- */
if(!loggedIn()){$('#locked').hidden=false;return}
$('#app').hidden=false;
$('#teachers').addEventListener('click',e=>{const b=e.target.closest('.tc');if(!b)return;teacherK=b.dataset.k;store.set('teacher',teacherK);renderTeacher();renderVoiceSel();greet();speak(hist[0].text)});
$('#scenes').addEventListener('click',e=>{const b=e.target.closest('.sc');if(!b)return;sceneK=b.dataset.k;renderScenes();greet()});
$('#orb').addEventListener('click',()=>{if($('#call').dataset.s==='speak'){try{speechSynthesis.cancel()}catch(x){}setS('idle');return}startTimer();listen()});
$('#kb').addEventListener('submit',e=>{e.preventDefault();const v=$('#kbIn').value;$('#kbIn').value='';send(v)});
const tog=(b,f)=>{const on=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',on);f&&f(on)};
$('#kbBtn').addEventListener('click',e=>tog(e.currentTarget,on=>{$('#kb').classList.toggle('on',on);if(on)$('#kbIn').focus()}));
$('#txBtn').addEventListener('click',e=>tog(e.currentTarget,on=>$('#tx').classList.toggle('on',on)));
$('#hfBtn').addEventListener('click',e=>tog(e.currentTarget));
$('#spdBtn').addEventListener('click',e=>{rate=RATES[(RATES.indexOf(rate)+1)%RATES.length];e.currentTarget.textContent=(rate===1?'1.0':String(rate))+'×'});
$('#endBtn').addEventListener('click',()=>{try{rec&&rec.stop();speechSynthesis.cancel()}catch(x){}clearInterval(tick);tick=null;setS('idle');report()});
$('#voiceSel').addEventListener('change',e=>store.set('voice_'+TT().k,e.target.value));
$('#voiceTest').addEventListener('click',()=>speak(`Hi, I'm ${TT().n}. Let's talk about your LPDDR5X customer meeting.`));
renderTeacher();renderWho();renderScenes();greet();probeRepo();
try{speechSynthesis.onvoiceschanged=voiceCheck;setTimeout(voiceCheck,600)}catch(e){}
loadShared();loadLimits();
})();
