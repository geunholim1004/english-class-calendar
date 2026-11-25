"use strict";
/* =====================================================================
   영어 수업 허브 — 로그인 · 선생님/학생 등록 · 마스터 승인 · 매칭 · 결제
   저장 위치 (기존 달력 앱과 같은 저장소 구조를 그대로 사용)
   - english-class-private (비공개, 마스터만) : hub/data.json   인력풀·매칭·장부·결제 설정
                                               hub/keys.json   회원별 데이터 키
                                               hub/master-key.json  마스터 개인키 (신청 링크 해독용)
   - english-class-access  (공개, 암호문만)    : hub/master-pub.json  마스터 공개키
                                               hub/accounts.json    아이디 + 비밀번호로 잠긴 키
                                               hub/p/<아이디>.json   회원별 화면 (회원 키로 암호화)
   신청·송금 알림은 마스터 공개키로 암호화한 링크로 카톡 전달 → 마스터만 열 수 있음
   ===================================================================== */
const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const DEFAULT_OWNER = "geunholim1004", DEFAULT_REPO = "english-class-calendar", BRANCH = "main";
const ACCESS = "english-class-access", PRIV_DEFAULT = "english-class-private";
const AUTHKEY = "eng-class-gh-auth", SESSKEY = "eng-hub-session", PENDKEY = "eng-hub-pending";
const ID_RE = /^[a-z0-9._-]{2,20}$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^\d{2}:\d{2}$/;

function coords(){
  const h = location.hostname, seg = location.pathname.split("/").filter(Boolean);
  if (h.endsWith(".github.io")) return {owner: h.split(".")[0], repo: (seg[0] && !seg[0].endsWith(".html")) ? seg[0] : DEFAULT_REPO};
  return {owner: DEFAULT_OWNER, repo: DEFAULT_REPO};
}
const siteUrl = () => { const c = coords(); return `https://${c.owner}.github.io/${c.repo}/`; };
const hubUrl = () => siteUrl() + "hub.html";
let auth = null; try { auth = JSON.parse(localStorage.getItem(AUTHKEY) || "null"); } catch(e) {}
let sess = null; try { sess = JSON.parse(localStorage.getItem(SESSKEY) || "null"); } catch(e) {}
const isMaster = () => !!(auth && auth.token && auth.role !== "sub");
const owner = () => (auth && auth.owner) || coords().owner;
const priv = () => (auth && auth.privRepo) || PRIV_DEFAULT;

/* ---------- 공통 도구 ---------- */
const utf8e = s => new TextEncoder().encode(s), utf8d = b => new TextDecoder().decode(b);
const b64e = bytes => { const u = new Uint8Array(bytes); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const b64d = s => Uint8Array.from(atob(s.replace(/\s/g, "")), c => c.charCodeAt(0));
const toUrl = s => s.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const fromUrl = s => s.replace(/-/g,"+").replace(/_/g,"/") + "===".slice((s.length + 3) % 4);
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const KST = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Seoul", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23"});
function kst(d){ const o = {}; KST.formatToParts(d || new Date()).forEach(p => o[p.type] = p.value); return o; }
const today = () => { const p = kst(); return `${p.year}-${p.month}-${p.day}`; };
const nowStamp = () => { const p = kst(); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; };
const parseD = s => { const [y,m,d] = s.split("-").map(Number); return new Date(Date.UTC(y, m-1, d)); };
const fmtD = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
function addMonths(d, n){ const x = new Date(d); const day = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + n); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(day, last)); return x; }
const DOW = ["일","월","화","수","목","금","토"], DOW_EN = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const kdate = s => { const d = parseD(s); return `${d.getUTCMonth()+1}/${d.getUTCDate()}(${DOW[d.getUTCDay()]})`; };
const usd = v => "$" + (+v || 0).toLocaleString("en-US", {maximumFractionDigits: 2});
const krw = v => "₩" + Math.round(+v || 0).toLocaleString("ko-KR");
const uzs = v => Math.round(+v || 0).toLocaleString("en-US") + " UZS";
function toast(msg){ const t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 2200); }
async function copy(text, msg){ try { await navigator.clipboard.writeText(text); } catch(e) { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch(_) {} ta.remove(); } toast(msg || "복사했어요"); }
async function share(text){
  if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)){ try { await navigator.share({text}); return; } catch(e) { if (e.name === "AbortError") return; } }
  copy(text, "복사했어요 — 카카오톡에 붙여넣어 보내세요");
}
function openSheet(html){ $("sheet").innerHTML = html; $("modal").classList.add("on"); $("sheet").scrollTop = 0; }
function closeSheet(){ $("modal").classList.remove("on"); }
$("modal").addEventListener("click", e => { if (e.target === $("modal")) closeSheet(); });

/* ---------- 신청 양식 항목 ---------- */
const BLOCKS = [["m","아침","06–09","07:00"],["a","오전","09–12","10:00"],["p","오후","12–18","14:00"],["e","저녁","18–21","19:00"],["n","밤","21–24","21:30"]];
const GOALS = [["talk","회화 Conversation"],["biz","비즈니스 Business"],["tech","반도체·기술 Tech"],["exam","시험 IELTS·TOEFL"],["pron","발음 Pronunciation"],["kids","어린이 Kids"]];
const GOAL_NAME = Object.fromEntries(GOALS.map(([k,v]) => [k, v.split(" ")[0]]));
const LEVELS = ["입문","초급","중급","상급"], WHO = ["본인","자녀","회사 동료","지인"], ACCENTS = ["미국 US","영국 UK","호주 AU","캐나다 CA","기타 Other"];
const slotName = k => { const [d, b] = k.split("-"); const B = BLOCKS.find(x => x[0] === b); return `${DOW[+d]} ${B ? B[1] : b}`; };
function cleanProfile(p, role){
  const o = {}, s = (v, n) => String(v ?? "").trim().slice(0, n);
  o.name = s(p.name, 40); o.contact = s(p.contact, 60); o.memo = s(p.memo, 600);
  o.slots = (Array.isArray(p.slots) ? p.slots : []).filter(k => /^[0-6]-[mapen]$/.test(k)).slice(0, 35);
  o.goals = (Array.isArray(p.goals) ? p.goals : []).filter(k => GOAL_NAME[k]);
  if (role === "teacher"){ o.country = s(p.country, 40); o.rate = Math.max(0, Math.min(500, +p.rate || 0)); o.years = Math.max(0, Math.min(60, +p.years || 0)); o.accent = s(p.accent, 20); o.sample = /^https:\/\/\S+$/.test(p.sample || "") ? s(p.sample, 300) : ""; }
  else { o.who = WHO.includes(p.who) ? p.who : "본인"; o.level = LEVELS.includes(p.level) ? p.level : "초급"; o.budget = Math.max(0, Math.min(500, +p.budget || 0)); o.guardian = s(p.guardian, 40); }
  return o;
}

/* ---------- GitHub ---------- */
async function ghGet(repo, path, withAuth = true){
  const h = {Accept:"application/vnd.github+json"}; if (withAuth && isMaster()) h.Authorization = "Bearer " + auth.token;
  const r = await fetch(`https://api.github.com/repos/${owner()}/${repo}/contents/${path}?ref=${BRANCH}&t=${Date.now()}`, {headers: h, cache:"no-store"});
  if (r.status === 404) return {data: null, sha: null};
  if (r.status === 403 && !h.Authorization) throw new Error("GitHub 조회 한도 초과 — 잠시 뒤 다시 시도해 주세요");
  if (!r.ok) throw new Error(`${repo}/${path} HTTP ${r.status}`);
  const j = await r.json(); return {data: JSON.parse(utf8d(b64d(j.content))), sha: j.sha};
}
async function ghPut(repo, path, obj, message, sha, retry){
  const body = {message, content: b64e(utf8e(JSON.stringify(obj, null, 1))), branch: BRANCH}; if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${owner()}/${repo}/contents/${path}`, {method:"PUT", headers:{Accept:"application/vnd.github+json", Authorization:"Bearer " + auth.token, "Content-Type":"application/json"}, body: JSON.stringify(body)});
  if ((r.status === 409 || r.status === 422) && !retry){ const g = await ghGet(repo, path); return ghPut(repo, path, obj, message, g.sha, true); }
  if (!r.ok) throw new Error(`${repo}/${path} 저장 실패 HTTP ${r.status}`);
  return (await r.json()).content.sha;
}
async function ghDel(repo, path, message){
  const g = await fetch(`https://api.github.com/repos/${owner()}/${repo}/contents/${path}?ref=${BRANCH}&t=${Date.now()}`, {headers:{Accept:"application/vnd.github+json", Authorization:"Bearer " + auth.token}, cache:"no-store"});
  if (!g.ok) return;
  const {sha} = await g.json();
  await fetch(`https://api.github.com/repos/${owner()}/${repo}/contents/${path}`, {method:"DELETE", headers:{Accept:"application/vnd.github+json", Authorization:"Bearer " + auth.token, "Content-Type":"application/json"}, body: JSON.stringify({message, sha, branch: BRANCH})});
}

