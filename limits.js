/* AI 한도 설정 모듈 — 마스터 전용. 저장 위치: english-class-share/coach-limits.json
   달력(app.js)·코치(coach.js)와 분리된 모듈. 사용자 목록은 english-class-access/users.json 에서 읽기만 함. */
{
const AUTHKEY = "eng-class-gh-auth", SHARE_REPO = "english-class-share", ACCESS_REPO = "english-class-access", FILE = "coach-limits.json", BRANCH = "main";
const COACH_EXTRA = {"edward1004":"edward", "uihee":"student"};   // coach.js 와 같은 규칙
const DEF = {v:1, base:10, enrolled:30, teacherDefault:5, unlimited:["edward100","edward1004"], people:{}, assume:{gem:250, groq:1000, or:50, per:1.5, inf:60}};
const $ = s => document.querySelector(s);
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

let auth = null; try{ auth = JSON.parse(localStorage.getItem(AUTHKEY) || "null"); }catch(e){}
const isMaster = () => !!(auth && auth.token && auth.owner && auth.role !== "sub");
const hdr = () => ({Accept:"application/vnd.github+json", Authorization:"Bearer " + auth.token});
const url = (repo, path) => "https://api.github.com/repos/" + encodeURIComponent(auth.owner) + "/" + encodeURIComponent(repo) + "/contents/" + path;
const b64enc = s => btoa(unescape(encodeURIComponent(s)));
const b64dec = s => decodeURIComponent(escape(atob(String(s).replace(/\s/g,""))));
async function getJSON(repo, path){
  const r = await fetch(url(repo, path) + "?ref=" + BRANCH + "&t=" + Date.now(), {headers: hdr(), cache:"no-store"});
  if(r.status === 404) return {data:null, sha:null};
  if(!r.ok) throw new Error(repo + " HTTP " + r.status);
  const j = await r.json(); return {data: JSON.parse(b64dec(j.content)), sha: j.sha};
}
async function putJSON(repo, path, obj, message, sha){
  const body = {message, content: b64enc(JSON.stringify(obj, null, 1)), branch: BRANCH}; if(sha) body.sha = sha;
  const r = await fetch(url(repo, path), {method:"PUT", headers:{...hdr(), "Content-Type":"application/json"}, body: JSON.stringify(body)});
  if(!r.ok) throw new Error(repo + " HTTP " + r.status);
  return (await r.json()).content.sha;
}

let cfg = JSON.parse(JSON.stringify(DEF)), sha = null, people = [];
const masterId = () => String(auth.login || auth.owner || "master");
const num = (v, d) => { const n = Number(v); return isFinite(n) && n >= 0 ? n : d; };
const infSet = () => new Set((cfg.unlimited||[]).map(s => String(s).toLowerCase()));
function roleOf(u){
  if(u.master) return "master";
  const ex = COACH_EXTRA[String(u.id).toLowerCase()];
  if(ex) return ex;
  return u.role === "student" ? "student" : "teacher";
}
const ROLE = {master:"마스터", edward:"Edward (선생+학생)", teacher:"선생님", student:"학생"};
function limitOf(u){
  if(u.master) return Infinity;                       // 마스터는 항상 무제한
  if(infSet().has(String(u.id).toLowerCase())) return Infinity;
  const p = cfg.people[u.id] || {}, r = roleOf(u);
  if(r === "teacher") return num(p.lim, cfg.teacherDefault);
  if(r === "student") return p.enr ? cfg.enrolled : cfg.base;
  return cfg.base;
}

/* ---------- form <-> cfg ---------- */
function fillForm(){
  $("#base").value = cfg.base; $("#enr").value = cfg.enrolled; $("#tch").value = cfg.teacherDefault;
  $("#inf").value = (cfg.unlimited||[]).join(", ");
  const a = cfg.assume; $("#aGem").value = a.gem; $("#aGroq").value = a.groq; $("#aOR").value = a.or; $("#aPer").value = a.per; $("#aInf").value = a.inf;
}
function readForm(){
  cfg.base = num($("#base").value, 10); cfg.enrolled = num($("#enr").value, 30); cfg.teacherDefault = num($("#tch").value, 5);
  cfg.unlimited = $("#inf").value.split(/[,\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 30);
  cfg.assume = {gem: num($("#aGem").value, 250), groq: num($("#aGroq").value, 1000), or: num($("#aOR").value, 50), per: Math.max(1, num($("#aPer").value, 1.5)), inf: num($("#aInf").value, 60)};
}

/* ---------- table ---------- */
function renderTable(){
  $("#tbl tbody").innerHTML = people.map((u, i) => {
    const r = roleOf(u), inf = infSet().has(String(u.id).toLowerCase()), p = cfg.people[u.id] || {};
    const lim = inf ? '<span class="inf">∞ 무제한</span>'
      : r === "teacher" ? '<input type="number" min="0" data-lim="'+i+'" value="'+esc(num(p.lim, cfg.teacherDefault))+'" aria-label="'+esc(u.id)+' 하루 한도">'
      : esc(limitOf(u)) + '회';
    const enr = r === "student" ? '<input type="checkbox" data-enr="'+i+'"'+(p.enr ? " checked" : "")+' aria-label="'+esc(u.id)+' 수강 중">' : '<span class="hint">—</span>';
    return '<tr><td data-l="아이디"><b>'+esc(u.id)+'</b></td><td data-l="이름">'+esc(u.name||"")+'</td><td data-l="역할">'+ROLE[r]+'</td><td data-l="수강 중">'+enr+'</td><td data-l="하루 한도">'+lim+'</td></tr>';
  }).join("");
}

/* ---------- capacity ---------- */
function calc(){
  const a = cfg.assume;
  const sup = [{n:"Gemini", v:a.gem, c:"var(--blue)"},{n:"Groq", v:a.groq, c:"var(--orange)"},{n:"OpenRouter", v:a.or, c:"var(--aqua)"}];
  const reqs = sup.reduce((s,x) => s + x.v, 0), uses = Math.floor(reqs / a.per);
  const teach = people.filter(u => roleOf(u) === "teacher" && limitOf(u) !== Infinity).reduce((s,u) => s + limitOf(u), 0);
  const reserved = a.inf + teach, left = Math.max(0, uses - reserved);
  const base = Math.max(1, cfg.base), enr = Math.max(1, cfg.enrolled);
  return {sup, reqs, uses, per:a.per, reserved, left, base, enr, fitBase: Math.floor(left/base), fitEnr: Math.floor(left/enr)};
}
function renderTop(){
  const r = calc();
  $("#title").textContent = "학생 약 " + r.fitBase + "명까지 하루 " + r.base + "회씩 쓸 수 있어요";
  $("#kUses").textContent = r.uses.toLocaleString();
  $("#kSub").textContent = "회 / 일  (AI 요청 " + r.reqs.toLocaleString() + "건 ÷ " + r.per + ")";
  $("#kLeft").innerHTML = "무제한·선생님 몫 " + esc(r.reserved) + "회를 빼면 학생에게 <b>" + esc(r.left) + "회</b><br>· 기본 " + esc(r.base) + "회면 약 <b>" + esc(r.fitBase) + "명</b><br>· 수강생 " + esc(r.enr) + "회면 약 <b>" + esc(r.fitEnr) + "명</b>";
  const max = Math.max(1, ...r.sup.map(s => s.v));
  $("#supply").innerHTML = '<div class="hint" style="margin-top:10px">업체별 하루 무료 요청 (추정)</div>' + r.sup.map(s =>
    '<div class="srow"><span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:'+s.c+';margin-right:5px"></i>'+s.n+'</span><div class="track"><span style="width:'+(s.v/max*100)+'%;background:'+s.c+'"></span></div><span class="num">'+s.v.toLocaleString()+'건</span></div>').join("");
  draw();
}
const svg = $("#chart"), tip = $("#tip");
function draw(){
  const r = calc(), W = svg.clientWidth, H = svg.clientHeight; if(!W || !H) return;
  const m = {l: W < 520 ? 40 : 50, r:14, t:12, b:30};
  const xMax = Math.max(25, Math.ceil(r.fitBase*1.3/25)*25);
  const yRaw = Math.max(r.uses, r.reserved + xMax*r.base) * 1.05;
  const step = [50,100,200,250,500,1000,2000,5000].find(v => yRaw/v <= 5) || 10000, yMax = Math.ceil(yRaw/step)*step;
  const x = v => m.l + v/xMax*(W-m.l-m.r), y = v => H-m.b - v/yMax*(H-m.t-m.b), d = n => r.reserved + n*r.base;
  let g = "";
  for(let v=0; v<=yMax; v+=step) g += '<line x1="'+m.l+'" x2="'+(W-m.r)+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#e4e1d8"/><text x="'+(m.l-6)+'" y="'+(y(v)+4)+'" text-anchor="end" font-size="11" fill="#6b7177">'+v+'</text>';
  for(let i=0; i<=5; i++){ const v = Math.round(xMax*i/5); g += '<text x="'+x(v)+'" y="'+(H-m.b+17)+'" text-anchor="middle" font-size="11" fill="#6b7177">'+v+(i===5?"명":"")+'</text>'; }
  g += '<line x1="'+x(0)+'" y1="'+y(d(0))+'" x2="'+x(xMax)+'" y2="'+y(Math.min(d(xMax),yMax))+'" stroke="#257de0" stroke-width="2.5" stroke-linecap="round"/>';
  g += '<line x1="'+m.l+'" x2="'+(W-m.r)+'" y1="'+y(r.uses)+'" y2="'+y(r.uses)+'" stroke="#1d2125" stroke-width="2" stroke-dasharray="6 4"/>';
  g += '<text x="'+(W-m.r)+'" y="'+(y(r.uses)-7)+'" text-anchor="end" font-size="12" font-weight="700" fill="#1d2125">무료 한계 '+r.uses+'회</text>';
  if(r.fitBase > 0 && r.fitBase <= xMax){ const cx = x(r.fitBase), cy = y(d(r.fitBase));
    g += '<line x1="'+cx+'" x2="'+cx+'" y1="'+cy+'" y2="'+(H-m.b)+'" stroke="#6b7177" stroke-dasharray="2 3"/><circle cx="'+cx+'" cy="'+cy+'" r="5" fill="#257de0" stroke="#fff" stroke-width="2"/>';
    g += '<rect x="'+(cx-28)+'" y="'+(H-m.b-22)+'" width="56" height="18" rx="4" fill="#fff"/><text x="'+cx+'" y="'+(H-m.b-9)+'" text-anchor="middle" font-size="12" font-weight="700" fill="#1d2125">'+r.fitBase+'명</text>'; }
  g += '<line id="hx" y1="'+m.t+'" y2="'+(H-m.b)+'" stroke="#6b7177" opacity="0"/><circle id="hd" r="5" fill="#257de0" stroke="#fff" stroke-width="2" opacity="0"/><rect id="hit" x="'+m.l+'" y="'+m.t+'" width="'+(W-m.l-m.r)+'" height="'+(H-m.t-m.b)+'" fill="transparent"/>';
  svg.innerHTML = g;
  const hit = svg.querySelector("#hit"), hx = svg.querySelector("#hx"), hd = svg.querySelector("#hd");
  hit.addEventListener("pointermove", e => {
    const px = e.clientX - svg.getBoundingClientRect().left;
    const n = Math.max(0, Math.min(xMax, Math.round((px-m.l)/(W-m.l-m.r)*xMax))), v = d(n);
    hx.setAttribute("x1", x(n)); hx.setAttribute("x2", x(n)); hx.setAttribute("opacity", 1);
    hd.setAttribute("cx", x(n)); hd.setAttribute("cy", y(Math.min(v,yMax))); hd.setAttribute("opacity", 1);
    tip.textContent = "학생 " + n + "명 → 하루 최대 " + v + "회 " + (v > r.uses ? "· 한도 초과 ✗" : "· 여유 " + (r.uses - v) + "회 ✓");
    tip.style.opacity = 1; tip.style.left = Math.min(px+12, W-220) + "px"; tip.style.top = (y(Math.min(v,yMax)) - 32) + "px";
  });
  hit.addEventListener("pointerleave", () => { hx.setAttribute("opacity", 0); hd.setAttribute("opacity", 0); tip.style.opacity = 0; });
}
const ro = new ResizeObserver(draw); ro.observe(svg);

/* ---------- events ---------- */
document.addEventListener("input", e => {
  const t = e.target;
  if(t.dataset.lim !== undefined){ const u = people[+t.dataset.lim]; cfg.people[u.id] = Object.assign({}, cfg.people[u.id], {lim: num(t.value, cfg.teacherDefault)}); renderTop(); return; }
  if(t.closest(".grid")){ readForm(); renderTop(); if(t.matches("#base,#enr,#inf,#tch")) renderTable(); }
});
document.addEventListener("change", e => {
  const t = e.target;
  if(t.dataset.enr !== undefined){ const u = people[+t.dataset.enr]; cfg.people[u.id] = Object.assign({}, cfg.people[u.id], {enr: t.checked}); renderTable(); renderTop(); }
});
$("#save").addEventListener("click", async () => {
  readForm(); const btn = $("#save"), msg = $("#msg"); btn.disabled = true; msg.className = "msg"; msg.textContent = "저장 중…";
  try{
    try{ sha = (await getJSON(SHARE_REPO, FILE)).sha; }catch(e){}
    sha = await putJSON(SHARE_REPO, FILE, Object.assign({}, cfg, {updatedAt: new Date().toISOString(), by: masterId()}), "AI limits updated by " + masterId(), sha);
    msg.className = "msg good"; msg.textContent = "✓ 저장했어요 (" + SHARE_REPO + "/" + FILE + ")";
  }catch(e){ msg.className = "msg bad"; msg.textContent = "저장 실패: " + e.message; }
  btn.disabled = false;
});
$("#reload").addEventListener("click", () => load());

async function load(){
  const msg = $("#msg"); msg.className = "msg"; msg.textContent = "불러오는 중…";
  try{
    const [lim, us] = await Promise.all([getJSON(SHARE_REPO, FILE).catch(() => ({data:null, sha:null})), getJSON(ACCESS_REPO, "users.json").catch(() => ({data:null}))]);
    sha = lim.sha;
    cfg = Object.assign(JSON.parse(JSON.stringify(DEF)), lim.data || {});
    cfg.assume = Object.assign({}, DEF.assume, (lim.data && lim.data.assume) || {});
    cfg.people = Object.assign({}, (lim.data && lim.data.people) || {});
    const list = ((us.data && us.data.users) || []).map(u => ({id: String(u.id||""), name: String(u.name||""), role: u.role})).filter(u => u.id);
    people = [{id: masterId(), name: "마스터", master: true}].concat(list.filter(u => u.id.toLowerCase() !== masterId().toLowerCase()));
    fillForm(); renderTable(); renderTop();
    msg.textContent = lim.data ? "저장된 설정을 불러왔어요." : "아직 저장된 설정이 없어 기본값(학생 10회)으로 보여줘요.";
  }catch(e){ msg.className = "msg bad"; msg.textContent = "불러오기 실패: " + e.message; }
}

if(!isMaster()){ $("#lockCard").hidden = false; }
else { $("#who").textContent = "마스터 · " + masterId(); $("#main").hidden = false; load(); }
}
