"use strict";
/* ============ Content: Edward's fossilized mistakes (from 4 years of Daniel's feedback) ============ */
const CORE = [
  {id:"every-people", wrong:"every people", right:"everyone / every person", why:"every 뒤에는 단수. people은 이미 복수", seed:12,
   ko:"모든 사람이 이 일정에 동의한 건 아니에요.", answer:"Not everyone agreed to this schedule."},
  {id:"similar-like", wrong:"similar like", right:"similar to", why:"similar는 to와 짝. like와 겹쳐 쓰지 않음", seed:14,
   ko:"이 칩의 스펙은 경쟁사 제품과 비슷해요.", answer:"The specs of this chip are similar to the competitor's product."},
  {id:"after-later", wrong:"after several months later", right:"several months later / in several months", why:"after와 later는 중복. 미래는 in + 기간", seed:12,
   ko:"몇 달 뒤에 양산이 시작될 거예요.", answer:"Mass production will start in a few months."},
  {id:"before-ago", wrong:"before five years", right:"five years ago", why:"과거 시점은 기간 + ago", seed:6,
   ko:"우리는 5년 전에 이 고객과 처음 거래했어요.", answer:"We first did business with this customer five years ago."},
  {id:"more-better", wrong:"more better / more good", right:"better", why:"better 자체가 비교급. more 붙이지 않음", seed:9,
   ko:"새 버전이 이전 것보다 훨씬 나아요.", answer:"The new version is much better than the previous one."},
  {id:"consider-about", wrong:"consider about", right:"consider (something)", why:"consider는 바로 목적어. about 없음", seed:8,
   ko:"가격 인상안을 검토해 주실 수 있나요?", answer:"Could you consider the price increase proposal?"},
  {id:"discuss-about", wrong:"discuss about", right:"discuss (something)", why:"discuss도 바로 목적어. talk about과 혼동 주의", seed:3,
   ko:"다음 회의에서 납기 문제를 논의합시다.", answer:"Let's discuss the delivery issue at the next meeting."},
  {id:"invest-to", wrong:"invest to", right:"invest in", why:"투자 대상 앞에는 in", seed:5,
   ko:"회사는 차량용 메모리에 더 투자해야 해요.", answer:"The company should invest more in automotive memory."},
  {id:"visit-to", wrong:"visit to", right:"visit (a place)", why:"visit은 바로 목적어. go to와 혼동 주의", seed:6,
   ko:"다음 달에 상하이 고객사를 방문할 예정이에요.", answer:"I'm planning to visit our customer in Shanghai next month."},
  {id:"focus-to", wrong:"focus to", right:"focus on", why:"집중 대상 앞에는 on", seed:6,
   ko:"올해는 ADAS 시장에 집중하고 있어요.", answer:"This year we are focusing on the ADAS market."},
  {id:"compare", wrong:"to compare last year", right:"compared to last year", why:"‘~에 비해’는 compared to", seed:8,
   ko:"작년에 비해 수요가 20% 늘었어요.", answer:"Demand has increased by 20% compared to last year."},
  {id:"ive-heard", wrong:"I'm heard", right:"I've heard", why:"현재완료는 have + p.p.", seed:6,
   ko:"중국 시장이 회복되고 있다고 들었어요.", answer:"I've heard that the Chinese market is recovering."},
  {id:"past-negative", wrong:"didn't found / don't saw", right:"didn't find / didn't see", why:"didn't 뒤에는 동사 원형", seed:6,
   ko:"우리는 아직 근본 원인을 찾지 못했어요.", answer:"We didn't find the root cause yet. / We haven't found the root cause yet."},
  {id:"lose-lost", wrong:"will lost / don't lost", right:"will lose / don't lose", why:"lose(현재) - lost(과거). 조동사 뒤엔 원형", seed:8,
   ko:"이 고객을 잃고 싶지 않아요.", answer:"We don't want to lose this customer."},
  {id:"nobody", wrong:"everybody doesn't know", right:"nobody knows", why:"전체 부정은 nobody / no one으로", seed:5,
   ko:"아무도 정확한 출시일을 몰라요.", answer:"Nobody knows the exact launch date."},
  {id:"go-abroad", wrong:"go to abroad / go to overseas", right:"go abroad / go overseas", why:"abroad, overseas, outside는 부사라 to 없음", seed:6,
   ko:"요즘은 출장으로 해외에 자주 나가요.", answer:"These days I often go abroad on business trips."},
  {id:"foreigners", wrong:"foreign country people", right:"foreigners / people from other countries", why:"한 단어 명사로", seed:3,
   ko:"전시회에 외국인 방문객이 많았어요.", answer:"There were many foreign visitors at the exhibition."},
  {id:"find-solution", wrong:"make a solution / prepare solution", right:"find a solution", why:"해결책은 find하는 것", seed:7,
   ko:"이 품질 문제에 대한 해결책을 찾아야 해요.", answer:"We need to find a solution to this quality issue."},
  {id:"thats-why", wrong:"for that", right:"that's why / so", why:"‘그래서’는 that's why", seed:3,
   ko:"공급이 부족해요. 그래서 가격이 오르고 있어요.", answer:"Supply is tight. That's why prices are going up."},
  {id:"other-countries", wrong:"another countries", right:"other countries", why:"another는 단수, other는 복수", seed:2,
   ko:"다른 나라 고객들도 같은 요청을 했어요.", answer:"Customers in other countries made the same request."},
  {id:"interested", wrong:"I'm interesting in", right:"I'm interested in", why:"감정은 -ed, 원인은 -ing", seed:4,
   ko:"저는 자율주행 반도체에 관심이 많아요.", answer:"I'm very interested in semiconductors for autonomous driving."}
];
const CORE_BY_ID = Object.fromEntries(CORE.map(c=>[c.id,c]));

const CHAT_TOPICS = [
  "이번 주말에 한 일","요즘 회사 일","아이들 교육","부동산 시장","투자 이야기","자전거 라이딩","최근 본 뉴스"
];

const SCENARIOS = [
  {id:"oem", title:"중국 OEM 공급 미팅",
   desc:"상대: 중국 전기차 업체 구매 담당 Ms. Chen. LPDDR5X 차량용 메모리 공급 물량과 일정을 묻습니다. 공급 가능 물량, 일정, AEC-Q100 인증 상태를 설명하세요.",
   role:"You are Ms. Chen, a senior procurement manager at a Chinese EV maker. You need LPDDR5X automotive memory for a new ADAS platform launching next year. You are polite but push hard on volume commitments, lead time and price. Ask one thing at a time."},
  {id:"launch", title:"신제품 발표 Q&A",
   desc:"상대: 글로벌 Tier-1 엔지니어 Tom. 차량용 UFS 4.0 소개 후 질의응답입니다. 성능, 온도 범위, 신뢰성 질문에 답하세요.",
   role:"You are Tom, a hardware engineer at a global automotive Tier-1 supplier attending a product briefing on automotive UFS 4.0 storage. Ask practical technical questions about performance, operating temperature range (e.g., -40 to 105°C), reliability, and qualification. Ask one question at a time."},
  {id:"jedec", title:"JEDEC 표준 설명",
   desc:"상대: 기술 배경이 약한 고객사 신임 PM. LPDDR5와 LPDDR5X의 차이, JEDEC 표준이 왜 중요한지 쉽게 설명하세요.",
   role:"You are Lisa, a newly appointed project manager at a customer company with a business background, not engineering. You want Edward to explain JEDEC standards and the difference between LPDDR5 and LPDDR5X in simple terms. Ask follow-up 'why does it matter for us?' questions."},
  {id:"delay", title:"납기 지연 알리기",
   desc:"상대: 화가 난 고객사 SCM 담당 Mr. Wang. 웨이퍼 공급 문제로 출하가 3주 늦어졌습니다. 사과하고, 원인과 대책, 새 일정을 설명하세요.",
   role:"You are Mr. Wang, a supply chain manager at a Chinese automotive customer. Edward's company has just told you a shipment will be three weeks late. You are frustrated and worried about your production line. Demand clear reasons, a recovery plan and a firm new date."},
  {id:"price", title:"가격 인상 협상",
   desc:"상대: 깐깐한 구매 책임자 Ms. Liu. 다음 분기 메모리 가격 8% 인상을 설득해야 합니다. 시장 상황과 공급 안정성을 근거로 협상하세요.",
   role:"You are Ms. Liu, head of purchasing at a large Chinese automotive electronics company. Edward wants an 8% memory price increase next quarter. You resist firmly, mention competitors' offers, and ask for justification and concessions. Stay professional."}
];

/* ============ Utilities ============ */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const todayStr = (d=new Date()) => { const z=n=>String(n).padStart(2,"0"); return d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate()); };
const addDays = (n) => { const d=new Date(); d.setDate(d.getDate()+n); return todayStr(d); };
const norm = s => String(s||"").toLowerCase().replace(/["'“”‘’.,!?]/g,"").replace(/\s+/g," ").trim();
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("show"),2600); }
function parseJSON(text){
  if(!text) throw new Error("빈 응답");
  let t = String(text).trim().replace(/^```(?:json)?/i,"").replace(/```$/,"").trim();
  const a=t.indexOf("{"), b=t.lastIndexOf("}");
  if(a<0||b<0) throw new Error("JSON 형식이 아님");
  return JSON.parse(t.slice(a,b+1));
}
const INTERVALS = [0,1,3,7,14,30];

/* ============ State & storage ============ */
const LS_KEY = "edward-coach-state-v1";
const LS_SECRET = "edward-coach-secret-v1"; // API key + model, never synced
function blankState(){ return {v:1, updatedAt:0, progress:{}, custom:[], sessions:[], days:{}, importedFb:[], expressions:[], settings:{autoSpeak:false, rate:1}}; }
let state = blankState();
let secret = {provider:"", apiKey:"", model:"claude-sonnet-5-5", geminiKey:"", geminiModel:"gemini-flash-latest",
  groqKey:"", groqModel:"llama-3.3-70b-versatile", orKey:"", orModel:""};