/* ---------- 암호화 ---------- */
async function pbkdf(pw, salt, iter){
  const base = await crypto.subtle.importKey("raw", utf8e(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2", salt, iterations: iter, hash:"SHA-256"}, base, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]);
}
async function lockBox(secret, pw, iter = 250000){
  const salt = rnd(16), iv = rnd(12);
  const ct = await crypto.subtle.encrypt({name:"AES-GCM", iv}, await pbkdf(pw, salt, iter), utf8e(secret));
  return {iter, salt: b64e(salt), iv: b64e(iv), ct: b64e(ct)};
}
async function unlockBox(box, pw){ return utf8d(await crypto.subtle.decrypt({name:"AES-GCM", iv: b64d(box.iv)}, await pbkdf(pw, b64d(box.salt), box.iter), b64d(box.ct))); }
const aesKey = raw => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt","decrypt"]);
async function encWith(keyB64, obj){ const iv = rnd(12); const ct = await crypto.subtle.encrypt({name:"AES-GCM", iv}, await aesKey(b64d(keyB64)), utf8e(JSON.stringify(obj))); return {iv: b64e(iv), ct: b64e(ct)}; }
async function decWith(keyB64, box){ return JSON.parse(utf8d(await crypto.subtle.decrypt({name:"AES-GCM", iv: b64d(box.iv)}, await aesKey(b64d(keyB64)), b64d(box.ct)))); }
async function hmac(keyB64, text){ const k = await crypto.subtle.importKey("raw", b64d(keyB64), {name:"HMAC", hash:"SHA-256"}, false, ["sign"]); return b64e(await crypto.subtle.sign("HMAC", k, utf8e(text))); }
async function sha(text){ return b64e(await crypto.subtle.digest("SHA-256", utf8e(text))).slice(0, 16); }
async function zip(bytes, inflate){
  if (typeof CompressionStream === "undefined") return null;
  const s = inflate ? new DecompressionStream("deflate-raw") : new CompressionStream("deflate-raw");
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(s)).arrayBuffer());
}
const RSA = {name:"RSA-OAEP", hash:"SHA-256"};
let masterPub = null, masterPriv = null;
async function getMasterPub(){
  if (masterPub) return masterPub;
  const g = await ghGet(ACCESS, "hub/master-pub.json", false);
  if (!g.data || !g.data.spki) throw new Error("아직 신청을 받을 준비가 안 됐어요. 마스터가 허브를 한 번 열어야 합니다.");
  return masterPub = await crypto.subtle.importKey("spki", b64d(g.data.spki), RSA, false, ["encrypt"]);
}
// 마스터만 열 수 있는 링크 내용 만들기 (RSA-OAEP로 감싼 AES 키 + 압축)
async function seal(obj){
  const pub = await getMasterPub();
  let data = utf8e(JSON.stringify(obj)), flag = 0;
  const z = await zip(data); if (z){ data = z; flag = 1; }
  const raw = rnd(32), iv = rnd(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM", iv}, await aesKey(raw), data));
  const ek = new Uint8Array(await crypto.subtle.encrypt(RSA, pub, raw));
  const out = new Uint8Array(1 + ek.length + 12 + ct.length);
  out[0] = flag; out.set(ek, 1); out.set(iv, 1 + ek.length); out.set(ct, 13 + ek.length);
  return toUrl(b64e(out));
}
async function unseal(str){
  const b = b64d(fromUrl(str)), n = 256;
  const raw = new Uint8Array(await crypto.subtle.decrypt(RSA, masterPriv, b.slice(1, 1 + n)));
  let pt = new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM", iv: b.slice(1 + n, 13 + n)}, await aesKey(raw), b.slice(13 + n)));
  if (b[0] === 1) pt = await zip(pt, true);
  return JSON.parse(utf8d(pt));
}

/* ---------- 상태 ---------- */
const DEF_SETTINGS = {bankName:"", bankHolder:"", bankAcct:"", tossId:"", kakaoLink:"", usdKrw:0, usdUzs:0, rateAt:"", rateSrc:"", margin:0, months:3, dur:25};
let D = null, dSha = null, keys = {}, kSha = null, accounts = [], aSha = null;   // 마스터 데이터
let page = null;                                                                   // 회원 화면 데이터
let tab = "home", poolSeg = "student", sel = {};
function freshData(){ return {v:1, settings:{...DEF_SETTINGS}, people:[], matches:[], ledger:[], inbox:[], pageHash:{}}; }
const person = id => D.people.find(p => p.id === id);
const matchesOf = id => D.matches.filter(m => m.sid === id || m.tid === id);

/* ---------- 수업 일정 ---------- */
function sessionsOf(m){
  const out = []; if (!DATE_RE.test(m.start || "")) return out;
  let d = parseD(m.start); const end = addMonths(d, +m.months || 3);
  while (d.getUTCDay() !== +m.dow) d = addDays(d, 1);
  for (; d < end; d = addDays(d, 7)) out.push(fmtD(d));
  return out;
}
function nextDow(dow, from){ let d = addDays(parseD(from || today()), 1); while (d.getUTCDay() !== +dow) d = addDays(d, 1); return fmtD(d); }
function progress(m){ const s = sessionsOf(m), t = today(); const done = s.filter(x => x < t).length; return {list: s, n: s.length, done, left: s.length - done, next: s.find(x => x >= t)}; }

/* ---------- 자동 매칭 점수 ---------- */
// 거르기: 시간 1칸 이상 겹침 · 학생 예산 ≥ 선생님 희망 수업료 · 선생님 활동 중
// 점수(100): 시간 겹침 40 · 목표 일치 25 · 선생님 평가 20 · 가격 여유 15  (같으면 담당 학생 적은 순)
function scorePair(s, t){
  const ov = (s.slots || []).filter(k => (t.slots || []).includes(k));
  const why = [];
  if (!ov.length) why.push("시간 안 맞음");
  if ((+s.budget || 0) < (+t.rate || 0)) why.push(`예산 부족 (${usd(s.budget)} < ${usd(t.rate)})`);
  if (t.status !== "active") why.push("선생님 활동 중지");
  const time = Math.min(ov.length, 3) / 3 * 40;
  const g = (s.goals || []).length ? (s.goals || []).filter(k => (t.goals || []).includes(k)).length / s.goals.length * 25 : 12.5;
  const ts = (t.score == null ? 60 : +t.score) / 100 * 20;
  const pr = s.budget > 0 ? Math.max(0, Math.min(1, (s.budget - (t.rate || 0)) / s.budget * 3)) * 15 : 0;
  const load = D.matches.filter(m => m.tid === t.id && m.status === "active").length;
  return {t, ov, why, ok: !why.length, total: Math.round(time + g + ts + pr), parts: {time: Math.round(time), goal: Math.round(g), score: Math.round(ts), price: Math.round(pr)}, load};
}
function rank(s){ return D.people.filter(p => p.role === "teacher").map(t => scorePair(s, t)).sort((a, b) => (b.ok - a.ok) || (b.total - a.total) || (a.load - b.load)); }

/* =====================================================================
   화면: 로그인
   ===================================================================== */
function setChrome(title, who, tabsOn){
  $("topbar").style.display = title ? "" : "none"; $("topTitle").textContent = title || ""; $("whoName").textContent = who || "";
  $("tabs").classList.toggle("on", !!tabsOn); document.body.style.paddingBottom = tabsOn ? "" : "20px";
}
function renderLogin(msg){
  setChrome("", "", false);
  let pend = null; try { pend = JSON.parse(localStorage.getItem(PENDKEY) || "null"); } catch(e) {}
  $("view").innerHTML = `<div class="hero">
    <div class="logo">🗓️</div><h1>영어 수업 허브</h1><p class="sub">English Class Hub · 등록 · 매칭 · 결제</p>
    <div class="card">
      <label>아이디 <small>ID</small></label><input id="lgId" autocomplete="username" autocapitalize="none">
      <label>비밀번호 <small>Password</small></label><input id="lgPw" type="password" autocomplete="current-password">
      <div class="btns"><button class="block" data-act="login">로그인 · Log in</button></div>
      <div class="hint ${msg && msg.bad ? "bad" : ""}" id="lgMsg">${esc(msg ? msg.text : "")}</div>
      ${pend ? `<div class="hint">⏳ <b>${esc(pend.id)}</b> 신청이 마스터 확인을 기다리고 있어요. 승인되면 위에서 바로 로그인됩니다. <a href="#" data-act="resend">신청 링크 다시 보내기</a></div>` : ""}
    </div>
    <div class="divider">처음이신가요? · New here?</div>
    <div class="choose">
      <button data-act="apply" data-role="teacher"><b>🧑‍🏫</b><span>선생님 등록<br><small class="muted">Teacher sign-up</small></span></button>
      <button data-act="apply" data-role="student"><b>🎓</b><span>학생 등록<br><small class="muted">Student sign-up</small></span></button>
    </div>
    <p class="hint" style="text-align:center;margin-top:18px">기존 수업 달력은 <a href="./">여기</a>에서 열 수 있어요.</p>
  </div>`;
  $("lgPw").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
}
async function doLogin(){
  const id = String($("lgId").value || "").trim().toLowerCase(), pw = $("lgPw").value, out = $("lgMsg");
  out.className = "hint"; out.textContent = "확인 중… Checking…";
  try {
    if (!ID_RE.test(id) || !pw) throw new Error("아이디와 비밀번호를 입력하세요.");
    // 1) 마스터 (기존 달력 앱의 마스터 아이디와 동일)
    const mg = await ghGet(ACCESS, "master.json", false);
    if (mg.data && mg.data.id === id){
      let token; try { token = await unlockBox(mg.data.box, pw); } catch(e) { throw new Error("비밀번호가 맞지 않아요."); }
      const c = coords(), pr = mg.data.privRepo || PRIV_DEFAULT;
      const r = await fetch(`https://api.github.com/repos/${c.owner}/${pr}`, {headers:{Accept:"application/vnd.github+json", Authorization:"Bearer " + token}});
      if (!r.ok) throw new Error("마스터 토큰이 비공개 저장소를 열 수 없어요. 달력 앱 설정에서 마스터 아이디를 다시 저장하세요.");
      const u = await fetch("https://api.github.com/user", {headers:{Authorization:"Bearer " + token}}).then(x => x.ok ? x.json() : {}).catch(() => ({}));
      auth = {token, owner: c.owner, repo: c.repo, login: u.login || c.owner, privRepo: pr};
      try { localStorage.setItem(AUTHKEY, JSON.stringify(auth)); } catch(e) {}
      return route();
    }
    // 2) 허브 회원 (선생님·학생)
    const ag = await ghGet(ACCESS, "hub/accounts.json", false);
    const a = ((ag.data && ag.data.accounts) || []).find(x => x.id === id);
    if (a){
      let K; try { K = await unlockBox(a.box, pw); } catch(e) { throw new Error("비밀번호가 맞지 않아요. · Wrong password."); }
      sess = {id, role: a.role, K}; try { localStorage.setItem(SESSKEY, JSON.stringify(sess)); localStorage.removeItem(PENDKEY); } catch(e) {}
      return route();
    }
    // 3) 기존 달력 앱 계정
    const ug = await ghGet(ACCESS, "users.json", false);
    if (((ug.data && ug.data.users) || []).some(u => u.id === id)) throw new Error("수업 달력 계정이에요. 달력 앱(첫 화면)에서 로그인하세요.");
    let pend = null; try { pend = JSON.parse(localStorage.getItem(PENDKEY) || "null"); } catch(e) {}
    if (pend && pend.id === id) throw new Error("아직 마스터 승인 전이에요. · Waiting for approval.");
    throw new Error("등록된 아이디가 없어요. · ID not found.");
  } catch(e) { out.className = "hint bad"; out.textContent = e.message; }
}
function logout(){
  if (isMaster() && !confirm("로그아웃하면 수업 달력 앱에서도 로그아웃됩니다. 계속할까요?")) return;
  if (isMaster()){ auth = null; try { localStorage.removeItem(AUTHKEY); } catch(e) {} }
  sess = null; page = null; D = null; try { localStorage.removeItem(SESSKEY); } catch(e) {}
  history.replaceState(null, "", location.pathname); renderLogin();
}

/* =====================================================================
   화면: 등록 신청 (선생님·학생)
   ===================================================================== */
let form = {role:"student", slots:[], goals:[]};
function slotGrid(selected, overlap){
  let h = `<div class="slots"><div></div>${DOW.map((d,i) => `<div class="h ${i === 0 ? "sun" : ""}">${d}<br><small>${DOW_EN[i]}</small></div>`).join("")}`;
  for (const [b, n, r] of BLOCKS){
    h += `<div class="b">${n}<small>${r}</small></div>`;
    for (let d = 0; d < 7; d++){ const k = `${d}-${b}`; h += `<button type="button" data-act="slot" data-k="${k}" class="${selected.includes(k) ? "on" : ""} ${overlap && overlap.includes(k) ? "ov" : ""}" aria-label="${DOW[d]} ${n}">✓</button>`; }
  }
  return h + "</div>";
}
function goalChips(selected){ return `<div class="chips">${GOALS.map(([k, v]) => `<button type="button" data-act="goal" data-k="${k}" class="${selected.includes(k) ? "on" : ""}">${v}</button>`).join("")}</div>`; }
const opts = (list, v) => list.map(x => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("");
function profileFields(role, p, withAccount){
  p = p || {};
  const T = role === "teacher";
  return `
    <label>이름 <small>Name</small></label><input id="fName" value="${esc(p.name)}" maxlength="40">
    ${withAccount ? `<label>아이디 <small>ID · 영문 소문자·숫자 2–20자</small></label><input id="fId" autocapitalize="none" maxlength="20">
    <div class="row2"><div><label>비밀번호 <small>Password · 8자 이상</small></label><input id="fPw1" type="password" autocomplete="new-password"></div>
    <div><label>비밀번호 확인 <small>Confirm</small></label><input id="fPw2" type="password" autocomplete="new-password"></div></div>` : ""}
    <label>연락처 <small>KakaoTalk ID / phone / WhatsApp</small></label><input id="fContact" value="${esc(p.contact)}" maxlength="60">
    ${T ? `<div class="row2"><div><label>국가 <small>Country</small></label><input id="fCountry" value="${esc(p.country)}" maxlength="40"></div>
      <div><label>억양 <small>Accent</small></label><select id="fAccent">${opts(ACCENTS, p.accent)}</select></div></div>
      <div class="row2"><div><label>희망 수업료 <small>Fee per 25-min class (USD)</small></label><input id="fRate" type="number" min="0" step="0.5" inputmode="decimal" value="${esc(p.rate ?? "")}"></div>
      <div><label>경력 <small>Years teaching</small></label><input id="fYears" type="number" min="0" inputmode="numeric" value="${esc(p.years ?? "")}"></div></div>
      <label>자기소개 녹음·영상 링크 <small>Sample recording link (Google Drive, YouTube…)</small></label><input id="fSample" value="${esc(p.sample)}" placeholder="https://">`
    : `<div class="row2"><div><label>누구의 수업인가요?</label><select id="fWho">${opts(WHO, p.who)}</select></div>
      <div><label>현재 수준</label><select id="fLevel">${opts(LEVELS, p.level)}</select></div></div>
      <div class="row2"><div><label>1회(25분) 예산 <small>USD</small></label><input id="fBudget" type="number" min="0" step="0.5" inputmode="decimal" value="${esc(p.budget ?? "")}"></div>
      <div id="guardWrap"><label>보호자 이름 <small>자녀인 경우</small></label><input id="fGuardian" value="${esc(p.guardian)}" maxlength="40"></div></div>`}
    <h3>가능한 시간 <small class="muted">Available times · 한국 시간 KST (UTC+9)</small></h3>
    ${slotGrid(form.slots)}
    <div class="hint">${T ? "우즈베키스탄(UTC+5)은 한국보다 4시간 늦어요. 예: 한국 저녁 19:00 = 타슈켄트 15:00 · Tashkent is 4h behind Korea." : "칸을 눌러 가능한 시간을 모두 고르세요. 겹치는 시간이 많을수록 매칭이 잘 돼요."}</div>
    <h3>${T ? "가르칠 수 있는 분야 <small class='muted'>Specialties</small>" : "배우고 싶은 것 <small class='muted'>Goals</small>"}</h3>
    ${goalChips(form.goals)}
    <label>${T ? "소개 <small>About you</small>" : "남기고 싶은 말 <small>메모</small>"}</label><textarea id="fMemo" maxlength="600">${esc(p.memo)}</textarea>`;
}
function readProfile(role){
  const v = id => $(id) ? $(id).value : "";
  return cleanProfile({name: v("fName"), contact: v("fContact"), memo: v("fMemo"), slots: form.slots, goals: form.goals,
    country: v("fCountry"), rate: v("fRate"), years: v("fYears"), accent: v("fAccent"), sample: v("fSample"),
    who: v("fWho"), level: v("fLevel"), budget: v("fBudget"), guardian: v("fGuardian")}, role);
}
function renderApply(role){
  form = {role, slots:[], goals:[]};
  setChrome(role === "teacher" ? "선생님 등록 · Teacher sign-up" : "학생 등록", "", false);
  $("logoutBtn").style.display = "none";
  $("view").innerHTML = `<div class="card">
    <h2>${role === "teacher" ? "🧑‍🏫 선생님 등록 신청" : "🎓 학생 등록 신청"}</h2>
    <p class="hint">작성하면 <b>마스터만 열 수 있게 암호화된 링크</b>가 만들어져요. 카카오톡으로 마스터에게 보내면, 마스터가 확인(confirm)한 뒤 인력풀에 등록되고 이 아이디로 로그인할 수 있어요.<br>
    ${role === "teacher" ? "Your form becomes an encrypted link only the master can open. Send it via KakaoTalk; after approval you can log in with this ID." : ""}</p>
    ${profileFields(role, null, true)}
    ${role === "student" ? `<label class="check" id="consentKid" style="display:none"><input type="checkbox" id="fKid"> <span>보호자로서 자녀의 수업 등록과 정보 제공에 동의합니다.</span></label>` : ""}
    <label class="check"><input type="checkbox" id="fAgree"> <span>입력한 정보는 매칭과 수업 관리에만 쓰이고, 마스터만 볼 수 있다는 데 동의합니다. · I agree my info is used only for matching and class management.</span></label>
    <div class="btns"><button class="ghost" data-act="home">취소</button><button data-act="submitApply" style="flex:1">신청 링크 만들기 · Create link</button></div>
    <div class="hint" id="apMsg"></div>
    <div id="apOut"></div>
  </div>`;
  if ($("fWho")){ const f = () => { const kid = $("fWho").value === "자녀"; $("consentKid").style.display = kid ? "" : "none"; $("guardWrap").style.visibility = kid ? "" : "hidden"; }; $("fWho").onchange = f; f(); }
}
async function submitApply(){
  const out = $("apMsg"), role = form.role; out.className = "hint bad";
  const id = String($("fId").value || "").trim().toLowerCase(), p1 = $("fPw1").value, p2 = $("fPw2").value;
  const p = readProfile(role);
  if (!p.name) return out.textContent = "이름을 입력하세요. · Enter your name.";
  if (!ID_RE.test(id)) return out.textContent = "아이디는 영문 소문자·숫자·. - _ 2–20자 · ID: 2–20 lowercase letters/digits.";
  if (p1.length < 8 || p1 !== p2) return out.textContent = "비밀번호는 8자 이상, 두 칸이 같아야 해요. · Password 8+ chars, both must match.";
  if (!p.contact) return out.textContent = "연락처를 입력하세요. · Enter a contact.";
  if (!p.slots.length) return out.textContent = "가능한 시간을 1칸 이상 고르세요. · Pick at least one time.";
  if (role === "teacher" && !(p.rate > 0)) return out.textContent = "희망 수업료(USD)를 입력하세요. · Enter your fee.";
  if (role === "student" && !(p.budget > 0)) return out.textContent = "1회 예산(USD)을 입력하세요.";
  if (role === "student" && p.who === "자녀" && (!p.guardian || !$("fKid").checked)) return out.textContent = "자녀 등록은 보호자 이름과 동의가 필요해요.";
  if (!$("fAgree").checked) return out.textContent = "정보 이용에 동의해 주세요. · Please agree.";
  out.className = "hint"; out.textContent = "암호화하는 중… Encrypting…";
  try {
    const [ag, ug, mg] = await Promise.all([ghGet(ACCESS, "hub/accounts.json", false), ghGet(ACCESS, "users.json", false), ghGet(ACCESS, "master.json", false)]);
    const taken = ((ag.data && ag.data.accounts) || []).some(a => a.id === id) || ((ug.data && ug.data.users) || []).some(u => u.id === id) || (mg.data && mg.data.id === id);
    if (taken) throw new Error("이미 쓰이는 아이디예요. · ID already taken.");
    const K = b64e(rnd(32));
    const box = await lockBox(K, p1);
    const link = hubUrl() + "#apply=" + await seal({t:"apply", role, id, profile: p, box, K, at: nowStamp()});
    try { localStorage.setItem(PENDKEY, JSON.stringify({id, role, link})); } catch(e) {}
    const text = `[영어 수업 허브] ${role === "teacher" ? "선생님" : "학생"} 등록 신청 · ${p.name} (${id})\n마스터만 열 수 있는 링크입니다:\n${link}`;
    out.textContent = "";
    $("apOut").innerHTML = `<div class="item todo ok"><b>✅ 신청 링크가 만들어졌어요 · Link ready</b>
      <div class="meta">아래 버튼으로 마스터에게 카카오톡을 보내세요. 승인되면 첫 화면에서 <b>${esc(id)}</b>로 로그인하세요.<br>Send it to the master; log in with <b>${esc(id)}</b> after approval.</div>
      <div class="btns"><button data-act="shareText" data-text="${esc(text)}">💬 카카오톡으로 보내기 · Share</button><button class="ghost" data-act="copyText" data-text="${esc(text)}">복사 · Copy</button></div></div>`;
    share(text);
  } catch(e) { out.className = "hint bad"; out.textContent = e.message; }
}

/* =====================================================================
   마스터: 불러오기 · 저장 · 회원 화면 게시
   ===================================================================== */
async function loadMaster(){
  setChrome("영어 수업 허브 · 마스터", "👑 " + (auth.login || ""), true);
  $("logoutBtn").style.display = "";
  $("view").innerHTML = `<div class="card"><div class="empty">불러오는 중…</div></div>`;
  try {
    // 마스터 키 (처음이면 만들기)
    const kg = await ghGet(priv(), "hub/master-key.json");
    if (kg.data && kg.data.pkcs8){
      masterPriv = await crypto.subtle.importKey("pkcs8", b64d(kg.data.pkcs8), RSA, false, ["decrypt"]);
      const pg = await ghGet(ACCESS, "hub/master-pub.json");
      if (!pg.data) await ghPut(ACCESS, "hub/master-pub.json", {spki: kg.data.spki, at: new Date().toISOString()}, "Hub: master public key", null);
    } else {
      const kp = await crypto.subtle.generateKey({...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1,0,1])}, true, ["encrypt","decrypt"]);
      const spki = b64e(await crypto.subtle.exportKey("spki", kp.publicKey)), pkcs8 = b64e(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
      await ghPut(priv(), "hub/master-key.json", {spki, pkcs8, at: new Date().toISOString()}, "Hub: master key (private)", null);
      await ghPut(ACCESS, "hub/master-pub.json", {spki, at: new Date().toISOString()}, "Hub: master public key", null);
      masterPriv = kp.privateKey;
    }
    const [dg, keyg, ag] = await Promise.all([ghGet(priv(), "hub/data.json"), ghGet(priv(), "hub/keys.json"), ghGet(ACCESS, "hub/accounts.json")]);
    D = Object.assign(freshData(), dg.data || {}); D.settings = {...DEF_SETTINGS, ...(D.settings || {})}; dSha = dg.sha;
    keys = (keyg.data && keyg.data.keys) || {}; kSha = keyg.sha;
    accounts = (ag.data && ag.data.accounts) || []; aSha = ag.sha;
    D.matches.forEach(m => { if (m.status === "active" && progress(m).left === 0){ m.status = "ended"; m.endedAt = nowStamp(); } });
    if (D.inbox.length > 200) D.inbox = D.inbox.slice(-200);
  } catch(e) { $("view").innerHTML = `<div class="card"><h2>불러오기 실패</h2><p class="bad">${esc(e.message)}</p><p class="hint">마스터 토큰에 english-class-private · english-class-access 쓰기 권한이 있는지 확인하세요.</p><button data-act="reload">다시 시도</button></div>`; return; }
  await handleHash();
  renderMaster();
}
let saving = Promise.resolve();
function save(what, msg){
  saving = saving.then(async () => {
    try {
      if (what.includes("keys")) kSha = await ghPut(priv(), "hub/keys.json", {keys}, "Hub: keys " + msg, kSha);
      if (what.includes("accounts")) aSha = await ghPut(ACCESS, "hub/accounts.json", {accounts}, "Hub: accounts " + msg, aSha);
      await publishPages();
      D.updatedAt = new Date().toISOString();
      dSha = await ghPut(priv(), "hub/data.json", D, "Hub: " + msg, dSha);
      toast("저장했어요 ✓");
    } catch(e) { toast("저장 실패: " + e.message); console.error(e); }
  });
  return saving;
}
function pageFor(p){
  const S = D.settings, isT = p.role === "teacher";
  const ms = matchesOf(p.id).map(m => {
    const other = person(isT ? m.sid : m.tid) || {};
    return {id: m.id, with: other.name || "", dow: m.dow, time: m.time, dur: m.dur, start: m.start, months: m.months, status: m.status, sessions: sessionsOf(m),
      ...(isT ? {pay: m.pay} : {price: m.price})};
  });
  const bills = D.ledger.filter(l => isT ? (l.kind === "out" && l.tid === p.id) : (l.kind === "in" && l.sid === p.id))
    .map(l => ({id: l.id, mid: l.mid, n: l.n, usd: l.usd, krw: l.krw, uzs: l.uzs, rate: l.rate, rateAt: l.rateAt, status: l.status, at: l.at, paidAt: l.paidAt, note: l.note}));
  return {v:1, at: new Date().toISOString(), id: p.id, role: p.role, name: p.name, profile: cleanProfile(p, p.role), matches: ms, bills,
    pay: isT ? null : {bankName: S.bankName, bankHolder: S.bankHolder, bankAcct: S.bankAcct, tossId: S.tossId, kakaoLink: S.kakaoLink}};
}
async function publishPages(){
  for (const a of accounts){
    const p = person(a.id), K = keys[a.id]; if (!p || !K) continue;
    const body = pageFor(p); const h = await sha(JSON.stringify({...body, at: 0}));
    if (D.pageHash[a.id] === h) continue;
    await ghPut(ACCESS, `hub/p/${a.id}.json`, await encWith(K, body), `Hub: page ${a.id}`, null);
    D.pageHash[a.id] = h;
  }
}

/* ---------- 카톡 링크 처리 (#apply= · #msg=) ---------- */
async function handleHash(raw){
  const h = raw || location.hash;
  const m = h.match(/#(apply|msg)=([A-Za-z0-9_-]+)/);
  if (!m) return false;
  if (!raw) history.replaceState(null, "", location.pathname);
  let o; try { o = await unseal(m[2]); } catch(e) { toast("링크를 열 수 없어요 (손상되었거나 다른 마스터 키)"); return false; }
  if (o.t === "apply") showApplication(o);
  else if (o.t === "msg") await receiveMsg(o);
  return true;
}
function profileHtml(p, role, en){
  const T = role === "teacher";
  return `<div class="meta">${T ? (en ? `${esc(p.country || "—")} · ${esc(p.accent || "")} · ${esc(p.years || 0)} yrs · <b>${usd(p.rate)}</b>/class` : `${esc(p.country || "—")} · ${esc(p.accent || "")} · 경력 ${esc(p.years || 0)}년 · <b>${usd(p.rate)}</b>/회`) : `${esc(p.who)}${p.guardian ? ` (보호자 ${esc(p.guardian)})` : ""} · ${esc(p.level)} · 예산 <b>${usd(p.budget)}</b>/회`}</div>
    <div class="meta">📞 ${esc(p.contact)}</div>
    <div style="margin-top:6px">${(p.goals || []).map(g => `<span class="tag violet">${esc(GOAL_NAME[g])}</span>`).join("")}</div>
    <div class="meta">🕒 ${(p.slots || []).map(slotName).join(", ") || "—"}</div>
    ${p.sample ? `<div class="meta">🎙 <a href="${esc(p.sample)}" target="_blank" rel="noopener noreferrer">녹음·영상 듣기</a></div>` : ""}
    ${p.memo ? `<div class="meta" style="white-space:pre-wrap">💬 ${esc(p.memo)}</div>` : ""}`;
}
let pendingApp = null;
function showApplication(o){
  pendingApp = o;
  const role = o.role === "teacher" ? "teacher" : "student", p = cleanProfile(o.profile || {}, role);
  const exists = person(o.id) || accounts.some(a => a.id === o.id);
  openSheet(`<h2>${role === "teacher" ? "🧑‍🏫 선생님" : "🎓 학생"} 등록 신청</h2>
    <div class="item"><div class="hd"><b>${esc(p.name)} <span class="muted mono">@${esc(o.id)}</span></b><span class="tag gray">${esc(o.at)}</span></div>${profileHtml(p, role)}</div>
    ${exists ? `<p class="bad">이미 등록된 아이디예요. 승인하면 비밀번호와 정보가 새 신청 내용으로 바뀝니다.</p>` : ""}
    ${role === "teacher" ? `<label>선생님 평가 점수 <small>0–100 · 녹음·경력 보고 마스터 채점 (70점 이상 추천)</small></label><input id="apScore" type="number" min="0" max="100" inputmode="numeric" placeholder="예: 75">` : ""}
    <div class="btns"><button class="danger" data-act="rejectApp">거절</button><button data-act="approveApp" style="flex:1">✓ 승인하고 인력풀에 등록</button></div>
    <div class="hint" id="apvMsg"></div>`);
}
async function approveApp(){
  const o = pendingApp; if (!o) return;
  const role = o.role === "teacher" ? "teacher" : "student";
  if (!ID_RE.test(o.id || "") || !o.box || !o.K) return toast("신청 내용이 올바르지 않아요");
  const p = {...cleanProfile(o.profile || {}, role), id: o.id, role, status: "active", appliedAt: o.at, confirmedAt: nowStamp(), account: true};
  if (role === "teacher"){ const sc = $("apScore").value; p.score = sc === "" ? null : Math.max(0, Math.min(100, +sc)); }
  const old = person(o.id);
  if (old) Object.assign(old, p); else D.people.push(p);
  keys[o.id] = o.K;
  accounts = accounts.filter(a => a.id !== o.id).concat({id: o.id, role, box: o.box, at: new Date().toISOString()});
  delete D.pageHash[o.id];
  D.inbox.push({id: uid("I"), at: nowStamp(), text: `${p.name}(${o.id}) ${role === "teacher" ? "선생님" : "학생"} 등록 승인`});
  pendingApp = null; closeSheet();
  await save(["keys","accounts"], `approve ${o.id}`);
  const text = `[영어 수업 허브] ${p.name}님, 등록이 승인되었습니다 🎉\n${role === "teacher" ? "Your registration is approved. " : ""}아이디 ${o.id} 로 로그인하세요:\n${hubUrl()}`;
  poolSeg = role; tab = "pool"; renderMaster();
  openSheet(`<h2>✓ 승인 완료</h2><p>${esc(p.name)}님을 인력풀에 등록했어요. 아래 안내를 보내세요.</p><textarea readonly rows="4">${esc(text)}</textarea>
    <div class="btns"><button data-act="shareText" data-text="${esc(text)}">💬 카카오톡 보내기</button><button class="ghost" data-act="close">닫기</button></div>`);
}
async function receiveMsg(o){
  const K = keys[o.from];
  const body = JSON.stringify({from: o.from, kind: o.kind, ref: o.ref, text: o.text, at: o.at});
  if (!K || o.mac !== await hmac(K, body)) { toast("확인할 수 없는 메시지예요 (회원 키 불일치)"); return; }
  const p = person(o.from) || {name: o.from};
  if (o.kind === "paid"){
    const l = D.ledger.find(x => x.id === o.ref && x.kind === "in");
    if (l && l.status === "requested"){ l.status = "reported"; l.reportedAt = o.at; l.note = String(o.text || "").slice(0, 200); }
    D.inbox.push({id: uid("I"), at: nowStamp(), text: `💸 ${p.name}: 송금했다고 알림 (${l ? krw(l.krw) : "?"}) ${o.text ? "— " + String(o.text).slice(0, 100) : ""}`});
    await save([], `payment reported ${o.from}`);
    tab = "pay"; renderMaster();
    if (l) openSheet(`<h2>💸 송금 알림</h2><p><b>${esc(p.name)}</b>님이 <b>${krw(l.krw)}</b> (${usd(l.usd)}) 송금했다고 알렸어요.</p>${o.text ? `<p class="muted">“${esc(o.text)}”</p>` : ""}
      <p class="hint">은행 앱에서 입금을 확인한 뒤 눌러 주세요.</p><div class="btns"><button data-act="confirmIn" data-id="${l.id}" style="flex:1">입금 확인 완료</button><button class="ghost" data-act="close">나중에</button></div>`);
  } else {
    D.inbox.push({id: uid("I"), at: nowStamp(), text: `✉️ ${p.name}: ${String(o.text || "").slice(0, 300)}`});
    await save([], `message ${o.from}`); tab = "home"; renderMaster();
  }
}

/* =====================================================================
   마스터 화면
   ===================================================================== */
function renderTabs(){
  const reported = D.ledger.filter(l => l.kind === "in" && l.status === "reported").length;
  const T = [["home","🏠","홈"],["pool","👥","인력풀"],["match","🤝","매칭"],["pay","💳","결제"],["set","⚙️","설정"]];
  $("tabsIn").innerHTML = T.map(([k, i, n]) => `<button data-act="tab" data-k="${k}" class="${tab === k ? "on" : ""}"><b>${i}</b>${n}${k === "pay" && reported ? `<span class="dot">${reported}</span>` : ""}</button>`).join("");
}
function renderMaster(){
  if (!D) return;
  renderTabs();
  const V = {home: mHome, pool: mPool, match: mMatch, pay: mPay, set: mSet}[tab] || mHome;
  $("view").innerHTML = V(); window.scrollTo(0, 0);
}
function money(){
  const inC = D.ledger.filter(l => l.kind === "in" && l.status === "confirmed").reduce((s, l) => s + (+l.usd || 0), 0);
  const inDue = D.ledger.filter(l => l.kind === "in" && l.status !== "confirmed").reduce((s, l) => s + (+l.krw || 0), 0);
  const outP = D.ledger.filter(l => l.kind === "out" && l.status === "paid").reduce((s, l) => s + (+l.usd || 0), 0);
  const outDue = D.ledger.filter(l => l.kind === "out" && l.status !== "paid").reduce((s, l) => s + (+l.usd || 0), 0);
  return {inC, inDue, outP, outDue};
}
function mHome(){
  const st = D.people.filter(p => p.role === "student" && p.status === "active"), te = D.people.filter(p => p.role === "teacher" && p.status === "active");
  const act = D.matches.filter(m => m.status === "active"), M = money();
  const todos = [];
  D.ledger.filter(l => l.kind === "in" && l.status === "reported").forEach(l => { const p = person(l.sid) || {};
    todos.push(`<div class="item todo"><div class="hd"><b>💸 입금 확인 · ${esc(p.name)}</b><span class="money">${krw(l.krw)}</span></div><div class="meta">송금했다고 알림 ${esc(l.reportedAt || "")}${l.note ? " · " + esc(l.note) : ""}</div><div class="btns"><button class="sm" data-act="confirmIn" data-id="${l.id}">입금 확인</button></div></div>`); });
  act.forEach(m => { const g = progress(m); if (g.left <= 2 && !D.matches.some(x => x.prev === m.id)){ const s = person(m.sid) || {}, t = person(m.tid) || {};
    todos.push(`<div class="item todo blue"><div class="hd"><b>🔔 연장 안내 · ${esc(s.name)} ↔ ${esc(t.name)}</b><span class="tag warn">남은 ${g.left}회</span></div><div class="meta">2회 남았을 때 다음 ${D.settings.months}개월 수업료를 청구하세요.</div><div class="btns"><button class="sm" data-act="renew" data-id="${m.id}">다음 기간 만들기 + 청구</button></div></div>`); } });
  st.filter(s => !act.some(m => m.sid === s.id)).forEach(s => {
    const best = rank(s).filter(r => r.ok)[0];
    todos.push(`<div class="item todo ok"><div class="hd"><b>🤝 매칭 대기 · ${esc(s.name)}</b>${best ? `<span class="tag">추천 ${esc(best.t.name)} ${best.total}점</span>` : `<span class="tag bad">맞는 선생님 없음</span>`}</div><div class="meta">예산 ${usd(s.budget)} · ${(s.slots || []).length}칸 가능</div><div class="btns"><button class="sm" data-act="pickStudent" data-id="${s.id}">추천 보기</button></div></div>`); });
  D.ledger.filter(l => l.kind === "out" && l.status === "due").forEach(l => { const t = person(l.tid) || {};
    todos.push(`<div class="item todo"><div class="hd"><b>🧾 선생님 지급 · ${esc(t.name)}</b><span class="money">${usd(l.usd)}</span></div><div class="meta">${l.uzs ? uzs(l.uzs) + " · " : ""}학생 입금이 확인된 기간입니다.</div><div class="btns"><button class="sm" data-act="paidOut" data-id="${l.id}">지급 완료</button></div></div>`); });
  return `<div class="kpis">
      <div class="kpi"><div class="l">학생</div><div class="v">${st.length}</div></div>
      <div class="kpi"><div class="l">선생님</div><div class="v">${te.length}</div></div>
      <div class="kpi"><div class="l">진행 중 매칭</div><div class="v">${act.length}</div></div>
      <div class="kpi"><div class="l">받을 돈</div><div class="v money">${krw(M.inDue)}</div></div></div>
    <div class="card"><h2>할 일 <span class="muted" style="font-weight:400">${todos.length}</span></h2>${todos.join("") || `<div class="empty">지금은 할 일이 없어요 ✨</div>`}</div>
    <div class="card"><h2>카톡으로 받은 링크 열기</h2>
      <p class="hint">카카오톡 안 브라우저에서는 로그인이 안 되어 있을 수 있어요. 받은 신청·송금 알림 링크를 길게 눌러 복사한 뒤 여기에 붙여넣으세요.</p>
      <textarea id="pasteLink" rows="2" placeholder="https://…/hub.html#apply=…"></textarea>
      <div class="btns"><button data-act="openPasted">열기</button></div></div>
    <div class="card"><h2>등록 받기</h2><p class="hint">이 링크를 선생님·학생에게 보내면 직접 등록 신청을 할 수 있어요.</p>
      <div class="btns"><button class="ghost" data-act="shareText" data-text="${esc(`[영어 수업 허브] 아래 링크에서 선생님/학생 등록을 해 주세요.\nPlease sign up here:\n${hubUrl()}`)}">💬 등록 링크 보내기</button><a class="btn ghost" href="./">🗓 수업 달력 열기</a></div></div>
    ${D.inbox.length ? `<div class="card"><h2>최근 알림</h2>${D.inbox.slice(-8).reverse().map(i => `<div class="meta">${esc(i.at)} · ${esc(i.text)}</div>`).join("")}</div>` : ""}`;
}
function mPool(){
  const list = D.people.filter(p => p.role === poolSeg);
  return `<div class="seg"><button data-act="poolSeg" data-k="student" class="${poolSeg === "student" ? "on" : ""}">🎓 학생 ${D.people.filter(p => p.role === "student").length}</button><button data-act="poolSeg" data-k="teacher" class="${poolSeg === "teacher" ? "on" : ""}">🧑‍🏫 선생님 ${D.people.filter(p => p.role === "teacher").length}</button>
    <button class="ghost" data-act="addPerson" style="margin-left:auto">+ 직접 추가</button></div>
    ${list.length ? list.map(p => {
      const ms = matchesOf(p.id).filter(m => m.status === "active");
      const badge = p.role === "teacher" ? (p.score == null ? `<span class="tag warn">채점 전</span>` : p.score >= 70 ? `<span class="tag">${p.score}점 · 추천</span>` : p.score >= 60 ? `<span class="tag warn">${p.score}점 · 검토</span>` : `<span class="tag bad">${p.score}점 · 보류</span>`) : "";
      return `<div class="item"><div class="hd"><b>${esc(p.name)} <span class="muted mono" style="font-weight:400">@${esc(p.id)}</span></b><span>${badge}${p.status !== "active" ? `<span class="tag gray">중지</span>` : ""}${p.account ? "" : `<span class="tag gray">계정 없음</span>`}</span></div>
        ${profileHtml(p, p.role)}
        <div class="meta">매칭 ${ms.length ? ms.map(m => esc((person(p.role === "teacher" ? m.sid : m.tid) || {}).name)).join(", ") : "없음"}</div>
        <div class="btns">${p.role === "student" ? `<button class="sm" data-act="pickStudent" data-id="${p.id}">추천 선생님</button>` : `<button class="sm ghost" data-act="scoreT" data-id="${p.id}">채점</button>`}
          <button class="sm ghost" data-act="editPerson" data-id="${p.id}">수정</button>
          <button class="sm ghost" data-act="toggleStatus" data-id="${p.id}">${p.status === "active" ? "활동 중지" : "다시 활동"}</button>
          <button class="sm danger" data-act="delPerson" data-id="${p.id}">삭제</button></div></div>`; }).join("")
    : `<div class="card"><div class="empty">아직 없어요. 홈의 '등록 링크 보내기'로 신청을 받거나 직접 추가하세요.</div></div>`}`;
}
function mMatch(){
  const students = D.people.filter(p => p.role === "student" && p.status === "active");
  const s = person(sel.sid) || students[0];
  let rec = "";
  if (s){
    const R = rank(s);
    rec = `<div class="card"><h2>추천 선생님 → ${esc(s.name)}</h2><p class="hint">시간 겹침 40 · 목표 25 · 선생님 점수 20 · 가격 여유 15 (같으면 담당 학생 적은 순)</p>
      ${R.length ? R.map(r => `<div class="item" style="${r.ok ? "" : "opacity:.55"}"><div class="hd"><b>${esc(r.t.name)}</b><span class="score">${r.ok ? r.total : "—"}</span></div>
        <div class="bar"><i style="width:${r.ok ? r.total : 0}%"></i></div>
        <div class="breakdown">${r.ok ? `시간 ${r.parts.time} · 목표 ${r.parts.goal} · 평가 ${r.parts.score} · 가격 ${r.parts.price} · 담당 ${r.load}명` : "제외: " + r.why.map(esc).join(", ")}</div>
        <div class="meta">${usd(r.t.rate)}/회 · 겹치는 시간: ${r.ov.map(slotName).join(", ") || "없음"}</div>
        ${r.ok ? `<div class="btns"><button class="sm" data-act="newMatch" data-sid="${s.id}" data-tid="${r.t.id}">이 선생님으로 매칭</button></div>` : ""}</div>`).join("") : `<div class="empty">등록된 선생님이 없어요.</div>`}</div>`;
  }
  const ms = D.matches.slice().reverse();
  return `<div class="card"><h2>학생 고르기</h2>${students.length ? `<select id="pickS" data-change="pickS">${students.map(x => `<option value="${esc(x.id)}" ${s && x.id === s.id ? "selected" : ""}>${esc(x.name)} · 예산 ${usd(x.budget)}</option>`).join("")}</select>` : `<div class="empty">활동 중인 학생이 없어요.</div>`}</div>
    ${rec}
    <div class="card"><h2>매칭 목록</h2>${ms.length ? ms.map(m => { const g = progress(m), st = person(m.sid) || {}, te = person(m.tid) || {};
      return `<div class="item"><div class="hd"><b>${esc(st.name)} ↔ ${esc(te.name)}</b><span class="tag ${m.status === "active" ? "" : "gray"}">${m.status === "active" ? `${g.done}/${g.n}회` : "종료"}</span></div>
        <div class="meta">매주 ${DOW[m.dow]} ${esc(m.time)} (${m.dur}분, KST) · ${esc(m.start)}부터 ${m.months}개월 · 학생 ${usd(m.price)}/회 · 선생님 ${usd(m.pay)}/회</div>
        <div class="sess">${g.list.map(d => `<span class="${d < today() ? "done" : ""} ${d === g.next ? "next" : ""}">${kdate(d)}</span>`).join("")}</div>
        <div class="btns"><button class="sm ghost" data-act="matchMsg" data-id="${m.id}">안내 메시지</button>${m.status === "active" ? `<button class="sm ghost" data-act="renew" data-id="${m.id}">다음 기간</button><button class="sm danger" data-act="endMatch" data-id="${m.id}">종료</button>` : ""}</div></div>`; }).join("") : `<div class="empty">아직 매칭이 없어요.</div>`}</div>`;
}
function mPay(){
  const S = D.settings, M = money();
  const rows = D.ledger.slice().reverse().map(l => {
    const p = person(l.kind === "in" ? l.sid : l.tid) || {};
    const st = l.kind === "in" ? ({requested:["청구","warn"], reported:["송금 알림","blue"], confirmed:["입금 확인",""]}[l.status] || [l.status,"gray"])
      : ({planned:["예정","gray"], due:["지급할 차례","warn"], paid:["지급 완료",""]}[l.status] || [l.status,"gray"]);
    const btn = l.kind === "in" ? (l.status !== "confirmed" ? `<button class="sm" data-act="confirmIn" data-id="${l.id}">입금 확인</button> <button class="sm ghost" data-act="billMsg" data-id="${l.id}">청구 메시지</button>` : "")
      : (l.status !== "paid" ? `<button class="sm" data-act="paidOut" data-id="${l.id}">지급 완료</button>` : "");
    return `<div class="item"><div class="hd"><b>${l.kind === "in" ? "⬇️ 학생 → 나" : "⬆️ 나 → 선생님"} · ${esc(p.name)}</b><span class="tag ${st[1]}">${st[0]}</span></div>
      <div class="meta money">${l.n}회 · <b>${usd(l.usd)}</b>${l.kind === "in" ? ` = <b>${krw(l.krw)}</b>` : l.uzs ? ` = <b>${uzs(l.uzs)}</b>` : ""} ${l.rateAt ? `<span class="muted">(환율 ${esc(l.rateAt)})</span>` : ""}</div>
      <div class="meta">${esc(l.at)}${l.paidAt ? " → " + esc(l.paidAt) : ""}${l.note ? " · " + esc(l.note) : ""}</div>
      ${btn ? `<div class="btns">${btn}</div>` : ""}</div>`;
  }).join("");
  return `<div class="kpis">
      <div class="kpi"><div class="l">받은 수업료</div><div class="v money">${usd(M.inC)}</div></div>
      <div class="kpi"><div class="l">받을 돈</div><div class="v money">${krw(M.inDue)}</div></div>
      <div class="kpi"><div class="l">선생님 지급</div><div class="v money">${usd(M.outP)}</div></div>
      <div class="kpi"><div class="l">차액 (받은−지급)</div><div class="v money">${usd(M.inC - M.outP)}</div></div></div>
    ${!S.bankAcct && !S.tossId && !S.kakaoLink ? `<div class="card todo item"><b>먼저 받을 계좌를 설정하세요</b><div class="meta">설정 탭에서 은행 계좌·토스 아이디·카카오페이 송금 링크를 넣으면 학생 화면에 송금 버튼이 생겨요.</div><div class="btns"><button class="sm" data-act="tab" data-k="set">설정으로</button></div></div>` : ""}
    <div class="card"><h2>장부</h2>${rows || `<div class="empty">매칭을 만들면 청구가 자동으로 생겨요.</div>`}</div>`;
}
function mSet(){
  const S = D.settings;
  return `<div class="card"><h2>💳 수업료 받을 곳 <small class="muted" style="font-weight:400">학생 화면에만 보여요</small></h2>
      <div class="row2"><div><label>은행</label><input id="sBank" value="${esc(S.bankName)}" placeholder="카카오뱅크"></div><div><label>예금주</label><input id="sHolder" value="${esc(S.bankHolder)}"></div></div>
      <label>계좌번호</label><input id="sAcct" value="${esc(S.bankAcct)}" inputmode="numeric">
      <label>토스 아이디 <small>toss.me/아이디 — 토스 앱 › 전체 › 토스아이디</small></label><input id="sToss" value="${esc(S.tossId)}" autocapitalize="none" placeholder="예: edward">
      <label>카카오페이 송금 링크 <small>카카오페이 › 송금 › 송금코드 › 링크 복사 (https://qr.kakaopay.com/…)</small></label><input id="sKakao" value="${esc(S.kakaoLink)}" placeholder="https://qr.kakaopay.com/…">
      <p class="hint">계좌 정보는 비공개 저장소에 저장되고, 학생 화면에는 그 학생의 비밀번호로만 열리는 암호문으로 전달돼요.</p></div>
    <div class="card"><h2>💱 환율 · 수업 기본값</h2>
      <div class="row2"><div><label>1 USD = KRW <small>학생 청구</small></label><input id="sKrw" type="number" step="0.01" value="${esc(S.usdKrw || "")}"></div>
        <div><label>1 USD = UZS <small>선생님 지급 (CBU)</small></label><input id="sUzs" type="number" step="0.01" value="${esc(S.usdUzs || "")}"></div></div>
      <div class="hint">${S.rateAt ? `기준: ${esc(S.rateAt)} · ${esc(S.rateSrc)}` : "아직 환율이 없어요."} <a href="https://cbu.uz/en/arkhiv-kursov-valyut/" target="_blank" rel="noopener">CBU 공식 환율 확인</a></div>
      <div class="btns"><button class="ghost sm" data-act="fetchRate">🔄 오늘 환율 가져오기</button></div>
      <div class="row2"><div><label>기본 기간 (개월)</label><input id="sMonths" type="number" min="1" max="12" value="${esc(S.months)}"></div>
        <div><label>마스터 몫 % <small>선생님 수업료에 더해 학생 청구</small></label><input id="sMargin" type="number" min="0" max="100" value="${esc(S.margin)}"></div></div>
      <div class="btns"><button data-act="saveSet" class="block">설정 저장</button></div></div>
    <div class="card"><h2>🔐 보안</h2><p class="hint">허브 회원(선생님·학생)은 GitHub 권한이 없어요. 각자 자기 화면만 자기 비밀번호로 열 수 있고, 신청·송금 알림은 마스터만 열 수 있는 암호 링크로 옵니다. 마스터 로그인은 수업 달력 앱의 마스터 아이디와 같아요.</p></div>`;
}

/* ---------- 마스터 동작 ---------- */
function personForm(p, role){
  form = {role, slots: (p && p.slots) ? [...p.slots] : [], goals: (p && p.goals) ? [...p.goals] : []};
  openSheet(`<h2>${p ? "정보 수정" : (role === "teacher" ? "선생님 직접 추가" : "학생 직접 추가")}</h2>
    ${p ? "" : `<div class="seg"><button data-act="addPerson" data-role="student" class="${role === "student" ? "on" : ""}">🎓 학생</button><button data-act="addPerson" data-role="teacher" class="${role === "teacher" ? "on" : ""}">🧑‍🏫 선생님</button></div>
      <label>아이디 <small>구분용 (로그인 계정은 만들지 않음)</small></label><input id="pfId" autocapitalize="none" maxlength="20">`}
    ${profileFields(role, p, false)}
    <div class="btns"><button class="ghost" data-act="close">취소</button><button data-act="savePerson" data-id="${p ? esc(p.id) : ""}" style="flex:1">저장</button></div><div class="hint bad" id="pfMsg"></div>`);
}
async function savePerson(id){
  const role = form.role, p = readProfile(role), out = $("pfMsg");
  if (!p.name) return out.textContent = "이름을 입력하세요.";
  if (id){ Object.assign(person(id), p); }
  else {
    const nid = String($("pfId").value || "").trim().toLowerCase();
    if (!ID_RE.test(nid)) return out.textContent = "아이디: 영문 소문자·숫자 2–20자";
    if (person(nid) || accounts.some(a => a.id === nid)) return out.textContent = "이미 있는 아이디예요.";
    D.people.push({...p, id: nid, role, status: "active", confirmedAt: nowStamp(), account: false, score: null});
  }
  closeSheet(); poolSeg = role; renderMaster(); await save([], `person ${id || "add"}`);
}
function newMatchSheet(sid, tid, prev){
  const s = person(sid), t = person(tid), S = D.settings, r = scorePair(s, t);
  const slot = (r.ov[0] || (s.slots || [])[0] || "0-e"), [d0, b0] = slot.split("-");
  const B = BLOCKS.find(b => b[0] === b0) || BLOCKS[3];
  const price = Math.min(+s.budget || Infinity, Math.round((+t.rate || 0) * (1 + (+S.margin || 0) / 100) * 100) / 100);
  const P = prev || {dow: +d0, time: B[3], dur: S.dur || 25, start: nextDow(+d0), months: S.months || 3, price, pay: +t.rate || 0};
  openSheet(`<h2>🤝 ${esc(s.name)} ↔ ${esc(t.name)}</h2>
    <p class="hint">겹치는 시간: ${r.ov.map(slotName).join(", ") || "없음"}</p>
    <div class="row2"><div><label>요일</label><select id="mDow">${DOW.map((d, i) => `<option value="${i}" ${i === +P.dow ? "selected" : ""}>${d}요일</option>`).join("")}</select></div>
      <div><label>시작 시각 (KST)</label><input id="mTime" type="time" value="${esc(P.time)}"></div></div>
    <div class="row2"><div><label>첫 수업일</label><input id="mStart" type="date" value="${esc(P.start)}"></div>
      <div><label>기간 (개월)</label><input id="mMonths" type="number" min="1" max="12" value="${esc(P.months)}"></div></div>
    <div class="row2"><div><label>학생 수업료 /회 (USD)</label><input id="mPrice" type="number" step="0.5" value="${esc(P.price)}"></div>
      <div><label>선생님 지급 /회 (USD)</label><input id="mPay" type="number" step="0.5" value="${esc(P.pay)}"></div></div>
    <input id="mDur" type="hidden" value="${esc(P.dur)}">
    <div class="item" id="mPrev"></div>
    ${!S.usdKrw ? `<p class="bad hint">설정에서 환율(USD→KRW)을 먼저 넣으면 원화 청구액이 계산돼요.</p>` : ""}
    <div class="btns"><button class="ghost" data-act="close">취소</button><button data-act="createMatch" data-sid="${sid}" data-tid="${tid}" data-prev="${prev ? esc(prev.id) : ""}" style="flex:1">매칭 확정 + 청구 만들기</button></div>`);
  const upd = () => {
    const m = readMatch(); const n = sessionsOf(m).length;
    const sdate = m.start && parseD(m.start).getUTCDay() !== m.dow ? `<div class="bad">첫 수업일이 ${DOW[m.dow]}요일이 아니에요 → 그 다음 ${DOW[m.dow]}요일부터 계산</div>` : "";
    $("mPrev").innerHTML = `${sdate}<b>${n}회</b> (${m.start ? kdate(sessionsOf(m)[0] || m.start) : ""} ~ ${n ? kdate(sessionsOf(m)[n-1]) : ""})<br>
      학생 청구 <b>${usd(n * m.price)}</b>${S.usdKrw ? ` = <b>${krw(Math.round(n * m.price * S.usdKrw / 100) * 100)}</b>` : ""}<br>
      선생님 지급 <b>${usd(n * m.pay)}</b>${S.usdUzs ? ` = ${uzs(Math.round(n * m.pay * S.usdUzs / 1000) * 1000)}` : ""}<br>
      <span class="muted">마스터 차액 ${usd(n * (m.price - m.pay))}</span>`;
  };
  ["mDow","mTime","mStart","mMonths","mPrice","mPay"].forEach(id => $(id).addEventListener("input", upd)); upd();
}
function readMatch(){ return {dow: +$("mDow").value, time: TIME_RE.test($("mTime").value) ? $("mTime").value : "19:00", dur: +$("mDur").value || 25, start: $("mStart").value, months: Math.max(1, Math.min(12, +$("mMonths").value || 3)), price: Math.max(0, +$("mPrice").value || 0), pay: Math.max(0, +$("mPay").value || 0)}; }
function billFor(m, s){
  const S = D.settings, n = sessionsOf(m).length;
  return {id: uid("B"), kind: "in", mid: m.id, sid: m.sid, n, usd: Math.round(n * m.price * 100) / 100, krw: S.usdKrw ? Math.round(n * m.price * S.usdKrw / 100) * 100 : 0, rate: S.usdKrw, rateAt: S.rateAt, status: "requested", at: nowStamp()};
}
function payoutFor(m){
  const S = D.settings, n = sessionsOf(m).length;
  return {id: uid("P"), kind: "out", mid: m.id, tid: m.tid, n, usd: Math.round(n * m.pay * 100) / 100, uzs: S.usdUzs ? Math.round(n * m.pay * S.usdUzs / 1000) * 1000 : 0, rate: S.usdUzs, rateAt: S.rateAt, status: "planned", at: nowStamp()};
}
async function createMatch(sid, tid, prevId){
  const m = {id: uid("M"), sid, tid, ...readMatch(), status: "active", at: nowStamp()};
  if (!DATE_RE.test(m.start)) return toast("첫 수업일을 고르세요");
  if (!sessionsOf(m).length) return toast("기간 안에 수업이 없어요");
  if (prevId) m.prev = prevId;
  D.matches.push(m); const bill = billFor(m); D.ledger.push(bill, payoutFor(m));
  closeSheet(); tab = "match"; renderMaster();
  await save([], `match ${sid}-${tid}`);
  matchMsg(m.id);
}
function renewSheet(id){
  const m = D.matches.find(x => x.id === id); if (!m) return;
  const last = sessionsOf(m).slice(-1)[0] || today();
  newMatchSheet(m.sid, m.tid, {...m, start: fmtD(addDays(parseD(last), 7)), months: D.settings.months || m.months, id: m.id});
}
function matchMsg(id){
  const m = D.matches.find(x => x.id === id); if (!m) return;
  const s = person(m.sid) || {}, t = person(m.tid) || {}, b = D.ledger.find(l => l.mid === m.id && l.kind === "in"), ses = sessionsOf(m);
  const sTxt = `[영어 수업 허브] ${s.name}님, 수업이 매칭되었어요 🎉\n선생님: ${t.name}\n매주 ${DOW[m.dow]}요일 ${m.time} (${m.dur}분) · ${kdate(ses[0])} ~ ${kdate(ses[ses.length-1])} · ${ses.length}회\n수업료(선불): ${b ? krw(b.krw) + ` (${usd(b.usd)})` : usd(ses.length * m.price)}\n아래에서 로그인 → '결제'에서 토스·카카오페이·계좌로 보내고 '송금했어요'를 눌러 주세요.\n${hubUrl()}`;
  const tTxt = `[English Class Hub] Hi ${t.name}, you have a new student: ${s.name} (${s.level || ""}).\nEvery ${DOW_EN[m.dow]} ${m.time} KST (= ${tashkent(m.time)} Tashkent), ${m.dur} min · ${ses[0]} ~ ${ses[ses.length-1]} · ${ses.length} classes.\nLog in to see details: ${hubUrl()}`;
  openSheet(`<h2>📨 안내 메시지</h2>
    <h3>학생에게</h3><textarea readonly rows="7">${esc(sTxt)}</textarea><div class="btns"><button class="sm" data-act="shareText" data-text="${esc(sTxt)}">💬 학생에게 보내기</button></div>
    <h3>선생님에게</h3><textarea readonly rows="5">${esc(tTxt)}</textarea><div class="btns"><button class="sm" data-act="shareText" data-text="${esc(tTxt)}">💬 선생님에게 보내기</button></div>
    <div class="btns"><button class="ghost block" data-act="close">닫기</button></div>`);
}
const tashkent = tm => { const [h, mi] = tm.split(":").map(Number); return `${String((h + 20) % 24).padStart(2, "0")}:${String(mi).padStart(2, "0")}`; };
function billMsg(id){
  const l = D.ledger.find(x => x.id === id); if (!l) return; const s = person(l.sid) || {};
  const txt = `[영어 수업 허브] ${s.name}님, 수업료 안내드려요.\n${l.n}회 · ${krw(l.krw)} (${usd(l.usd)})\n로그인 → '결제'에서 송금 후 '송금했어요'를 눌러 주세요.\n${hubUrl()}`;
  share(txt);
}
let fetchedRate = null;
async function fetchRate(){
  toast("환율 가져오는 중…");
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD"); const j = await r.json();
    if (j.result !== "success") throw new Error("응답 오류");
    $("sKrw").value = Math.round(j.rates.KRW * 100) / 100; $("sUzs").value = Math.round(j.rates.UZS * 100) / 100;
    fetchedRate = {krw: +$("sKrw").value, uzs: +$("sUzs").value, at: kstStampFrom(j.time_last_update_unix)};
    toast("가져왔어요 — '설정 저장'을 눌러 주세요");
  } catch(e) { toast("가져오기 실패 — 직접 입력해 주세요"); }
}
function kstStampFrom(unix){ const p = kst(new Date(unix * 1000)); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; }
async function saveSet(){
  const S = D.settings, v = id => $(id).value.trim();
  const k = v("sKakao"); if (k && !/^https:\/\/(qr\.kakaopay\.com|link\.kakaopay\.com)\/\S+$/.test(k)) return toast("카카오페이 송금 링크 형식이 아니에요");
  const krwV = +v("sKrw"), uzsV = +v("sUzs");
  if (fetchedRate && krwV === fetchedRate.krw && uzsV === fetchedRate.uzs){ S.rateAt = fetchedRate.at; S.rateSrc = "open.er-api.com (CBU 공식값과 조금 다를 수 있음)"; }
  else if (krwV !== +S.usdKrw || uzsV !== +S.usdUzs){ S.rateAt = nowStamp(); S.rateSrc = "직접 입력"; }
  fetchedRate = null;
  Object.assign(S, {bankName: v("sBank").slice(0, 30), bankHolder: v("sHolder").slice(0, 30), bankAcct: v("sAcct").replace(/[^\d-]/g, "").slice(0, 30), tossId: v("sToss").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40), kakaoLink: k,
    usdKrw: krwV || 0, usdUzs: uzsV || 0, months: Math.max(1, Math.min(12, +v("sMonths") || 3)), margin: Math.max(0, Math.min(100, +v("sMargin") || 0))});
  // 아직 입금 전인 청구는 새 환율로 다시 계산
  D.ledger.forEach(l => { if (l.kind === "in" && l.status === "requested" && S.usdKrw){ l.krw = Math.round(l.usd * S.usdKrw / 100) * 100; l.rate = S.usdKrw; l.rateAt = S.rateAt; }
    if (l.kind === "out" && l.status !== "paid" && S.usdUzs){ l.uzs = Math.round(l.usd * S.usdUzs / 1000) * 1000; l.rate = S.usdUzs; l.rateAt = S.rateAt; } });
  await save([], "settings"); renderMaster();
}
async function confirmIn(id){
  const l = D.ledger.find(x => x.id === id); if (!l) return;
  if (!confirm(`${krw(l.krw)} 입금을 확인했나요?`)) return;
  l.status = "confirmed"; l.paidAt = nowStamp();
  const o = D.ledger.find(x => x.kind === "out" && x.mid === l.mid && x.status === "planned"); if (o) o.status = "due";
  closeSheet(); renderMaster(); await save([], `payment confirmed ${l.sid}`);
}
async function paidOut(id){
  const l = D.ledger.find(x => x.id === id); if (!l) return;
  if (!confirm(`선생님에게 ${usd(l.usd)}${l.uzs ? " (" + uzs(l.uzs) + ")" : ""} 지급했나요?`)) return;
  l.status = "paid"; l.paidAt = nowStamp(); renderMaster(); await save([], `payout ${l.tid}`);
}
async function delPerson(id, btn){
  if (btn.dataset.arm !== "1"){ btn.dataset.arm = "1"; btn.textContent = "정말 삭제?"; return; }
  if (D.matches.some(m => (m.sid === id || m.tid === id) && m.status === "active")) return toast("진행 중인 매칭을 먼저 종료하세요");
  D.people = D.people.filter(p => p.id !== id); const hadAcct = accounts.some(a => a.id === id);
  accounts = accounts.filter(a => a.id !== id); delete keys[id]; delete D.pageHash[id];
  renderMaster(); await save(hadAcct ? ["keys","accounts"] : [], `remove ${id}`);
  if (hadAcct) await ghDel(ACCESS, `hub/p/${id}.json`, `Hub: remove page ${id}`);
}