try{ const raw=localStorage.getItem(LS_KEY); if(raw) state=Object.assign(blankState(), JSON.parse(raw)); }catch(e){}
try{ const raw=localStorage.getItem(LS_SECRET); if(raw) secret=Object.assign(secret, JSON.parse(raw)); }catch(e){}
/* AI 순서: Gemini → Groq → OpenRouter 무료 모델 → (선택) Claude 유료 키 → 오프라인 자동 판정 */
const AI_CHAIN = [
  {id:"gemini",     name:"Gemini",     key:()=>secret.geminiKey, model:()=>(secret.geminiModel||"gemini-flash-latest").replace(/^models\//,"")},
  {id:"groq",       name:"Groq",       key:()=>secret.groqKey,   model:()=>secret.groqModel||"llama-3.3-70b-versatile"},
  {id:"openrouter", name:"OpenRouter", key:()=>secret.orKey,     model:()=>secret.orModel||"자동(무료 모델)"},
  {id:"anthropic",  name:"Claude",     key:()=>secret.apiKey,    model:()=>secret.model||"claude-sonnet-5-5", paid:true}
];
const hasKey = () => AI_CHAIN.some(p=>!!p.key());
/* 마스터가 넣은 무료 키를 학생·edward1004도 쓰도록 공유 (english-class-share/coach-ai.json, 간단히 가려서 저장) */
const SHARED_AI = "coach-ai.json";
let sharedKeys = null;   // 학생 기기: 마스터가 공유한 키 (자기 키가 비어 있을 때만 사용)
const SHARE_FIELDS = ["geminiKey","geminiModel","groqKey","groqModel","orKey","orModel"];
const mask = t => btoa(String(t).split("").reverse().join("")).split("").reverse().join("");
const unmask = t => { try{ return atob(String(t).split("").reverse().join("")).split("").reverse().join(""); }catch(e){ return ""; } };
function applySharedKeys(){
  if(!sharedKeys) return;
  SHARE_FIELDS.forEach(f=>{ if(!secret[f] && sharedKeys[f]) secret[f] = sharedKeys[f]; });
}
async function loadSharedKeys(){
  if(ghMaster() || !ghCoach()) return;
  try{
    const g = await ghGetJSON(SHARE_REPO, SHARED_AI);
    if(g.data && g.data.k){ sharedKeys = {}; Object.keys(g.data.k).forEach(f=>{ if(SHARE_FIELDS.includes(f)) sharedKeys[f] = /Key$/.test(f) ? unmask(g.data.k[f]) : String(g.data.k[f]); }); applySharedKeys(); renderAll(); }
  }catch(e){}
}
async function shareKeysToStudents(){
  const k = {}; SHARE_FIELDS.forEach(f=>{ if(secret[f]) k[f] = /Key$/.test(f) ? mask(secret[f]) : secret[f]; });
  let sha = null; try{ sha = (await ghGetJSON(SHARE_REPO, SHARED_AI)).sha; }catch(e){}
  await ghPutJSON(SHARE_REPO, SHARED_AI, {v:1, updatedAt:Date.now(), note:"Free AI keys shared by the master for the English coach", k}, "Coach: share free AI keys with students", sha);
}
const keyedNames = () => AI_CHAIN.filter(p=>p.key()).map(p=>p.name);

/* --- GitHub storage (calendar site): coach.json in the private repo, master token only --- */
const AUTHKEY = "eng-class-gh-auth", SHARE_REPO = "english-class-share", COACH_FILE = "coach.json", BRANCH = "main";
const GH = {auth:null, sha:null};
try{ GH.auth = JSON.parse(localStorage.getItem(AUTHKEY) || "null"); }catch(e){}
const ghMaster = () => !!(GH.auth && GH.auth.token && GH.auth.owner && GH.auth.role !== "sub");
// 선생님 계정이지만 코치를 쓰는 사용자: edward1004 = Edward 본인(Edward 실수 목록 사용), uihee = 학생으로 취급
const COACH_EXTRA = {"edward1004":"edward", "uihee":"student"};
const ghSub = () => !!(GH.auth && GH.auth.token && GH.auth.owner && GH.auth.role === "sub");
const extraOf = () => ghSub() ? COACH_EXTRA[String(GH.auth.login||"").toLowerCase()] : "";
const ghStudent = () => ghSub() && (GH.auth.kind === "student" || extraOf() === "student");
const ghEdward = () => ghSub() && extraOf() === "edward";
const ghCoach = () => ghMaster() || ghStudent() || ghEdward();     // 마스터·모든 학생·edward1004가 코치 사용, Daniel(선생님)은 제외
const whoLabel = () => ghMaster() ? "마스터" : ghEdward() ? "Edward · " + GH.auth.login : "학생 · " + (GH.auth.name || GH.auth.login);
const ghPriv = () => (GH.auth && GH.auth.privRepo) || "english-class-private";
// where this person's coach notebook lives: master → private repo, student → share repo (their token has no private access)
const coachLoc = () => ghMaster() ? {repo: ghPriv(), path: COACH_FILE} : {repo: SHARE_REPO, path: "coach-" + String(GH.auth.login||"student").replace(/[^a-z0-9._-]/gi,"") + ".json"};
const b64enc = s => btoa(unescape(encodeURIComponent(s)));
const b64dec = s => decodeURIComponent(escape(atob(String(s).replace(/\n/g,""))));
const ghHeaders = () => ({Accept:"application/vnd.github+json", Authorization:"Bearer " + GH.auth.token});
const ghUrl = (repo, path) => "https://api.github.com/repos/" + encodeURIComponent(GH.auth.owner) + "/" + encodeURIComponent(repo) + "/contents/" + path;
async function ghGetJSON(repo, path){
  const r = await fetch(ghUrl(repo, path) + "?ref=" + BRANCH + "&t=" + Date.now(), {headers: ghHeaders(), cache:"no-store"});
  if(r.status === 404) return {data:null, sha:null};
  if(!r.ok) throw new Error(repo + " HTTP " + r.status);
  const j = await r.json(); return {data: JSON.parse(b64dec(j.content)), sha: j.sha};
}
async function ghPutJSON(repo, path, obj, message, sha, opts={}){
  const body = {message, content: b64enc(JSON.stringify(obj)), branch: BRANCH}; if(sha) body.sha = sha;
  const r = await fetch(ghUrl(repo, path), {method:"PUT", headers:{...ghHeaders(), "Content-Type":"application/json"}, body: JSON.stringify(body), keepalive: !!opts.keepalive});
  if(r.status === 409 || r.status === 422) { const e = new Error("conflict"); e.conflict = true; throw e; }
  if(!r.ok) throw new Error(repo + " HTTP " + r.status);
  return (await r.json()).content.sha;
}
function setSync(msg, bad){ const el = $("#syncNote"); if(!el) return; el.textContent = msg || ""; el.classList.toggle("bad", !!bad); }

let dbRef = null, saveTimer = null, saving = false, saveAgain = false, dirty = false;
function save(){
  state.updatedAt = Date.now(); dirty = true;
  try{ localStorage.setItem(LS_KEY, JSON.stringify(state)); }catch(e){}
  clearTimeout(saveTimer);
  if(MODE === "github"){ setSync("저장 대기 중…"); saveTimer = setTimeout(flush, 4000); }
  else saveTimer = setTimeout(flush, 1200);
}
function slimState(){ const o = JSON.parse(JSON.stringify(state)); o.sessions = (o.sessions||[]).slice(0,80); return o; }
async function flush(opts={}){
  if(MODE === "github"){
    if(!dirty) return;
    if(saving){ saveAgain = true; return; }
    saving = true; dirty = false; setSync("저장 중…");
    try{
      try{ GH.sha = await ghPutJSON(coachLoc().repo, coachLoc().path, slimState(), "Coach: update progress", GH.sha, opts); }
      catch(e){
        if(!e.conflict) throw e;
        const g = await ghGetJSON(coachLoc().repo, coachLoc().path);          // another device saved first → merge, then retry once
        if(g.data) state = mergeStates(state, Object.assign(blankState(), g.data));
        GH.sha = await ghPutJSON(coachLoc().repo, coachLoc().path, slimState(), "Coach: update progress (merged)", g.sha, opts);
        renderAll();
      }
      setSync("저장소에 저장됨 ✓");
    }catch(e){ dirty = true; setSync("저장 실패: " + e.message + " — 잠시 뒤 다시 시도해요", true); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 30000); }
    saving = false;
    if(saveAgain){ saveAgain = false; flush(); }
    return;
  }
  if(!dbRef) return;
  if(saving){ saveAgain=true; return; }
  saving = true;
  try{ await dbRef.set(JSON.parse(JSON.stringify(state))); }
  catch(e){ if(e && e.code==="quota_exceeded") toast("저장 공간이 가득 찼어요. 오래된 기록을 줄여 주세요."); }
  saving = false;
  if(saveAgain){ saveAgain=false; flush(); }
}
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState === "hidden" && MODE === "github" && dirty && !saving){ clearTimeout(saveTimer); flush({keepalive:true}); } });
function mergeStates(a, b){
  // keep both learners' history: union of custom, max progress, union of sessions/days
  const out = blankState();
  const newer = (a.updatedAt||0) >= (b.updatedAt||0) ? a : b;
  out.settings = Object.assign({}, b.settings||{}, a.settings||{}, newer.settings||{});
  const keys = new Set([...Object.keys(a.progress||{}), ...Object.keys(b.progress||{})]);
  keys.forEach(k=>{
    const x=(a.progress||{})[k], y=(b.progress||{})[k];
    if(!x||!y){ out.progress[k]=Object.assign({}, x||y); return; }
    const pick = (x.lastSeen||"") >= (y.lastSeen||"") ? x : y;
    out.progress[k] = Object.assign({}, pick, {count: Math.max(x.count||0, y.count||0)});
  });
  const cmap = new Map();
  [...(b.custom||[]), ...(a.custom||[])].forEach(c=>cmap.set(c.id,c));
  out.custom=[...cmap.values()];
  const smap = new Map();
  [...(b.sessions||[]), ...(a.sessions||[])].forEach(s=>smap.set(s.id,s));
  out.sessions=[...smap.values()].sort((p,q)=>(q.ts||0)-(p.ts||0)).slice(0,80);
  out.days = Object.assign({}, b.days||{});
  Object.entries(a.days||{}).forEach(([d,n])=>{ out.days[d]=Math.max(out.days[d]||0,n); });
  out.importedFb = [...new Set([...(b.importedFb||[]), ...(a.importedFb||[])])];
  const emap = new Map();
  [...(b.expressions||[]), ...(a.expressions||[])].forEach(x=>{ if(x && x.en) emap.set(norm(x.en), x); });
  out.expressions = [...emap.values()].slice(-200);
  out.updatedAt = Math.max(a.updatedAt||0, b.updatedAt||0);
  return out;
}

/* ============ Mistake model ============ */
function allItems(){
  // Edward's 21 recurring mistakes are his own; a student account starts with only their own notes
  const items = ghStudent() ? [] : CORE.map(c=>Object.assign({source:"daniel", core:true}, c));
  state.custom.forEach(c=>items.push(Object.assign({core:false}, c)));
  return items.map(it=>{
    const p = state.progress[it.id] || {};
    return Object.assign({}, it, {
      count:(it.seed||0)+(p.count||0), appCount:p.count||0, box:p.box||0,
      due:p.due||todayStr(), lastSeen:p.lastSeen||"", mastered:(p.box||0)>=5
    });
  });
}
function bumpMistake(id){
  const p = state.progress[id] || {count:0, box:0};
  p.count=(p.count||0)+1; p.box=0; p.due=todayStr(); p.lastSeen=todayStr();
  state.progress[id]=p;
}
function recordAttempt(id, ok){
  const p = state.progress[id] || {count:0, box:0};
  if(ok){ p.box=Math.min(5,(p.box||0)+1); p.due=addDays(INTERVALS[p.box]||30); }
  else { p.box=0; p.count=(p.count||0)+1; p.due=addDays(1); }
  p.lastSeen=todayStr();
  state.progress[id]=p;
  markPractice();
}
function markPractice(){ const d=todayStr(); state.days[d]=(state.days[d]||0)+1; }
function addCorrection(c, source){
  // c: {wrong,right,why,tag}
  if(!c || !c.wrong || !c.right) return;
  const useCore = !ghStudent();           // the built-in list is Edward's; students keep their own entries
  if(useCore && c.tag && CORE_BY_ID[c.tag]){ bumpMistake(c.tag); return; }
  const key = norm(c.wrong);
  const coreHit = useCore && CORE.find(x=>norm(x.wrong).split(" / ").some(w=>w && key.includes(w)));
  if(coreHit){ bumpMistake(coreHit.id); return; }
  let ex = state.custom.find(x=>norm(x.wrong)===key);
  if(!ex){
    ex = {id:"c-"+Date.now().toString(36)+Math.random().toString(36).slice(2,6), wrong:String(c.wrong).slice(0,120), right:String(c.right).slice(0,160), why:String(c.why||"").slice(0,120), source, added:todayStr()};
    state.custom.push(ex);
    if(state.custom.length>300) state.custom.shift();
  }
  bumpMistake(ex.id);
}
function streak(){
  let n=0; const d=new Date();
  if(!state.days[todayStr(d)]) d.setDate(d.getDate()-1);
  while(state.days[todayStr(d)]){ n++; d.setDate(d.getDate()-1); }
  return n;
}
function addSession(s){
  s.id = "s-"+Date.now().toString(36); s.ts=Date.now(); s.date=todayStr();
  state.sessions.unshift(s); state.sessions=state.sessions.slice(0,80);
}

/* ============ AI engine (Claude artifact OR own API key) ============ */
let MODE = "detecting"; // "claude" (artifact) | "github" (calendar site, master) | "standalone"
let cap = {sample:null, dictation:null, tts:null};
function aiReady(){ return !!cap.sample || (MODE!=="claude" && hasKey()); }
async function ai(system, messages, opts={}){
  if(cap.sample || MODE==="claude"){
    if(!cap.sample) throw new Error("이 화면에서는 AI를 쓸 수 없어요.");
    const msgs = messages.map((m,i)=>({role:m.role, content: i===0 ? "[COACH INSTRUCTIONS]\n"+system+"\n[/COACH INSTRUCTIONS]\n\n"+m.content : m.content}));
    try{
      const r = await cap.sample(msgs, {modelTier: opts.tier||"default", cache:false});
      return r.text;
    }catch(e){
      if(e && e.code==="not_granted") throw new Error("AI 사용이 허용되지 않았어요. 다시 누르면 허용 창이 떠요.");
      if(e && e.code==="rate_limited") throw new Error("잠시 사용량이 많아요. 조금 뒤에 다시 해 주세요.");
      throw new Error((e && e.message) || "AI 호출 실패");
    }
  }
  if(!hasKey()) throw new Error("설정 탭에서 AI 키를 넣어 주세요 (Google Gemini·Groq·OpenRouter 키는 모두 무료).");
  return aiChain(system, messages, opts);
}

/* ---- 여러 AI 업체를 차례로 시도 (폴백 체인) ---- */
let lastAI = null;                       // {name, model, skipped:[{name,why}], offline}
const aiCool = {};                       // 혼잡·한도 초과 업체는 1분 동안 뒤로 미룸
class AIErr extends Error{ constructor(msg, status, why){ super(msg); this.status=status; this.why=why; } }
async function fetchJSON(url, init, label){
  const ctl = new AbortController(); const t = setTimeout(()=>ctl.abort(), 30000);
  let res, data;
  try{ res = await fetch(url, Object.assign({}, init, {signal: ctl.signal})); data = await res.json().catch(()=>({})); }
  catch(e){ throw new AIErr(label+" 연결 실패", 0, e.name==="AbortError" ? "응답 시간 초과" : "연결 실패"); }
  finally{ clearTimeout(t); }
  if(!res.ok){
    const msg = (data.error && (data.error.message || data.error)) || (label+" 오류 "+res.status);
    const why = res.status===503||res.status===502||res.status===529 ? "서버 혼잡"
      : res.status===429 ? "사용량 한도"
      : res.status===401||res.status===403||(res.status===400 && /api key/i.test(String(msg))) ? "키 오류"
      : res.status===404 ? "모델 없음" : "오류 "+res.status;
    throw new AIErr(String(msg), res.status, why);
  }
  return data;
}
async function callGemini(model, system, messages){
  const data = await fetchJSON("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent", {
    method:"POST", headers:{"content-type":"application/json","x-goog-api-key":secret.geminiKey},
    body: JSON.stringify({systemInstruction:{parts:[{text:system}]}, contents: messages.map(m=>({role: m.role==="assistant"?"model":"user", parts:[{text: String(m.content)}]}))})
  }, "Gemini");
  const parts = (((data.candidates||[])[0]||{}).content||{}).parts||[];
  return parts.filter(x=>x.text && !x.thought).map(x=>x.text).join("");
}
async function callOpenAI(url, key, model, system, messages, opts, label, extra){
  const data = await fetchJSON(url, {
    method:"POST", headers:Object.assign({"content-type":"application/json","authorization":"Bearer "+key}, extra||{}),
    body: JSON.stringify({model, max_tokens: opts.maxTokens||1500, temperature:0.4,
      messages:[{role:"system", content:system}].concat(messages.map(m=>({role:m.role, content:String(m.content)})))})
  }, label);
  const msg = ((data.choices||[])[0]||{}).message||{};
  return String(msg.content||"").replace(/<think>[\s\S]*?<\/think>/g,"").trim();
}
// OpenRouter 무료 모델은 자주 바뀌므로 목록을 받아 좋은 순서로 고름 (하루 캐시)
const OR_CACHE = "edward-coach-or-free-v1";
const OR_PREF = [/llama-3\.3-70b/i, /gpt-oss-120b/i, /deepseek-(chat|v3)/i, /qwen.*(72b|235b|-max)/i, /gemma-[34].*(27b|31b)/i, /mistral-(small|medium)/i, /llama-4/i, /nemotron/i];
async function orFreeModels(){
  try{ const c = JSON.parse(localStorage.getItem(OR_CACHE)||"null"); if(c && Date.now()-c.t < 864e5 && c.ids.length) return c.ids; }catch(e){}
  let ids = [];
  try{
    const r = await fetch("https://openrouter.ai/api/v1/models"); const d = await r.json();
    ids = (d.data||[]).filter(m => /:free$/.test(m.id) && (m.context_length||0) >= 8000 && !/vision|image|embed|audio/i.test(m.id)).map(m=>m.id);
    const rank = id => { const i = OR_PREF.findIndex(rx=>rx.test(id)); return i<0 ? 99 : i; };
    ids.sort((a,b)=>rank(a)-rank(b));
    try{ localStorage.setItem(OR_CACHE, JSON.stringify({t:Date.now(), ids})); }catch(e){}
  }catch(e){}
  return ids.length ? ids : ["meta-llama/llama-3.3-70b-instruct:free"];
}
async function callProvider(p, system, messages, opts){
  if(p.id==="gemini") return {text: await callGemini(p.model(), system, messages), model:p.model()};
  if(p.id==="groq") return {text: await callOpenAI("https://api.groq.com/openai/v1/chat/completions", secret.groqKey, p.model(), system, messages, opts, "Groq"), model:p.model()};
  if(p.id==="openrouter"){
    const hdr = {"HTTP-Referer": location.origin, "X-Title": "Edward English Coach"};
    const list = secret.orModel ? [secret.orModel] : (await orFreeModels()).slice(0,3);
    let last;
    for(const m of list){   // 무료 모델 하나가 막히면 다른 무료 모델로
      try{ return {text: await callOpenAI("https://openrouter.ai/api/v1/chat/completions", secret.orKey, m, system, messages, opts, "OpenRouter", hdr), model:m.replace(/:free$/,"")}; }
      catch(e){ last = e; if(e.why==="키 오류") break; if(e.why==="모델 없음") try{ localStorage.removeItem(OR_CACHE); }catch(_){} }
    }
    throw last;
  }
  const data = await fetchJSON("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{"content-type":"application/json","x-api-key":secret.apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
    body: JSON.stringify({model: p.model(), max_tokens: opts.maxTokens||1200, system, messages})
  }, "Claude");
  return {text:(data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join(""), model:p.model()};
}
async function aiChain(system, messages, opts){
  const now = Date.now();
  const list = AI_CHAIN.filter(p=>p.key());
  const order = list.filter(p=>!(aiCool[p.id]>now)).concat(list.filter(p=>aiCool[p.id]>now));
  const skipped = [];
  for(const p of order){
    try{
      const r = await callProvider(p, system, messages, opts);
      if(!r.text || !r.text.trim()) throw new AIErr(p.name+" 답이 비어 있음", 0, "빈 답");
      delete aiCool[p.id];
      lastAI = {name:p.name, model:r.model, skipped, offline:false, paid:!!p.paid, t:Date.now()};
      showAIUsed(true);
      return r.text;
    }catch(e){
      const why = e.why || "오류";
      if(why==="서버 혼잡" || why==="사용량 한도" || why==="응답 시간 초과") aiCool[p.id] = Date.now()+60000;
      skipped.push({name:p.name, why});
    }
  }
  lastAI = {name:"", model:"", skipped, offline:true, t:Date.now()};
  showAIUsed(false);
  const err = new Error("연결된 AI가 모두 응답하지 않아요 ("+skipped.map(x=>x.name+": "+x.why).join(", ")+"). 잠시 뒤 다시 해 주세요.");
  err.allFailed = true;
  throw err;
}
// 어떤 AI가 답했는지 한 줄 표시용
function aiUsedText(){
  if(!lastAI) return "";
  if(lastAI.offline) return "🤖 오프라인 자동 판정"+(lastAI.skipped.length?" · "+lastAI.skipped.map(x=>x.name+" "+x.why).join(", "):"");
  return "🤖 "+lastAI.name+" · "+lastAI.model+(lastAI.skipped.length?" · "+lastAI.skipped.map(x=>x.name+" "+x.why).join(", ")+" → 전환":"");
}
function aiUsedHTML(){ const t = aiUsedText(); return t ? '<div class="ai-used'+(lastAI && (lastAI.skipped.length||lastAI.offline)?" switched":"")+'">'+esc(t)+'</div>' : ""; }
function showAIUsed(ok){
  if(ok && lastAI && lastAI.skipped.length) toast(lastAI.skipped.map(x=>x.name).join("·")+" "+lastAI.skipped[0].why+" → "+lastAI.name+"(으)로 처리했어요");
  try{ renderPill(); renderApiCard(); }catch(e){}
}
async function aiJSON(system, messages, opts){
  const t = await ai(system, messages, opts);
  try{ return parseJSON(t); }
  catch(e){
    const t2 = await ai(system, messages.concat([{role:"assistant", content:t},{role:"user", content:"That was not valid JSON. Reply again with ONLY the JSON object."}]), opts);
    return parseJSON(t2);
  }
}