/* =====================================================================
   회원 화면 (선생님·학생)
   ===================================================================== */
async function loadMember(){
  $("logoutBtn").style.display = "";
  setChrome("영어 수업 허브", "", false);
  $("view").innerHTML = `<div class="card"><div class="empty">불러오는 중… Loading…</div></div>`;
  try {
    const g = await ghGet(ACCESS, `hub/p/${sess.id}.json`, false);
    if (!g.data) throw new Error("화면이 아직 준비되지 않았어요. 잠시 뒤 다시 열어 주세요. · Not ready yet.");
    page = await decWith(sess.K, g.data);
  } catch(e) {
    if (e.name === "OperationError"){ logout(); return; }
    $("view").innerHTML = `<div class="card"><p class="bad">${esc(e.message)}</p><button data-act="reload">다시 시도 · Retry</button></div>`; return;
  }
  renderMember();
}
function renderMember(){
  const p = page, T = p.role === "teacher";
  setChrome(T ? "My classes" : "내 수업", (T ? "🧑‍🏫 " : "🎓 ") + p.name, false);
  const t = today(), ms = p.matches.filter(m => m.status === "active" || m.sessions.some(d => d >= t));
  const classes = ms.length ? ms.map(m => { const left = m.sessions.filter(d => d >= t), next = left[0];
    return `<div class="item"><div class="hd"><b>${T ? "🎓 " : "🧑‍🏫 "}${esc(m.with)}</b><span class="tag">${m.sessions.length - left.length}/${m.sessions.length}</span></div>
      <div class="meta">${T ? `Every ${DOW_EN[m.dow]} ${esc(m.time)} KST = <b>${tashkent(m.time)} Tashkent</b> · ${m.dur} min` : `매주 ${DOW[m.dow]}요일 ${esc(m.time)} · ${m.dur}분`}</div>
      ${next ? `<div class="meta">${T ? "Next" : "다음 수업"}: <b>${T ? next : kdate(next)}</b> · ${T ? "remaining" : "남은"} ${left.length}${T ? "" : "회"}</div>` : ""}
      <div class="sess">${m.sessions.map(d => `<span class="${d < t ? "done" : ""} ${d === next ? "next" : ""}">${T ? d.slice(5) : kdate(d)}</span>`).join("")}</div></div>`; }).join("")
    : `<div class="empty">${T ? "No matched students yet. The master will contact you." : "아직 매칭 전이에요. 마스터가 선생님을 찾고 있어요."}</div>`;
  const bills = p.bills.slice().reverse();
  const billHtml = T ? bills.map(b => `<div class="item"><div class="hd"><b>${b.n} classes · ${usd(b.usd)}</b><span class="tag ${b.status === "paid" ? "" : "gray"}">${b.status === "paid" ? "Paid" : b.status === "due" ? "To be paid" : "Scheduled"}</span></div>
      <div class="meta">${b.uzs ? uzs(b.uzs) + " · " : ""}${b.status === "paid" ? "paid " + esc(b.paidAt) : "after the student's payment is confirmed"}</div></div>`).join("")
    : bills.map(b => `<div class="item ${b.status === "requested" ? "todo" : ""}"><div class="hd"><b>${b.n}회 수업료</b><span class="tag ${b.status === "confirmed" ? "" : b.status === "reported" ? "blue" : "warn"}">${b.status === "confirmed" ? "입금 확인" : b.status === "reported" ? "확인 중" : "결제 필요"}</span></div>
      <div class="big money">${krw(b.krw)}</div><div class="meta">${usd(b.usd)} · 1 USD = ${(+b.rate || 0).toLocaleString("ko-KR")}원 (${esc(b.rateAt || "")})</div>
      ${b.status === "requested" ? `<div class="btns"><button class="block" data-act="payNow" data-id="${b.id}">결제하기</button></div>` : b.status === "reported" ? `<div class="meta">마스터가 입금을 확인하고 있어요.</div>` : `<div class="meta">${esc(b.paidAt || "")} 확인 완료 ✓</div>`}</div>`).join("");
  $("view").innerHTML = `
    <div class="card"><h2>${T ? "📅 My students" : "📅 수업 일정"}</h2>${classes}</div>
    <div class="card"><h2>${T ? "💵 Payouts" : "💳 결제"}</h2>${billHtml || `<div class="empty">${T ? "No payouts yet." : "청구된 수업료가 없어요."}</div>`}
      ${T ? `<p class="hint">Fees flow student → master → teacher. Your payout is sent after the student's payment is confirmed.</p>` : ""}</div>
    <div class="card"><h2>${T ? "👤 Profile" : "👤 내 정보"}</h2>${profileHtml(p.profile, p.role, T)}
      <div class="btns"><button class="ghost sm" data-act="msgMaster">${T ? "✉️ Message the master" : "✉️ 마스터에게 메시지"}</button><button class="ghost sm" data-act="reload">${T ? "Refresh" : "새로고침"}</button></div>
      <p class="hint">${T ? "To change your info or password, message the master." : "정보·비밀번호 변경은 마스터에게 메시지를 보내 주세요."} · ${esc(p.at.slice(0, 16).replace("T", " "))} UTC 기준</p></div>`;
}
function payNow(id){
  const b = page.bills.find(x => x.id === id), P = page.pay || {}; if (!b) return;
  const acct = P.bankAcct ? `${P.bankName} ${P.bankAcct} (${P.bankHolder})` : "";
  openSheet(`<h2>💳 수업료 보내기</h2>
    <div class="big money">${krw(b.krw)}</div><div class="hint">${b.n}회 · ${usd(b.usd)} · 받는 사람: ${esc(P.bankHolder || "마스터")}</div>
    <div class="pay">
      ${P.tossId ? `<a class="btn toss" href="https://toss.me/${encodeURIComponent(P.tossId)}" target="_blank" rel="noopener noreferrer"><b>🔵</b> 토스로 보내기 <span class="muted">(금액 ${krw(b.krw)} 입력)</span></a>` : ""}
      ${P.kakaoLink ? `<a class="btn kakao" href="${esc(P.kakaoLink)}" target="_blank" rel="noopener noreferrer"><b>🟡</b> 카카오페이로 보내기 <span class="muted">(금액 ${krw(b.krw)} 입력)</span></a>` : ""}
      ${acct ? `<div class="acctbox"><b>🏦 계좌이체</b> · 카카오뱅크·은행 앱 어디서나<br><span class="mono">${esc(acct)}</span>
        <div class="btns"><button class="sm" data-act="copyText" data-text="${esc(P.bankAcct)}">계좌번호 복사</button><button class="sm ghost" data-act="copyText" data-text="${esc(String(b.krw))}">금액 복사</button></div></div>` : ""}
      ${!P.tossId && !P.kakaoLink && !acct ? `<p class="bad">마스터가 아직 받을 계좌를 설정하지 않았어요.</p>` : ""}
    </div>
    <label>보낸 사람 이름 / 메모 <small>선택</small></label><input id="payNote" maxlength="100" placeholder="예: 홍길동 (아빠 계좌)">
    <div class="btns"><button class="block" data-act="reportPaid" data-id="${b.id}">✅ 송금했어요 — 마스터에게 알리기</button></div>
    <p class="hint">누르면 마스터만 열 수 있는 확인 링크가 카카오톡으로 전달돼요. 입금이 확인되면 '입금 확인'으로 바뀝니다.</p>`);
}
async function sendToMaster(kind, ref, text){
  const body = {from: sess.id, kind, ref, text: String(text || "").slice(0, 300), at: nowStamp()};
  const mac = await hmac(sess.K, JSON.stringify(body));
  const link = hubUrl() + "#msg=" + await seal({t:"msg", ...body, mac});
  return link;
}
async function reportPaid(id){
  const b = page.bills.find(x => x.id === id); const note = $("payNote").value.trim();
  try {
    const link = await sendToMaster("paid", id, note);
    b.status = "reported"; closeSheet(); renderMember();
    share(`[영어 수업 허브] ${page.name}: 수업료 ${krw(b.krw)} 송금했어요.${note ? " (" + note + ")" : ""}\n확인 링크(마스터 전용):\n${link}`);
  } catch(e) { toast(e.message); }
}
function msgMasterSheet(){
  const T = page.role === "teacher";
  openSheet(`<h2>✉️ ${T ? "Message the master" : "마스터에게 메시지"}</h2><textarea id="mmText" rows="4" maxlength="300" placeholder="${T ? "e.g. schedule change request" : "예: 일정 변경, 정보 수정 요청"}"></textarea>
    <div class="btns"><button class="ghost" data-act="close">${T ? "Cancel" : "취소"}</button><button data-act="sendMsg" style="flex:1">${T ? "Send via KakaoTalk" : "카카오톡으로 보내기"}</button></div>`);
}
async function sendMsg(){
  const text = $("mmText").value.trim(); if (!text) return;
  try { const link = await sendToMaster("note", "", text); closeSheet(); share(`[영어 수업 허브] ${page.name}: ${text}\n${link}`); } catch(e) { toast(e.message); }
}

/* =====================================================================
   이벤트 · 라우팅
   ===================================================================== */
const ACT = {
  login: () => doLogin(), home: () => route(), reload: () => route(), close: () => closeSheet(),
  apply: d => renderApply(d.role),
  resend: () => { try { const p = JSON.parse(localStorage.getItem(PENDKEY)); share(`[영어 수업 허브] 등록 신청 · ${p.id}\n${p.link}`); } catch(e) {} },
  slot: (d, b) => { const i = form.slots.indexOf(d.k); i < 0 ? form.slots.push(d.k) : form.slots.splice(i, 1); b.classList.toggle("on"); },
  goal: (d, b) => { const i = form.goals.indexOf(d.k); i < 0 ? form.goals.push(d.k) : form.goals.splice(i, 1); b.classList.toggle("on"); },
  submitApply: () => submitApply(),
  shareText: d => share(d.text), copyText: d => copy(d.text),
  approveApp: () => approveApp(), rejectApp: () => { pendingApp = null; closeSheet(); toast("거절했어요 (저장되지 않음)"); },
  tab: d => { tab = d.k; renderMaster(); }, poolSeg: d => { poolSeg = d.k; renderMaster(); },
  pickStudent: d => { sel.sid = d.id; tab = "match"; renderMaster(); },
  addPerson: d => personForm(null, d.role || poolSeg), editPerson: d => personForm(person(d.id), person(d.id).role), savePerson: d => savePerson(d.id),
  scoreT: d => { const p = person(d.id); const v = prompt(`${p.name} 선생님 점수 (0–100)\n녹음·경력·체험 수업을 보고 매겨 주세요. 70점 이상 추천.`, p.score ?? ""); if (v === null) return; p.score = v === "" ? null : Math.max(0, Math.min(100, +v || 0)); renderMaster(); save([], `score ${p.id}`); },
  toggleStatus: d => { const p = person(d.id); p.status = p.status === "active" ? "paused" : "active"; renderMaster(); save([], `status ${p.id}`); },
  delPerson: (d, b) => delPerson(d.id, b),
  newMatch: d => newMatchSheet(d.sid, d.tid), createMatch: d => createMatch(d.sid, d.tid, d.prev),
  renew: d => renewSheet(d.id), matchMsg: d => matchMsg(d.id),
  endMatch: d => { if (!confirm("이 매칭을 종료할까요? (기록은 남아요)")) return; const m = D.matches.find(x => x.id === d.id); m.status = "ended"; m.endedAt = nowStamp(); renderMaster(); save([], `end match ${m.id}`); },
  confirmIn: d => confirmIn(d.id), paidOut: d => paidOut(d.id), billMsg: d => billMsg(d.id),
  fetchRate: () => fetchRate(), saveSet: () => saveSet(),
  openPasted: async () => { const v = $("pasteLink").value.trim(); if (!(await handleHash(v))) toast("허브 신청·알림 링크가 아니에요"); },
  payNow: d => payNow(d.id), reportPaid: d => reportPaid(d.id), msgMaster: () => msgMasterSheet(), sendMsg: () => sendMsg(),
};
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const f = ACT[b.dataset.act]; if (!f) return;
  e.preventDefault(); f(b.dataset, b);
});
document.addEventListener("change", e => { if (e.target.dataset.change === "pickS"){ sel.sid = e.target.value; renderMaster(); } });
$("logoutBtn").onclick = logout;
window.addEventListener("hashchange", () => { if (isMaster() && D) handleHash().then(() => {}); else route(); });

async function route(){
  closeSheet();
  if (isMaster()) return loadMaster();
  if (sess && sess.id && sess.K) return loadMember();
  if (/#(apply|msg)=/.test(location.hash)){
    renderLogin({text: "마스터 전용 링크예요. 마스터 아이디로 로그인하면 바로 열립니다.", bad: false}); return;
  }
  renderLogin();
}
route();