let LEARNER = "Edward is a Korean technical marketing professional at a memory semiconductor company (memory and automotive semiconductor solutions), mostly working with Chinese and global customers. Intermediate English: fluent enough to talk, but with fossilized errors.";
const TAGS = CORE.map(c=>c.id+' ("'+c.wrong+'" → "'+c.right+'")').join("; ");

function coachSystem(context){
  return LEARNER+"\n\n"+context+"\n\nHis known recurring errors (use the id as tag when one matches): "+TAGS+".\n\n"+
  "For EACH learner message:\n1) Find real grammar, word-choice and collocation errors a native business speaker would fix. Ignore capitalization and missing punctuation (input may come from speech recognition). Do not nitpick style when the sentence is natural.\n2) Give a natural rewrite of the whole message.\n3) Continue the conversation naturally in plain, natural English: 1–3 short sentences, ending with ONE question that invites a longer answer.\n\n"+
  'Respond with ONLY this JSON object, no markdown:\n{"corrections":[{"wrong":"exact wrong fragment","right":"corrected fragment","why":"짧은 한국어 설명 (25자 이내)","tag":"matching id or other"}],"better":"natural rewrite, or \\"\\" if already natural","reply":"your reply","tip":"optionally one useful business expression for this moment with Korean meaning, e.g. \\"bear with us — 양해해 주세요\\", or \\"\\""}\nAt most 4 corrections, most important first. If there are no errors, corrections is [] and better is "".';
}

/* ============ Voice ============ */
let speaking=false;
function speak(text){
  if(!text) return;
  const rate = Number(state.settings.rate)||1;
  if(MODE==="claude" && cap.tts){ cap.tts.speak(String(text).slice(0,2000), {language:"en", rate}).catch(()=>{}); return; }
  if("speechSynthesis" in window){
    try{
      speechSynthesis.cancel();
      const u=new SpeechSynthesisUtterance(text); u.lang="en-US"; u.rate=rate;
      const v=speechSynthesis.getVoices().find(v=>/en[-_]US/i.test(v.lang)&&/Google|Samantha|Natural/i.test(v.name)) || speechSynthesis.getVoices().find(v=>/^en/i.test(v.lang));
      if(v) u.voice=v;
      speechSynthesis.speak(u);
    }catch(e){}
  }
}
function canSpeak(){ return (MODE==="claude" && !!cap.tts) || (MODE!=="claude" && "speechSynthesis" in window); }
function webSR(){ return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
function canListen(){ return (MODE==="claude" && !!cap.dictation) || (MODE!=="claude" && !!webSR()); }

let activeMic = null;
function wireMic(btn, input){
  btn.hidden = !canListen();
  if(btn._wired) return; btn._wired=true;
  btn.addEventListener("click", ()=>{
    if(activeMic && activeMic.btn===btn){ activeMic.stop(); return; }
    if(activeMic) activeMic.stop();
    const base = input.value ? input.value.replace(/\s*$/," ") : "";
    if(MODE==="claude" && cap.dictation){
      const d = cap.dictation; let finalText = "";
      const offs=[];
      const setVal = (partial)=>{ input.value = base + finalText + (partial||""); };
      offs.push(d.onPartial(({text})=>setVal(text)));
      offs.push(d.onFinal(({text})=>{ finalText += (text||"")+" "; setVal(""); }));
      offs.push(d.onState(({state:st})=>{ if(st==="idle"){ btn.classList.remove("listening"); offs.forEach(f=>{try{typeof f==="function"&&f();}catch(e){}}); activeMic=null; } else if(st==="listening"){ btn.classList.add("listening"); } }));
      activeMic = {btn, stop:()=>{ d.stop().catch(()=>{}); }};
      d.start().catch(e=>{
        btn.classList.remove("listening"); activeMic=null;
        if(e && e.code==="not_granted"){ btn.hidden=true; toast("마이크 사용이 허용되지 않았어요. 타이핑으로 해 주세요."); }
      });
      return;
    }
    const SR = webSR(); if(!SR) return;
    const rec = new SR(); rec.lang="en-US"; rec.interimResults=true; rec.continuous=true;
    let finalText="";
    rec.onresult = ev=>{ let interim=""; for(let i=ev.resultIndex;i<ev.results.length;i++){ const r=ev.results[i]; if(r.isFinal) finalText+=r[0].transcript+" "; else interim+=r[0].transcript; } input.value = base+finalText+interim; };
    rec.onend = ()=>{ btn.classList.remove("listening"); activeMic=null; };
    rec.onerror = e=>{ if(e.error==="not-allowed") toast("브라우저에서 마이크를 허용해 주세요."); };
    activeMic = {btn, stop:()=>rec.stop()};
    btn.classList.add("listening"); rec.start();
  });
}
function stopMic(){ if(activeMic){ activeMic.stop(); } }

/* ============ Rendering helpers ============ */
function fixHTML(res){
  const cs = (res.corrections||[]).filter(c=>c && c.wrong);
  let h = "";
  if(cs.length){
    h += '<div class="fix">'+cs.map(c=>'<div class="fix-line"><span class="del">'+esc(c.wrong)+'</span><span aria-hidden="true">→</span><span class="ins">'+esc(c.right)+'</span><span class="why">'+esc(c.why)+'</span></div>').join("");
    if(res.better) h += '<div class="better"><b>NATURAL</b>'+esc(res.better)+'</div>';
    h += '</div>';
  } else if(res.better){
    h += '<div class="fix clean"><div class="better"><b>MORE NATURAL</b>'+esc(res.better)+'</div></div>';
  } else {
    h += '<div class="fix clean"><div class="fix-line"><span class="ins">✓ 자연스러운 문장이에요</span></div></div>';
  }
  return h;
}
function speakerBtn(text){
  if(!canSpeak()) return "";
  return '<button class="btn ghost icon" type="button" data-speak="'+esc(text)+'" aria-label="듣기" title="듣기">🔊</button>';
}
document.addEventListener("click", e=>{
  const b = e.target.closest("[data-speak]"); if(b){ speak(b.getAttribute("data-speak")); }
  const c = e.target.closest("[data-copy]"); if(c){ copyText(c.getAttribute("data-copy")); }
});
async function copyText(t){
  try{ await navigator.clipboard.writeText(t); toast("복사했어요"); }
  catch(e){ toast("복사가 막혀 있어요. 길게 눌러 직접 복사해 주세요."); }
}

/* ============ Conversation engine (shared by chat + roleplay) ============ */
function makeConvo(o){
  const C = {history:[], busy:false, mistakes:0, turns:0, o};
  C.log = $(o.log); C.input = $(o.input); C.send=$(o.send);
  C.addMe = (text)=>{
    const div=document.createElement("div"); div.className="msg me";
    div.innerHTML='<div class="bubble">'+esc(text)+'</div><div class="pending typing">교정 중…</div>';
    C.log.appendChild(div); C.log.scrollTop=C.log.scrollHeight; return div;
  };
  C.addAI = (text, tip)=>{
    const div=document.createElement("div"); div.className="msg ai";
    div.innerHTML='<div class="bubble">'+esc(text)+'</div><div class="meta">'+speakerBtn(text)+'</div>'+(tip?'<div class="tip">💡 '+esc(tip)+'</div>':"")+(MODE!=="claude"?aiUsedHTML():"");
    C.log.appendChild(div); C.log.scrollTop=C.log.scrollHeight;
    if(state.settings.autoSpeak) speak(text);
  };
  C.submit = async ()=>{
    const text = C.input.value.trim();
    if(!text || C.busy) return;
    if(!aiReady()){ toast(MODE==="claude"?"AI 연결을 기다리는 중이에요.":"설정 탭에서 AI 키를 넣어 주세요 (Gemini·Groq·OpenRouter 모두 무료)."); return; }
    stopMic();
    C.busy=true; C.send.disabled=true; C.input.value="";
    const me = C.addMe(text);
    C.history.push({role:"user", content:text});
    try{
      const res = await aiJSON(coachSystem(o.context()), C.history.slice(-15));
      me.querySelector(".pending").outerHTML = fixHTML(res);
      (res.corrections||[]).forEach(c=>{ addCorrection(c, "app"); C.mistakes++; });
      C.turns++; markPractice(); save(); renderStats();
      const reply = res.reply || "Could you tell me more?";
      C.history.push({role:"assistant", content:reply});
      C.addAI(reply, res.tip);
    }catch(e){
      me.querySelector(".pending").outerHTML = '<div class="err">'+esc(e.message)+'</div>';
      C.history.pop();
    }
    C.busy=false; C.send.disabled=false; C.input.focus();
  };
  C.send.addEventListener("click", C.submit);
  C.input.addEventListener("keydown", e=>{ if(e.key==="Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); C.submit(); } });
  C.reset = ()=>{ C.history=[]; C.mistakes=0; C.turns=0; C.log.innerHTML=""; };
  return C;
}

/* ----- Free chat ----- */
let chatTopic = "";
const chat = makeConvo({log:"#chatLog", input:"#chatInput", send:"#chatSend",
  context:()=>"Mode: free conversation practice. Be a warm, curious conversation partner."+(chatTopic?" Suggested topic: "+chatTopic+".":"")});
function chatGreeting(){
  chat.reset();
  const opener = chatTopic ? "Let's talk about this: "+chatTopic+". Where would you like to start?" : "Hi Edward! How has your week been so far? Tell me about one thing that happened.";
  chat.history.push({role:"user", content:"(Session start. Greet me.)"});
  chat.history.push({role:"assistant", content:opener});
  chat.addAI(opener);
}
function renderChatTopics(){
  $("#chatTopics").innerHTML = CHAT_TOPICS.map(t=>'<button type="button" class="chip" aria-pressed="'+(t===chatTopic)+'" data-topic="'+esc(t)+'">'+esc(t)+'</button>').join("");
}
$("#chatTopics").addEventListener("click", e=>{
  const b=e.target.closest("[data-topic]"); if(!b) return;
  chatTopic = (chatTopic===b.dataset.topic) ? "" : b.dataset.topic;
  renderChatTopics(); chatGreeting();
});
$("#chatReset").addEventListener("click", ()=>{ if(chat.turns) addSession({kind:"chat", title:"교정 대화"+(chatTopic?" · "+chatTopic:""), summary:chat.turns+"문장 · 교정 "+chat.mistakes+"개"}); save(); chatGreeting(); renderSessions(); });

/* ----- Roleplay ----- */
let scenario = SCENARIOS[0];
const role = makeConvo({log:"#roleLog", input:"#roleInput", send:"#roleSend",
  context:()=>"Mode: business role-play. Stay fully in character as described, and keep replies realistic and concise. "+scenario.role+" Edward plays himself (Samsung memory technical marketing)."});
function renderRoles(){
  $("#roleChips").innerHTML = SCENARIOS.map(s=>'<button type="button" class="chip" aria-pressed="'+(s.id===scenario.id)+'" data-sc="'+s.id+'">'+esc(s.title)+'</button>').join("");
  $("#roleDesc").textContent = scenario.desc;
}
$("#roleChips").addEventListener("click", e=>{
  const b=e.target.closest("[data-sc]"); if(!b) return;
  scenario = SCENARIOS.find(s=>s.id===b.dataset.sc); renderRoles();
});
$("#roleStart").addEventListener("click", async ()=>{
  if(!aiReady()){ toast(MODE==="claude"?"AI 연결을 기다리는 중이에요.":"설정 탭에서 AI 키를 넣어 주세요 (Gemini·Groq·OpenRouter 모두 무료)."); return; }
  role.reset(); $("#roleReport").innerHTML="";
  const btn=$("#roleStart"); btn.disabled=true; btn.textContent="상대방 입장 중…";
  try{
    const sys = "You are role-playing for an English learner. "+scenario.role+" "+LEARNER+' Start the meeting with your first line in character (1–2 sentences). Respond with ONLY JSON: {"reply":"..."}';
    const r = await aiJSON(sys, [{role:"user", content:"Start the role-play now."}]);
    role.history.push({role:"user", content:"(Role-play start. Open the meeting in character.)"});
    role.history.push({role:"assistant", content:r.reply});
    role.addAI(r.reply);
    $("#roleEnd").disabled=false;
    role.input.focus();
  }catch(e){ toast(e.message); }
  btn.disabled=false; btn.textContent="이 상황으로 다시 시작";
});
$("#roleEnd").addEventListener("click", async ()=>{
  if(role.turns<1){ toast("한 번 이상 대답한 뒤에 끝내 주세요."); return; }
  const btn=$("#roleEnd"); btn.disabled=true; btn.textContent="리포트 만드는 중…";
  const transcript = role.history.slice(2).map(m=>(m.role==="user"?"EDWARD: ":"PARTNER: ")+m.content).join("\n");
  try{
    const sys = LEARNER+" You are his business English coach. Review this role-play ("+scenario.title+"). Be specific and encouraging but honest."+
      ' Respond with ONLY JSON: {"score":1-10,"summary_ko":"2문장 총평 (한국어)","strengths_ko":["잘한 점",...max 2],"top_mistakes":[{"wrong":"","right":"","why":"한국어"}],"expressions":[{"en":"useful phrase for this situation","ko":"뜻"}],"model_answer":"a stronger version of Edward\'s weakest answer, 2-4 sentences"}. top_mistakes max 3, expressions exactly 5.';
    const r = await aiJSON(sys, [{role:"user", content:transcript}], {tier:"complex"});
    const h = '<div class="row"><span class="tag done">점수 '+esc(r.score)+'/10</span></div>'+
      '<div>'+esc(r.summary_ko)+'</div>'+
      ((r.strengths_ko||[]).length?'<div><h3>잘한 점</h3><ul>'+r.strengths_ko.map(s=>'<li>'+esc(s)+'</li>').join("")+'</ul></div>':"")+
      ((r.top_mistakes||[]).length?'<div><h3>꼭 고칠 것</h3>'+fixHTML({corrections:r.top_mistakes})+'</div>':"")+
      ((r.expressions||[]).length?'<div><h3>이 상황에서 쓸 표현</h3><div class="expr">'+r.expressions.map(x=>'<div class="en">'+esc(x.en)+' '+speakerBtn(x.en)+'</div><div class="ko">'+esc(x.ko)+'</div>').join("")+'</div></div>':"")+
      (r.model_answer?'<div><h3>더 강한 답변 예시</h3><div class="fix clean"><div class="better">'+esc(r.model_answer)+' '+speakerBtn(r.model_answer)+'</div></div></div>':"");
    $("#roleReport").innerHTML = h + aiUsedHTML();
    addSession({kind:"roleplay", title:"롤플레이 · "+scenario.title, summary:"점수 "+r.score+"/10 · "+(r.summary_ko||"")});
    save(); renderSessions();
  }catch(e){ toast(e.message); }
  btn.disabled=false; btn.textContent="세션 끝내기 · 리포트";
});

/* ============ Drill ============ */
let drill = {queue:[], i:0, item:null, phase:"idle", ko:"", answer:"", done:0, ok:0};
function buildQueue(){
  const t = todayStr();
  const items = allItems().filter(x=>!x.mastered && x.due<=t)
    .sort((a,b)=>(a.box-b.box) || (b.count-a.count));
  return items.slice(0,8);
}
function renderDrill(){
  const body=$("#drillBody");
  const total=drill.queue.length;
  $("#drillPos").textContent = total ? Math.min(drill.i+1,total)+" / "+total : "";
  $("#drillBar").style.width = total ? (drill.i/total*100)+"%" : "0%";
  if(drill.phase==="idle"){
    if(!allItems().length){ body.innerHTML='<div>아직 실수 노트가 비어 있어요.</div><div class="hint">교정 대화를 하거나 Daniel 수업 탭에서 피드백을 가져오면, 지적된 표현으로 매일 훈련 문제가 만들어져요.</div>'; return; }
    const q=buildQueue();
    body.innerHTML = q.length
      ? '<div>오늘 복습할 표현이 <b>'+q.length+'개</b> 있어요. 한국어 문장을 영어로 말하거나 써 보세요. 5분이면 끝나요.</div>'+
        '<div class="hint">'+q.slice(0,4).map(x=>'<span class="del">'+esc(x.wrong)+'</span>').join(" · ")+(q.length>4?" …":"")+'</div>'+
        '<div class="row"><button class="btn primary" id="drillStart" type="button">훈련 시작</button></div>'
      : '<div>오늘 복습은 끝났어요. 👏 내일 다시 나오는 표현이 준비돼요.</div><div class="row"><button class="btn" id="drillExtra" type="button">그래도 더 연습하기</button></div>';
    const s=$("#drillStart"); if(s) s.onclick=()=>startDrill(q);
    const x=$("#drillExtra"); if(x) x.onclick=()=>startDrill(allItems().filter(i=>!i.mastered).sort((a,b)=>b.count-a.count).slice(0,6));
    return;
  }
  if(drill.phase==="finished"){
    body.innerHTML = '<div><b>'+drill.done+'문제 중 '+drill.ok+'개</b> 맞혔어요.</div><div class="hint">틀린 표현은 내일 다시 나와요. 맞힌 표현은 점점 간격이 벌어져요.</div><div class="row"><button class="btn" id="drillAgain" type="button">처음으로</button></div>';
    $("#drillAgain").onclick=()=>{ drill.phase="idle"; renderDrill(); };
    $("#drillBar").style.width="100%";
    return;
  }
  const it=drill.item;
  let h = '<div class="target">TARGET · <span class="del">'+esc(it.wrong)+'</span> → <span class="ins">'+esc(it.right)+'</span></div>'+
          '<div class="drill-q">'+(drill.ko?esc(drill.ko):'<span class="typing">문제 만드는 중…</span>')+'</div>';
  if(drill.phase==="ask"){
    h += '<div class="composer"><textarea id="drillInput" class="grow" placeholder="영어로 말하거나 써 보세요" aria-label="영어 답"></textarea><button class="btn icon mic" id="drillMic" type="button" aria-label="말하기" title="말하기" hidden>🎙</button></div>'+
         '<div class="row"><button class="btn primary" id="drillCheck" type="button">'+"채점"+'</button><button class="btn ghost" id="drillSkip" type="button">건너뛰기</button></div>';
  }
  if(drill.phase==="graded"){ h += drill.resultHTML; }
  body.innerHTML = h;
  if(drill.phase==="ask"){
    const inp=$("#drillInput"); inp.focus();
    wireMic($("#drillMic"), inp);
    inp.addEventListener("keydown", e=>{ if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){ e.preventDefault(); checkDrill(); } });
    $("#drillCheck").onclick=checkDrill;
    $("#drillSkip").onclick=()=>nextDrill();
  }
  if(drill.phase==="graded"){
    const n=$("#drillNext"); if(n){ n.onclick=nextDrill; n.focus(); }
    const sg=$("#selfOk"), sb=$("#selfNo");
    if(sg) sg.onclick=()=>{ recordAttempt(it.id,true); drill.ok++; drill.done++; save(); nextDrill(true); };
    if(sb) sb.onclick=()=>{ recordAttempt(it.id,false); drill.done++; save(); nextDrill(true); };
  }
}
async function startDrill(q){
  if(!q.length) return;
  drill={queue:q, i:0, item:null, phase:"ask", ko:"", answer:"", done:0, ok:0};
  loadDrillItem();
}
async function loadDrillItem(){
  const it = drill.queue[drill.i]; drill.item=it; drill.phase="ask";
  const fresh = aiReady() && (state.progress[it.id]?.lastSeen);  // first time uses the built-in sentence
  drill.ko = (!fresh && it.ko) ? it.ko : ""; drill.answer = (!fresh && it.answer) ? it.answer : "";
  renderDrill();
  if(!drill.ko){
    if(!aiReady()){ drill.ko = it.ko || ('“'+it.right+'”를 써서 문장을 하나 만들어 보세요.'); drill.answer = it.answer || it.right; renderDrill(); return; }
    try{
      const r = await aiJSON(LEARNER+' Create ONE translation drill. Target: the learner tends to say "'+it.wrong+'" instead of "'+it.right+'". Write a natural Korean sentence from his real work life (semiconductor marketing, customers, meetings, family life is also fine) whose natural English translation REQUIRES the correct form "'+it.right+'". Vary topics. Respond with ONLY JSON: {"ko":"한국어 문장","answer":"model English answer"}',
        [{role:"user", content:"New drill, different from: "+(it.ko||"")}], {tier:"quick"});
      drill.ko=r.ko; drill.answer=r.answer;
    }catch(e){ drill.ko = it.ko || ('“'+it.right+'”를 써서 문장을 만들어 보세요.'); drill.answer = it.answer || it.right; }
    renderDrill();
  }
}
async function checkDrill(){
  const inp=$("#drillInput"); const ans=(inp?.value||"").trim();
  const it=drill.item;
  stopMic();
  if(!ans){ toast("답을 먼저 말하거나 써 주세요."); return; }
  if(!aiReady()){ offlineGrade(it, ans, ""); return; }
  const btn=$("#drillCheck"); btn.disabled=true; btn.textContent="채점 중…";
  try{
    const r = await aiJSON(LEARNER+' Grade a translation drill. Target pattern: correct form "'+it.right+'" (common error: "'+it.wrong+'"). Korean prompt: "'+drill.ko+'". Model answer: "'+drill.answer+'". Pass = the learner used the target pattern correctly AND the sentence has no serious grammar error (small wording differences from the model are fine; ignore punctuation/capitalization). Respond with ONLY JSON: {"pass":true|false,"corrected":"learner sentence minimally fixed (same as input if perfect)","why":"한국어 1~2문장 설명","other":[{"wrong":"","right":"","why":"한국어"}]}  (other = other errors not about the target, max 2)',
      [{role:"user", content:"Learner answer: "+ans}], {tier:"quick"});
    recordAttempt(it.id, !!r.pass); drill.done++; if(r.pass) drill.ok++;
    (r.other||[]).forEach(c=>addCorrection(c,"app"));
    save();
    drill.phase="graded";
    drill.resultHTML = '<div class="bubble" style="background:var(--accent-soft)">'+esc(ans)+'</div>'+
      '<div class="fix '+(r.pass?"clean":"")+'"><div class="fix-line"><span class="'+(r.pass?"ins":"del")+'">'+(r.pass?"✓ 통과":"✗ 다시 연습")+'</span></div>'+
      (r.corrected && norm(r.corrected)!==norm(ans)?'<div class="better"><b>FIXED</b>'+esc(r.corrected)+'</div>':"")+
      '<div class="why">'+esc(r.why)+'</div>'+
      ((r.other||[]).length?r.other.map(c=>'<div class="fix-line"><span class="del">'+esc(c.wrong)+'</span>→<span class="ins">'+esc(c.right)+'</span><span class="why">'+esc(c.why)+'</span></div>').join(""):"")+
      '<div class="better"><b>MODEL</b>'+esc(drill.answer)+' '+speakerBtn(drill.answer)+'</div></div>'+
      (MODE!=="claude"?aiUsedHTML():"")+
      '<div class="row"><button class="btn primary" id="drillNext" type="button">다음 →</button></div>';
    renderDrill(); renderStats();
  }catch(e){
    if(e.allFailed){ offlineGrade(it, ans, "AI가 모두 혼잡해서 자동 판정으로 채점했어요."); return; }
    toast(e.message); btn.disabled=false; btn.textContent="채점";
  }
}
// AI 없이도 자동 판정: 목표 표현을 썼고 틀린 표현이 없으면 통과
function offlineGrade(it, ans, note){
    const r = ruleJudge(it, ans);
    recordAttempt(it.id, r.pass); drill.done++; if(r.pass) drill.ok++; save();
    drill.phase="graded";
    drill.resultHTML = '<div class="bubble" style="background:var(--accent-soft)">'+esc(ans)+'</div>'+
      '<div class="fix '+(r.pass?"clean":"")+'"><div class="fix-line"><span class="'+(r.pass?"ins":"del")+'">'+(r.pass?"✓ 통과":"✗ 다시 연습")+'</span><span class="why">자동 판정 · '+esc(r.why)+'</span></div>'+
      '<div class="better"><b>MODEL</b>'+esc(drill.answer)+' '+speakerBtn(drill.answer)+'</div><div class="why">'+esc(it.why)+'</div></div>'+
      (note ? '<div class="ai-used switched">'+esc(aiUsedText() || "🤖 오프라인 자동 판정")+'</div><div class="hint">'+esc(note)+'</div>'
            : '<div class="ai-used">🤖 오프라인 자동 판정</div><div class="hint">설정 탭에서 무료 AI 키(Gemini·Groq·OpenRouter)를 넣으면 AI가 문장 전체의 문법·철자까지 채점해요.</div>')+
      '<div class="row"><button class="btn primary" id="drillNext" type="button">다음 →</button></div>';
    renderDrill(); renderStats();
}
// AI가 없을 때 쓰는 규칙 판정 (목표 표현 포함 + 흔한 틀린 표현 없음)
function ruleJudge(it, ans){
  const nz = t => " "+String(t||"").toLowerCase().replace(/[’']/g,"'").replace(/[^a-z0-9' ]+/g," ").replace(/\s+/g," ").trim()+" ";
  const forms = t => String(t||"").split("/").map(x=>x.replace(/\(.*?\)/g," ").replace(/…|\.\.\./g," ")).map(nz).filter(x=>x.trim());
  const a = nz(ans), rights = forms(it.right), wrongs = forms(it.wrong);
  const hasRight = rights.some(r => a.includes(r)), hasWrong = wrongs.some(w => a.includes(w));
  if(hasWrong) return {pass:false, why:"‘"+it.wrong+"’ 표현이 그대로 들어 있어요"};
  if(!hasRight) return {pass:false, why:"‘"+it.right+"’ 표현이 안 보여요"};
  return {pass:true, why:"‘"+it.right+"’를 맞게 썼어요"};
}
function nextDrill(){
  drill.i++;
  if(drill.i>=drill.queue.length){
    drill.phase="finished";
    addSession({kind:"drill", title:"반복 실수 훈련", summary:drill.done+"문제 중 "+drill.ok+"개 통과"});
    save(); renderDrill(); renderStats(); renderSessions(); return;
  }
  loadDrillItem();
}

/* ============ Daniel ============ */
$("#prepGo").addEventListener("click", async ()=>{
  const topic=$("#prepTopic").value.trim();
  if(!topic){ toast("주제를 먼저 적어 주세요."); return; }
  if(!aiReady()){ toast(MODE==="claude"?"AI 연결을 기다리는 중이에요.":"설정 탭에서 AI 키를 넣어 주세요 (Gemini·Groq·OpenRouter 모두 무료)."); return; }
  const btn=$("#prepGo"); btn.disabled=true; btn.textContent="만드는 중…";
  try{
    const r = await aiJSON(LEARNER+" He has a 25-minute online class once a week with his tutor Daniel. Help him prepare so the class is dense and useful. Topic: "+topic+
      '. Respond with ONLY JSON: {"opener":"a 4-5 sentence natural spoken-English draft Edward could say to open the topic, at upper-intermediate level","questions":["3 questions Daniel is likely to ask"],"expressions":[{"en":"","ko":""}],"message":"a short friendly KakaoTalk message to Daniel proposing this topic and asking him to correct mistakes strictly and send 3-5 written corrections after class"}. expressions exactly 6, useful for this topic.',
      [{role:"user", content:topic}]);
    $("#prepOut").innerHTML =
      '<div><h3>첫 발언 초안 (소리 내서 3번 읽기)</h3><div class="fix clean"><div class="better">'+esc(r.opener)+' '+speakerBtn(r.opener)+'</div></div></div>'+
      '<div><h3>Daniel이 물어볼 질문</h3><ol>'+(r.questions||[]).map(q=>'<li>'+esc(q)+'</li>').join("")+'</ol></div>'+
      '<div><h3>핵심 표현</h3><div class="expr">'+(r.expressions||[]).map(x=>'<div class="en">'+esc(x.en)+'</div><div class="ko">'+esc(x.ko)+'</div>').join("")+'</div></div>'+
      '<div><h3>Daniel에게 보낼 메시지</h3><div class="bubble" style="background:var(--bg);border:1px solid var(--line)">'+esc(r.message)+'</div><div class="row" style="margin-top:8px"><button class="btn" type="button" data-copy="'+esc(r.message)+'">메시지 복사</button></div></div>'+aiUsedHTML();
    addSession({kind:"daniel", title:"수업 준비 · "+topic, summary:"예상 질문 "+(r.questions||[]).length+"개 · 표현 "+(r.expressions||[]).length+"개"});
    markPractice(); save(); renderSessions(); renderStats();
  }catch(e){ toast(e.message); }
  btn.disabled=false; btn.textContent="준비 자료 만들기";
});
$("#notesGo").addEventListener("click", async ()=>{
  const notes=$("#classNotes").value.trim();
  if(!notes){ toast("기억나는 걸 먼저 적어 주세요."); return; }
  if(!aiReady()){ toast("AI 없이 넣으려면 아래 ‘직접 한 줄씩 넣기’를 써 주세요."); return; }
  const btn=$("#notesGo"); btn.disabled=true; btn.textContent="정리 중…";
  try{
    const r = await aiJSON(LEARNER+" These are his rough notes (Korean/English mixed) about mistakes his tutor Daniel corrected in class. Extract each mistake. Known recurring error ids: "+TAGS+'. Respond with ONLY JSON: {"items":[{"wrong":"","right":"","why":"짧은 한국어 설명","tag":"matching id or other"}]}',
      [{role:"user", content:notes}], {tier:"quick"});
    const items=(r.items||[]).filter(x=>x.wrong&&x.right);
    items.forEach(c=>addCorrection(c,"daniel"));
    addSession({kind:"daniel", title:"Daniel 수업 기록", summary:"교정 "+items.length+"개 저장: "+items.map(x=>x.right).slice(0,3).join(", ")});
    save(); renderAll();
    $("#classNotes").value="";
    $("#notesStatus").textContent = items.length+"개를 실수 노트에 넣었어요. "+aiUsedText();
  }catch(e){ toast(e.message); }
  btn.disabled=false; btn.textContent="정리해서 저장";
});
$("#manAdd").addEventListener("click", ()=>{
  const w=$("#manWrong").value.trim(), r=$("#manRight").value.trim();
  if(!w||!r){ toast("틀린 표현과 맞는 표현을 둘 다 적어 주세요."); return; }
  addCorrection({wrong:w, right:r, why:$("#manWhy").value.trim()}, "daniel");
  save(); renderAll();
  $("#manWrong").value=$("#manRight").value=$("#manWhy").value="";
  toast("실수 노트에 추가했어요");
});
const KIND_LABEL={chat:"대화", roleplay:"롤플레이", drill:"훈련", daniel:"Daniel"};
function renderSessions(){
  const el=$("#sessList");
  if(!state.sessions.length){ el.innerHTML='<div class="empty">아직 기록이 없어요. 훈련이나 대화를 하면 여기에 쌓여요.</div>'; return; }
  el.innerHTML = state.sessions.slice(0,15).map(s=>'<div class="sess"><div class="row"><span class="tag">'+esc(KIND_LABEL[s.kind]||s.kind)+'</span><span class="t">'+esc(s.title)+'</span></div><div class="d">'+esc(s.date)+'</div><div class="hint">'+esc(s.summary)+'</div></div>').join("");
}

/* ============ Daniel feedback from the calendar (english-class-share/feedback.json) ============ */
let fbItems = null, fbErr = "";
const FB_L = {topics:"배운 내용", expr:"핵심 표현", good:"잘한 점·고칠 점", hw:"숙제·다음 준비"};
async function loadDanielFeedback(){
  if(MODE !== "github"){ renderFeedback(); return; }
  try{
    const g = await ghGetJSON(SHARE_REPO, "feedback.json");
    const raw = (g.data && g.data.items) || {};
    fbItems = Object.keys(raw).filter(k=>/^[\w:]{1,40}$/.test(k) && raw[k] && typeof raw[k]==="object").map(k=>{
      const f = raw[k], o = {id:k};
      ["topics","expr","good","hw","at","name","by"].forEach(x=>o[x]=String(f[x]||"").slice(0,2000));
      return o;
    }).filter(f=>f.topics||f.expr||f.good||f.hw).sort((a,b)=>(b.at||"").localeCompare(a.at||""));
    fbErr = "";
  }catch(e){ fbErr = e.message; fbItems = []; }
  renderFeedback();
}
function renderFeedback(){
  const list = $("#fbList"), allBtn = $("#fbImportAll");
  if(MODE !== "github"){
    $("#fbHint").textContent = "수업 달력에서 마스터나 학생으로 로그인한 뒤 이 페이지를 열면 Daniel의 피드백이 여기에 나와요.";
    list.innerHTML = ""; allBtn.hidden = true; return;
  }
  allBtn.hidden = false;
  $("#fbHint").textContent = "수업 달력에서 Daniel이 쓴 피드백을 읽어, 고칠 점은 실수 노트로, 핵심 표현은 아래 표현 목록으로 넣어요.";
  if(fbItems === null){ list.innerHTML = '<div class="empty">피드백 불러오는 중…</div>'; return; }
  if(fbErr){ list.innerHTML = '<div class="err">피드백을 읽지 못했어요 ('+esc(fbErr)+'). 달력의 설정에서 저장소 연결을 확인해 주세요.</div>'; return; }
  if(!fbItems.length){ list.innerHTML = '<div class="empty">아직 Daniel이 남긴 피드백이 없어요. 수업이 끝나면 Daniel이 달력에서 ✍ 표시된 수업에 피드백을 남길 수 있어요.</div>'; allBtn.disabled = true; return; }
  const done = new Set(state.importedFb||[]);
  const fresh = fbItems.filter(f=>!done.has(f.id));
  allBtn.disabled = !fresh.length;
  allBtn.textContent = fresh.length ? "새 피드백 "+fresh.length+"개 가져오기" : "모두 가져옴";
  list.innerHTML = fbItems.slice(0,8).map(f=>{
    const imp = done.has(f.id);
    return '<div class="fbitem"><div class="row"><span class="tag '+(imp?"done":"due")+'">'+(imp?"가져옴":"새 피드백")+'</span><span class="count">'+esc(f.at||f.id)+' · '+esc(f.name||f.by||"Daniel")+'</span></div>'+
      ["topics","expr","good","hw"].filter(k=>f[k]).map(k=>'<div class="fbt"><b>'+FB_L[k]+'</b>'+esc(f[k])+'</div>').join("")+
      '<div class="row">'+(imp?"":'<button class="btn" type="button" data-fbimp="'+esc(f.id)+'">이 피드백 가져오기</button>')+
      (f.hw?'<button class="btn ghost" type="button" data-fbhw="'+esc(f.id)+'">숙제로 다음 수업 준비</button>':"")+'</div></div>';
  }).join("");
}
async function importFeedback(ids){
  if(!ids.length) return;
  if(!aiReady()){ toast("피드백을 정리하려면 설정 탭에서 API 키를 넣어 주세요."); return; }
  const btn = $("#fbImportAll"); btn.disabled = true; const old = btn.textContent; btn.textContent = "정리 중…";
  let nm = 0, ne = 0;
  for(const id of ids){
    const f = (fbItems||[]).find(x=>x.id===id); if(!f) continue;
    const text = ["topics","expr","good","hw"].filter(k=>f[k]).map(k=>FB_L[k]+": "+f[k]).join("\n");
    try{
      const r = await aiJSON(LEARNER+" Below is class feedback his tutor Daniel wrote after a lesson. Extract (1) concrete mistakes Edward made, as wrong→right pairs (only if a correction is stated or clearly implied; do not invent), and (2) the key expressions Daniel taught. Known recurring error ids: "+TAGS+'. Respond with ONLY JSON: {"mistakes":[{"wrong":"","right":"","why":"짧은 한국어 설명","tag":"matching id or other"}],"expressions":[{"en":"","ko":"한국어 뜻"}]}',
        [{role:"user", content:text}], {tier:"quick"});
      (r.mistakes||[]).filter(m=>m.wrong&&m.right).forEach(m=>{ addCorrection(m,"daniel"); nm++; });
      (r.expressions||[]).filter(x=>x.en).forEach(x=>{ if(!state.expressions.some(y=>norm(y.en)===norm(x.en))){ state.expressions.push({en:String(x.en).slice(0,160), ko:String(x.ko||"").slice(0,160), from:f.at||f.id}); ne++; } });
      state.importedFb = [...new Set([...(state.importedFb||[]), id])];
    }catch(e){ toast(e.message); break; }
  }
  if(nm||ne) addSession({kind:"daniel", title:"Daniel 피드백 가져오기", summary:"고칠 점 "+nm+"개 · 표현 "+ne+"개"});
  btn.textContent = old; save(); renderAll();
  toast("고칠 점 "+nm+"개, 표현 "+ne+"개를 넣었어요");
}
$("#fbImportAll").addEventListener("click", ()=>{ const done=new Set(state.importedFb||[]); importFeedback((fbItems||[]).filter(f=>!done.has(f.id)).map(f=>f.id)); });
$("#fbList").addEventListener("click", e=>{
  const a = e.target.closest("[data-fbimp]"); if(a){ importFeedback([a.dataset.fbimp]); return; }
  const h = e.target.closest("[data-fbhw]");
  if(h){ const f=(fbItems||[]).find(x=>x.id===h.dataset.fbhw); if(f){ $("#prepTopic").value = f.hw.slice(0,200); $("#prepTopic").scrollIntoView({behavior:"smooth", block:"center"}); $("#prepTopic").focus(); } }
});
function renderExpressions(){
  const el = $("#exprList"), xs = (state.expressions||[]).slice().reverse();
  $("#exprCard").hidden = !xs.length;
  el.innerHTML = xs.slice(0,30).map(x=>'<div class="en">'+esc(x.en)+' '+speakerBtn(x.en)+'</div><div class="ko">'+esc(x.ko)+'</div>').join("");
}

/* ============ Notes ============ */
function renderNotes(){
  const f=$("#noteFilter").value, t=todayStr();
  let items=allItems();
  if(f==="due") items=items.filter(x=>!x.mastered&&x.due<=t);
  if(f==="daniel") items=items.filter(x=>x.source==="daniel");
  if(f==="app") items=items.filter(x=>x.source==="app"||x.appCount>0);
  if(f==="done") items=items.filter(x=>x.mastered);
  items.sort((a,b)=>(a.mastered-b.mastered)||(b.count-a.count));
  const el=$("#noteList");
  if(!items.length){ el.innerHTML='<div class="empty">해당하는 표현이 없어요.</div>'; return; }
  el.innerHTML = items.map(x=>{
    const st = x.mastered ? '<span class="tag done">고침</span>' : (x.due<=t ? '<span class="tag due">오늘</span>' : '<span class="tag">'+esc(x.due.slice(5))+'</span>');
    const src = x.source==="daniel" ? '<span class="tag src-daniel">Daniel</span>' : '<span class="tag">앱</span>';
    return '<div class="mitem"><div><div class="pair"><span class="del">'+esc(x.wrong)+'</span><span aria-hidden="true">→</span><span class="ins">'+esc(x.right)+'</span></div><div class="why">'+esc(x.why)+'</div></div>'+
      '<div class="side"><div class="row" style="gap:4px">'+src+st+'</div><div class="dots" aria-label="숙련도 '+x.box+'/5">'+[0,1,2,3,4].map(i=>'<i class="'+(i<x.box?"on":"")+'"></i>').join("")+'</div><span class="count">지적 '+x.count+'회</span>'+
      (!x.core?'<button class="btn ghost" type="button" data-del="'+esc(x.id)+'" style="font-size:12px;min-height:0;padding:2px 6px">삭제</button>':"")+'</div></div>';
  }).join("");
}
$("#noteFilter").addEventListener("change", renderNotes);
$("#noteList").addEventListener("click", e=>{
  const b=e.target.closest("[data-del]"); if(!b) return;
  const id=b.dataset.del;
  state.custom=state.custom.filter(c=>c.id!==id); delete state.progress[id];
  save(); renderAll();
});

/* ============ Stats / top ============ */
function renderStats(){
  const items=allItems(), t=todayStr();
  $("#stDue").textContent = items.filter(x=>!x.mastered&&x.due<=t).length;
  $("#stStreak").textContent = streak();
  $("#stMastered").textContent = items.filter(x=>x.mastered).length;
  $("#stTotal").textContent = Object.values(state.days).reduce((a,b)=>a+b,0);
  const top = items.filter(x=>!x.mastered).sort((a,b)=>b.count-a.count).slice(0,5);
  const max = top[0]?.count||1;
  $("#topList").innerHTML = top.map(x=>'<div class="bar"><div><span class="del">'+esc(x.wrong)+'</span> → <span class="ins">'+esc(x.right)+'</span></div><span class="count" style="text-align:right">'+x.count+'회</span><div class="track"><i style="width:'+Math.round(x.count/max*100)+'%"></i></div></div>').join("");
}

/* ============ Settings ============ */
function renderSettings(){
  const pill=$("#modePill");
  if(MODE==="claude"){
    pill.textContent = cap.sample ? "● Claude 연결됨" : "● Claude (AI 꺼짐)";
    pill.className = "mode-pill "+(cap.sample?"on":"off");
    $("#modeExplain").innerHTML = "지금은 <b>Claude 안에서</b> 열려 있어요. API 키 없이 Claude가 바로 교정해 주고, 기록은 Claude 계정에 저장돼 폰과 PC에서 이어져요."+
      (cap.dictation?"":" 이 화면에서는 음성 입력이 지원되지 않아요(크롬·데스크톱 앱에서 지원).")+
      "<br><br>같은 파일을 GitHub Pages에 올리면 <b>독립 모드</b>로 바뀌어 내 API 키로 동작해요.";
    $("#apiCard").style.display="none";
  } else if(MODE==="github"){
    const who = whoLabel();
    renderPill();
    $("#modeExplain").innerHTML = "수업 달력에 <b>"+esc(whoLabel())+"(으)로 로그인된 상태</b>예요. 실수 노트와 기록은 "+esc(coachLoc().repo+"/"+coachLoc().path)+"에 저장돼 다른 기기에서도 이어지고, Daniel이 달력에 남긴 피드백을 바로 가져올 수 있어요. "+(cap.sample?"AI 기능은 <b>Claude</b>로 동작해요(키 불필요).":"AI 기능은 Gemini → Groq → OpenRouter 순서로 자동 전환되며, 모두 막히면 오프라인 자동 판정으로 채점해요. 키가 없어도 반복 실수 훈련은 자동 판정돼요.")+"";
    $("#apiCard").style.display = cap.sample ? "none" : "";
  } else if(MODE==="standalone"){
    renderPill();
    $("#modeExplain").innerHTML = "지금은 <b>로그인 전</b>이라 기록이 이 브라우저에만 저장돼요. <a href=\"./\">수업 달력</a>에서 마스터나 학생으로 로그인하고 다시 열면 비공개 저장소에 저장되고 Daniel 피드백도 가져올 수 있어요. 키가 없어도 반복 실수 훈련은 자동 판정으로 쓸 수 있어요.";
    $("#apiCard").style.display="";
  } else {
    pill.textContent="연결 확인 중…"; pill.className="mode-pill";
  }
  renderApiCard();
  $("#autoSpeak").checked = !!state.settings.autoSpeak;
  $("#rate").value = state.settings.rate||1; $("#rateVal").textContent = "×"+Number(state.settings.rate||1).toFixed(2);
  $("#voiceNote").textContent = (canListen()?"🎙 음성 입력 사용 가능. ":"🎙 이 화면에선 음성 입력이 안 돼요(크롬 권장). ")+(canSpeak()?"🔊 읽어주기 사용 가능.":"🔊 이 화면에선 읽어주기가 안 돼요.");
  ["#chatMic","#roleMic"].forEach((s,i)=>wireMic($(s), $(i?"#roleInput":"#chatInput")));
}
function renderPill(){
  const pill=$("#modePill"); if(!pill || MODE==="claude" || MODE==="detecting") return;
  const who = MODE==="github" ? whoLabel() : "독립 모드";
  if(cap.sample){ pill.textContent="● "+who+" · AI 연결됨 (Claude)"; pill.className="mode-pill on"; return; }
  if(!hasKey()){ pill.textContent="● "+who+" · AI 키 필요"; pill.className="mode-pill off"; return; }
  const now = lastAI && !lastAI.offline ? lastAI.name : (lastAI && lastAI.offline ? "오프라인" : keyedNames()[0]);
  pill.textContent = "● "+who+" · AI: "+now+(lastAI?"":" 대기")+" ("+keyedNames().length+"곳 연결)";
  pill.className = "mode-pill "+(lastAI && lastAI.offline ? "off" : "on");
  pill.title = "자동 전환 순서: "+keyedNames().join(" → ")+" → 오프라인 자동 판정";
}
const KEY_FIELDS = [
  {k:"geminiKey", m:"geminiModel", key:"#kGemini", model:"#mGemini", def:"gemini-flash-latest"},
  {k:"groqKey",   m:"groqModel",   key:"#kGroq",   model:"#mGroq",   def:"llama-3.3-70b-versatile"},
  {k:"orKey",     m:"orModel",     key:"#kOR",     model:"#mOR",     def:""},
  {k:"apiKey",    m:"model",       key:"#kClaude", model:"#mClaude", def:"claude-sonnet-5-5"}
];
function renderApiCard(){
  KEY_FIELDS.forEach(f=>{
    const el=$(f.key), mel=$(f.model); if(!el) return;
    const v=secret[f.k]; el.value = v ? "••••••••"+v.slice(-4) : "";
    const st=$(f.key+"St"); if(st) st.textContent = v ? "✓ 연결됨" : "미입력";
    if(mel) mel.value = secret[f.m] || f.def;
  });
  const used=$("#aiUsedNow"); if(used) used.textContent = lastAI ? "마지막 사용: "+aiUsedText().replace(/^🤖 /,"") : "아직 이번 화면에서 AI를 쓰지 않았어요.";
  const sh=$("#apiShareRow"); if(sh) sh.style.display = (MODE==="github" && ghMaster()) ? "" : "none";
  const sn=$("#sharedNote"); if(sn) sn.textContent = (!ghMaster() && sharedKeys) ? "마스터가 공유한 무료 키를 쓰고 있어요. 내 키를 넣으면 내 키가 먼저 쓰여요." : "";
  const ord=$("#aiOrder"); if(ord) ord.textContent = hasKey() ? keyedNames().join(" → ")+" → 오프라인 자동 판정" : "키가 없어서 오프라인 자동 판정만 동작해요.";
}
$("#apiSave").addEventListener("click", ()=>{
  KEY_FIELDS.forEach(f=>{
    const el=$(f.key), mel=$(f.model); if(!el) return;
    const k=el.value.trim();
    if(k && !k.startsWith("••")) secret[f.k]=k;
    if(!k) secret[f.k]="";
    if(mel) secret[f.m] = mel.value.trim() || f.def;
  });
  const own = Object.assign({}, secret);
  if(sharedKeys) SHARE_FIELDS.forEach(f=>{ if(own[f] && own[f]===sharedKeys[f]) own[f]=""; });   // 공유받은 키는 내 기기에 따로 저장하지 않음
  try{ localStorage.setItem(LS_SECRET, JSON.stringify(own)); }catch(e){}
  applySharedKeys();
  toast("저장했어요 · 순서: "+(keyedNames().join(" → ")||"오프라인")); renderAll();
});
$("#apiClear").addEventListener("click", ()=>{ KEY_FIELDS.forEach(f=>secret[f.k]=""); try{ localStorage.setItem(LS_SECRET, JSON.stringify(secret)); }catch(e){} renderAll(); toast("키를 모두 지웠어요"); });
$("#apiShare").addEventListener("click", async ()=>{
  if(!ghMaster()){ toast("마스터만 공유할 수 있어요."); return; }
  if(!secret.geminiKey && !secret.groqKey && !secret.orKey){ toast("공유할 무료 키를 먼저 넣고 저장해 주세요."); return; }
  const btn=$("#apiShare"); btn.disabled=true;
  try{ await shareKeysToStudents(); toast("학생·edward1004 기기에서도 이 무료 키로 AI를 쓸 수 있어요"); }
  catch(e){ toast("공유 실패: "+e.message); }
  btn.disabled=false;
});
$("#apiTest").addEventListener("click", async ()=>{
  const btn=$("#apiTest"), out=$("#aiTestOut"); btn.disabled=true; btn.textContent="확인 중…"; out.innerHTML="";
  const rows=[];
  for(const p of AI_CHAIN.filter(p=>p.key())){
    const t0=Date.now();
    try{ const r=await callProvider(p, "Reply with the single word OK.", [{role:"user", content:"ping"}], {maxTokens:20}); rows.push("✓ "+p.name+" · "+r.model+" · "+((Date.now()-t0)/1000).toFixed(1)+"초"); }
    catch(e){ rows.push("✗ "+p.name+" · "+(e.why||"오류")+" — "+String(e.message).slice(0,90)); }
    out.innerHTML = rows.map(x=>'<div class="'+(x[0]==="✓"?"ok":"err")+'">'+esc(x)+'</div>').join("");
  }
  if(!rows.length) out.innerHTML='<div class="err">입력된 키가 없어요.</div>';
  btn.disabled=false; btn.textContent="연결 테스트";
});
$("#autoSpeak").addEventListener("change", e=>{ state.settings.autoSpeak=e.target.checked; save(); });
$("#rate").addEventListener("input", e=>{ state.settings.rate=Number(e.target.value); $("#rateVal").textContent="×"+Number(e.target.value).toFixed(2); });
$("#rate").addEventListener("change", ()=>save());
$("#expBtn").addEventListener("click", ()=>{
  const code = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
  $("#impText").value = code; copyText(code);
});
$("#impBtn").addEventListener("click", ()=>{
  const raw=$("#impText").value.trim(); if(!raw) return;
  try{
    let obj; try{ obj=JSON.parse(decodeURIComponent(escape(atob(raw)))); }catch(e){ obj=JSON.parse(raw); }
    if(!obj || typeof obj!=="object" || !obj.progress) throw new Error();
    state = mergeStates(state, obj); save(); renderAll(); toast("불러와서 합쳤어요"); $("#impText").value="";
  }catch(e){ toast("백업 코드가 올바르지 않아요"); }
});

/* ============ Tabs ============ */
const tabs=[...document.querySelectorAll('nav.tabs [role="tab"]')];
function selectTab(btn){
  tabs.forEach(t=>{ const on=t===btn; t.setAttribute("aria-selected",on); document.getElementById(t.getAttribute("aria-controls")).classList.toggle("active",on); });
  stopMic();
  if(btn.id==="tab-notes") renderNotes();
  if(btn.id==="tab-chat" && !chat.history.length) chatGreeting();
}
tabs.forEach((t,i)=>{
  t.addEventListener("click",()=>selectTab(t));
  t.addEventListener("keydown",e=>{ if(e.key==="ArrowRight"||e.key==="ArrowLeft"){ const n=tabs[(i+(e.key==="ArrowRight"?1:tabs.length-1))%tabs.length]; n.focus(); selectTab(n); } });
});

function renderAll(){ renderStats(); renderSettings(); renderSessions(); renderNotes(); renderFeedback(); renderExpressions(); if(drill.phase==="idle") renderDrill(); }

/* ============ Boot ============ */
async function bootGithub(){
  if(ghStudent()){
    const nm = String(GH.auth.name || GH.auth.login || "the learner").replace(/[^\p{L}\p{N} ._-]/gu,"").slice(0,30);
    LEARNER = "The learner, "+nm+", is a Korean student of English taking a weekly online class with tutor Daniel. Adjust to their level; keep examples from everyday life, school and travel unless they bring up work.";
    const h1 = document.querySelector("header.top h1"); if(h1) h1.textContent = "English Coach · " + nm;
  }
  MODE="github"; renderAll(); setSync("저장소에서 불러오는 중…");
    try{
      const g = await ghGetJSON(coachLoc().repo, coachLoc().path);
      GH.sha = g.sha;
      if(g.data){ state = mergeStates(state, Object.assign(blankState(), g.data)); try{ localStorage.setItem(LS_KEY, JSON.stringify(state)); }catch(e){} }
      setSync(g.data ? "저장소와 동기화됨 ✓" : "첫 저장 때 저장소에 기록 파일이 만들어져요");
      if(!g.data || (state.updatedAt||0) > (g.data.updatedAt||0)){ dirty = true; save(); }
    }catch(e){ setSync("저장소를 읽지 못했어요 ("+e.message+"). 이 기기에만 저장돼요.", true); MODE="standalone"; }
    renderAll(); loadDanielFeedback(); loadSharedKeys();
}

renderChatTopics(); renderRoles(); renderAll();

(async function boot(){
  // Inside a Claude artifact, window.claude.use exists. On GitHub Pages it never appears.
  let inClaude=false;
  for(let i=0;i<15;i++){ if(window.claude && typeof window.claude.use==="function"){ inClaude=true; break; } await new Promise(r=>setTimeout(r,100)); }
  if(!inClaude){
    if(!ghCoach()){ MODE="standalone"; renderAll(); return; }
    return bootGithub();
  }

  const use = n => window.claude.use(n).catch(()=>null);
  if(ghCoach()){
    // Calendar master/student inside Claude: progress stays in the GitHub private repo, AI and voice come from Claude
    const [sample, dictation, tts] = await Promise.all([use("sample"), use("dictation"), use("tts")]);
    cap.sample=sample; cap.dictation=dictation; cap.tts=tts;
    return bootGithub();
  }
  MODE="claude"; renderAll();
  const [sample, dictation, tts, db, user] = await Promise.all([use("sample"), use("dictation"), use("tts"), use("db"), use("user")]);
  cap.sample=sample; cap.dictation=dictation; cap.tts=tts;
  renderAll();
  if(db && user){
    try{
      const uid = await user.id();
      if(uid){
        dbRef = db.collection("data/users/"+uid).doc("coach");
        const timer = setTimeout(()=>toast("기록을 불러오는 데 시간이 걸리고 있어요."), 10000);
        const snap = await dbRef.get();
        clearTimeout(timer);
        if(snap.exists){ state = mergeStates(state, Object.assign(blankState(), snap.data())); try{ localStorage.setItem(LS_KEY, JSON.stringify(state)); }catch(e){} }
        if(state.updatedAt) flush();
        renderAll();
      }
    }catch(e){ dbRef=null; }
  }
})();
