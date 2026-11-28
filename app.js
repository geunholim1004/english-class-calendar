const $ = id => document.getElementById(id);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^\d{2}:\d{2}$/;
const safeTime = (v, def) => TIME_RE.test(String(v || "")) ? v : def;
// 저장소에서 읽은 요청은 형식이 맞는 값만 남김 (조작된 값 차단)
function cleanReq(r){
  if (!r || typeof r !== "object") return null;
  const o = {...r};
  if (!DATE_RE.test(o.d || "") || !["edit","move"].includes(o.act) || !/^[A-Za-z0-9:]+$/.test(o.id || "")) return null;
  if (o.cause && !["me","teacher","mutual"].includes(o.cause)) o.cause = undefined;
  if (o.how && !["end","date"].includes(o.how)) o.how = "end";
  if (o.to && !DATE_RE.test(o.to)) return null;
  if ((o.act === "edit" || o.how === "date") && !o.to) return null;
  o.toTime = o.toTime ? safeTime(o.toTime, undefined) : undefined;
  o.at = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(o.at || "") ? o.at : "";
  o.decidedAt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(o.decidedAt || "") ? o.decidedAt : undefined;
  o.rid = String(o.rid || "").replace(/[^\w-]/g, "");
  o.by = String(o.by || "").replace(/[^a-z0-9._-]/g, "");
  o.name = String(o.name || "").slice(0, 40); o.reason = String(o.reason || "").slice(0, 300);
  if (!["pending","teacherOk","approved","rejected", undefined].includes(o.status)) o.status = "pending";
  o.byKind = o.byKind === "student" ? "student" : "teacher";
  o.decidedBy = o.decidedBy ? String(o.decidedBy).replace(/[^a-z0-9._-]/g, "").slice(0, 40) : undefined;
  o.auto = o.auto === true ? true : undefined; o.undone = o.undone === true ? true : undefined;
  o.undoReq = o.undoReq && typeof o.undoReq === "object" ? {by: String(o.undoReq.by || "").replace(/[^a-z0-9._-]/g, "").slice(0, 40), at: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(o.undoReq.at || "") ? o.undoReq.at : "", closed: o.undoReq.closed === true || undefined} : undefined;
  return o;
}
// 사용자가 입력한 글자는 화면에 그릴 때 반드시 이스케이프 (악성 코드 실행 방지)
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const KEY = "eng-class-state-v4", LOGKEY = "eng-class-log-v4", LANGKEY = "eng-class-lang";
let state = {}, log = [], extras = [], fixes = [], selected = null, lang = "ko", addDate = null, addPaid = "paid", calExpanded = false;
try { extras = JSON.parse(localStorage.getItem("eng-class-extras-v1") || "[]"); } catch(e) {}
try { calExpanded = localStorage.getItem("eng-class-cal6") === "1"; } catch(e) {}
try { state = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch(e) {}
try { log = JSON.parse(localStorage.getItem(LOGKEY) || "[]"); } catch(e) {}
try { lang = localStorage.getItem(LANGKEY) || "ko"; } catch(e) {}
function save(){ try { localStorage.setItem(KEY, JSON.stringify(state)); localStorage.setItem(LOGKEY, JSON.stringify(log)); localStorage.setItem("eng-class-extras-v1", JSON.stringify(extras)); } catch(e) {} queueRemoteSave(); }

/* ---------- 권한 & GitHub 동기화 (Roles & GitHub sync) ---------- */
// 저장소 위치: GitHub Pages 주소(owner.github.io/repo)에서 자동으로 읽고, 없으면 기본값
const DEFAULT_OWNER = "geunholim1004", DEFAULT_REPO = "english-class-calendar", LEGACY_DATA = "data/state.json", BRANCH = "main";
const AUTHKEY = "eng-class-gh-auth";
function repoCoords(){
  const h = location.hostname, seg = location.pathname.split("/").filter(Boolean);
  if (h.endsWith(".github.io")) return {owner: h.split(".")[0], repo: seg[0] || DEFAULT_REPO};
  return {owner: DEFAULT_OWNER, repo: DEFAULT_REPO};
}
let auth = null;   // {token, owner, repo, login}
try { auth = JSON.parse(localStorage.getItem(AUTHKEY) || "null"); } catch(e) {}
const isMaster = () => !!(auth && auth.token && auth.role !== "sub");
const isSub = () => !!(auth && auth.token && auth.role === "sub");
const isEditor = () => isMaster() || isSub();
// 사용자 역할: 선생님(피드백 작성) / 학생(AI 코치 사용). 예전 계정은 역할이 없으면 선생님
const isStudent = () => isSub() && auth.kind === "student";
const isTeacher = () => isSub() && !isStudent();
const roleOf = u => (u && u.role === "student") ? "student" : "teacher";
let remoteSha = null, lastUpdated = null, syncStatus = "", saveTimer = null, loadingRemote = false;
const SETTING_IDS = ["start","months","count","time","dur","price","alertN","minNotice","autoMin","rate","rateDate","zoom"];
function snapshot(){ const settings = {}; SETTING_IDS.forEach(id => settings[id] = $(id).value);
  return {version:1, updatedAt:new Date().toISOString(), settings, state, log, extras, fixes}; }
let baseState = null;   // 선생님·학생 화면: 저장소에서 받은 달력 (선생님이 승인한 학생 요청을 그 위에 바로 보여 줌)
function applySnapshot(d){
  if (!d) return;
  if (d.settings) SETTING_IDS.forEach(id => { if (d.settings[id] !== undefined) $(id).value = d.settings[id]; });
  state = d.state || {}; baseState = state; log = d.log || []; extras = d.extras || []; fixes = Array.isArray(d.fixes) ? d.fixes : []; lastUpdated = d.updatedAt || null;
  try { localStorage.setItem(KEY, JSON.stringify(state)); localStorage.setItem(LOGKEY, JSON.stringify(log)); } catch(e) {}
}
const b64enc = s => btoa(unescape(encodeURIComponent(s)));
const b64dec = s => decodeURIComponent(escape(atob(s.replace(/\n/g,""))));
function apiHeaders(){ const h = {"Accept":"application/vnd.github+json"}; if (isEditor()) h.Authorization = "Bearer " + auth.token; return h; }
/* ---------- 저장소 구조 ----------
   english-class-calendar (공개): 사이트 코드만 — 마스터만 쓰기
   english-class-private  (비공개): 전체 데이터·납부·영수증·보관 로그 — 마스터만
   english-class-share    (비공개): 선생님용 달력(금액 제외)·변경 요청 — 마스터 + 사용자
   english-class-access   (공개): 로그인용 암호화 정보 — 마스터 + 사용자            */
const SHARE_REPO = "english-class-share", ACCESS_REPO = "english-class-access";
let shareSha = null;
const ownerOf = () => (auth && auth.owner) || repoCoords().owner;
async function ghGet(repo, path, token){
  const headers = token ? {Accept:"application/vnd.github+json", Authorization:"Bearer " + token} : apiHeaders();
  const r = await fetch(`https://api.github.com/repos/${ownerOf()}/${repo}/contents/${path}?ref=${BRANCH}&t=${Date.now()}`, {headers, cache:"no-store"});
  if (r.status === 404) return {data: null, sha: null};
  if (!r.ok) throw new Error(`${repo} HTTP ${r.status}`);
  const j = await r.json(); return {data: JSON.parse(b64dec(j.content)), sha: j.sha};
}
async function ghPut(repo, path, obj, message, sha, token, retry){
  const headers = token ? {Accept:"application/vnd.github+json", Authorization:"Bearer " + token} : apiHeaders();
  const body = {message, content: b64enc(JSON.stringify(obj, null, 1)), branch: BRANCH}; if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${ownerOf()}/${repo}/contents/${path}`, {method:"PUT", headers:{...headers, "Content-Type":"application/json"}, body: JSON.stringify(body)});
  if ((r.status === 409 || r.status === 422) && !retry){ const g = await ghGet(repo, path, token); return ghPut(repo, path, obj, message, g.sha, token, true); }
  if (!r.ok) throw new Error(`${repo} HTTP ${r.status}`);
  return (await r.json()).content.sha;
}
async function ghDelete(repo, path, message){
  const g = await fetch(`https://api.github.com/repos/${ownerOf()}/${repo}/contents/${path}?ref=${BRANCH}&t=${Date.now()}`, {headers: apiHeaders(), cache:"no-store"});
  if (!g.ok) return;
  const {sha} = await g.json();
  await fetch(`https://api.github.com/repos/${ownerOf()}/${repo}/contents/${path}`, {method:"DELETE", headers:{...apiHeaders(), "Content-Type":"application/json"}, body: JSON.stringify({message, sha, branch: BRANCH})});
}
// 선생님용 사본: 금액(가격·환율) 빼고 저장
const MONEY_KEYS = ["price","rate","rateDate"];
function shareView(snap){ const settings = {...snap.settings}; MONEY_KEYS.forEach(k => delete settings[k]); const v = {...snap, settings}; delete v.fixes; return v; }
function lockView(on){ document.body.classList.toggle("locked", on); }
async function loadRemote(){
  if (!isEditor()){ lockView(true); setSync(""); render(); return; }       // 로그인 안 한 사람: 아무 데이터도 불러오지 않음
  lockView(false); loadingRemote = true; setSync(t("syncLoading"));
  try {
    if (isMaster()){
      const g = await ghGet(privRepo(), "state.json"); remoteSha = g.sha;
      if (!g.data){
        const old = await ghGet(auth.repo, LEGACY_DATA);                 // 예전 공개 저장소 데이터 → 옮기기
        if (old.data){ applySnapshot(old.data); loadingRemote = false; render(); await migrateFromPublic(); render(); return; }
      }
      applySnapshot(g.data);
      shareSha = (await ghGet(SHARE_REPO, "schedule.json")).sha;
    } else {
      applySnapshot((await ghGet(SHARE_REPO, "schedule.json")).data);
    }
  } catch(e) { loadingRemote = false; setSync(t("syncStoreFail")(e.message), true); render(); return; }
  loadingRemote = false;
  setSync(lastUpdated ? t("syncLoaded")(fmtStamp(lastUpdated)) : "");
  render();
}
async function migrateFromPublic(){
  setSync(t("syncMigrating"));
  try {
    const u = await ghGet(auth.repo, "data/users.json");
    if (u.data && !(await ghGet(ACCESS_REPO, "users.json")).data) await ghPut(ACCESS_REPO, "users.json", u.data, "Move users from the public site repo", null);
    const q = await ghGet(auth.repo, "data/requests.json");
    if (q.data && !(await ghGet(SHARE_REPO, "requests.json")).data) await ghPut(SHARE_REPO, "requests.json", q.data, "Move requests from the public site repo", null);
    if (!(await saveRemote())) throw new Error("save");
    for (const p of ["data/state.json","data/users.json","data/requests.json","data/sub.json"]) await ghDelete(auth.repo, p, "Remove data from the public site repo (moved to private repos)");
    setSync(t("syncMigrated"));
  } catch(e) { setSync(t("syncStoreFail")(e.message), true); }
}
function fmtStamp(iso){ const p = kstParts(new Date(iso)); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; }
function queueRemoteSave(){ if (!isMaster() || loadingRemote) return; clearTimeout(saveTimer); setSync(t("syncPending")); if (!confirming) saveTimer = setTimeout(confirmedSave, 1200); }
// 마스터 수정은 저장 직전에 비밀번호로 최종 확인 (설정 창이 열려 있으면 닫힐 때까지 기다림)
let confirming = false, confirmedUntil = 0;
async function confirmedSave(){
  if ($("settingsModal").classList.contains("on")){ saveTimer = setTimeout(confirmedSave, 800); return; }
  if (!(await confirmMaster())){ await loadRemote(); render(); setSync(t("pwCancelled"), true); return; }
  await saveRemote(); reconcilePayments();
}
function confirmMaster(){
  if (!isMaster()) return Promise.resolve(false);
  if (Date.now() < confirmedUntil) return Promise.resolve(true);
  confirming = true;
  return new Promise(async resolve => {
    const {m} = await fetchMasterBox();
    $("pwcHint").textContent = m ? t("pwcHintId")(m.id) : t("pwcHintTok");
    $("pwcIn").value = ""; $("pwcIn").placeholder = m ? "" : "github_pat_…"; $("pwcMsg").textContent = ""; $("pwcMsg").className = "hint";
    $("pwcModal").classList.add("on"); setTimeout(() => $("pwcIn").focus(), 50);
    const done = ok => { $("pwcModal").classList.remove("on"); $("pwcOk").onclick = $("pwcCancel").onclick = $("pwcIn").onkeydown = null; confirming = false; if (ok) confirmedUntil = Date.now() + 8000; resolve(ok); };
    $("pwcOk").onclick = async () => {
      const v = $("pwcIn").value; if (!v) return;
      $("pwcOk").disabled = true; $("pwcMsg").className = "hint"; $("pwcMsg").textContent = t("loginChecking");
      let ok = false;
      if (m){ try { ok = (await unlockToken(m.box, v)) === auth.token; } catch(e) { ok = false; } }
      else ok = v.trim() === auth.token;
      $("pwcOk").disabled = false;
      if (ok) done(true); else { $("pwcMsg").className = "hint bad"; $("pwcMsg").textContent = m ? t("pwcBadId") : t("pwcBadTok"); }
    };
    $("pwcIn").onkeydown = e => { if (e.key === "Enter") $("pwcOk").click(); };
    $("pwcCancel").onclick = () => done(false);
  });
}
async function saveRemote(){
  setSync(t("syncSaving"));
  try {
    const snap = snapshot(), msg = `Update class data (${fmtStamp(snap.updatedAt)})`;
    remoteSha = await ghPut(privRepo(), "state.json", snap, msg, remoteSha);
    shareSha = await ghPut(SHARE_REPO, "schedule.json", shareView(snap), msg, shareSha);
    lastUpdated = snap.updatedAt;
    setSync(t("syncSaved")(fmtStamp(snap.updatedAt)));
    return true;
  } catch(e) { setSync(t("syncFail")(e.message), true); return false; }
}
function setSync(msg, bad){ const el = $("syncStatus"); if (!el) return; el.textContent = msg; el.classList.toggle("bad", !!bad); }
function teacherLink(){ const {owner, repo} = isMaster() ? auth : repoCoords(); return `https://${owner}.github.io/${repo}/`; }
// 제목 아래 한 줄: 설정의 가격·시각·길이를 그대로 표시 (선생님 화면은 금액 없이)
function renderSub(){ const C = cfg(); document.querySelector(".sub").textContent = t(isMaster() ? "sub" : "subV")(usd(C.price), C.time, C.dur); }
function renderAcct(){
  const m = isMaster();
  renderSub();
  const sb = isSub();
  document.querySelector(".calHintEl").textContent = m ? t("calHint") : sb ? t("calHintS") : t("calHintV");
  document.body.classList.toggle("viewer", !m);
  document.body.classList.toggle("subm", sb);
  if (typeof renderPending === "function") renderPending();
  $("roleBadge").textContent = m ? t("roleMaster")(auth.login || auth.owner) : sb ? t(isStudent() ? "roleStudent" : "roleUser")(auth.name || auth.login) : t("roleViewer");
  $("coachLink").style.display = (m || sb) ? "" : "none";   // 코치: 마스터·학생·선생님 모두 (사용 횟수는 limits.html 에서 마스터가 정함)
  $("roleBadge").className = "badge " + (m ? "master" : sb ? "subm" : "viewer");
  $("loginBtn").style.display = (m || sb) ? "none" : "";
  $("logoutBtn").style.display = (m || sb) ? "" : "none";
  $("linkBtn").style.display = m ? "" : "none";
  SETTING_IDS.forEach(id => $(id).disabled = !m);
}
async function doLogin(){
  const owner = $("ghOwner").value.trim(), repo = $("ghRepo").value.trim(), token = $("ghToken").value.trim();
  const out = $("loginMsg"); out.className = "hint"; out.textContent = t("loginChecking");
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {headers:{"Accept":"application/vnd.github+json", Authorization:"Bearer "+token}});
    if (!r.ok) throw new Error(t("loginNoRepo")(r.status));
    const j = await r.json();
    if (!(j.permissions && (j.permissions.push || j.permissions.admin))) throw new Error(t("loginNoPush"));
    const u = await fetch("https://api.github.com/user", {headers:{Authorization:"Bearer "+token}}).then(x => x.ok ? x.json() : {}).catch(() => ({}));
    auth = {token, owner, repo, login: u.login || owner, privRepo: ($("ghPriv").value.trim() || PRIV_DEFAULT)};
    try { localStorage.setItem(AUTHKEY, JSON.stringify(auth)); } catch(e) {}
    $("loginModal").classList.remove("on"); $("ghToken").value = "";
    renderAcct(); await loadRemote(); loadPayments(); loadArchive(); loadRequests(); loadFeedback(); if (incoming) showReq();
  } catch(e) { out.className = "hint bad"; out.textContent = e.message; }
}


/* ---------- 언어 사전 (Language dictionary) ---------- */
const L = {
ko: {
  syncStoreFail:e => `저장소를 읽거나 쓸 수 없어요 (${e}). 설정에서 저장소 연결 상태를 확인하세요.`, syncMigrating:"공개 저장소의 데이터를 비공개 저장소로 옮기는 중…", syncMigrated:"데이터를 비공개 저장소로 옮겼어요 ✓",
  uTokNeeds:r => `선생님용 토큰에 ${r} 쓰기 권한이 없어요. Repository access에 추가하고 Contents: Read and write로 하세요.`,
  uTokTooWide:r => `이 토큰은 ${r}에도 쓸 수 있어요. 선생님용은 english-class-share와 english-class-access만 선택해서 새로 만드세요.`,
  hRepos:"저장소 연결 상태", repoMissing:"✗ 표시된 저장소를 만들거나 마스터 토큰의 Repository access에 추가하세요.",
  lockTitle:"🔒 로그인이 필요합니다", lockBody:"등록된 사용자만 수업 달력을 볼 수 있어요. 아이디가 없으면 등록을 요청하세요.", lockLogin:"로그인", lockReg:"등록 요청",

  rqWhatTeacherDate:(d,tm) => `이동 → ${d} ${tm} (선생님 사유 · 보너스 1회)`, rqSameDayBonus:" (선생님 사유 · 한국 시간 기준 당일 변경 → 보너스 1회)",
  nfTitle:"📢 단톡방 공지", nfCopy:"복사", nfShare:"💬 카톡 단톡방에 보내기", nfHint:"휴대폰: 버튼 → 카카오톡 → 단톡방 선택 → 전송. PC: 복사된 글을 단톡방에 붙여넣기. 이어서 바뀌는 내용은 이 공지에 함께 모여요.",
  nfCopied:"복사했어요 · 카톡 단톡방에 붙여넣으세요", nfSentHint:"단톡방 공지를 보냈어요", nfUnsent:n => `📢 안 보낸 공지 ${n}`,
  nfTd:(ok, what, stu, tch) => `${what} — ${tch} 선생님이 ${stu}님 요청을 ${ok ? "승인했어요. 달력에 반영됐어요." : "거절했어요."}`,
  nfReq:(who, what, why, to) => `${who}님 변경 요청: ${what}${why ? " (" + why + ")" : ""} — ${to === "teacher" ? "선생님" : "Edward"} 승인 대기`,
  nfCancel:(who, what) => `${who}님이 요청을 취소했어요: ${what}`,
  nfFb:(cls, who) => `${cls} 수업 피드백이 올라왔어요 (${who}). 사이트에서 확인하세요.`,
  nfZoom:"Zoom 수업 링크가 바뀌었어요. 사이트의 Zoom 입장 버튼으로 들어오세요 (수업 5분 전부터 열려요).",
  hPend:"승인 대기 요청", hPendT:"학생 변경 요청 · 승인해 주세요", pendWaitT:"선생님 승인 대기 (마스터가 바로 승인해도 돼요)", tdAskOk:n => `${n}님의 요청을 승인할까요? 승인하면 달력 일정이 바로 바뀝니다.`, tdAskNo:n => `${n}님의 요청을 거절할까요?`, tdDone:"승인했어요 · 달력이 바뀌었어요", tdYes:"✓ 승인 확정", tdNo:"취소", tdYesNo:"✕ 거절 확정", tdDeclined:"거절했어요", tdApplied:n => `선생님이 승인한 학생 요청 ${n}건을 달력에 반영했어요`, tdNeedPw:n => `선생님이 승인한 학생 요청 ${n}건 반영 — 비밀번호를 확인해 주세요`, tdLater:"반영을 미뤘어요 · 승인 대기 카드에서 언제든 반영할 수 있어요", tdApplyBtn:"📥 달력에 반영", tdMsg:(ok, what, stu, tch, url) => `[영어 수업 변경 요청 ${ok ? "승인" : "거절"}]\n• ${what}\n${stu}님의 요청을 ${tch} 선생님이 ${ok ? "승인했어요. 달력이 바뀌었어요." : "거절했어요."}\n${url}`, pendBy:(n,id,at) => `${n} (${id}) · ${at}`, pendApprove:"✓ 승인", pendReject:"✕ 거절",
  sAuto:"학생 요청 자동 반영 (선생님이 답하지 않을 때)", autoOpt:{0:"끄기", 10:"수업 10분 전", 30:"수업 30분 전 (추천)", 60:"수업 1시간 전", 180:"수업 3시간 전", 1440:"수업 하루 전"},
  autoHint:"선생님이 놓쳤을 때를 위한 마지막 안전장치예요. 등록·하루 전·3시간 전에 알림 공지를 만들고, Zoom이 열리기 전에 반영해요.",
  bMut:"🤝 사전 합의 요청", bMe:"🙋 학생 사정", bTch:"👨‍🏫 선생님 사정", bStuReq:"🎓 학생 요청", bTchReq:"👨‍🏫 선생님 요청", bLate:"⚠ 늦은 요청 · 기준 미달",
  lateNote:"사전 합의 기준보다 늦게 낸 요청이라 기존 규칙대로 기록돼요 (학생 사정이면 선불 1회 차감 등).",
  autoIn:(when, left) => `⏱ 선생님 응답이 없으면 ${when}에 자동 반영 · ${left} 남음`, autoSoon:when => `⏰ 곧 자동 반영 (${when})`, autoOff:"자동 반영 꺼짐 · 선생님 또는 마스터가 처리해요", autoNoLate:"수업 직전에 낸 요청이라 자동 반영하지 않아요 · 선생님이 확인해 주세요",
  autoSame:"👀 이 카드와 자동 반영 시각은 학생·선생님 화면에 똑같이 보여요",
  remSteps:{filed:"요청 등록 공지", day:"하루 전 알림", three:"3시간 전 알림", due:"자동 반영"}, remSent:"✓", remWait:"예정",
  nfRemind:(who, what, due) => `확인 부탁드려요 🙏 ${who}님의 변경 요청이 아직 승인 대기 중이에요: ${what}. 답이 없으면 규칙에 따라 ${due}에 자동 반영돼요.`,
  nfAuto:(what, m) => `${what} 수업 변경 요청이 규칙에 따라 자동 반영되었어요 (수업 ${m} 전 기준). 바쁘셨을 텐데 따로 신경 쓰지 않으셔도 돼요. 다음 수업에서 뵐게요! 🙂`,
  autoDone:"✓ 자동 반영", autoTagNo:"선생님 응답 없음", autoRec:(at, ap) => `등록 ${at} → 자동 반영 ${ap}`,
  undoBtn:"↩ 되돌리기 요청 (→ 마스터)", undoSent:"↩ 되돌리기 요청을 보냈어요 · 마스터 확인 대기", undoAsk:(who, at) => `↩ ${who} 선생님이 되돌리기를 요청했어요 (${at})`,
  undoDo:"↩ 원래대로 되돌리기", undoKeep:"그대로 두기", undoDone:"되돌렸어요", undoKept:"그대로 두었어요",
  nfUndoReq:(who, what) => `${who} 선생님이 자동 반영된 요청의 되돌리기를 요청했어요: ${what} (마스터 확인 대기)`, nfUndone:what => `자동 반영된 변경을 원래대로 되돌렸어요: ${what}`,
  rqTagAuto:at => `자동 반영 · 선생님 응답 없음 · 등록 ${at}`, logUndo:x => `자동 반영 되돌림: ${x}`,
  mins:m => m >= 1440 ? "하루" : m >= 60 ? (m / 60) + "시간" : m + "분", leftFmt:ms => { const m = Math.max(0, Math.round(ms / 60e3)); return m >= 1440 ? Math.floor(m / 1440) + "일 " + Math.floor(m % 1440 / 60) + "시간" : m >= 60 ? Math.floor(m / 60) + "시간 " + (m % 60) + "분" : m + "분"; },
  autoTag:" (자동)", fbHas:"피드백 있음", fbDue:"피드백 작성 대기", fbHead:"선생님 피드백", fbNone:"아직 선생님 피드백이 없어요.",
  fbL:{topics:"오늘 배운 내용", expr:"핵심 표현·단어", good:"잘한 점·고칠 점", hw:"숙제·다음 준비"},
  fbPh:{topics:"예: 반도체 고객 미팅 롤플레이", expr:"예: lead time, ramp-up, yield", good:"예: 발음 좋음 / 시제 주의", hw:"예: 이메일 3문장 써 오기"},
  fbTitle:(d,l) => `${d} ${l} · 수업 피드백`, fbSave:"💾 피드백 저장", fbUpdate:"💾 피드백 수정", fbEmpty:"한 칸 이상 써 주세요.",
  fbSaved:"저장했어요 ✓ 아래 메시지를 카카오톡으로 보내 주세요.", fbShareBtn:"💬 카카오톡으로 보내기", fbCopyMsg:"메시지 복사",
  fbMsgHead:x => `[영어 수업 피드백] ${x}`, fbReplyL:"학생 답장", fbReplyPh:"질문이나 다음 수업에 하고 싶은 것", fbReplySave:"답장 저장 + 메시지 복사",
  fbReplied:"답장을 저장했어요 ✓", fbReplyCopied:"답장 포함 메시지를 복사했어요. 카카오톡에 붙여 넣으세요.", fbReplied2:"답장함",
  hFb:"수업 피드백", fbDueCnt:n => `✍ 작성 대기 ${n}`, fbNewCnt:n => `새 피드백 ${n}`, fbEmptyList:"끝난 수업이 생기면 여기에 피드백이 모입니다.",
  fbHint:"수업이 끝나면 자동으로 '완료'가 되고, 선생님이 ✍ 표시된 수업을 눌러 피드백을 남깁니다.",
  hMyReq:"내 변경 요청", myNone:"보낸 요청이 없어요.", st_pending:"⏳ 승인 대기", st_teacherOk:"✓ 선생님 승인 · 일정 변경됨", st_approved:"✓ 승인됨", st_rejected:"✕ 거절됨", myCancel:"요청 취소",
  rqSaveFail:e => `요청 저장 실패 (${e})`, rqAlready:"이 수업에는 이미 승인 대기 중인 요청이 있어요.",
  rqMsg2:o => `[영어 수업 변경 요청]\n${o.target}\n요청: ${o.what}\n사유: ${o.why}\n요청자: ${o.who}\n\n웹에서 확인·승인해 주세요 👇\n${o.url}`,

  rrLink:"아이디가 없나요? 등록 요청", hRR:"사용 등록 요청", rrId:"희망 아이디 (영문 소문자·숫자)", rrName:"이름", rrSend:"📨 등록 요청 보내기", rrNeedName:"이름을 입력하세요.",
  rrText:o => `[영어 수업 앱 등록 요청]\n이름: ${o.name}\n역할: ${o.role}\n희망 아이디: ${o.id}\n\n승인 링크 👇\n${o.url}`,
  rrHint:"이 내용을 카카오톡으로 Edward에게 보내세요. 승인되면 이 기기에서 사이트를 다시 열어 비밀번호만 정하면 됩니다.",
  rrWaiting:id => `'${id}' 등록 승인 대기 중`, rrApproved:"승인됐어요! 사용할 비밀번호를 정하면 등록이 끝납니다.",
  hRA:"사용 등록 요청", raApprove:"✓ 승인", raReject:"✕ 거절", raNeedTok:"설정 → 사용자 관리에서 선생님용 토큰을 먼저 저장하세요.",
  raExists:"이미 사용 중인 아이디예요. 승인하면 기존 등록을 덮어씁니다.", raDone:n => `승인했어요. ${n}님이 같은 기기에서 사이트를 다시 열면 비밀번호를 정해 등록이 끝납니다.`,

  roleUser:n => `선생님 · ${n}`, roleStudent:n => `학생 · ${n}`, uRoleL:"역할", roleT:"선생님", roleS:"학생", loginTabSub:"아이디 로그인", uIdL:"아이디", subPwL:"비밀번호", subLoginBtn:"로그인",
  uNoId:"등록되지 않은 아이디예요.", uNotRegistered:"아직 등록이 끝나지 않았어요. 카톡으로 받은 초대 링크에서 먼저 등록하세요.",
  hReg:"사용자 등록", regCode:"초대 코드 (카톡으로 받은 8자리)", regPw1:"사용할 비밀번호 (8자 이상)", regPw2:"비밀번호 확인", regBtn:"등록하고 시작",
  regPwRule:"비밀번호는 8자 이상, 두 번 똑같이 입력하세요.", regNoInvite:"이 아이디로 대기 중인 초대가 없어요. Edward에게 다시 초대를 요청하세요.", regBadCode:"초대 코드가 맞지 않아요.",
  regHint:"등록하면 이 기기에서 바로 로그인됩니다. 다른 기기에서는 아이디와 비밀번호로 로그인하세요.",
  advRepo:"고급: 저장소 이름 (보통 바꿀 필요 없음)", midTokNote:"토큰으로 로그인해야 할 때(토큰 재발급 등)는 사이트 주소 끝에 #master 를 붙여 여세요.",
  pwcTitle:"🔒 마스터 비밀번호 확인", pwcOk:"확인하고 저장", pwcCancel:"취소 (변경 되돌리기)", pwCancelled:"저장을 취소해 변경을 되돌렸어요",
  pwcHintId:id => `변경 내용을 저장하려면 마스터 아이디(${id})의 비밀번호를 입력하세요.`, pwcHintTok:"변경 내용을 저장하려면 마스터 토큰을 입력하세요. (설정에서 마스터 아이디를 정하면 비밀번호로 확인할 수 있어요)",
  pwcBadId:"비밀번호가 맞지 않아요. (마스터 토큰을 재발급했다면 설정에서 마스터 아이디를 다시 저장하세요)", pwcBadTok:"토큰이 맞지 않아요.",
  hMid:"마스터 아이디 로그인 (다른 기기용)", midPw1:"비밀번호 (12자 이상)", midPw2:"비밀번호 확인", midSave:"저장", midDel:"삭제",
  midHelp:"다른 휴대폰·PC에서는 로그인 → 아이디 로그인 탭에 이 아이디와 비밀번호를 넣으면 마스터로 들어옵니다. 마스터 토큰은 이 비밀번호로 암호화(PBKDF2 60만 회 + AES-GCM)되어 저장되며, 원문과 비밀번호는 어디에도 저장되지 않습니다. 남이 추측하기 어려운 긴 비밀번호를 쓰세요.",
  midSet:(id, at) => `설정됨: 아이디 ${id} · ${at}`, midUnset:"아직 없음 — 아이디와 비밀번호를 정하면 다른 기기에서 토큰 없이 로그인할 수 있어요.",
  midPwRule:"비밀번호는 12자 이상이고, 두 칸이 같아야 해요.", midIdRule:"아이디는 영문 소문자·숫자·.-_ 2~20자로 정하세요.", midIdTaken:"이미 선생님(사용자) 아이디로 쓰이고 있어요. 다른 아이디를 정하세요.",
  midSaved:"저장했어요 ✓ 다른 기기에서 이 아이디로 로그인해 보세요.", midDelAsk:"마스터 아이디 로그인을 삭제할까요? (토큰 로그인은 그대로 됩니다)", midDeleted:"삭제했어요.", midBadTok:"이 아이디로 열린 토큰이 비공개 저장소에 접근할 수 없어요. 마스터 토큰이 만료·재발급됐다면 토큰으로 로그인한 뒤 설정에서 다시 저장하세요.",
  hUsers:"사용자 관리 (보조 마스터)", uTokL:"선생님용 GitHub 토큰", uTokSave:"토큰 저장", uTokChange:"토큰 바꾸기", uTokSet:"선생님용 토큰: 설정됨 (이 기기)", uTokUnset:"선생님용 토큰: 아직 없음",
  uTokHelp:'<a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">토큰을 하나 더</a> 만드세요: Only select repositories → <b>english-class-share, english-class-access 두 개만</b> → Contents: Read and write. 초대할 때 이 토큰이 사용자별 비밀번호로 잠겨 저장됩니다.',
  uNewId:"아이디 (영문 소문자·숫자)", uNewName:"이름", uInviteBtn:"＋ 초대 만들기", uNone:"등록된 사용자가 없어요.",
  uActive:d => `사용 중 · 등록 ${d}`, uInvited:d => `초대됨 (등록 대기) · ${d}`, uReinvite:"다시 초대", uDelete:"삭제",
  uNeedTok:"먼저 선생님용 토큰을 저장하세요.", uIdRule:"아이디는 영문 소문자·숫자·.-_ 2~20자로 정하세요.", uDup:"이미 있는 아이디예요. 목록에서 '다시 초대'를 누르세요.",
  uDeleted:"삭제했어요. 이미 로그인된 기기까지 막으려면 GitHub에서 선생님용 토큰을 Delete하고 새 토큰으로 다시 초대하세요.",
  uInviteMsg:o => `[영어 수업 앱 초대]\n${o.name}님, 영어 수업 달력에 초대합니다.\n\n아이디: ${o.id}\n초대 코드: ${o.code}\n\n아래 링크를 열고 초대 코드와 사용할 비밀번호를 입력해 등록하세요.\n${o.link}`,
  uInviteHint:"이 메시지를 카톡으로 보내세요. 초대 코드는 한 번 등록하면 더 이상 쓸 수 없습니다.",

  roleSub:"", calHintS:"예정된 수업을 누르면 수정·이동을 요청할 수 있어요. Edward가 웹에서 승인하면 반영됩니다.", byTeacher:"선생님",
  loginTabMaster:"마스터 (Edward)",
  subBadPw:"비밀번호가 맞지 않아요.",
 
 
  subTooWide:r => `이 토큰은 비공개 저장소(${r})도 열 수 있어요. 선생님용은 english-class-calendar만 선택해서 새로 만드세요.`,
 
 

  calHintV:"보기 전용입니다. 수정·이동 요청은 등록된 사용자가 로그인해야 할 수 있어요.",
  rcStudent:"학생 사유", rqReason:"사유", rqNotePh:"자세한 내용 (선택)", rqSend:"📨 변경 요청 보내기", rqCopy:"요청 복사",
  rqdSend:"✔ 이대로 보내기", rqdBack:"수정하기", rqdShare:"💬 카카오톡으로 보내기", rqdSaving:"저장 중…", rqdCopied:"복사했어요. 카카오톡에 붙여 넣어 Edward에게 보내 주세요.",
  rqdAskTitle:"이 내용으로 변경 요청을 보낼까요?", rqdAskHint:"보내면 승인 대기로 저장되고, Edward가 승인해야 달력에 반영됩니다.",
  rqdDoneTitle:"요청을 보냈어요 ✓", rqdDoneHint:"승인 대기로 저장됐어요. 아래 내용을 카카오톡으로 Edward에게 보내 알려 주세요.",
  rqOutHint:"요청이 승인 대기로 저장됐어요. 이 내용을 카카오톡으로 Edward에게 보내 알려 주세요.",
  rqReasons:["선생님 개인 사정","선생님 출장·이동","건강 문제","인터넷·기술 문제","학생 요청","공휴일·명절","기타"],
  rqTitle:(d,x) => `${d} · ${x} 변경 요청`, rqPick:"수정 또는 이동을 고르세요.", rqNeedCause:"사유가 누구에게 있는지 고르세요.", rqNeedDate:"새 날짜를 고르세요.",
  rqPvEdit:(d,tm) => `같은 수업을 ${d} ${tm}(으)로 바꾸자는 요청입니다.`, rqPvFoot:"요청은 Edward(마스터)가 승인해야 반영됩니다.",
  rqMsg:(o) => `[영어 수업 변경 요청]\n${o.target}\n요청: ${o.what}\n사유: ${o.why}\n\n승인 링크 👇\n${o.url}`,
  rqWhatEdit:(d,tm) => `수정 → ${d} ${tm}`, rqWhatEnd:"이동 → 마지막 수업 다음 (자동)", rqWhatDate:(d,tm) => `이동 → ${d} ${tm}`,
  rqWhatTeacher:"이동 → 마지막 수업 다음 (선생님 사유 · 한국 시간 당일 → 패널티 보너스 1회)", rqNoPenalty:" (선생님 사유 · 미리 연락 → 패널티 없음)",
  rqInTitle:"선생님 변경 요청", rqApprove:"✓ 승인하고 적용", rqReject:"✕ 거절", rqNeedLogin:"마스터로 로그인해야 승인할 수 있어요.",
  rqTarget:"대상", rqWhat:"요청", rqWhy:"사유", rqWhen:"요청 시각", rqStale:"⚠ 요청 이후 이 수업의 날짜나 상태가 바뀌었습니다. 확인 후 승인하세요.",
  rqGone:"요청한 수업을 찾을 수 없어요 (이미 삭제·변경됨).", rqTag:"선생님 요청", rqTagS:"학생 요청", rqTagOk:w => `${w} 승인`, rqRejected:(x) => `선생님 변경 요청 거절: ${x}`,

  logDel:"기록에서 지우기", logClear:"🗑 전체 지우기", logClearQ:"정말 전체 지울까요? 한 번 더", dlArch:"⬇ 보관 로그(CSV)",
  archHead:["시각","내용","상태"], archKept:"보관", archDeleted:d => `화면에서 삭제 (${d})`,
  logHintM:"지운 기록도 비공개 저장소의 보관 로그(log-archive.json)에 남습니다. 1년이 지난 기록은 수업별 마지막 변경 1건만 남기고 자동 정리됩니다.",

  dlCsv:"⬇ 엑셀(CSV)", dlTxt:"⬇ 텍스트(TXT)", csvHead:["시각","내용"], logFileTitle:"영어 수업 변경 기록", logCountTxt:n => `${n}건`,

  hPay:"수업료 납부 기록", payAdd:"＋ 납부 기록", payNone:"아직 납부 기록이 없어요.", payLoading:"불러오는 중…",
  payNoRepo:r => `비공개 저장소 '${r}'에 접근할 수 없어요. 저장소를 만들고(Private) 토큰의 Repository access에 추가했는지 확인하세요.`,
  pthDate:"납부일", pthPeriod:"기간", pthCls:"횟수", pthRcpt:"영수증", pthMemo:"메모",
  payTotal:(n,u,z) => `누적 ${n}건 · ${u} · ${z}`,
  hPayForm:"수업료 납부 기록", pfPeriod:"납부 기간", pfCur:"이번 기간", pfNext:"다음 기간", pfDate:"납부일", pfCls:"수업 횟수",
  pfPrice:"1회 금액 (USD)", pfRate:"환율 (1 USD = UZS)", pfRateDate:"환율 기준일", pfUzs:"실제 납부액 (UZS)",
  pfCalc:(n,p,u,r,z) => `계산: ${n}회 × ${p} = ${u} × ${r} = ${z}`, pfMemo:"메모 (납부 방법 등)", pfMemoPh:"예: Payme 송금, 카드, 현금",
  pfRcpt:"영수증 사진 (여러 장 가능)", pfRcptHint:"사진은 자동으로 줄여서(최대 1600px) 비공개 저장소에만 올라갑니다.",
  pfSave:"저장", pfSaving:(i,n) => `업로드 중… (${i}/${n})`, pfFail:e => `저장 실패 (${e})`, pfNeed:"납부일과 횟수를 확인하세요.",
  payDelQ:"정말 삭제?", logPay:(a,b) => `수업료 납부 기록 (${a} ~ ${b})`, logPayDel:(a,b) => `수업료 납부 기록 삭제 (${a} ~ ${b})`,
  bannerPaid:d => `✓ 다음 기간 납부 완료 (${d})`, bannerCurPaid:d => `✓ 이번 기간 납부 완료 (${d})`, bannerPayBtn:"납부 기록하기", privRepoL:"비공개 저장소 (납부·영수증)",

  addBtn:"＋ 수업 추가", expand:"6개월 펼치기 ▾", collapse:"접기 ▴", addTitle:d => `${d} · 수업 추가`, addKind:"수업료",
  addPaid:"유료 (선불에 추가)", addFree:"무료", addMemoPh:"예: 시험 대비 추가 수업", addApply:"추가",
  addPv:(paid,price) => paid ? `선불 수업이 1회 늘고 수업료에 ${price}가 더해집니다.` : "무료 수업으로 추가됩니다 (선불 횟수·금액 변화 없음).",
  addPvV:"수업이 1회 추가됩니다.",
  extraL:n => `추가${n}`, aDelX:"🗑 추가 수업 삭제", nExtra:p => p ? "추가 수업 (선불에 포함)" : "추가 수업 (무료)",
  logAdd:(d,tm,x,p) => `${d} ${tm} ${x} 추가 (${p ? "유료" : "무료"})`, logDel:(d,x) => `${d} ${x} 삭제`,
  basisExtra:f => `②+ 무료 추가 수업 ${f}회 ($0) — 선불 수업 수에는 포함되지 않음`, lg9:"추가 수업",

  roleMaster:u => `마스터 · ${u}`, roleViewer:"로그인 전", login:"로그인", logout:"로그아웃", teacherLinkBtn:"선생님 링크 복사", coachBtn:"🎓 AI 영어 코치",
  linkCopied:u => `선생님 링크를 복사했어요: ${u}`,
  syncLoading:"불러오는 중…", syncLoaded:d => `마지막 업데이트 ${d}`, syncPending:"변경 사항 저장 대기…", syncSaving:"GitHub에 저장 중…",
  syncSaved:d => `저장됨 · ${d}`, syncFail:e => `저장 실패 (${e}) — 토큰 권한을 확인하세요`, syncOffline:"GitHub에서 불러오지 못해 이 브라우저 데이터로 표시 중",
  hLogin:"마스터 로그인", ghOwner:"GitHub 계정", ghRepo:"저장소 이름", ghToken:"GitHub 토큰 (Fine-grained)",
  tokenHelp:'<a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">토큰 만들기</a> → Repository access: <b>Only select repositories</b>에서 이 저장소만 선택 → Permissions: <b>Contents = Read and write</b> → 생성 후 붙여넣기. 토큰은 이 브라우저에만 저장됩니다.',
  doLogin:"로그인", loginChecking:"확인 중…", loginNoRepo:s => `저장소에 접근할 수 없어요 (HTTP ${s}). 계정·저장소 이름·토큰을 확인하세요.`, loginNoPush:"이 토큰에는 쓰기 권한이 없어요. Contents = Read and write로 만들어 주세요.",
  docTitle:"영어 수업 달력 & 수업료 계산기 (USD→UZS)",
  title:"영어 수업 달력 & 수업료 계산기",
  sub:(p,tm,d) => `선불제 · 매주 일요일 ${tm} · ${d}분 = 1 Class · ${p} · CBU 공식 환율로 UZS 환산 · 취소·이동·보류·No-show를 사유와 함께 기록`,
  subV:(p,tm,d) => `매주 일요일 ${tm} · ${d}분 = 1 Class · 취소·이동·보류·No-show를 사유와 함께 기록`,
  hHolds:"보류 중인 수업", hKakao:"카카오톡 알림 메시지", copyMsg:"메시지 복사",
  kakaoHint:"복사 후 카카오톡 ‘나와의 채팅’이나 선생님 채팅방에 붙여넣으세요.",
  hLog:"변경 기록", copyLog:"기록 복사",
  logHint:"마스터가 바꾼 내용은 비공개 저장소에 저장되고, 선생님 화면에도 금액만 빼고 그대로 보입니다.",
  openSettings:"수업 설정 열기",
  kPrepaid:"선불 수업", kUsdL:"선불액", kUzsL:"선불액 (UZS)", kMiscL:"보너스 / 이동 / 보류", kLeftL:"남은 수업",
  lg1:"정규 예정", lg2:"완료", lg3:"보너스", lg4:"이동된 수업", lg5:"보류", lg6:"선생님 사유", lg7:"내 사유 취소·No-show(차감)", lg8:"정산 알림일",
  aUndo:"↩ 이동 취소 (원래 날짜로)", close:"닫기", qDone:"✓ 완료", qEdit:"✎ 수정", qMove:"→ 이동", hOther:"다른 처리", aCancel:"취소", aPlan:"예정으로 되돌리기",
  hCause:"사유는 누구에게 있나요?", cMe:"나 (학생)", cTeacher:"선생님", cMutual:"사전 합의",
  hHow:"어디로 옮길까요?", howEnd:"마지막 수업 다음으로 자동", howDate:"날짜 지정",
  lAgreed:"합의(연락)한 날 (한국 날짜)", lTo:"새 날짜", lToTime:"새 시각", lMemo:"사유 입력", memoPh:"예: 선생님 출장, 가족 행사, 인터넷 장애 …",
  apply:"적용", calHint:"수업을 누르면 완료·수정·이동·Hold·취소·No-show, 빈 날짜를 누르면 그날 수업 추가.",
  hBasis:"계산 근거", hList:"수업 목록", thDate:"날짜", thType:"구분", thStatus:"상태", thNotes:"비고 / 사유", hNext:"다음 선불 기간 미리 계산",
  fixBtn:"✏️ 수업 조건 정정 (강제 수정)", fixH:"수업 조건 정정", fixHint:"잘못 입력된 가격·수업 수를 바로잡습니다. 달력·기간·정산 알림이 새 조건으로 다시 계산되고, 정정 전후 내용은 기록으로 남습니다.",
  fixNow:"현재", fixNew:"정정 후", fixPrice:"1 Class 가격 (USD)", fixCount:"선불 수업 수", fixTotal:"선불액", fixEnd:"마지막 수업", fixReason:"정정 사유 (필수)", fixReasonPh:"예: 가격 오기 — 실제 1 Class $9",
  fixExtra:n => `유료 추가 수업 ${n}개는 선불 수업 수에 포함해 정리합니다 (달력에서 따로 표시되지 않음).`, fixApply:"정정 적용", fixNeed:"사유를 입력하고, 가격이나 수업 수를 바꿔 주세요.",
  fixOrphan:n => `새 수업 수 밖으로 빠지는 수업 ${n}개에 기록(이동·취소 등)이 있어요. 기록은 남지만 달력에서는 보이지 않습니다.`,
  fixHist:"정정 기록", fixDone:"정정했어요. 저장할 때 마스터 비밀번호를 확인합니다.",
  logFix:(a,b,e1,e2) => `🛠 수업 조건 정정: 선불 ${a}회 → ${b}회 · 마지막 수업 ${e1} → ${e2} (자세한 내용은 마스터 정정 기록)`,
  fixRow:(at,p1,p2,c1,c2,u1,u2,r) => `${at} · $${p1} × ${c1}회 = $${u1} → $${p2} × ${c2}회 = $${u2} · ${r}`,
  payWas:(n,e) => `정정 전 ${n}회 · ~${e}`,
  zCardT:(live) => live ? "🎥 Zoom 수업 · 지금 입장할 수 있어요" : "🎥 Zoom 수업", zNextL:"다음 수업",
  zIn:(m) => m < 60 ? `${m}분 후 시작` : m < 1440 ? `${Math.floor(m/60)}시간 ${m%60}분 후` : `${Math.floor(m/1440)}일 후`, zLeftL:(m) => `수업 중 · ${m}분 남음`,
  zBig:"🎥 Zoom 수업 입장하기", zPractice:"🎙 수업 전 AI 영어 코치로 연습하기", zUntil:"입장까지", zOpensHM:hm => `🔒 ${hm}에 열려요`, zTeachL:"AI 코치", zSetLink:"⚙ Zoom 링크 넣기 (한 번만)", zNoLinkT:"Edward가 Zoom 링크를 넣으면 여기서 입장할 수 있어요", zOpensAt2:(d, hm) => `🔒 ${d} ${hm}부터 입장할 수 있어요`,
  zTeacherL:"👨‍🏫 선생님", zStudentL:"🧑 학생 Edward", zOnS:"📷 ON", zOffS:"📷 OFF", zJoinedAt:(hm) => `${hm} 입장`, zNotYet:"아직 입장 안 함", zLateL:(m) => `${m}분 지났는데 아직 입장 안 함`,
  zLegend:"🔒 = 아직 입장 시간 전 · 파란 칸 = 지금 누르면 Zoom 입장 · 칸 안의 파란 점 = 상대방 입장함(ON), 회색 = 아직(OFF)",
  zLgPre:hm => [`🔒 아직 입장 시간 전 — ${hm}부터 파란 단추로 입장`, "수업 전 AI 코치 연습"], zLgLive:["파란 단추 = 지금 누르면 Zoom 입장", "파란 점 = 입장함 (ON)", "회색 점 = 아직 (OFF)", "빨간 칸 = 시작했는데 아직 안 들어옴"],
  zJoinChip:(l) => `🎥 ${l} 입장`, zLock:"16:55부터 Zoom 입장 버튼이 켜져요", zBarHead:(l, m) => m < 0 ? `${l} 수업 · ${-m}분 후 시작` : `${l} 수업 중 · ${m}분 남음`,
  zJoin:"🎥 Zoom 입장", zOther:(isT) => isT ? "Edward" : "선생님", zOn:"📷 ON · 입장함", zWait:"📷 OFF · 아직 입장 전", zLate:(m) => `📷 OFF · ${m}분 늦음`, zMe:"내 상태: 📷 ON",
  zChipTitle:"지금 누르면 Zoom 수업에 입장 · 점 🟢 = 상대방 입장함", zBadUrl:"Zoom 링크는 https://…zoom.us/… 형식이어야 해요",
  actBtn:"👀 선생님 활동 보기", actH:"선생님 활동 (마스터만 볼 수 있음)", actUser:"아이디", actLast:"마지막 활동", actVisits:"접속", actReqs:"요청", actFbs:"피드백", actList:"활동 기록 (최근 순)",
  actKind:{reqApprove:"학생 요청 승인", reqDecline:"학생 요청 거절", zoom:"Zoom 입장", login:"로그인",visit:"사이트 열람",request:"변경 요청",reqCancel:"요청 취소",feedback:"피드백 작성",fbDelete:"피드백 삭제",register:"가입 완료"},
  actNever:"기록 없음", actNone:"아직 기록이 없어요.", actGit:"GitHub 저장 기록",
  actNote:"접속(열람)은 이번 업데이트부터 기록됩니다. 그 전의 가입·요청·피드백은 GitHub 저장 기록에서 찾아 보여 줍니다. 같은 기기에서 30분 안에 다시 열면 한 번으로 셉니다.",
  fbEditB:"✏️ 편집", fbDelB:"🗑 초기화(삭제)", fbDelAsk:"이 수업의 피드백을 지울까요? 학생 답장도 함께 지워집니다.", fbDeleted:"피드백을 지웠어요.", fbEditSave:"편집 저장", fbEdited:"피드백을 고쳤어요.",
  hSettings:"나의 수업 설정", sStart:"시작일", sMonths:"선불 기간(개월)", sCount:"선불 수업 수 (빈칸 = 기간 안 일요일 전부)", sTime:"수업 시각", sZoom:"Zoom 수업 링크 (수업 5분 전부터 첫 화면 버튼이 켜짐)", sDur:"수업 길이(분)", sPrice:"1 Class 가격 (USD)",
  sAlert:"알림: 남은 수업 몇 회", sNotice:"이동·Hold 사전 합의 기준 (수업 며칠 전까지)", sRateDate:"환율 고시일",
  cbuHint:'결제 전에 <a href="https://cbu.uz/en/arkhiv-kursov-valyut/" target="_blank" rel="noopener">CBU 환율 아카이브</a>에서 최신 값을 확인해 입력하세요.',
  sAsof:"기준일 (알림 미리보기용, 비우면 오늘)", sDone:"완료", sHint:"입력 즉시 달력과 금액이 다시 계산됩니다.",
  dow:["일","월","화","수","목","금","토"],
  kdate:(y,m,d,w) => `${y}.${String(m).padStart(2,"0")}.${String(d).padStart(2,"0")}(${w})`,
  monthHead:(y,m) => `${y}년 ${m}월`,
  times:n => `<small> 회</small>`, holdPlus:n => ` +보류 ${n}`,
  calTitle:(a,b) => `수업 달력 · ${a} ~ ${b}`,
  act:{plan:"예정", done:"완료", move:"이동", hold:"Hold", cancel:"취소", noshow:"No-show", edit:"수정"},
  cause:{me:"나", teacher:"선생님", mutual:"사전 합의"},
  status:(a,c) => `${a} · ${c} 사유`, edited:" (수정됨)",
  bonusL:n => `보너스${n}`, makeupL:x => `보강(${x})`,
  holdNote:n => ` 보류 중인 수업 ${n}회는 날짜가 정해지면 반영됩니다.`,
  fxTail:d => `CBU ${d} 기준 · 누르면 2010년~ 추세`,
  alertDue:(left,last) => `정산 알림 · 남은 수업 ${left}회 (마지막 수업 ${last})`,
  alertDueBody:(a,b,n,p,u,z) => `다음 선불 기간 ${a} ~ ${b} 일요일 ${n}회 × ${p} = <b>${u}</b> → ${z}. 결제 전 CBU 최신 환율로 갱신하세요.`,
  alertDueBodyV:(a,b,n) => `다음 기간 ${a} ~ ${b} · 일요일 ${n}회`,
  alertNext:(d,t) => `다음 정산 알림일: ${d} ${t}`,
  alertNextBody:(N,last) => `이날 수업 후 남은 수업이 ${N}회가 됩니다. 마지막 수업은 ${last}입니다.`,
  noHolds:"보류 중인 수업이 없어요.", pickDate:"날짜 정하기", noReason:"사유 없음",
  nEdited:d => `원래 ${d} → 수정`, nTBD:"날짜 미정", nConsumed:"선불 차감, 보강 없음",
  nBonus:d => `${d} 선생님 사유 보너스 (무료)`, nMakeup:(d,x) => `${d} ${x} 보강`,
  nReason:m => `사유: ${m}`, nContact:(d,n,late) => `연락 ${d} (${n}일 전${late?" ⚠기준 미달":""})`,
  inPrepaid:"선불 포함",
  listFoot:(p,b,m) => `선불 합계 (정규 ${p}회 · 보너스 ${b}회 무료 · 보강 ${m}회는 선불분)`,
  basis:(o) => [
    `① 선불 기간: ${o.ps} ~ ${o.pe}${o.count ? ` (시작일부터 매주 일요일 ${o.count}회)` : o.ext ? "" : ` (시작일 + ${o.months}개월 − 1일)`}`,
    `② 선불 수업 <b>${o.prepaid}회</b> — 매주 일요일 ${o.slot} (${o.dur}분 = 1 Class)`,
    `③ 선불액: ${o.prepaid}회 × ${o.price} = <b>${o.usd}</b> × ${o.rate} UZS (CBU ${o.rateDate}) = <b>${o.uzs} UZS</b>`,
    `④ 내 사유 취소·No-show ${o.consumed}회 → 선불 차감, 보강 없음`,
    `⑤ 선생님 사유 ${o.teacher}회 · 한국 시간 기준 수업 당일 변경, 또는 취소·No-show → 패널티 보너스 수업 총 ${o.bonus}회 ($0). 미리 연락한 변경은 패널티 없음`,
    `⑥ 사전 합의·내 사유 이동 ${o.relocated}회 · Hold ${o.holds}회 → 선불분 유지, 차감 없음`,
    `⑦ 실제 마지막 수업: ${o.last} · 정산 알림: 남은 수업 ${o.N}회가 되는 ${o.alert}`],
  next:(o) => [
    `기간: ${o.a} ~ ${o.b} (${o.count ? `마지막 수업 다음 일요일부터 ${o.count}회` : `마지막 수업 다음 날부터 ${o.months}개월`})`,
    `일요일 ${o.n}회: ${o.list}`,
    `${o.n}회 × ${o.price} = <b>${o.usd}</b> → × ${o.rate} = <b>${o.uzs} UZS</b>`],
  nextHint:h => `현재 입력된 환율로 계산한 예상값입니다.${h?" 보류 수업이 남아 있으면 날짜를 정한 뒤 다시 확인하세요.":""}`,
  noLog:"아직 기록이 없어요. 수업 상태를 바꾸면 여기에 남습니다.",
  msg:(o) => `[영어 수업 선불 정산 알림]
선불 기간: ${o.ps} ~ ${o.pe}
수업: 매주 일요일 ${o.slot} (${o.dur}분 = 1 Class)
선불: ${o.prepaid}회 × ${o.price} = ${o.usd}
환율: 1 USD = ${o.rate} UZS (CBU ${o.rateDate})
금액: ${o.uzs}${o.changed?`\n\n변경 내역\n${o.changed}`:""}
남은 수업: ${o.left}회 · 마지막 수업: ${o.last}

다음 선불 기간 ${o.na} ~ ${o.nb}
${o.nn}회 × ${o.price} = ${o.nusd} ≈ ${o.nuzs}`,
  copied:"복사됐어요. 카카오톡에 붙여넣으세요.", logCopied:"기록을 복사했어요.", copyFail:"자동 복사가 막혀 있어요. 텍스트를 직접 선택해 복사하세요.", noLogTxt:"(기록 없음)",
  origBonus:(d,x) => ` · ${d} ${x} 선생님 사유 보너스`, origMakeup:(d,x) => ` · ${d} ${x}의 보강`, nowIs:s => `현재: ${s}`,
  datesEdit:"새 날짜·시각 (같은 수업을 그대로 옮김)", datesMove:"연락한 날과 새 날짜",
  pv:{ holdPenalty:`<b>선생님 사유 · 당일 보류 (한국 시간 기준):</b> 날짜 미정으로 보류하고, 마지막 수업 다음 일요일에 <b>패널티 보너스 수업 1회($0)</b>가 생깁니다.`, noPenalty:"선생님 사유지만 수업 전날 이전(한국 시간 기준)에 연락해 패널티 보너스는 없습니다.", teacherDate:`<b>선생님 사유 · 당일 변경 (한국 시간 기준):</b> 지정한 날짜로 옮기고, 마지막 수업 다음 일요일에 <b>보너스 수업 1회($0)</b>가 새로 생깁니다. 사유가 기록에 남습니다.`, editBonus:`<b>선생님 사유 · 당일 변경 (한국 시간 기준):</b> 날짜·시각만 바꾸고 <b>보너스 수업 1회($0)</b>가 무조건 추가됩니다.`, editNoBonus:"선생님 사유지만 수업 당일(한국 시간 기준) 변경이 아니라 보너스는 없습니다 (날짜·시각만 변경).", delX:"이 추가 수업을 지웁니다. 유료였다면 선불 횟수와 금액도 원래대로 돌아갑니다.", undo:(d,x) => `원래 수업 ${d} ${x}을(를) 되살리고, 거기서 생긴 보강·보너스를 모두 지웁니다.`, already:"이미 예정 상태예요. 바꿀 것이 없습니다.", pick:"위에서 할 일을 고르세요.", done:"이 수업을 완료로 표시합니다.", plan:"예정 상태로 되돌리고, 이 수업에서 생긴 보강·보너스를 해제합니다.",
    edit:"같은 수업의 날짜·시각만 바꿉니다. 선불 차감이나 보너스는 없습니다.", cause:"사유가 누구에게 있는지 고르세요.",
    teacher:`<b>선생님 사유 · 당일(한국 시간) 변경 또는 취소·No-show:</b> 이 수업은 마지막 수업 다음 일요일로 자동 이동(보강)되고, 그다음 주에 <b>패널티 보너스 수업 1회($0)</b>가 새로 생깁니다. 사유가 기록에 남습니다.`,
    consumed:a => `내 사유 ${a}: 선불 1회가 차감되고 보강은 없습니다. 기록에 남습니다.`,
    hold:"날짜 미정으로 보류합니다 (선불 유지).", toDate:"지정한 날짜로 옮깁니다 (선불 유지).", toEnd:"마지막 수업 다음 일요일로 자동 이동합니다 (선불 유지).",
    head:(a,c,w) => `${a} · ${c} 사유: ${w}`,
    notice:(n,min,late) => `수업 ${n}일 전 연락 · 기준 ${min}일 전 ${late?"<b>미달</b> — 기록에 ‘기준 미달’로 남습니다. 연락 없이 빠지는 경우라면 ‘취소 · 나’가 맞습니다.":"충족"}`,
    needDate:"새 날짜를 고르세요." },
  logEdit:(d,t) => `수정 (${d} ${t})`, logFreed:k => ` · 기존 ${k} 해제`, logMade:k => ` · 생성: ${k}`,
  fxPrefix:"1 USD =", fxName:{KRW:"원화", JPY:"엔화", CNY:"위안", UZS:"솜"}, fxTab:{KRW:"원화 KRW", JPY:"엔화 JPY", CNY:"위안화 CNY", UZS:"솜 UZS", IDX:"4개 통화 비교 (2010=100)"},
  fxTitle:x => `환율 추세 · ${x}`, fxCompare:"4개 통화 비교", fxIdxTitle:"2010년 평균을 100으로 놓은 1 USD당 각 통화 (높을수록 달러 강세 / 해당 통화 약세)",
  fxUnitTitle:(u,n) => `1 USD = ? ${u} (${n})`, fxYear:"연도",
  fxChange:(p,up) => `2010년 대비 ${p}% ${up?"상승 (달러 강세)":"하락 (달러 약세)"} · `,
  fxBasis:d => `2010–2025는 연평균, 마지막 점(2026.11)은 CBU ${d} 고시 교차환율입니다.`,
  fxSrc:{KRW:"2010–2025 연평균: 미 연준 G.5A (FRED AEXKOUS)", JPY:"2010–2025 연평균: 미 연준 G.5A (FRED AEXJPUS)", CNY:"2010–2025 연평균: 미 연준 G.5A (FRED AEXCHUS)",
    UZS:"2010–2023 연평균: FRED XRNCUSUZA618NRUG · 2024–2025 연평균: TradersUnion 일별 종가 평균. 2017년 9월 환율 자유화로 급등"},
  fxCross:"2026.11 원화·엔화·위안화 = CBU의 USD/UZS ÷ 각 통화/UZS (원화는 CBU 소수점 둘째 자리 반올림 때문에 ±1원 정도 오차).",
},
en: {
  syncStoreFail:e => `Can’t read or write the repositories (${e}). Check the repository status in Settings.`, syncMigrating:"Moving data from the public repo to the private repos…", syncMigrated:"Data moved to the private repos ✓",
  uTokNeeds:r => `The teacher token can’t write to ${r}. Add it under Repository access with Contents: Read and write.`,
  uTokTooWide:r => `This token can also write to ${r}. Create a new one with only english-class-share and english-class-access selected.`,
  hRepos:"Repository status", repoMissing:"Create the repos marked ✗ or add them to the master token’s repository access.",
  lockTitle:"🔒 Please log in", lockBody:"Only registered users can see the class calendar. If you have no ID, request access.", lockLogin:"Log in", lockReg:"Request access",

  rqWhatTeacherDate:(d,tm) => `Move → ${d} ${tm} (teacher’s reason · 1 bonus class)`, rqSameDayBonus:" (teacher’s reason · same-day change in Korea time → 1 bonus class)",
  nfTitle:"📢 Group chat notice", nfCopy:"Copy", nfShare:"💬 Send to the KakaoTalk group", nfHint:"Phone: tap → KakaoTalk → pick the group → send. Computer: paste the copied text into the group. Further changes are added to this notice.",
  nfCopied:"Copied · paste it into the KakaoTalk group", nfSentHint:"Notice sent to the group", nfUnsent:n => `📢 ${n} unsent notice${n > 1 ? "s" : ""}`,
  nfTd:(ok, what, stu, tch) => `${what} — ${tch} ${ok ? "approved" : "declined"} ${stu}’s request${ok ? ". The calendar is updated." : "."}`,
  nfReq:(who, what, why, to) => `${who} requested: ${what}${why ? " (" + why + ")" : ""} — waiting for ${to === "teacher" ? "the teacher" : "Edward"}’s approval`,
  nfCancel:(who, what) => `${who} cancelled the request: ${what}`,
  nfFb:(cls, who) => `Feedback for ${cls} is up (${who}). Check it on the site.`,
  nfZoom:"The Zoom class link was updated. Join from the Zoom button on the site (opens 5 min before class).",
  hPend:"Pending requests", hPendT:"Student change requests · please review", pendWaitT:"Waiting for teacher (master may approve directly)", tdAskOk:n => `Approve ${n}\u2019s request? The calendar changes right away.`, tdAskNo:n => `Decline ${n}\u2019s request?`, tdDone:"Approved · calendar updated", tdYes:"✓ Yes, approve", tdNo:"Cancel", tdYesNo:"✕ Yes, decline", tdDeclined:"Declined", tdApplied:n => `Applied ${n} teacher-approved student request(s) to the calendar`, tdNeedPw:n => `Applying ${n} teacher-approved request(s) — confirm your password`, tdLater:"Postponed · apply any time from the pending card", tdApplyBtn:"📥 Apply to calendar", tdMsg:(ok, what, stu, tch, url) => `[English class – request ${ok ? "approved" : "declined"}]\n• ${what}\n${tch} ${ok ? "approved" : "declined"} ${stu}\u2019s request.${ok ? " The calendar has been updated." : ""}\n${url}`, pendBy:(n,id,at) => `${n} (${id}) · ${at}`, pendApprove:"✓ Approve", pendReject:"✕ Decline",
  sAuto:"Auto-apply student requests (if the teacher doesn’t answer)", autoOpt:{0:"Off", 10:"10 min before class", 30:"30 min before class (recommended)", 60:"1 hour before class", 180:"3 hours before class", 1440:"1 day before class"},
  autoHint:"A last safety net if the teacher misses a request. Notices are drafted when filed, 1 day and 3 hours before, and it applies before Zoom opens.",
  bMut:"🤝 Mutual agreement request", bMe:"🙋 Student’s reason", bTch:"👨‍🏫 Teacher’s reason", bStuReq:"🎓 Student’s request", bTchReq:"👨‍🏫 Teacher’s request", bLate:"⚠ Late request · below the notice rule",
  lateNote:"Filed later than the notice rule, so it is recorded under the existing rules (e.g. one prepaid class deducted if it’s the student’s reason).",
  autoIn:(when, left) => `⏱ If the teacher doesn’t answer, auto-applies at ${when} · ${left} left`, autoSoon:when => `⏰ Auto-applying soon (${when})`, autoOff:"Auto-apply is off · the teacher or master will handle it", autoNoLate:"Filed right before class, so it won’t auto-apply · teacher, please check",
  autoSame:"👀 The student and the teacher see this same card and time",
  remSteps:{filed:"Notice when filed", day:"1-day reminder", three:"3-hour reminder", due:"Auto-apply"}, remSent:"✓", remWait:"scheduled",
  nfRemind:(who, what, due) => `Friendly reminder 🙏 ${who}’s change request is still waiting: ${what}. If there’s no answer, it will be applied automatically at ${due} under our rules.`,
  nfAuto:(what, m) => `The class change request for ${what} was applied automatically under our rules (${m} before class). No need to worry about it — see you next class! 🙂`,
  autoDone:"✓ Auto-applied", autoTagNo:"no teacher answer", autoRec:(at, ap) => `Filed ${at} → auto-applied ${ap}`,
  undoBtn:"↩ Ask to undo (→ master)", undoSent:"↩ Undo request sent · waiting for the master", undoAsk:(who, at) => `↩ ${who} asked to undo this (${at})`,
  undoDo:"↩ Undo the change", undoKeep:"Keep it", undoDone:"Undone", undoKept:"Kept as is",
  nfUndoReq:(who, what) => `${who} asked the master to undo an auto-applied request: ${what}`, nfUndone:what => `An auto-applied change was undone: ${what}`,
  rqTagAuto:at => `Auto-applied · no teacher answer · filed ${at}`, logUndo:x => `Auto-apply undone: ${x}`,
  mins:m => m >= 1440 ? "1 day" : m >= 60 ? (m / 60) + (m === 60 ? " hour" : " hours") : m + " min", leftFmt:ms => { const m = Math.max(0, Math.round(ms / 60e3)); return m >= 1440 ? Math.floor(m / 1440) + "d " + Math.floor(m % 1440 / 60) + "h" : m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + " min"; },
  autoTag:" (auto)", fbHas:"Feedback written", fbDue:"Feedback to write", fbHead:"Teacher feedback", fbNone:"No feedback from the teacher yet.",
  fbL:{topics:"Topics covered", expr:"Key expressions & words", good:"Strengths & to improve", hw:"Homework / next class"},
  fbPh:{topics:"e.g. Role-play: customer meeting on memory chips", expr:"e.g. lead time, ramp-up, yield", good:"e.g. Clear pronunciation / watch past tense", hw:"e.g. Write a 3-sentence email"},
  fbTitle:(d,l) => `${d} ${l} · Class feedback`, fbSave:"💾 Save feedback", fbUpdate:"💾 Update feedback", fbEmpty:"Please fill in at least one field.",
  fbSaved:"Saved ✓ Send the message below on KakaoTalk.", fbShareBtn:"💬 Send via KakaoTalk", fbCopyMsg:"Copy message",
  fbMsgHead:x => `[English class feedback] ${x}`, fbReplyL:"Student reply", fbReplyPh:"Questions or what you’d like next time", fbReplySave:"Save reply + copy message",
  fbReplied:"Reply saved ✓", fbReplyCopied:"Copied the message with your reply. Paste it into KakaoTalk.", fbReplied2:"replied",
  hFb:"Class feedback", fbDueCnt:n => `✍ ${n} to write`, fbNewCnt:n => `${n} new`, fbEmptyList:"Feedback appears here once classes are done.",
  fbHint:"Classes turn ‘Done’ automatically when they end; the teacher taps a class marked ✍ to leave feedback.",
  hMyReq:"My change requests", myNone:"No requests yet.", st_pending:"⏳ Pending", st_teacherOk:"✓ Approved by teacher · schedule changed", st_approved:"✓ Approved", st_rejected:"✕ Declined", myCancel:"Cancel request",
  rqSaveFail:e => `Couldn’t save the request (${e})`, rqAlready:"There’s already a pending request for this class.",
  rqMsg2:o => `[English class – change request]\n${o.target}\nRequest: ${o.what}\nReason: ${o.why}\nFrom: ${o.who}\n\nPlease review and approve on the web 👇\n${o.url}`,

  rrLink:"No ID yet? Request access", hRR:"Request access", rrId:"Preferred ID (lowercase letters / digits)", rrName:"Name", rrSend:"📨 Send request", rrNeedName:"Enter your name.",
  rrText:o => `[English class app – access request]\nName: ${o.name}\nRole: ${o.role}\nPreferred ID: ${o.id}\n\nApprove here 👇\n${o.url}`,
  rrHint:"Send this to Edward on KakaoTalk. Once approved, reopen the site on this device and just choose a password.",
  rrWaiting:id => `'${id}' waiting for approval`, rrApproved:"Approved! Choose a password to finish registering.",
  hRA:"Access request", raApprove:"✓ Approve", raReject:"✕ Decline", raNeedTok:"Save the teacher token first under Settings → Users.",
  raExists:"This ID is already in use. Approving will replace the existing registration.", raDone:n => `Approved. When ${n} reopens the site on the same device, they set a password and they’re done.`,

  roleUser:n => `Teacher · ${n}`, roleStudent:n => `Student · ${n}`, uRoleL:"Role", roleT:"Teacher", roleS:"Student", loginTabSub:"ID login", uIdL:"ID", subPwL:"Password", subLoginBtn:"Log in",
  uNoId:"This ID isn’t registered.", uNotRegistered:"Registration isn’t finished yet. Register first from the invite link you received.",
  hReg:"Register", regCode:"Invite code (8 characters, from KakaoTalk)", regPw1:"Choose a password (8+ characters)", regPw2:"Confirm password", regBtn:"Register & start",
  regPwRule:"Use 8+ characters and type the same password twice.", regNoInvite:"There’s no pending invite for this ID. Ask Edward to invite you again.", regBadCode:"Wrong invite code.",
  regHint:"After registering you’re logged in on this device. On other devices, log in with your ID and password.",
  advRepo:"Advanced: repository names (usually leave as is)", midTokNote:"When you need to log in with the token (e.g. after regenerating it), open the site address with #master at the end.",
  pwcTitle:"🔒 Confirm master password", pwcOk:"Confirm & save", pwcCancel:"Cancel (undo changes)", pwCancelled:"Save cancelled — changes were undone",
  pwcHintId:id => `Enter the password of the master ID (${id}) to save these changes.`, pwcHintTok:"Enter the master token to save these changes. (Set a master ID in Settings to confirm with a password instead.)",
  pwcBadId:"Wrong password. (If you regenerated the master token, save the master ID again in Settings.)", pwcBadTok:"That token doesn’t match.",
  hMid:"Master ID login (for other devices)", midPw1:"Password (12+ characters)", midPw2:"Confirm password", midSave:"Save", midDel:"Delete",
  midHelp:"On another phone or PC, use Log in → ID login with this ID and password to enter as master. The master token is encrypted with this password (PBKDF2 600k + AES-GCM); neither the token nor the password is stored in plain form anywhere. Use a long password that is hard to guess.",
  midSet:(id, at) => `Set: ID ${id} · ${at}`, midUnset:"Not set — choose an ID and password to log in on other devices without the token.",
  midPwRule:"The password must be 12+ characters and both fields must match.", midIdRule:"Use 2–20 lowercase letters, digits or . - _ for the ID.", midIdTaken:"That ID is already used by a teacher (user). Choose another.",
  midSaved:"Saved ✓ Try logging in with this ID on another device.", midDelAsk:"Delete the master ID login? (Token login keeps working.)", midDeleted:"Deleted.", midBadTok:"The token unlocked by this ID can’t reach the private repo. If the master token expired or was regenerated, log in with the token and save the ID again in Settings.",
  hUsers:"Users (sub-masters)", uTokL:"GitHub token for teachers", uTokSave:"Save token", uTokChange:"Change token", uTokSet:"Teacher token: set (this device)", uTokUnset:"Teacher token: not set",
  uTokHelp:'Create <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">one more token</a>: Only select repositories → <b>only english-class-share and english-class-access</b> → Contents: Read and write. Each invite stores it locked with that user’s own password.',
  uNewId:"ID (lowercase letters / digits)", uNewName:"Name", uInviteBtn:"+ Create invite", uNone:"No users yet.",
  uActive:d => `Active · registered ${d}`, uInvited:d => `Invited (waiting) · ${d}`, uReinvite:"Re-invite", uDelete:"Delete",
  uNeedTok:"Save the teacher token first.", uIdRule:"Use 2–20 lowercase letters, digits, or . - _ for the ID.", uDup:"That ID already exists. Use ‘Re-invite’ in the list.",
  uDeleted:"Deleted. To also block devices already logged in, delete the teacher token on GitHub and re-invite with a new one.",
  uInviteMsg:o => `[English class app – invitation]\nHi ${o.name}, you’re invited to the English class calendar.\n\nID: ${o.id}\nInvite code: ${o.code}\n\nOpen the link below and enter the invite code and a password of your choice to register.\n${o.link}`,
  uInviteHint:"Send this on KakaoTalk. The invite code stops working once it’s used.",

  roleSub:"", calHintS:"Tap an upcoming class to request an edit or a move. It takes effect once Edward approves it on the web.", byTeacher:"Teacher",
  loginTabMaster:"Master (Edward)",
  subBadPw:"Wrong password.",
 
 
  subTooWide:r => `This token can also open the private repo (${r}). Make a new one with only english-class-calendar selected.`,
 
 

  calHintV:"View only. Registered users can log in to request edits or moves.",
  rcStudent:"Student’s reason", rqReason:"Reason", rqNotePh:"Details (optional)", rqSend:"📨 Send change request", rqCopy:"Copy request",
  rqdSend:"✔ Send as is", rqdBack:"Edit", rqdShare:"💬 Send via KakaoTalk", rqdSaving:"Saving…", rqdCopied:"Copied. Paste it into KakaoTalk to let Edward know.",
  rqdAskTitle:"Send this change request?", rqdAskHint:"It will be saved as pending and applied to the calendar once Edward approves it.",
  rqdDoneTitle:"Request sent ✓", rqdDoneHint:"Saved as pending. Send the message below to Edward on KakaoTalk to let him know.",
  rqOutHint:"Your request is saved as pending. Send this to Edward on KakaoTalk to let him know.",
  rqReasons:["Teacher – personal reasons","Teacher – travel","Health","Internet / technical problem","Student’s request","Public holiday","Other"],
  rqTitle:(d,x) => `${d} · request a change to ${x}`, rqPick:"Choose Edit or Move.", rqNeedCause:"Choose whose reason it is.", rqNeedDate:"Pick a new date.",
  rqPvEdit:(d,tm) => `Asks to reschedule this class to ${d} ${tm}.`, rqPvFoot:"Edward (master) must approve the request before it takes effect.",
  rqMsg:(o) => `[English class – change request]\n${o.target}\nRequest: ${o.what}\nReason: ${o.why}\n\nApprove here 👇\n${o.url}`,
  rqWhatEdit:(d,tm) => `Edit → ${d} ${tm}`, rqWhatEnd:"Move → after the last class (auto)", rqWhatDate:(d,tm) => `Move → ${d} ${tm}`,
  rqWhatTeacher:"Move → after the last class (teacher’s reason · same day in Korea time → 1 penalty bonus class)", rqNoPenalty:" (teacher’s reason · notice given in advance → no penalty)",
  rqInTitle:"Teacher’s change request", rqApprove:"✓ Approve & apply", rqReject:"✕ Decline", rqNeedLogin:"Log in as master to approve.",
  rqTarget:"Class", rqWhat:"Request", rqWhy:"Reason", rqWhen:"Requested at", rqStale:"⚠ This class’s date or status changed after the request. Check before approving.",
  rqGone:"The requested class can’t be found (already deleted or changed).", rqTag:"Teacher request", rqTagS:"Student request", rqTagOk:w => `approved by ${w}`, rqRejected:(x) => `Teacher’s change request declined: ${x}`,

  logDel:"Remove from log", logClear:"🗑 Clear all", logClearQ:"Clear everything? Tap again", dlArch:"⬇ Archive log (CSV)",
  archHead:["Time","Entry","Status"], archKept:"kept", archDeleted:d => `removed from view (${d})`,
  logHintM:"Removed entries stay in the archive log (log-archive.json) in the private repo. Entries older than 1 year are trimmed to the last change per class.",

  dlCsv:"⬇ Excel (CSV)", dlTxt:"⬇ Text (TXT)", csvHead:["Time","Entry"], logFileTitle:"English class change log", logCountTxt:n => `${n}`,

  hPay:"Fee payments", payAdd:"+ Record payment", payNone:"No payments recorded yet.", payLoading:"Loading…",
  payNoRepo:r => `Can’t access the private repository '${r}'. Create it (Private) and add it to the token’s repository access.`,
  pthDate:"Paid on", pthPeriod:"Period", pthCls:"Classes", pthRcpt:"Receipt", pthMemo:"Memo",
  payTotal:(n,u,z) => `${n} payment${n===1?"":"s"} · ${u} · ${z}`,
  hPayForm:"Record a fee payment", pfPeriod:"Period paid for", pfCur:"Current period", pfNext:"Next period", pfDate:"Paid on", pfCls:"Classes",
  pfPrice:"Price per class (USD)", pfRate:"Rate (1 USD = UZS)", pfRateDate:"Rate date", pfUzs:"Amount actually paid (UZS)",
  pfCalc:(n,p,u,r,z) => `Calc: ${n} × ${p} = ${u} × ${r} = ${z}`, pfMemo:"Memo (payment method etc.)", pfMemoPh:"e.g. Payme transfer, card, cash",
  pfRcpt:"Receipt photos (multiple OK)", pfRcptHint:"Photos are shrunk automatically (max 1600px) and uploaded only to the private repository.",
  pfSave:"Save", pfSaving:(i,n) => `Uploading… (${i}/${n})`, pfFail:e => `Save failed (${e})`, pfNeed:"Check the payment date and number of classes.",
  payDelQ:"Delete?", logPay:(a,b) => `Fee payment recorded (${a} – ${b})`, logPayDel:(a,b) => `Fee payment record deleted (${a} – ${b})`,
  bannerPaid:d => `✓ Next period paid (${d})`, bannerCurPaid:d => `✓ Current period paid (${d})`, bannerPayBtn:"Record payment", privRepoL:"Private repo (payments & receipts)",

  addBtn:"+ Add class", expand:"Show 6 months ▾", collapse:"Collapse ▴", addTitle:d => `${d} · add a class`, addKind:"Fee",
  addPaid:"Paid (added to prepaid)", addFree:"Free", addMemoPh:"e.g. extra class before a test", addApply:"Add",
  addPv:(paid,price) => paid ? `Adds 1 prepaid class and ${price} to the fee.` : "Added as a free class (no change to prepaid count or amount).",
  addPvV:"Adds 1 class.",
  extraL:n => `Extra ${n}`, aDelX:"🗑 Delete this extra class", nExtra:p => p ? "Extra class (in prepaid)" : "Extra class (free)",
  logAdd:(d,tm,x,p) => `${d} ${tm} ${x} added (${p ? "paid" : "free"})`, logDel:(d,x) => `${d} ${x} deleted`,
  basisExtra:f => `②+ Free extra classes: ${f} ($0) — not counted as prepaid classes`, lg9:"Extra class",

  roleMaster:u => `Master · ${u}`, roleViewer:"Not logged in", login:"Log in", logout:"Log out", teacherLinkBtn:"Copy teacher link", coachBtn:"🎓 AI English coach",
  linkCopied:u => `Teacher link copied: ${u}`,
  syncLoading:"Loading…", syncLoaded:d => `Last updated ${d}`, syncPending:"Waiting to save…", syncSaving:"Saving to GitHub…",
  syncSaved:d => `Saved · ${d}`, syncFail:e => `Save failed (${e}) — check the token’s permissions`, syncOffline:"Couldn’t load from GitHub; showing this browser’s data",
  hLogin:"Master login", ghOwner:"GitHub account", ghRepo:"Repository", ghToken:"GitHub token (fine-grained)",
  tokenHelp:'<a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Create a token</a> → Repository access: <b>Only select repositories</b>, pick this repo → Permissions: <b>Contents = Read and write</b> → paste it here. The token is stored only in this browser.',
  doLogin:"Log in", loginChecking:"Checking…", loginNoRepo:s => `Can’t access the repository (HTTP ${s}). Check the account, repo name and token.`, loginNoPush:"This token can’t write. Create it with Contents = Read and write.",
  docTitle:"English Class Calendar & Fee Calculator (USD→UZS)",
  title:"English Class Calendar & Fee Calculator",
  subV:(p,tm,d) => `Every Sunday ${tm} · ${d} min = 1 class · Cancellations, moves, holds and no-shows logged with reasons`,
  sub:(p,tm,d) => `Prepaid · Every Sunday ${tm} · ${d} min = 1 class · ${p} · Converted to UZS at the official CBU rate · Cancellations, moves, holds and no-shows logged with reasons`,
  hHolds:"Classes on hold", hKakao:"KakaoTalk message", copyMsg:"Copy message",
  kakaoHint:"Paste it into your KakaoTalk ‘Chat with myself’ or the teacher’s chat room.",
  hLog:"Change log", copyLog:"Copy log",
  logHint:"Changes made by the master are saved to the private repo and appear on the teacher’s screen too (without amounts).",
  openSettings:"Open class settings",
  kPrepaid:"Prepaid classes", kUsdL:"Prepaid", kUzsL:"Prepaid (UZS)", kMiscL:"Bonus / Moved / Hold", kLeftL:"Remaining",
  lg1:"Scheduled", lg2:"Done", lg3:"Bonus", lg4:"Moved class", lg5:"On hold", lg6:"Teacher’s reason", lg7:"My cancel / no-show (used)", lg8:"Payment alert day",
  aUndo:"↩ Undo move (back to original)", close:"Close", qDone:"✓ Done", qEdit:"✎ Edit", qMove:"→ Move", hOther:"Other", aCancel:"Cancel", aPlan:"Reset to scheduled",
  hCause:"Whose reason is it?", cMe:"Me (student)", cTeacher:"Teacher", cMutual:"Agreed in advance",
  hHow:"Move it where?", howEnd:"Auto: after the last class", howDate:"Pick a date",
  lAgreed:"Date contacted (Korea date)", lTo:"New date", lToTime:"New time", lMemo:"Reason", memoPh:"e.g. teacher travelling, family event, internet outage …",
  apply:"Apply", calHint:"Click a class to mark it done, edit, move, hold, cancel or no-show; click an empty day to add a class there.",
  hBasis:"How it’s calculated", hList:"Class list", thDate:"Date", thType:"Type", thStatus:"Status", thNotes:"Notes / reason", hNext:"Next prepaid period (estimate)",
  fixBtn:"✏️ Correct class terms (override)", fixH:"Correct class terms", fixHint:"Fix a wrong price or class count. The calendar, period and payment alert are recalculated, and the before/after is kept in the history.",
  fixNow:"Current", fixNew:"Corrected", fixPrice:"Price per class (USD)", fixCount:"Prepaid classes", fixTotal:"Prepaid amount", fixEnd:"Last class", fixReason:"Reason (required)", fixReasonPh:"e.g. wrong price — actually $9 per class",
  fixExtra:n => `${n} paid extra class(es) will be folded into the prepaid count (no longer shown separately).`, fixApply:"Apply correction", fixNeed:"Enter a reason and change the price or class count.",
  fixOrphan:n => `${n} class(es) beyond the new count have records (moves, cancellations…). They are kept but no longer shown on the calendar.`,
  fixHist:"Correction history", fixDone:"Corrected. The master password is confirmed when saving.",
  logFix:(a,b,e1,e2) => `🛠 Class terms corrected: prepaid ${a} → ${b} classes · last class ${e1} → ${e2} (details in the master correction history)`,
  fixRow:(at,p1,p2,c1,c2,u1,u2,r) => `${at} · $${p1} × ${c1} = $${u1} → $${p2} × ${c2} = $${u2} · ${r}`,
  payWas:(n,e) => `was ${n} · to ${e}`,
  zCardT:(live) => live ? "🎥 Zoom class · you can join now" : "🎥 Zoom class", zNextL:"Next class",
  zIn:(m) => m < 60 ? `starts in ${m} min` : m < 1440 ? `in ${Math.floor(m/60)} h ${m%60} min` : `in ${Math.floor(m/1440)} days`, zLeftL:(m) => `In class · ${m} min left`,
  zBig:"🎥 Join the Zoom class", zPractice:"🎙 Practise with the AI English coach before class", zUntil:"Until you can join", zOpensHM:hm => `🔒 opens at ${hm}`, zTeachL:"AI coach", zSetLink:"⚙ Add the Zoom link (once)", zNoLinkT:"You can join here once Edward adds the Zoom link", zOpensAt2:(d, hm) => `🔒 You can join from ${d} ${hm}`,
  zTeacherL:"👨‍🏫 Teacher", zStudentL:"🧑 Student Edward", zOnS:"📷 ON", zOffS:"📷 OFF", zJoinedAt:(hm) => `joined ${hm}`, zNotYet:"Not joined yet", zLateL:(m) => `${m} min past start, not joined yet`,
  zLegend:"🔒 = not open yet · blue = tap to join Zoom · blue dot = the other person has joined (ON), grey = not yet (OFF)",
  zLgPre:hm => [`🔒 Not open yet — join with the blue button from ${hm}`, "Practise with the AI coach before class"], zLgLive:["Blue button = tap to join Zoom", "Blue dot = joined (ON)", "Grey dot = not yet (OFF)", "Red box = class started, not joined yet"],
  zJoinChip:(l) => `🎥 Join ${l}`, zLock:"The Zoom join button turns on 5 min before class", zBarHead:(l, m) => m < 0 ? `Class ${l} · starts in ${-m} min` : `Class ${l} · ${m} min left`,
  zJoin:"🎥 Join Zoom", zOther:(isT) => isT ? "Edward" : "Teacher", zOn:"📷 ON · joined", zWait:"📷 OFF · not joined yet", zLate:(m) => `📷 OFF · ${m} min late`, zMe:"You: 📷 ON",
  zChipTitle:"Tap to join the Zoom class · green dot = the other person has joined", zBadUrl:"The Zoom link must look like https://…zoom.us/…",
  actBtn:"👀 Teacher activity", actH:"Teacher activity (master only)", actUser:"ID", actLast:"Last activity", actVisits:"Visits", actReqs:"Requests", actFbs:"Feedback", actList:"Activity log (newest first)",
  actKind:{reqApprove:"Approved a student request", reqDecline:"Declined a student request", zoom:"Joined Zoom", login:"Logged in",visit:"Opened the site",request:"Change request",reqCancel:"Cancelled request",feedback:"Wrote feedback",fbDelete:"Deleted feedback",register:"Registered"},
  actNever:"No record", actNone:"No records yet.", actGit:"from GitHub history",
  actNote:"Visits are recorded from this update. Earlier sign-ups, requests and feedback come from the GitHub save history. Re-opening on the same device within 30 minutes counts once.",
  fbEditB:"✏️ Edit", fbDelB:"🗑 Reset (delete)", fbDelAsk:"Delete the feedback for this class? The student reply is deleted too.", fbDeleted:"Feedback deleted.", fbEditSave:"Save edits", fbEdited:"Feedback updated.",
  hSettings:"My class settings", sStart:"Start date", sMonths:"Prepaid period (months)", sCount:"Prepaid classes (blank = every Sunday in the period)", sTime:"Class time", sZoom:"Zoom class link (the join button turns on 5 min before class)", sDur:"Length (min)", sPrice:"Price per class (USD)",
  sAlert:"Alert when this many classes are left", sNotice:"Notice needed to move / hold (days before class)", sRateDate:"Rate date",
  cbuHint:'Check the latest rate in the <a href="https://cbu.uz/en/arkhiv-kursov-valyut/" target="_blank" rel="noopener">CBU rate archive</a> before paying.',
  sAsof:"As-of date (to preview alerts; blank = today)", sDone:"Done", sHint:"The calendar and amounts update as you type.",
  dow:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],
  kdate:(y,m,d,w) => `${w}, ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]} ${d}, ${y}`,
  monthHead:(y,m) => `${["January","February","March","April","May","June","July","August","September","October","November","December"][m-1]} ${y}`,
  times:n => `<small> ${n===1?"class":"classes"}</small>`, holdPlus:n => ` +${n} on hold`,
  calTitle:(a,b) => `Class calendar · ${a} – ${b}`,
  act:{plan:"Scheduled", done:"Done", move:"Moved", hold:"Hold", cancel:"Cancelled", noshow:"No-show", edit:"Edited"},
  cause:{me:"me", teacher:"teacher", mutual:"mutual agreement"},
  status:(a,c) => `${a} · ${c==="mutual agreement"?"by mutual agreement":"by "+c}`, edited:" (edited)",
  bonusL:n => `Bonus ${n}`, makeupL:x => `Makeup(${x})`,
  holdNote:n => ` ${n} class${n>1?"es":""} on hold will be added once a date is set.`,
  fxTail:d => `CBU ${d} · tap for trends since 2010`,
  alertDue:(left,last) => `Payment alert · ${left} class${left===1?"":"es"} left (last class ${last})`,
  alertDueBody:(a,b,n,p,u,z) => `Next prepaid period ${a} – ${b}: ${n} Sundays × ${p} = <b>${u}</b> → ${z}. Update to the latest CBU rate before paying.`,
  alertDueBodyV:(a,b,n) => `Next period ${a} – ${b} · ${n} Sundays`,
  alertNext:(d,t) => `Next payment alert: ${d} ${t}`,
  alertNextBody:(N,last) => `After this class, ${N} classes will be left. The last class is ${last}.`,
  noHolds:"No classes on hold.", pickDate:"Set a date", noReason:"no reason",
  nEdited:d => `Originally ${d} → edited`, nTBD:"Date to be decided", nConsumed:"Used from prepaid, no makeup",
  nBonus:d => `Bonus for teacher’s cancellation on ${d} (free)`, nMakeup:(d,x) => `Makeup for ${x} on ${d}`,
  nReason:m => `Reason: ${m}`, nContact:(d,n,late) => `Contacted ${d} (${n} day${n===1?"":"s"} before${late?", ⚠ below notice rule":""})`,
  inPrepaid:"In prepaid",
  listFoot:(p,b,m) => `Prepaid total (${p} regular · ${b} bonus free · ${m} makeup from prepaid)`,
  basis:(o) => [
    `① Prepaid period: ${o.ps} – ${o.pe}${o.count ? ` (${o.count} Sundays from the start date)` : o.ext ? "" : ` (start date + ${o.months} months − 1 day)`}`,
    `② <b>${o.prepaid} prepaid classes</b> — every Sunday ${o.slot} (${o.dur} min = 1 class)`,
    `③ Prepaid: ${o.prepaid} × ${o.price} = <b>${o.usd}</b> × ${o.rate} UZS (CBU ${o.rateDate}) = <b>${o.uzs} UZS</b>`,
    `④ My cancellations / no-shows: ${o.consumed} → used from prepaid, no makeup`,
    `⑤ Teacher’s reason: ${o.teacher} · same-day changes (Korea time) or cancel / no-show → ${o.bonus} penalty bonus class(es) in total ($0). Changes with advance notice: no penalty`,
    `⑥ Moves by me or by agreement: ${o.relocated} · On hold: ${o.holds} → stays prepaid, nothing used`,
    `⑦ Actual last class: ${o.last} · Payment alert on ${o.alert}, when ${o.N} classes are left`],
  next:(o) => [
    `Period: ${o.a} – ${o.b} (${o.count ? `${o.count} Sundays after the last class` : `${o.months} months from the day after the last class`})`,
    `${o.n} Sundays: ${o.list}`,
    `${o.n} × ${o.price} = <b>${o.usd}</b> → × ${o.rate} = <b>${o.uzs} UZS</b>`],
  nextHint:h => `Estimate at the rate entered now.${h?" If classes are still on hold, check again after setting their dates.":""}`,
  noLog:"No changes yet. Anything you change on a class is logged here.",
  msg:(o) => `[English class – prepaid payment reminder]
Prepaid period: ${o.ps} – ${o.pe}
Classes: every Sunday ${o.slot} (${o.dur} min = 1 class)
Prepaid: ${o.prepaid} × ${o.price} = ${o.usd}
Rate: 1 USD = ${o.rate} UZS (CBU ${o.rateDate})
Amount: ${o.uzs}${o.changed?`\n\nChanges\n${o.changed}`:""}
Remaining: ${o.left} · Last class: ${o.last}

Next prepaid period ${o.na} – ${o.nb}
${o.nn} × ${o.price} = ${o.nusd} ≈ ${o.nuzs}`,
  copied:"Copied. Paste it into KakaoTalk.", logCopied:"Log copied.", copyFail:"Copying is blocked here. Select the text and copy it manually.", noLogTxt:"(no entries)",
  origBonus:(d,x) => ` · bonus for teacher’s cancellation of ${x} on ${d}`, origMakeup:(d,x) => ` · makeup for ${x} on ${d}`, nowIs:s => `Now: ${s}`,
  datesEdit:"New date & time (same class, just rescheduled)", datesMove:"Contact date & new date",
  pv:{ holdPenalty:`<b>Teacher’s reason · same-day hold (Korea time):</b> put on hold with no date yet, and a <b>penalty bonus class ($0)</b> is added on the Sunday after the last class.`, noPenalty:"Teacher’s reason, but notice was given before the class day (Korea time), so no penalty bonus.", teacherDate:`<b>Teacher’s reason · same-day change (Korea time):</b> moves the class to the date you pick, and a new <b>bonus class ($0)</b> is added on the Sunday after the last class. The reason is logged.`, editBonus:`<b>Teacher’s reason · same-day change (Korea time):</b> only the date/time changes, and a <b>bonus class ($0)</b> is always added.`, editNoBonus:"Teacher’s reason, but not changed on the class day (Korea time), so no bonus (date/time change only).", delX:"Deletes this extra class. If it was paid, the prepaid count and amount go back too.", undo:(d,x) => `Restores the original class ${x} on ${d} and removes the makeup and bonus created from it.`, already:"Already scheduled — nothing to change.", pick:"Choose what to do above.", done:"Marks this class as done.", plan:"Resets to scheduled and removes any makeup or bonus created from this class.",
    edit:"Changes only this class’s date and time. Nothing is used from prepaid and no bonus is added.", cause:"Choose whose reason it is.",
    teacher:`<b>Teacher’s reason · same-day change (Korea time) or cancel / no-show:</b> this class moves automatically to the Sunday after the last class (makeup), and a <b>penalty bonus class ($0)</b> is added the week after. The reason is logged.`,
    consumed:a => `${a} for my own reason: 1 prepaid class is used, no makeup. It’s logged.`,
    hold:"Puts it on hold with no date yet (stays prepaid).", toDate:"Moves it to the date you pick (stays prepaid).", toEnd:"Moves it to the Sunday after the last class (stays prepaid).",
    head:(a,c,w) => `${a} · ${c==="mutual agreement"?"by mutual agreement":"by "+c}: ${w}`,
    notice:(n,min,late) => `Contacted ${n} day${n===1?"":"s"} before class · rule: ${min} day${min===1?"":"s"} before — ${late?"<b>not met</b>. It will be logged as ‘below notice rule’. If you’re skipping without notice, use ‘Cancel · me’.":"met"}`,
    needDate:"Pick a new date." },
  logEdit:(d,t) => `Edited (${d} ${t})`, logFreed:k => ` · removed ${k}`, logMade:k => ` · created: ${k}`,
  fxPrefix:"1 USD =", fxName:{KRW:"KRW", JPY:"JPY", CNY:"CNY", UZS:"UZS"}, fxTab:{KRW:"Korean won", JPY:"Japanese yen", CNY:"Chinese yuan", UZS:"Uzbek som", IDX:"Compare all 4 (2010 = 100)"},
  fxTitle:x => `Exchange-rate trend · ${x}`, fxCompare:"All 4 currencies", fxIdxTitle:"Units per 1 USD, 2010 average = 100 (higher = stronger dollar / weaker currency)",
  fxUnitTitle:(u,n) => `1 USD = ? ${u} (${n})`, fxYear:"Year",
  fxChange:(p,up) => `${up?"Up":"Down"} ${Math.abs(p)}% since 2010 (${up?"stronger":"weaker"} dollar) · `,
  fxBasis:d => `2010–2025 are annual averages; the last point (2026.11) is the CBU cross rate of ${d}.`,
  fxSrc:{KRW:"2010–2025 annual averages: Federal Reserve G.5A (FRED AEXKOUS)", JPY:"2010–2025 annual averages: Federal Reserve G.5A (FRED AEXJPUS)", CNY:"2010–2025 annual averages: Federal Reserve G.5A (FRED AEXCHUS)",
    UZS:"2010–2023 annual averages: FRED XRNCUSUZA618NRUG · 2024–2025: TradersUnion average of daily closes. Sharp jump after the September 2017 currency liberalisation"},
  fxCross:"2026.11 KRW/JPY/CNY = CBU USD/UZS ÷ each currency/UZS (KRW may be off by about ±1 because CBU rounds it to 2 decimals).",
}};
const t = k => L[lang][k];

/* ---------- 환율 데이터 ---------- */
const CBU = {date:"2026-11-21", USD:12004.48, KRW:8.96, JPY:75.58, CNY:1797.29};
const NOW = {KRW: CBU.USD/CBU.KRW, JPY: CBU.USD/CBU.JPY, CNY: CBU.USD/CBU.CNY, UZS: CBU.USD};
const YEARS = [2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025];
const FX = {
  KRW:{dec:0, color:"#2d5bd7", v:[1155.7389,1106.94,1126.1621,1094.6749,1052.2924,1130.9603,1159.3422,1129.0435,1099.2926,1165.8016,1180.5554,1144.8911,1291.7796,1306.7637,1363.4381,1421.3963]},
  JPY:{dec:2, color:"#c0392b", v:[87.7817,79.6967,79.818,97.5971,105.7398,121.0491,108.6569,112.0986,110.3974,109.0188,106.7754,109.8429,131.4589,140.5001,151.4551,149.5686]},
  CNY:{dec:3, color:"#b4541a", v:[6.7696,6.463,6.3093,6.1478,6.162,6.2827,6.64,6.7569,6.609,6.9081,6.9042,6.4508,6.729,7.0809,7.1957,7.1875]},
  UZS:{dec:0, color:"#1f6f5c", v:[1578.4167,1706.6111,1878.6844,2094.9885,2310.9482,2567.9872,2965.2535,5113.8789,8069.6062,8836.7875,10054.2613,10609.4644,11050.1454,11734.8334,12622.19,12565.61]},
};
const fxFmt = (c,v) => v.toLocaleString("en-US",{minimumFractionDigits:FX[c].dec,maximumFractionDigits:FX[c].dec});

/* ---------- 날짜 유틸 ---------- */
function parse(s){ const [y,m,d] = s.split("-").map(Number); return new Date(Date.UTC(y,m-1,d)); }
function fmt(d){ return d.toISOString().slice(0,10); }
function addDays(d,n){ const x = new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; }
function addMonths(d,n){
  const y = d.getUTCFullYear(), m = d.getUTCMonth()+n, day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m+1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day,last)));
}
function nextSundayAfter(d){ let x = addDays(d,1); while (x.getUTCDay() !== 0) x = addDays(x,1); return x; }
function kdate(d){ return t("kdate")(d.getUTCFullYear(), d.getUTCMonth()+1, d.getUTCDate(), t("dow")[d.getUTCDay()]); }
function sdate(d){ return `${d.getUTCMonth()+1}/${d.getUTCDate()}`; }
// 모든 날짜·시각은 한국 시간(Asia/Seoul, KST) 기준 — 선생님이 다른 나라에서 열어도 '당일'과 기록 시각이 같게 나옴
const KST_FMT = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Seoul", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23"});
function kstParts(d){ const o = {}; KST_FMT.formatToParts(d || new Date()).forEach(p => o[p.type] = p.value); return o; }
function todayStr(){ const p = kstParts(); return `${p.year}-${p.month}-${p.day}`; }
function nowStamp(){ const p = kstParts(); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; }
const usd = v => "$" + v.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const uzs = v => Math.round(v).toLocaleString("en-US") + " UZS";
const uzs2 = v => v.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});

/* ---------- 수업 모델 ---------- */
function cfg(){
  return {
    start: parse($("start").value || "2026-11-22"),
    months: Math.max(1, +$("months").value || 3),
    count: Math.max(0, Math.floor(+$("count").value || 0)),   // 선불 수업 수 (0 = 기간 안의 일요일 전부)
    price: +$("price").value || 0,
    rate: +$("rate").value || 0,
    rateDate: $("rateDate").value,
    N: Math.max(1, +$("alertN").value || 2),
    time: $("time").value || "17:00",
    dur: +$("dur").value || 25,
    minNotice: Math.max(0, +$("minNotice").value || 0),
    autoMin: [0,10,30,60,180,1440].includes(+$("autoMin").value) && $("autoMin").value !== "" ? +$("autoMin").value : 30,   // 학생 요청 자동 반영: 수업 몇 분 전 (0 = 끄기)
    asof: parse($("asof").value || todayStr()),
  };
}
// 선불 기간의 일요일 목록. count가 있으면 시작일부터 정확히 count회 (기간 끝 = 마지막 수업일)
function sundays(start, months, count){
  let d = new Date(start);
  while (d.getUTCDay() !== 0) d = addDays(d,1);
  const list = [];
  if (count > 0){ for (let i = 0; i < count; i++, d = addDays(d,7)) list.push(new Date(d)); return {start, end: list[list.length-1], list}; }
  const end = addDays(addMonths(start, months), -1);
  for (; d <= end; d = addDays(d,7)) list.push(new Date(d));
  return {start, end, list};
}
function labelOf(s){
  if (s.kind === "reg") return `#${s.no}`;
  if (s.kind === "bonus") return t("bonusL")(s.bno);
  if (s.kind === "extra") return `#${s.no}`;   // 추가 수업도 정규 수업 번호에 이어서 (#15, #16 …)
  return t("makeupL")(labelOf(s.from));
}
function klass(s){
  const a = s.act, c = s.cause;
  if (a === "plan" || a === "done") return a;
  if (a === "hold") return "hold";
  if (c === "teacher") return "teacher";
  if ((a === "cancel" || a === "noshow") && c === "me") return "consumed";
  if (a === "hold") return "hold";
  return "relocated";
}
const occupies = s => s.act === "plan" || s.act === "done" || ((s.act === "cancel" || s.act === "noshow") && s.cause === "me");
function statusText(s){
  if (s.act === "plan" || s.act === "done") return t("act")[s.act] + (s.auto ? t("autoTag") : "") + (s.edited ? t("edited") : "");
  return t("status")(t("act")[s.act], t("cause")[s.cause] || "-");
}

function buildSessions(P, C){
  const S = P.list.map((d,i) => ({id:"R"+(i+1), d, kind:"reg", no:i+1, time:C.time}));
  extras.filter(x => x && DATE_RE.test(x.date || "") && /^X\w+$/.test(x.id || "")).sort((a,b) => a.date.localeCompare(b.date)).forEach((x,i) => S.push({id:x.id, d:parse(x.date), kind:"extra", xno:i+1, no:P.list.length+i+1, paid:x.paid, time:safeTime(x.time, C.time)}));
  let bonusNo = 0;
  const endSlot = () => nextSundayAfter(S.reduce((m,x) => x.d > m ? x.d : m, P.start));
  for (let i=0; i<S.length; i++){
    const s = S[i], meta = state[s.id] || {};
    s.meta = meta; s.act = meta.act || "plan"; s.cause = meta.cause || null;
    s.origD = s.d;
    if (meta.ed && DATE_RE.test(meta.ed.date || "")){ s.d = parse(meta.ed.date); s.time = safeTime(meta.ed.time, s.time); s.edited = true; }
    if (meta.ed && meta.edCause === "teacher" && meta.edSameDay){          // 선생님 사유 당일 변경 → 무조건 보너스
      const bn = {id:"BE:"+s.id, kind:"bonus", bno:++bonusNo, from:s, d:endSlot(), time:C.time};
      S.push(bn); s.children = [bn];
    }
    const relocate = !["plan","done"].includes(s.act) && !occupies(s);
    if (!relocate) continue;
    // 패널티(보너스 1회): 선생님 사유 취소·No-show는 항상, 이동·Hold는 한국 시간 기준 수업 당일 연락일 때만
    const penalty = s.cause === "teacher" && (s.act === "cancel" || s.act === "noshow" || ((s.act === "move" || s.act === "hold") && (meta.notice ?? 0) <= 0));
    const kids = [];
    if (s.act === "move"){
      const toDate = meta.how === "date" && DATE_RE.test(meta.to || "") && meta.to;
      kids.push({id:"M:"+s.id, kind:"moved", from:s, d: toDate ? parse(meta.to) : endSlot(), time: toDate ? safeTime(meta.toTime, C.time) : C.time});
    } else if ((s.act === "cancel" || s.act === "noshow") && s.cause !== "me"){
      kids.push({id:"M:"+s.id, kind:"moved", from:s, d:endSlot(), time:C.time});     // 선생님·합의 취소 → 맨 뒤 보강
    }                                                                                 // Hold → 날짜 미정 (보강 없음)
    kids.forEach(k => S.push(k));
    if (penalty){ const bn = {id:"B:"+s.id, kind:"bonus", bno:++bonusNo, from:s, d:endSlot(), time:C.time}; S.push(bn); kids.push(bn); }
    if (kids.length) s.children = (s.children || []).concat(kids);
  }
  // 수업 끝난 시각(한국 시간)이 지나면 '예정' → '완료(자동)'
  const nk = kstParts(), nowKey = `${nk.year}-${nk.month}-${nk.day} ${nk.hour}:${nk.minute}`;
  S.forEach(s => { if (s.act === "plan" && `${fmt(s.d)} ${endHM(s.time, C.dur)}` <= nowKey){ s.act = "done"; s.auto = true; } });
  return S;
}
function endHM(tm, dur){ const [a,b] = String(tm || "17:00").split(":").map(Number); const e = new Date(Date.UTC(2000,0,1,a,b + (+dur || 25))); return `${String(e.getUTCHours()).padStart(2,"0")}:${String(e.getUTCMinutes()).padStart(2,"0")}`; }
const byTime = (a,b) => a.d - b.d || (a.time||"").localeCompare(b.time||"");

/* ---------- 정적 문구 적용 ---------- */
function applyStatic(){
  document.documentElement.lang = lang;
  document.title = t("docTitle");
  document.querySelectorAll("[data-i18n]").forEach(el => el.textContent = t(el.dataset.i18n));
  document.querySelectorAll("[data-i18n-html]").forEach(el => el.innerHTML = t(el.dataset.i18nHtml));
  document.querySelectorAll("[data-i18n-ph]").forEach(el => el.placeholder = t(el.dataset.i18nPh));
  document.querySelectorAll("#autoMin option").forEach(o => o.textContent = t("autoOpt")[o.value]);
  document.querySelectorAll("[data-i18n-title]").forEach(el => el.title = t(el.dataset.i18nTitle));
  document.querySelectorAll("[data-i18n-fb]").forEach(el => { const k = el.dataset.i18nFb; el.textContent = t("fbL")[k]; const ta = $("fb_" + k); if (ta) ta.placeholder = t("fbPh")[k]; });
  document.querySelectorAll("[data-lang]").forEach(b => b.classList.toggle("on", b.dataset.lang === lang));
}
function setLang(l){
  lang = l; try { localStorage.setItem(LANGKEY, l); } catch(e) {}
  applyStatic(); renderAcct(); render(); renderPayments(); renderPending();
  if ($("fxModal").classList.contains("on")) drawFx();
}
document.querySelectorAll("[data-lang]").forEach(b => b.onclick = () => setLang(b.dataset.lang));


/* ---------- 수업 조건 정정 (마스터 강제 수정 + 기록) ---------- */
function termsOf(C, ex){
  const P = sundays(C.start, C.months, C.count), paid = ex.filter(x => x.paid && DATE_RE.test(x.date || ""));
  const prepaid = P.list.length + paid.length;
  const last = new Date(Math.max(P.list.length ? +P.list[P.list.length-1] : 0, ...paid.map(x => +parse(x.date))));
  return {P, prepaid, usd: prepaid * C.price, last};
}
function openFix(){
  if (!isMaster()) return;
  const C = cfg(), cur = termsOf(C, extras), paidN = extras.filter(x => x.paid).length;
  $("fxPrice").value = C.price; $("fxCount").value = cur.prepaid; $("fxReason").value = ""; $("fxMsg").textContent = "";
  $("fxHist").innerHTML = fixes.length ? `<h4>${t("fixHist")}</h4>` + fixes.slice().reverse().map(f => `<div class="hint">${esc(t("fixRow")(f.at, f.p1, f.p2, f.c1, f.c2, f.u1, f.u2, f.reason))}</div>`).join("") : "";
  const pv = () => {
    const np = +$("fxPrice").value || 0, nc = Math.max(1, Math.floor(+$("fxCount").value || 0));
    const nx = termsOf({...C, price: np, count: nc}, extras.filter(x => !x.paid));
    const orphan = Object.keys(state).filter(k => /^R\d+$/.test(k) && +k.slice(1) > nc).length;
    const row = (l, a, b) => `<tr><th>${l}</th><td class="mono">${a}</td><td class="mono"><b>${b}</b></td></tr>`;
    $("fxTable").innerHTML = `<tr><th></th><th>${t("fixNow")}</th><th>${t("fixNew")}</th></tr>`
      + row(t("fixPrice"), usd(C.price), usd(np)) + row(t("fixCount"), cur.prepaid, nc) + row(t("fixTotal"), usd(cur.usd), usd(np * nc)) + row(t("fixEnd"), kdate(cur.last), kdate(nx.last));
    $("fxNote").innerHTML = (paidN ? `<div>${esc(t("fixExtra")(paidN))}</div>` : "") + (orphan ? `<div class="bad">${esc(t("fixOrphan")(orphan))}</div>` : "");
  };
  ["fxPrice","fxCount"].forEach(id => $(id).oninput = pv); pv();
  $("fxApply").onclick = () => {
    const np = +$("fxPrice").value || 0, nc = Math.max(1, Math.floor(+$("fxCount").value || 0)), reason = $("fxReason").value.trim().slice(0, 300);
    if (!reason || (np === C.price && nc === cur.prepaid)){ $("fxMsg").className = "hint bad"; $("fxMsg").textContent = t("fixNeed"); return; }
    const nx = termsOf({...C, price: np, count: nc}, extras.filter(x => !x.paid));
    fixes.push({at: nowStamp(), p1: C.price, p2: np, c1: cur.prepaid, c2: nc, u1: +cur.usd.toFixed(2), u2: +(np * nc).toFixed(2), e1: fmt(cur.last), e2: fmt(nx.last), removedExtras: extras.filter(x => x.paid), reason});
    addLog({...bothLangs(() => t("logFix")(cur.prepaid, nc, kdate(cur.last), kdate(nx.last))), fix: true}, "fix");
    extras = extras.filter(x => !x.paid);
    $("price").value = np; $("count").value = nc;
    $("fixModal").classList.remove("on"); save(); render(); setSync(t("fixDone"));
  };
  openModal("fixModal");
}
$("fixBtn").onclick = openFix;
$("actBtn").onclick = openActivity;
$("actBtn2").onclick = openActivity;


/* ---------- 선생님 활동 기록 (마스터만 봄) ----------
   선생님 화면 → share/activity.json 에 잠깐 쌓임 → 마스터가 열면 비공개 저장소 activity-log.json 으로 옮기고 share 쪽은 비움.
   과거 기록은 GitHub 저장 기록(커밋 메시지)에서 읽어 옴. */
const ACT_INBOX = "activity.json", ACT_LOG = "activity-log.json", ACT_MAX = 3000, VISIT_GAP = 30 * 60e3;
async function logActivity(kind, detail){
  if (!isSub()) return;
  try {
    if (kind === "visit"){ const k = "eng-class-lastvisit-" + auth.login, last = +(localStorage.getItem(k) || 0); if (Date.now() - last < VISIT_GAP) return; localStorage.setItem(k, Date.now()); }
  } catch(e) {}
  const ev = {at: nowStamp(), by: auth.login, name: auth.name, kind, detail: String(detail || "").slice(0, 120), dev: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? "mobile" : "pc"};
  try { const g = await ghGet(SHARE_REPO, ACT_INBOX); const items = (g.data && Array.isArray(g.data.items)) ? g.data.items.slice(-200) : []; items.push(ev);
    await ghPut(SHARE_REPO, ACT_INBOX, {items}, `Activity: ${kind} by ${auth.login}`, g.sha); } catch(e) {}
}
let actLog = [], actSha = null;
async function drainActivity(){
  if (!isMaster()) return;
  try {
    const r = await fetch(privUrl(ACT_LOG) + `?t=${Date.now()}`, {headers: apiHeaders(), cache:"no-store"});
    if (r.ok){ const j = await r.json(); actSha = j.sha; actLog = JSON.parse(b64dec(j.content)); } else { actLog = []; actSha = null; }
    const g = await ghGet(SHARE_REPO, ACT_INBOX);
    const inbox = (g.data && Array.isArray(g.data.items)) ? g.data.items : [];
    if (inbox.length){
      inbox.forEach(e => { if (e && typeof e === "object") actLog.push({at: String(e.at || "").slice(0,20), by: String(e.by || "").slice(0,40), name: String(e.name || "").slice(0,40), kind: String(e.kind || "").slice(0,20), detail: String(e.detail || "").slice(0,120), dev: e.dev === "mobile" ? "mobile" : "pc"}); });
      actLog = actLog.slice(-ACT_MAX);
      actSha = await privPut(ACT_LOG, b64enc(JSON.stringify(actLog)), "Move teacher activity to private log", actSha);
      await ghDelete(SHARE_REPO, ACT_INBOX, "Clear activity inbox");
    }
  } catch(e) {}
}
// GitHub 저장 기록에서 과거 활동 찾기 (가입·요청·피드백)
async function commitActivity(){
  const out = [];
  for (const repo of [SHARE_REPO, ACCESS_REPO]){
    try { const r = await fetch(`https://api.github.com/repos/${ownerOf()}/${repo}/commits?per_page=100`, {headers: apiHeaders(), cache:"no-store"});
      if (!r.ok) continue;
      (await r.json()).forEach(c => { const msg = (c.commit && c.commit.message || "").split("\n")[0], at = fmtStamp(c.commit.author.date);
        let m;
        if ((m = msg.match(/^User registered: (\S+)/))) out.push({at, by:m[1], kind:"register", src:"git"});
        else if ((m = msg.match(/^Request from (\S+): (.*)/))) out.push({at, by:m[1], kind:"request", detail:m[2], src:"git"});
        else if ((m = msg.match(/^Feedback (.*) by (\S+)$/))) out.push({at, by:m[2], kind:"feedback", detail:m[1], src:"git"});
        else if ((m = msg.match(/^Delete feedback (\S+) by (\S+)$/))) out.push({at, by:m[2], kind:"fbDelete", detail:m[1], src:"git"}); });
    } catch(e) {}
  }
  return out;
}
async function openActivity(){
  if (!isMaster()) return;
  $("actBody").innerHTML = `<div class="hint">${t("loginChecking")}</div>`; openModal("actModal");
  await drainActivity();
  const git = await commitActivity();
  // 같은 사건이 활동 기록과 GitHub 기록 양쪽에 있으면 하나만 (3분 안, 같은 사람·종류)
  const mins = at => Date.parse(String(at).replace(" ", "T") + ":00+09:00") / 60e3;
  const all = actLog.slice();
  git.forEach(g => { if (!all.some(e => e.by === g.by && e.kind === g.kind && Math.abs(mins(e.at) - mins(g.at)) <= 3)) all.push(g); });
  all.sort((a,b) => a.at < b.at ? 1 : -1);
  let users = []; try { users = (await fetchUsers()).users.map(u => u.id); } catch(e) {}
  const ids = [...new Set([...users, ...all.map(e => e.by)])].filter(Boolean);
  const K = t("actKind");
  const sum = ids.map(id => { const es = all.filter(e => e.by === id), last = es[0];
    const cnt = k => es.filter(e => e.kind === k).length;
    return `<tr><td><b>${esc(id)}</b></td><td>${last ? esc(last.at) : t("actNever")}</td><td class="r">${cnt("login") + cnt("visit")}</td><td class="r">${cnt("request")}</td><td class="r">${cnt("feedback")}</td></tr>`; }).join("");
  $("actBody").innerHTML = `<table class="mini"><tr><th>${t("actUser")}</th><th>${t("actLast")}</th><th class="r">${t("actVisits")}</th><th class="r">${t("actReqs")}</th><th class="r">${t("actFbs")}</th></tr>${sum}</table>
    <h4 style="margin-top:14px">${t("actList")}</h4>
    ${all.length ? `<div class="actlist">${all.slice(0, 300).map(e => `<div class="logrow"><div><b>${esc(e.at)}</b> · ${esc(e.by)} · ${esc(K[e.kind] || e.kind)}${e.detail ? ` · <span class="hint">${esc(e.detail)}</span>` : ""}${e.dev ? ` <span class="hint">(${e.dev === "mobile" ? "📱" : "💻"})</span>` : ""}${e.src === "git" ? ` <span class="hint">· ${t("actGit")}</span>` : ""}</div></div>`).join("")}</div>` : `<div class="hint">${t("actNone")}</div>`}
    <div class="hint" style="margin-top:10px">${t("actNote")}</div>`;
}

/* ---------- Zoom 입장 (수업 5분 전 ~ 끝날 때까지) : 입장 표시는 english-class-share/live.json ---------- */
let zTL = [], zC = null, zLive = null, zLiveAt = 0, zWasOpen = false;
const ZOOM_RE = /^https:\/\/([\w-]+\.)*zoom\.us\/[^\s"'<>]*$/i;
function zoomUrl(){ const u = ($("zoom").value || "").trim(); return ZOOM_RE.test(u) ? u : ""; }
const zStart = s => Date.parse(`${fmt(s.d)}T${s.time}:00+09:00`);
const zKey = s => `${fmt(s.d)} ${s.time}`;
function zCurrent(){ if (!zC) return null; const now = Date.now(), dur = (zC.dur || 25) * 60e3;
  return zTL.find(s => (s.act === "plan" || s.act === "done") && now >= zStart(s) - 5*60e3 && now < zStart(s) + dur) || null; }
function zNext(){ const now = Date.now(); return zTL.filter(s => s.act === "plan" && zStart(s) > now).sort((a,b) => zStart(a) - zStart(b))[0] || null; }
function zoomState(s, C){
  if (!isEditor() || !zoomUrl()) return "";
  const cur = zCurrent(); if (cur && cur.id === s.id) return "open";
  if (!cur){ const n = zNext(); if (n && n.id === s.id) return "next"; }
  return "";
}
function zOtherIn(){ const cur = zCurrent(); if (!cur || !zLive || zLive.key !== zKey(cur)) return false;
  const want = isTeacher() ? "master" : "sub"; return Object.values(zLive.in || {}).some(v => v && v.role === want); }
function zMeIn(){ const cur = zCurrent(); return !!(cur && zLive && zLive.key === zKey(cur) && zLive.in && zLive.in[auth.login]); }
async function zFetch(){ try { const g = await ghGet(SHARE_REPO, "live.json"); zLive = g.data && typeof g.data === "object" ? g.data : null; zLiveAt = Date.now(); } catch(e) {} }
function joinZoom(s){
  const url = zoomUrl(); if (!url) return;
  window.open(url, "_blank", "noopener");
  const key = zKey(s), me = {role: isTeacher() ? "sub" : "master", name: (auth && auth.name) || (isMaster() ? "Edward" : auth.login), at: nowStamp()};
  zLive = zLive && zLive.key === key ? zLive : {key, in: {}}; zLive.in[auth.login] = me; renderZoom();
  (async () => { try { const g = await ghGet(SHARE_REPO, "live.json"); const d = g.data && g.data.key === key ? g.data : {key, in: {}};
      d.in = d.in || {}; d.in[auth.login] = me; await ghPut(SHARE_REPO, "live.json", d, `Zoom join ${key} by ${auth.login}`, g.sha); zLive = d; renderZoom(); } catch(e) {} })();
  logActivity("zoom", key);
}
function zWho(role){ const cur = zCurrent(); if (!cur || !zLive || zLive.key !== zKey(cur)) return null; return Object.values(zLive.in || {}).find(v => v && v.role === role) || null; }
function zDay(s){ return `${sdate(s.d)}(${t("dow")[s.d.getUTCDay()]})`; }
// 수업 전 AI 연습: 로그인한 모든 사람 (마스터·학생·선생님 t.danel 포함) — AI 사용 횟수는 limits.html 의 한도를 따름
const zPracticeOK = () => isEditor();
const Z_TEACH = [["emma","Emma"],["sophie","Sophie"],["james","James"],["ryan","Ryan"]];
function zCountdown(ms){ const s = Math.max(0, Math.floor(ms/1000)), h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60;
  return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+":"+String(x).padStart(2,"0"); }
function renderZCard(){
  const box = $("zCard"); if (!box) return;
  if (!isEditor() || !zC){ box.style.display = "none"; return; }
  const hasUrl = !!zoomUrl(), cur = hasUrl ? zCurrent() : null, s = cur || zNext();
  if (!s){ box.style.display = "none"; return; }
  box.style.display = ""; box.classList.toggle("live", !!cur);
  const st = zStart(s), dur = zC.dur || 25, el = (Date.now() - st) / 60e3;
  const range = `${zDay(s)} ${s.time}–${endHM(s.time, dur)}`;
  const when = !cur ? `${t("zNextL")} · ${labelOf(s)} · ${range} · ${t("zIn")(Math.ceil(-el))}`
    : el < 0 ? `${labelOf(s)} · ${range} · ${t("zIn")(Math.ceil(-el))}` : `${labelOf(s)} · ${range} · ${t("zLeftL")(dur - Math.floor(el))}`;
  const opens = new Date(st - 5*60e3), op = kstParts(opens);
  const btn = !hasUrl ? (isMaster() ? `<button class="zbig" id="zSetBtn">${t("zSetLink")}</button>` : `<button class="zbig" disabled>${t("zNoLinkT")}</button>`)
    : cur ? `<button class="zbig" id="zBigBtn">${t("zBig")}</button>`
    : zPracticeOK() ? `<div class="zpr"><div class="zclock" aria-label="${esc(t("zUntil"))}"><small>${t("zUntil")}</small><b class="zcd" data-at="${+opens}">${zCountdown(+opens - Date.now())}</b><small>${esc(t("zOpensHM")(`${op.hour}:${op.minute}`))}</small></div>`+
        `<a class="zgo" href="voice-coach/">${t("zPractice")}</a></div>`+
        `<div class="zteach"><span>${t("zTeachL")}</span>${Z_TEACH.map(([k,n]) => `<a class="zt" href="voice-coach/?t=${k}"><img src="voice-coach/teachers/thumbs/${k}.jpg" alt="" width="28" height="28" loading="lazy">${n}</a>`).join("")}</div>`
    : `<button class="zbig" disabled>${esc(t("zOpensAt2")(zDay(s), `${op.hour}:${op.minute}`))}</button>`;
  let pres = "";
  if (cur){
    const m = Math.floor(el);
    const boxH = (label, role, mine) => { const w = zWho(role), late = !w && m > 0 && !mine;
      const nm = role === "sub" ? `${label}${w && w.name ? " " + esc(w.name) : ""}` : label;
      return `<div class="zp ${w ? "on" : late ? "late" : ""}"><div>${nm}</div><div class="zs"><span class="dot"></span>${w ? t("zOnS") : t("zOffS")}</div><div class="zsub">${w ? esc(t("zJoinedAt")(String(w.at).slice(11))) : late ? esc(t("zLateL")(m)) : t("zNotYet")}</div></div>`; };
    pres = `<div class="zpres">${boxH(t("zTeacherL"), "sub", isTeacher())}${boxH(t("zStudentL"), "master", isMaster() || isStudent())}</div>`;
  }
  const lg = cur ? (L => `<div class="zlegend zlg"><span><i class="lg-blue"></i>${esc(L[0])}</span><span><i class="lg-dot on"></i>${esc(L[1])}</span><span><i class="lg-dot"></i>${esc(L[2])}</span><span><i class="lg-red"></i>${esc(L[3])}</span></div>`)(t("zLgLive"))
    : (hasUrl && zPracticeOK()) ? (L => `<div class="zlegend zlg"><span>${esc(L[0])}</span><span><i class="lg-green"></i>${esc(L[1])}</span></div>`)(t("zLgPre")(`${op.hour}:${op.minute}`))
    : `<div class="zlegend">${t("zLegend")}</div>`;
  box.innerHTML = `<h3>${t("zCardT")(!!cur)}</h3><div class="zwhen">${esc(when)}</div>${btn}${pres}${lg}`;
  if (cur) $("zBigBtn").onclick = () => joinZoom(cur);
  if (!hasUrl && isMaster()) $("zSetBtn").onclick = () => { $("openSettings").click(); setTimeout(() => { $("zoom").scrollIntoView({block:"center"}); $("zoom").focus(); }, 300); };
}
setInterval(() => { document.querySelectorAll(".zcd").forEach(e => { const left = +e.dataset.at - Date.now(); e.textContent = zCountdown(left); if (left <= 0) renderZCard(); }); }, 1000);
// 상단 카드가 화면에 보이면 하단 바는 숨김 (둘 다 같은 내용이라)
let zCardVisible = false;
try { new IntersectionObserver(es => { zCardVisible = es[0].isIntersecting; renderZoom(); }).observe(document.getElementById("zCard")); } catch(e) {}
function renderZoom(){
  renderZCard();
  const cur = isEditor() && zoomUrl() ? zCurrent() : null, showBar = false;   // A(달력 칸) + B(상단 카드)만 사용 — 하단 바는 끔
  $("zBar").classList.toggle("show", showBar); document.body.classList.toggle("zbaron", showBar);
  if (!cur){ return; }
  const el = (Date.now() - zStart(cur)) / 60e3, m = el < 0 ? -Math.ceil(-el) : Math.floor(el), left = (zC.dur || 25) - Math.max(0, m);
  const on = zOtherIn(), late = !on && m > 0;
  $("zBarIn").innerHTML = `<div class="info"><b>${esc(t("zBarHead")(labelOf(cur), m <= 0 ? m : left))}</b>
    <span class="tp ${on ? "on" : late ? "late" : ""}"><span class="dot"></span>${esc(t("zOther")(isTeacher()))} ${esc(on ? t("zOn") : late ? t("zLate")(m) : t("zWait"))}</span>
    ${zMeIn() ? `<div class="zme">${t("zMe")}</div>` : ""}</div>
    <button class="zj" id="zJoinBtn">${t("zJoin")}</button>`;
  $("zJoinBtn").onclick = () => joinZoom(cur);
  document.querySelectorAll(".it.zlive .zd").forEach(d => d.classList.toggle("on", on));
}
// 15초마다: 입장 시간이 열리고 닫힐 때 달력 다시 그림, 수업 시간엔 상대방 입장 확인(20초 간격)
setInterval(async () => {
  if (!isEditor() || !zoomUrl()) return;
  const open = !!zCurrent();
  if (open !== zWasOpen){ zWasOpen = open; render(); }
  if (open && Date.now() - zLiveAt > 18e3){ await zFetch(); renderZoom(); }
  else if (open) renderZoom();
}, 15e3);

/* ---------- 렌더링 ---------- */
function render(){ if (!isMaster() && baseState) overlayApprovals(); renderMain(); renderZoom(); renderUnsentChip(); }
function renderMain(){
  const C = cfg(); renderSub();
  const P = sundays(C.start, C.months, C.count);
  const S = buildSessions(P, C);
  const paidX = extras.filter(x => x.paid).length, freeX = extras.length - paidX;
  const prepaid = P.list.length + paidX;
  const paidDates = extras.filter(x => x.paid && DATE_RE.test(x.date || "")).map(x => parse(x.date));
  const Pend = paidDates.length ? new Date(Math.max(P.list.length ? +P.list[P.list.length-1] : 0, ...paidDates.map(Number))) : P.end;
  const prepaidUsd = prepaid*C.price, prepaidUzs = prepaidUsd*C.rate;

  const timeline = S.filter(occupies).sort(byTime); zTL = timeline; zC = C;
  const holds = S.filter(s => s.act === "hold");
  const bonusCount = S.filter(s => s.kind === "bonus").length;
  const movedCount = S.filter(s => s.kind === "moved").length;
  const lastSession = timeline.length ? timeline[timeline.length-1].d : P.end;
  const left = timeline.filter(s => s.act === "plan" && s.d >= C.asof).length;
  const alertItem = timeline.length > C.N ? timeline[timeline.length-C.N-1] : timeline[0];

  const NP = sundays(addDays(lastSession,1), C.months, C.count);
  const nCount = NP.list.length, nUsd = nCount*C.price, nUzs = nUsd*C.rate;
  lastCalc = {C, P, Pend, NP, prepaid, nCount};

  $("kCount").innerHTML = `${prepaid}${t("times")(prepaid)}`;
  $("kUsd").textContent = usd(prepaidUsd);
  $("kUzs").innerHTML = `${Math.round(prepaidUzs).toLocaleString("en-US")}<small> UZS</small>`;
  $("kMisc").innerHTML = `${bonusCount} / ${movedCount} / ${holds.length}`;
  $("kLeft").innerHTML = `${left}<small>${t("times")(left).replace(/<\/?small>/g,"")}${holds.length?t("holdPlus")(holds.length):""}</small>`;
  $("calTitle").textContent = t("calTitle")(kdate(P.start), kdate(lastSession));

  // 배너 + 환율 줄
  const b = $("banner");
  const holdNote = holds.length ? t("holdNote")(holds.length) : "";
  const nm = t("fxName");
  const fxLine = `<div class="fx">${t("fxPrefix")}
    <button data-fx="KRW">${nm.KRW} <b>${fxFmt("KRW",NOW.KRW)}</b></button>
    <button data-fx="JPY">${nm.JPY} <b>${fxFmt("JPY",NOW.JPY)}</b></button>
    <button data-fx="CNY">${nm.CNY} <b>${fxFmt("CNY",NOW.CNY)}</b></button>
    <button data-fx="UZS">${nm.UZS} <b>${uzs2(C.rate)}</b></button>
    <span>${t("fxTail")(C.rateDate)}</span></div>`;
  if (alertItem && C.asof >= alertItem.d){
    b.className = "banner on warn";
    b.innerHTML = `<b class="h">${t("alertDue")(left, kdate(lastSession))}</b>
      ${isMaster() ? t("alertDueBody")(kdate(NP.start), kdate(NP.end), nCount, usd(C.price), usd(nUsd), uzs(nUzs)) : t("alertDueBodyV")(kdate(NP.start), kdate(NP.end), nCount)}${holdNote}${fxLine}`;
  } else {
    b.className = "banner on ok";
    b.innerHTML = alertItem ? `<b class="h">${t("alertNext")(kdate(alertItem.d), alertItem.time)}</b>
      ${t("alertNextBody")(C.N, kdate(lastSession))}${holdNote}${fxLine}` : fxLine;
  }
  if (isMaster() && payLoaded && !payErr){
    const paidNext = payments.find(p => p.periodStart === fmt(NP.start)), paidCur = payments.find(p => p.periodStart === fmt(P.start));
    const tag = paidNext ? t("bannerPaid")(paidNext.paidOn) : paidCur ? t("bannerCurPaid")(paidCur.paidOn) : "";
    b.insertAdjacentHTML("beforeend", `<div class="paystate">${tag ? `<span class="paidtag">${tag}</span>` : ""}<button class="sm" id="bannerPay">${t("bannerPayBtn")}</button></div>`);
    $("bannerPay").onclick = () => openPayForm();
  }
  b.querySelectorAll("[data-fx]").forEach(x => x.onclick = () => openFx(x.dataset.fx));

  // 달력
  const wrap = $("months-wrap"); wrap.innerHTML = "";
  const byDay = {};
  S.forEach(s => (byDay[fmt(s.d)] ||= []).push(s));
  Object.values(byDay).forEach(a => a.sort(byTime));
  let calEnd = S.reduce((m,x) => x.d > m ? x.d : m, lastSession);
  if (addDate && parse(addDate) > calEnd) calEnd = parse(addDate);
  let m = new Date(Date.UTC(P.start.getUTCFullYear(), P.start.getUTCMonth(), 1));
  let lastM = new Date(Date.UTC(calEnd.getUTCFullYear(), calEnd.getUTCMonth(), 1));
  const sixM = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth()+5, 1));
  if (calExpanded && sixM > lastM) lastM = sixM;
  $("expandBtn").textContent = calExpanded ? t("collapse") : t("expand");
  const act = t("act");
  while (m <= lastM){
    const box = document.createElement("div"); box.className = "month";
    box.innerHTML = `<h3>${t("monthHead")(m.getUTCFullYear(), m.getUTCMonth()+1)}</h3>`;
    const cal = document.createElement("div"); cal.className = "cal";
    t("dow").forEach((w,i) => cal.insertAdjacentHTML("beforeend", `<div class="dow ${i===0?"sun":""}">${w}</div>`));
    for (let i=0;i<m.getUTCDay();i++) cal.insertAdjacentHTML("beforeend","<div></div>");
    const days = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth()+1, 0)).getUTCDate();
    for (let dd=1; dd<=days; dd++){
      const d = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), dd));
      const k = fmt(d), list = byDay[k];
      const el = document.createElement("div");
      el.className = "day " + (d >= P.start && d <= calEnd ? "in" : "out");
      if (k === fmt(C.asof)) el.classList.add("today");
      el.textContent = dd; el.dataset.date = k;
      if (isMaster() && d >= P.start){ el.classList.add("addable"); el.onclick = e => { if (!e.target.closest(".it")) openAdd(k); }; }
      if (addDate === k) el.classList.add("addsel");
      if (list){
        el.classList.add("has");
        if (alertItem && list.includes(alertItem)) el.classList.add("alert");
        list.forEach(s => {
          const it = document.createElement("span");
          const kc = klass(s);
          const short = (s.act === "plan" || s.act === "done") ? s.time
            : s.act === "hold" && kc === "hold" ? "Hold"
            : (s.children ? `${act[s.act]}→${sdate(s.children[0].d)}` : act[s.act]);
          it.className = `it ${s.kind} ${kc}` + (selected === s.id ? " sel" : "");
          it.textContent = `${labelOf(s)} ${short}`;
          it.title = `${labelOf(s)} · ${statusText(s)}${s.meta&&s.meta.memo?" · "+s.meta.memo:""}`;
          const fb = feedback[s.id];
          if (s.act === "done" && fb){ it.textContent += " 📝"; it.title += " · " + t("fbHas"); }
          else if (s.act === "done" && isTeacher() && fbDue(s)) { it.textContent += " ✍"; it.classList.add("fbdue"); it.title += " · " + t("fbDue"); }
          if (isMaster()) it.onclick = () => selectSession(selected === s.id ? null : s.id);
          else if (isSub() && s.act === "plan" && s.d >= C.asof && !pendingFor(s.id)) it.onclick = () => openReq(reqSid === s.id ? null : s.id);
          else if (isTeacher() && s.act === "done") it.onclick = () => openFb(fbSid === s.id ? null : s.id);
          else it.style.cursor = "default";
          if (pendingFor(s.id)){ it.classList.add("pending"); it.textContent += " ⏳"; it.title += " · " + t("st_pending"); }
          if (reqSid === s.id || fbSid === s.id) it.classList.add("sel");
          const zw = zoomState(s, C);
          if (zw === "open"){ it.className = "it zlive"; it.textContent = t("zJoinChip")(labelOf(s)); it.insertAdjacentHTML("beforeend", `<span class="zd ${zOtherIn() ? "on" : ""}"></span>`); it.title = t("zChipTitle"); it.onclick = e => { e.stopPropagation(); joinZoom(s); }; }
          else if (zw === "next"){ it.textContent += " 🔒"; it.title += " · " + t("zLock"); }
          el.appendChild(it);
        });
      }
      cal.appendChild(el);
    }
    box.appendChild(cal); wrap.appendChild(box);
    m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth()+1, 1));
  }

  // 선택 패널
  const sel = selected && S.find(s => s.id === selected);
  if (sel){ renderPanel(sel, C); positionPanel(); }
  else { $("actions").className = "actions"; selected = null; }
  const rs = reqSid && isSub() && S.find(x => x.id === reqSid);
  if (rs){ renderReq(rs, C); positionPop($("reqPanel"), $("calcard").querySelector(".it.sel")); } else { $("reqPanel").className = "actions"; reqSid = null; }
  const fs = fbSid && isTeacher() && S.find(x => x.id === fbSid);
  if (fs){ renderFb(fs); positionPop($("fbPanel"), $("calcard").querySelector(".it.sel")); } else { $("fbPanel").className = "actions"; fbSid = null; }
  renderFbCard(S);
  if (addDate && isMaster()){ renderAdd(C); positionPop($("addPanel"), document.querySelector(`.day[data-date="${addDate}"]`)); }
  else { $("addPanel").className = "actions"; addDate = null; }

  // 보류 목록
  $("holds").innerHTML = holds.length ? holds.map(h => `<div><span>${kdate(h.d)} ${labelOf(h)}<br><span class="hint">${t("cause")[h.cause]} · ${esc(h.meta.memo||t("noReason"))}</span></span>
      ${isMaster()?`<button class="ghost" data-sel="${h.id}">${t("pickDate")}</button>`:""}</div>`).join("")
    : `<div class="empty">${t("noHolds")}</div>`;
  $("holds").querySelectorAll("[data-sel]").forEach(x => x.onclick = () => {
    selectSession(x.dataset.sel, "move");
    $("actions").scrollIntoView({behavior:"smooth", block:"center"});
  });

  // 목록
  const tEnd = tm => { const [a,b2] = tm.split(":").map(Number); const e = new Date(Date.UTC(2000,0,1,a,b2+C.dur)); return `${tm}–${String(e.getUTCHours()).padStart(2,"0")}:${String(e.getUTCMinutes()).padStart(2,"0")}`; };
  $("list").innerHTML = S.slice().sort(byTime).map(s => {
    const notes = [];
    if (s.edited) notes.push(t("nEdited")(kdate(s.origD)));
    if (s.children) s.children.forEach(c => notes.push(`${labelOf(c)} → ${kdate(c.d)} ${c.time}`));
    if (s.act === "hold" && klass(s) === "hold") notes.push(t("nTBD"));
    if (klass(s) === "consumed") notes.push(t("nConsumed"));
    if (s.kind === "bonus") notes.push(t("nBonus")(sdate(s.from.d)));
    if (s.kind === "moved") notes.push(t("nMakeup")(sdate(s.from.d), labelOf(s.from)));
    if (s.meta && s.meta.memo) notes.push(t("nReason")(s.meta.memo));
    if (s.meta && s.meta.agreed) notes.push(t("nContact")(s.meta.agreed, s.meta.notice, s.meta.late));
    if (s.kind === "extra" && !s.paid) notes.unshift(t("nExtra")(false));   // 유료 추가 수업은 정규 수업처럼 표시
    const fee = (s.kind === "reg" || (s.kind === "extra" && s.paid)) ? usd(C.price) : (s.kind === "bonus" || s.kind === "extra") ? "$0.00" : t("inPrepaid");
    const cc = s.act==="done" ? "c-done" : s.act==="plan" ? "" : s.cause ? "c-"+s.cause : "";
    return `<tr><td>${kdate(s.d)} ${s===alertItem?"🔔":""}<br><span class="hint">${tEnd(s.time)}</span></td>
      <td><span class="tag ${s.kind}">${labelOf(s)}</span></td>
      <td class="${cc}">${statusText(s)}</td><td>${notes.map(esc).join("<br>")}</td><td class="r mono usdcol">${fee}</td></tr>`;
  }).join("") + `<tr><th colspan="4">${t("listFoot")(prepaid, bonusCount, movedCount)}</th><th class="r mono usdcol">${usd(prepaidUsd)}</th></tr>`;

  // 근거
  const cnt = f => S.filter(f).length;
  $("basis").innerHTML = t("basis")({
    ps:kdate(P.start), pe:kdate(Pend), ext: paidDates.length > 0, months:C.months, count:C.count, prepaid, slot:tEnd(C.time), dur:C.dur,
    price:usd(C.price), usd:usd(prepaidUsd), rate:uzs2(C.rate), rateDate:C.rateDate, uzs:uzs2(prepaidUzs),
    consumed:cnt(s => klass(s)==="consumed"), teacher:cnt(s => klass(s)==="teacher"), bonus:bonusCount,
    relocated:cnt(s => klass(s)==="relocated"), holds:holds.length, last:kdate(lastSession), N:C.N, alert:alertItem?kdate(alertItem.d):"–"
  }).map((x,i) => `<div${i===2?' class="money"':""}>${isMaster() ? x : x.replace(/ \(\$0\)/, "")}</div>`)
    .map((x,i,arr) => (i === 1 && freeX) ? x + `<div>${t("basisExtra")(freeX)}</div>` : x).join("");
  $("nextBasis").innerHTML = t("next")({a:kdate(NP.start), b:kdate(NP.end), months:C.months, count:C.count, n:nCount, list:NP.list.map(sdate).join(", "),
    price:usd(C.price), usd:usd(nUsd), rate:uzs2(C.rate), uzs:uzs2(nUzs)}).map((x,i) => `<div${i===2?' class="money"':""}>${x}</div>`).join("")
    + `<div class="hint">${t("nextHint")(holds.length)}</div>`;

  // 기록
  $("logCount").textContent = log.length ? "(" + t("logCountTxt")(log.length) + ")" : "";
  $("log").innerHTML = log.length ? log.slice().reverse().map(l => `<div class="logrow${l.fix ? " fixrow" : ""}"><div><time>${esc(l.at)}${l.by ? ` · <span class="bytag">${esc(l.by)}</span>` : ""}</time>${esc(l[lang] || l.ko || l.text || "")}</div>${isMaster() ? `<button class="logdel" data-id="${esc(logId(l))}" title="${t("logDel")}">×</button>` : ""}</div>`).join("")
    : `<div class="empty">${t("noLog")}</div>`;

  $("log").querySelectorAll(".logdel").forEach(btn => btn.onclick = () => removeLogs([btn.dataset.id]));
  $("logClear").textContent = clearArm ? t("logClearQ") : t("logClear");
  $("logClear").disabled = !log.length;
  $("dlArch").disabled = archive === null;

  // 카톡 메시지
  // 변경 내역 = 상태가 바뀐 수업(이동·취소·Hold·No-show·수정) + 새로 추가한 수업
  const xMemo = id => (extras.find(x => x.id === id) || {}).memo;
  const changed = S.filter(s => !["plan","done"].includes(s.act) || s.edited || (s.kind === "extra" && !s.paid)).sort((a,b)=>a.origD-b.origD)
    .map(s => {
      if (s.kind === "extra" && ["plan","done"].includes(s.act))
        return `· ${sdate(s.d)} ${s.time} ${labelOf(s)} ${t("nExtra")(s.paid)}${xMemo(s.id)?` (${xMemo(s.id)})`:""}`;
      return `· ${sdate(s.origD)} ${labelOf(s)} ${statusText(s)}${s.children?" → "+s.children.map(c=>`${labelOf(c)} ${sdate(c.d)}`).join(", "):""}${s.meta.memo?` (${s.meta.memo})`:""}`;
    }).join("\n");
  $("msg").value = t("msg")({ps:kdate(P.start), pe:kdate(Pend), slot:tEnd(C.time), dur:C.dur, prepaid, price:usd(C.price), usd:usd(prepaidUsd),
    rate:uzs2(C.rate), rateDate:C.rateDate, uzs:uzs(prepaidUzs), changed, left, last:kdate(lastSession),
    na:kdate(NP.start), nb:kdate(NP.end), nn:nCount, nusd:usd(nUsd), nuzs:uzs(nUzs)});
}

/* ---------- 상태 변경 패널 ---------- */
let pick = {act:null, cause:null, how:"end"};
function selectSession(id, a){
  if (id && !isMaster()) return;
  selected = id; if (id) addDate = null;
  const m = id && state[id] || {};
  pick = {act: a || null, cause: m.cause || null, how: m.how || "end"};
  $("agreed").value = todayStr(); $("toDate").value = ""; $("toTime").value = $("time").value || "17:00";
  $("memo").value = m.memo || "";
  render();
}
function setSeg(id, v){ $(id).querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === v)); }
function positionPanel(){ positionPop($("actions"), $("calcard").querySelector(".it.sel")); }
function positionPop(p, it){
  const card = $("calcard");
  const wasOpen = p.classList.contains("on");
  p.className = "actions on";
  if (!it || window.innerWidth <= 640){ return; }
  const cr = card.getBoundingClientRect(), ir = it.getBoundingClientRect();
  const pw = p.offsetWidth, ph = p.offsetHeight, gap = 12;
  let left, side;
  if (ir.right - cr.left + gap + pw <= cr.width + 40){ left = ir.right - cr.left + gap; side = "right"; }
  else if (ir.left - cr.left - gap - pw >= -40){ left = ir.left - cr.left - gap - pw; side = "left"; }
  else { left = Math.max(8, Math.min(cr.width - pw - 8, ir.left - cr.left)); side = "below"; }
  let top = side === "below" ? ir.bottom - cr.top + gap : ir.top - cr.top - 14;
  const overflow = (cr.top + top + ph) - (window.innerHeight - 12);
  if (side !== "below" && overflow > 0) top = Math.max(ir.top - cr.top - ph + 30, top - overflow);
  top = Math.max(-cr.top + 12, top);
  p.style.left = left + "px"; p.style.top = top + "px";
  p.style.setProperty("--ay", Math.max(14, Math.min(ph - 26, ir.top - cr.top - top + ir.height/2 - 6)) + "px");
  p.classList.add(side);
  if (!wasOpen){ const r = p.getBoundingClientRect(); if (r.top < 0 || r.bottom > window.innerHeight) p.scrollIntoView({behavior:"smooth", block:"nearest"}); }
}
window.addEventListener("resize", () => { if (selected) positionPanel(); });
document.addEventListener("mousedown", e => {
  if (!selected && !addDate && !reqSid && !fbSid) return;
  if ((reqSid || fbSid) && !e.target.closest(".actions") && !e.target.closest(".it") && !e.target.closest(".lang") && !e.target.closest(".modal") && !e.target.closest("#fbCard")){ reqSid = null; fbSid = null; render(); return; }
  if (e.target.closest(".actions") || e.target.closest(".it") || e.target.closest(".modal") || e.target.closest("[data-sel]") || e.target.closest(".lang") || e.target.closest(".day.addable") || e.target.closest("#addBtn")) return;
  addDate = null; selectSession(null);
});

/* ---------- 사용자(보조 마스터) 관리: 아이디 발급 → 카톡 초대 → 본인 등록 ---------- */
// data/users.json 에는 사용자별로 '선생님용 토큰'을 각자의 비밀번호(처음엔 초대 코드)로 암호화한 값만 저장합니다.
// (PBKDF2-SHA256 25만 회 + AES-GCM) — 토큰 원문이나 비밀번호는 어디에도 저장되지 않습니다.
const TTOKKEY = "eng-class-teacher-token";
const bytes2b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const b642bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(pw, salt, iter){
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2", salt, iterations: iter, hash:"SHA-256"}, base, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]);
}
async function lockToken(token, pw, iter = 250000){
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name:"AES-GCM", iv}, await deriveKey(pw, salt, iter), new TextEncoder().encode(token));
  return {iter, salt: bytes2b64(salt), iv: bytes2b64(iv), ct: bytes2b64(ct)};
}
async function unlockToken(box, pw){
  const pt = await crypto.subtle.decrypt({name:"AES-GCM", iv: b642bytes(box.iv)}, await deriveKey(pw, b642bytes(box.salt), box.iter), b642bytes(box.ct));
  return new TextDecoder().decode(pt);
}
function inviteCode(){ const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; return Array.from(crypto.getRandomValues(new Uint8Array(8)), n => A[n % A.length]).join(""); }
const normId = s => String(s || "").trim().toLowerCase();
async function fetchUsers(){
  try {
    const g = await ghGet(ACCESS_REPO, "users.json");
    return {users: ((g.data && g.data.users) || []).filter(u => u && /^[a-z0-9._-]{2,20}$/.test(u.id || "")), sha: g.sha};
  } catch(e) { return {users: [], sha: null}; }
}
async function saveUsers(users, sha, token, message){ await ghPut(ACCESS_REPO, "users.json", {users}, message, sha, token); }
function becomeUser(u, token){
  const c = repoCoords();
  auth = {token, owner: c.owner, repo: c.repo, role: "sub", kind: roleOf(u), login: u.id, name: u.name};
  try { localStorage.setItem(AUTHKEY, JSON.stringify(auth)); } catch(e) {}
}
// 마스터 아이디 로그인: english-class-access/master.json 에 마스터 토큰을 마스터 비밀번호로 암호화해 저장
async function fetchMasterBox(){
  try { const g = await ghGet(ACCESS_REPO, "master.json"); const d = g.data || {};
    return {m: (d.id && d.box && /^[a-z0-9._-]{2,20}$/.test(d.id)) ? d : null, sha: g.sha};
  } catch(e) { return {m: null, sha: null}; }
}
async function renderMasterId(){
  if (!isMaster()) return;
  const {m} = await fetchMasterBox();
  $("midState").textContent = m ? t("midSet")(m.id, fmtStamp(m.at)) : t("midUnset");
  $("midId").value = m ? m.id : ""; $("midDel").style.display = m ? "" : "none";
}
async function saveMasterId(){
  const out = $("midMsg"), id = normId($("midId").value), p1 = $("midPw1").value, p2 = $("midPw2").value;
  out.className = "hint bad";
  if (!/^[a-z0-9._-]{2,20}$/.test(id)){ out.textContent = t("midIdRule"); return; }
  if (p1.length < 12 || p1 !== p2){ out.textContent = t("midPwRule"); return; }
  out.className = "hint"; out.textContent = t("loginChecking");
  try {
    const {users} = await fetchUsers(); if (users.some(u => u.id === id)) throw new Error(t("midIdTaken"));
    const {sha} = await fetchMasterBox();
    const box = await lockToken(auth.token, p1, 600000);
    await ghPut(ACCESS_REPO, "master.json", {id, box, owner: auth.owner, repo: auth.repo, privRepo: privRepo(), at: new Date().toISOString()}, "Master ID login updated", sha);
    $("midPw1").value = $("midPw2").value = ""; out.textContent = t("midSaved"); renderMasterId();
  } catch(e) { out.className = "hint bad"; out.textContent = e.message; }
}
async function deleteMasterId(){
  if (!confirm(t("midDelAsk"))) return;
  const out = $("midMsg");
  try { const {sha} = await fetchMasterBox(); if (sha) await ghDelete(ACCESS_REPO, "master.json", "Master ID login removed", sha); out.className = "hint"; out.textContent = t("midDeleted"); renderMasterId(); }
  catch(e) { out.className = "hint bad"; out.textContent = e.message; }
}
async function tryMasterLogin(id, pw){
  const {m} = await fetchMasterBox();
  if (!m || m.id !== id) return false;
  let token; try { token = await unlockToken(m.box, pw); } catch(e) { throw new Error(t("subBadPw")); }
  const c = repoCoords(), priv = m.privRepo || PRIV_DEFAULT;
  // 진짜 마스터 토큰인지 확인 (비공개 저장소를 읽을 수 있어야 함)
  const r = await fetch(`https://api.github.com/repos/${c.owner}/${priv}`, {headers:{Accept:"application/vnd.github+json", Authorization:"Bearer " + token}});
  if (!r.ok) throw new Error(t("midBadTok"));
  const u = await fetch("https://api.github.com/user", {headers:{Authorization:"Bearer " + token}}).then(x => x.ok ? x.json() : {}).catch(() => ({}));
  auth = {token, owner: c.owner, repo: c.repo, login: u.login || c.owner, privRepo: priv};
  try { localStorage.setItem(AUTHKEY, JSON.stringify(auth)); } catch(e) {}
  $("loginModal").classList.remove("on"); $("subPw").value = "";
  renderAcct(); await loadRemote(); loadPayments(); loadArchive(); loadRequests(); loadFeedback(); if (incoming) showReq();
  return true;
}
// 아이디 로그인
async function doSubLogin(){
  const out = $("loginMsg"), id = normId($("subId").value), pw = $("subPw").value;
  out.className = "hint"; out.textContent = t("loginChecking");
  try {
    if (await tryMasterLogin(id, pw)) return;
    const {users} = await fetchUsers();
    const u = users.find(x => x.id === id);
    if (!u){   // 허브(새 선생님·학생) 계정이면 허브로 로그인시켜 보냄
      let acc = null; try { const g = await ghGet(ACCESS_REPO, "hub/accounts.json"); acc = ((g.data && g.data.accounts) || []).find(a => a.id === id); } catch(e) {}
      if (!acc) throw new Error(t("uNoId"));
      let K; try { K = await unlockToken(acc.box, pw); } catch(e) { throw new Error(t("subBadPw")); }
      try { localStorage.setItem("eng-hub-session", JSON.stringify({id, role: acc.role, K})); } catch(e) {}
      location.href = "hub.html"; return;
    }
    if (u.status !== "active") throw new Error(t("uNotRegistered"));
    let token; try { token = await unlockToken(u.box, pw); } catch(e) { throw new Error(t("subBadPw")); }
    becomeUser(u, token);
    $("loginModal").classList.remove("on"); $("subPw").value = "";
    renderAcct(); await loadRemote(); loadRequests(); loadFeedback(); logActivity("login");
  } catch(e) { out.className = "hint bad"; out.textContent = e.message; }
}
// 초대 링크로 등록 (#invite=아이디)
async function doRegister(){
  const out = $("regMsg"), id = normId($("regId").value), code = $("regCode").value.trim().toUpperCase(), p1 = $("regPw1").value, p2 = $("regPw2").value;
  out.className = "hint";
  if (p1.length < 8 || p1 !== p2){ out.className = "hint bad"; out.textContent = t("regPwRule"); return; }
  out.textContent = t("loginChecking");
  try {
    const {users, sha} = await fetchUsers();
    const u = users.find(x => x.id === id);
    if (!u || u.status !== "invited") throw new Error(t("regNoInvite"));
    let token; try { token = await unlockToken(u.box, code); } catch(e) { throw new Error(t("regBadCode")); }
    u.box = await lockToken(token, p1); u.status = "active"; u.registeredAt = new Date().toISOString();
    await saveUsers(users, sha, token, `User registered: ${u.id}`);
    try { localStorage.removeItem(PENDKEY); } catch(e) {}
    becomeUser(u, token);
    $("regModal").classList.remove("on");
    try { history.replaceState(null, "", location.pathname); } catch(e) {}
    renderAcct(); await loadRemote(); loadRequests(); loadFeedback(); logActivity("login");
  } catch(e) { out.className = "hint bad"; out.textContent = e.message; }
}
function checkInvite(){
  const m = location.hash.match(/^#invite=([a-z0-9._-]+)$/i);
  if (!m || isEditor()) return;
  $("regId").value = m[1]; $("regCode").value = ""; $("regCodeWrap").style.display = ""; $("regPw1").value = $("regPw2").value = ""; $("regMsg").textContent = "";
  openModal("regModal");
}
// 마스터: 사용자 목록 · 초대 · 다시 초대 · 삭제
let teacherToken = ""; try { teacherToken = localStorage.getItem(TTOKKEY) || ""; } catch(e) {}
async function renderRepoStatus(){
  if (!isMaster()) return;
  const el = $("repoStatus"); el.textContent = t("loginChecking");
  const rows = [];
  for (const repo of [auth.repo, privRepo(), SHARE_REPO, ACCESS_REPO]){
    const ok = await canWrite(repo, auth.token);
    rows.push(`${ok ? "✓" : "✗"} ${esc(repo)}`);
  }
  el.innerHTML = rows.join(" · ") + (rows.some(r => r.startsWith("✗")) ? `<br><span class="bad">${t("repoMissing")}</span>` : "");
}
async function renderUsers(){
  if (!isMaster()) return;
  $("uTokState").textContent = teacherToken ? t("uTokSet") : t("uTokUnset");
  $("uTokWrap").style.display = teacherToken ? "none" : "";
  const {users} = await fetchUsers();
  $("uList").innerHTML = users.length ? users.map(u => `<div class="urow"><span><b>${esc(u.id)}</b> · ${esc(u.name)} · ${t(roleOf(u) === "student" ? "roleS" : "roleT")}<br>
      <span class="hint">${u.status === "active" ? t("uActive")(fmtStamp(u.registeredAt)) : t("uInvited")(fmtStamp(u.invitedAt))}</span></span>
      <span><button class="ghost sm" data-reinv="${u.id}">${t("uReinvite")}</button> <button class="ghost sm danger" data-udel="${u.id}">${t("uDelete")}</button></span></div>`).join("")
    : `<div class="empty">${t("uNone")}</div>`;
  $("uList").querySelectorAll("[data-reinv]").forEach(b => b.onclick = () => invite(b.dataset.reinv));
  $("uList").querySelectorAll("[data-udel]").forEach(b => b.onclick = () => deleteUser(b.dataset.udel, b));
}
// Can this token write to the repo? A PUT with a wrong sha never changes anything:
// 409/422 = the token may write (only the sha was wrong); 401/403/404 = it may not.
async function canWrite(repo, tok){
  try {
    const r = await fetch(`https://api.github.com/repos/${auth.owner}/${repo}/contents/${repo === privRepo() ? "state.json" : "README.md"}`, {method:"PUT",
      headers:{Accept:"application/vnd.github+json", Authorization:"Bearer " + tok, "Content-Type":"application/json"},
      body: JSON.stringify({message:"permission check", content:"", sha:"0000000000000000000000000000000000000000"})});
    return r.status === 409 || r.status === 422;
  } catch(e) { return false; }
}
async function setTeacherToken(){
  const tok = $("uToken").value.trim(), out = $("uMsg"); out.className = "hint"; out.textContent = t("loginChecking");
  try {
    if (!tok) throw new Error(t("uNeedTok"));
    const H = {Accept:"application/vnd.github+json", Authorization:"Bearer " + tok};
    for (const repo of [SHARE_REPO, ACCESS_REPO]) if (!(await canWrite(repo, tok))) throw new Error(t("uTokNeeds")(repo));
    if (await canWrite(auth.repo, tok)) throw new Error(t("uTokTooWide")(auth.repo));
    const pr = await fetch(`https://api.github.com/repos/${auth.owner}/${privRepo()}`, {headers: H});
    if (pr.ok) throw new Error(t("uTokTooWide")(privRepo()));
    teacherToken = tok; try { localStorage.setItem(TTOKKEY, tok); } catch(e) {}
    $("uToken").value = ""; out.textContent = ""; renderUsers();
  } catch(e) { out.className = "hint bad"; out.textContent = e.message; }
}
async function invite(idArg){
  const out = $("uMsg"); out.className = "hint";
  const id = normId(idArg || $("uNewId").value), name = idArg ? null : $("uNewName").value.trim(), role = $("uNewRole").value === "student" ? "student" : "teacher";
  if (!teacherToken){ out.className = "hint bad"; out.textContent = t("uNeedTok"); return; }
  if (!/^[a-z0-9._-]{2,20}$/.test(id)){ out.className = "hint bad"; out.textContent = t("uIdRule"); return; }
  try {
    const {users, sha} = await fetchUsers();
    let u = users.find(x => x.id === id);
    if (u && !idArg){ out.className = "hint bad"; out.textContent = t("uDup"); return; }
    const code = inviteCode();
    if (!u){ u = {id, name: name || id, role}; users.push(u); }
    u.box = await lockToken(teacherToken, code); u.status = "invited"; u.invitedAt = new Date().toISOString(); delete u.registeredAt;
    await saveUsers(users, sha, auth.token, `Invite user: ${id}`);
    $("uNewId").value = $("uNewName").value = ""; $("uNewRole").value = "teacher";
    const link = teacherLink() + "#invite=" + id;
    $("uInvite").value = t("uInviteMsg")({name: u.name, id, code, link});
    $("uInviteBox").style.display = "";
    renderUsers();
  } catch(e) { out.className = "hint bad"; out.textContent = e.message; }
}
async function deleteUser(id, btn){
  if (btn.dataset.arm !== "1"){ btn.dataset.arm = "1"; btn.textContent = t("payDelQ"); return; }
  const {users, sha} = await fetchUsers();
  await saveUsers(users.filter(u => u.id !== id), sha, auth.token, `Remove user: ${id}`);
  $("uMsg").className = "hint"; $("uMsg").textContent = t("uDeleted"); renderUsers();
}
$("doSubLogin").onclick = doSubLogin;
$("subPw").addEventListener("keydown", e => { if (e.key === "Enter") doSubLogin(); });
$("doRegister").onclick = doRegister;
$("uTokSave").onclick = setTeacherToken;
$("uTokChange").onclick = () => { $("uTokWrap").style.display = ""; };
$("uInviteBtn").onclick = () => invite();
$("uInviteCopy").onclick = () => copy($("uInvite").value, t("copied"));
document.querySelectorAll("#loginTabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll("#loginTabs button").forEach(x => x.classList.toggle("on", x === b));
  $("loginMaster").style.display = b.dataset.v === "master" ? "" : "none";
  $("loginSub").style.display = b.dataset.v === "sub" ? "" : "none";
  $("loginMsg").textContent = "";
});
window.addEventListener("hashchange", checkInvite);
/* ---------- 등록 요청 → 마스터 승인 → (같은 기기에서) 비밀번호 정하고 완료 ---------- */
const PENDKEY = "eng-class-pending-reg";
let incomingReg = null;
$("regReqLink").onclick = e => { e.preventDefault(); $("loginModal").classList.remove("on"); $("rrOut").style.display = "none"; $("rrMsg").textContent = ""; openModal("regReqModal"); };
$("rrSend").onclick = async () => {
  const id = normId($("rrId").value), name = $("rrName").value.trim(), role = $("rrRole").value === "student" ? "student" : "teacher", out = $("rrMsg");
  out.className = "hint";
  if (!/^[a-z0-9._-]{2,20}$/.test(id)){ out.className = "hint bad"; out.textContent = t("uIdRule"); return; }
  if (!name){ out.className = "hint bad"; out.textContent = t("rrNeedName"); return; }
  const s = inviteCode() + inviteCode();                     // 이 기기에만 남는 1회용 비밀값
  try { localStorage.setItem(PENDKEY, JSON.stringify({id, name, s})); } catch(e) {}
  const url = teacherLink() + "#regreq=" + b64url(JSON.stringify({id, name, role, s, at: nowStamp()}));
  const text = t("rrText")({id, name, role: t(role === "student" ? "roleS" : "roleT"), url});
  $("rrText").value = text; $("rrOut").style.display = "";
  if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)){ try { await navigator.share({text}); } catch(e) {} }
};
$("rrCopy").onclick = () => copy($("rrText").value, t("copied"));
// 마스터: #regreq= 링크를 열면 승인 창
function checkRegReq(){
  const m = location.hash.match(/^#regreq=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  try { incomingReg = JSON.parse(unb64url(m[1])); } catch(e){ incomingReg = null; return; }
  showRegApprove();
}
async function showRegApprove(){
  const r = incomingReg; if (!r) return;
  $("raBody").innerHTML = `<div><b>${t("uIdL")}</b> · ${String(r.id).replace(/</g,"&lt;")}</div><div><b>${t("uNewName")}</b> · ${String(r.name).replace(/</g,"&lt;")}</div><div><b>${t("uRoleL")}</b> · ${t(roleOf(r) === "student" ? "roleS" : "roleT")}</div><div><b>${t("rqWhen")}</b> · ${esc(r.at)}</div>`;
  const msg = $("raMsg"); msg.className = "hint"; msg.textContent = "";
  let ok = isMaster();
  if (!ok) msg.textContent = t("rqNeedLogin");
  else if (!teacherToken){ ok = false; msg.className = "hint bad"; msg.textContent = t("raNeedTok"); }
  else {
    const {users} = await fetchUsers();
    const ex = users.find(u => u.id === normId(r.id));
    if (ex && ex.status === "active"){ msg.className = "hint bad"; msg.textContent = t("raExists"); }
  }
  $("raApprove").style.display = ok ? "" : "none";
  openModal("raModal");
}
$("raApprove").onclick = async () => {
  const r = incomingReg, msg = $("raMsg"); if (!r || !isMaster() || !teacherToken) return;
  msg.className = "hint"; msg.textContent = t("loginChecking");
  try {
    const {users, sha} = await fetchUsers(), id = normId(r.id);
    let u = users.find(x => x.id === id); if (!u){ u = {id}; users.push(u); }
    u.name = r.name; u.role = roleOf(r); u.box = await lockToken(teacherToken, r.s); u.status = "invited"; u.invitedAt = new Date().toISOString(); delete u.registeredAt;
    await saveUsers(users, sha, auth.token, `Approve registration: ${id}`);
    msg.textContent = t("raDone")(r.name); $("raApprove").style.display = "none";
    try { history.replaceState(null, "", location.pathname); } catch(e) {}
    incomingReg = null;
  } catch(e) { msg.className = "hint bad"; msg.textContent = e.message; }
};
$("raReject").onclick = () => { incomingReg = null; $("raModal").classList.remove("on"); try { history.replaceState(null, "", location.pathname); } catch(e) {} };
// 요청한 사람: 다시 열었을 때 승인됐는지 확인
async function checkPendingReg(){
  if (isEditor()) return;
  let p = null; try { p = JSON.parse(localStorage.getItem(PENDKEY) || "null"); } catch(e) {}
  if (!p) return;
  const {users} = await fetchUsers();
  const u = users.find(x => x.id === p.id);
  if (u && u.status === "active"){ try { localStorage.removeItem(PENDKEY); } catch(e) {} return; }
  let approved = false;
  if (u && u.status === "invited"){ try { await unlockToken(u.box, p.s); approved = true; } catch(e) {} }
  if (!approved){ setSync(t("rrWaiting")(p.id)); return; }
  $("regId").value = p.id; $("regCode").value = p.s; $("regCodeWrap").style.display = "none";
  $("regPw1").value = $("regPw2").value = ""; $("regMsg").className = "hint"; $("regMsg").textContent = t("rrApproved");
  openModal("regModal");
}
window.addEventListener("hashchange", checkRegReq);
$("lockLogin").onclick = () => $("loginBtn").click();
$("lockReg").onclick = () => { $("rrOut").style.display = "none"; $("rrMsg").textContent = ""; openModal("regReqModal"); };

/* ---------- 선생님 변경 요청 → 마스터 승인 ---------- */
let reqSid = null, rq = {act:null, cause:null, how:"end"};
const b64url = str => b64enc(str).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const unb64url = str => b64dec(str.replace(/-/g,"+").replace(/_/g,"/") + "===".slice((str.length + 3) % 4));
function openReq(id){
  reqSid = id; rq = {act:null, cause:null, how:"end"};
  $("reqDate").value = ""; $("reqTime").value = $("time").value || "17:00"; $("reqNote").value = "";
  $("reqReason").innerHTML = t("rqReasons").map((r,i) => `<option value="${i}">${r}</option>`).join("");
  $("reqOut").classList.remove("on");
  render();
}
function reqWhat(r, C){
  if (r.act === "edit") return t("rqWhatEdit")(kdate(parse(r.to)), r.toTime) + (r.cause === "teacher" ? (String(r.at).slice(0,10) === r.d ? t("rqSameDayBonus") : "") : "");
  if (r.cause === "teacher"){
    const sd = String(r.at).slice(0,10) === r.d;
    if (sd) return r.how === "date" ? t("rqWhatTeacherDate")(kdate(parse(r.to)), r.toTime) : t("rqWhatTeacher");
    return (r.how === "date" ? t("rqWhatDate")(kdate(parse(r.to)), r.toTime) : t("rqWhatEnd")) + t("rqNoPenalty");
  }
  return r.how === "date" ? t("rqWhatDate")(kdate(parse(r.to)), r.toTime) : t("rqWhatEnd");
}
function renderReq(sel, C){
  $("reqTitle").innerHTML = `<b>${t("rqTitle")(kdate(sel.d) + " " + sel.time, labelOf(sel))}</b>`;
  setSeg("reqAct", rq.act); setSeg("reqCause", rq.cause); setSeg("reqHow", rq.how);
  const mv = rq.act === "move";
  $("reqCauseFld").classList.toggle("on", mv || rq.act === "edit");
  $("reqHowFld").classList.toggle("on", mv && !!rq.cause);
  $("reqDateFld").classList.toggle("on", rq.act === "edit" || (mv && !!rq.cause && rq.how === "date"));
  if (rq.act === "edit" && !$("reqDate").value) $("reqDate").value = fmt(sel.d);
  const p = $("reqPreview"); p.className = "preview"; let x;
  if (!rq.act) x = t("rqPick");
  else if (rq.act === "edit"){
    const sd = todayStr() === fmt(sel.d);
    x = $("reqDate").value ? t("rqPvEdit")(kdate(parse($("reqDate").value)), $("reqTime").value) + (rq.cause === "teacher" ? "<br>" + outcomeHtml("edit", "teacher", null, sd) : "") : t("rqNeedDate");
    if (rq.cause === "teacher" && sd) p.className = "preview teacher";
  }
  else if (!rq.cause) x = t("rqNeedCause");
  else { const sd = todayStr() === fmt(sel.d); if (rq.cause === "teacher" && sd) p.className = "preview teacher"; x = outcomeHtml("move", rq.cause, rq.how, sd); }
  x = x.replace(/\s?\(\$0\)/g, "");
  p.innerHTML = x + `<br><span class="hint">${t("rqPvFoot")}</span>`;
}
["reqAct","reqCause","reqHow"].forEach(id => $(id).querySelectorAll("button").forEach(b => b.onclick = () => {
  const k = {reqAct:"act", reqCause:"cause", reqHow:"how"}[id]; rq[k] = b.dataset.v; $("reqOut").classList.remove("on"); render();
}));
["reqDate","reqTime"].forEach(id => $(id).addEventListener("input", () => render()));
$("xReq").onclick = $("reqClose").onclick = () => { reqSid = null; render(); };
let rqDraft = null;
// 1) 변경 요청 보내기 → 확인 창 (아직 저장 안 함)
$("reqSend").onclick = () => {
  if (!isSub()) return;
  const C = cfg(), sel = buildSessions(sundays(C.start, C.months, C.count), C).find(x => x.id === reqSid);
  if (!sel || !rq.act) return;
  if (rq.act === "move" && !rq.cause){ $("reqPreview").textContent = t("rqNeedCause"); return; }
  const needDate = rq.act === "edit" || (rq.act === "move" && rq.how === "date");
  if (needDate && !$("reqDate").value){ $("reqPreview").textContent = t("rqNeedDate"); return; }
  const reason = t("rqReasons")[+$("reqReason").value] + ($("reqNote").value.trim() ? " – " + $("reqNote").value.trim() : "");
  const r = {rid: "Q" + Date.now().toString(36), id: sel.id, d: fmt(sel.d), act: rq.act, cause: rq.cause || undefined,
    how: rq.act === "move" ? rq.how : undefined,
    to: needDate ? $("reqDate").value : undefined, toTime: needDate ? ($("reqTime").value || C.time) : undefined,
    reason, by: auth.login, name: auth.name, byKind: isStudent() ? "student" : "teacher", status: "pending"};
  const text = t("rqMsg2")({target: `${kdate(sel.d)} ${sel.time} ${labelOf(sel)}`, what: reqWhat(Object.assign({at: nowStamp()}, r), C), why: reason, who: `${r.name} (${r.by})`, url: teacherLink()});
  rqDraft = {r, text};
  $("rqdTitle").textContent = t("rqdAskTitle"); $("rqdHint").textContent = t("rqdAskHint");
  $("rqdText").value = text; $("rqdAsk").style.display = ""; $("rqdDone").style.display = "none";
  $("rqdMsg").className = "hint"; $("rqdMsg").textContent = ""; $("rqdSend").disabled = false;
  openModal("rqdModal");
};
// 2) 확인 → 저장 → 요청 창 닫기 → 완료 표시 + 카톡 공유
$("rqdSend").onclick = async () => {
  if (!rqDraft || !isSub()) return;
  const r = Object.assign({}, rqDraft.r, {at: nowStamp()});
  $("rqdSend").disabled = true; $("rqdMsg").className = "hint"; $("rqdMsg").textContent = t("rqdSaving");
  try {
    await mutateRequests(list => { if (list.some(x => x.id === r.id && x.status === "pending")) throw new Error(t("rqAlready")); list.push(r); }, `Request from ${r.by}: ${r.d} ${r.act}`); logActivity("request", `${r.d} ${r.act}`);
  } catch(e){ $("rqdSend").disabled = false; $("rqdMsg").className = "hint bad"; $("rqdMsg").textContent = t("rqSaveFail")(e.message); return; }
  rqDraft = null; reqSid = null; render(); renderPending();
  { const C2 = cfg(), to = isStudent() ? "teacher" : "master";
    announceB("request", () => t("nfReq")(r.name || r.by, `${kdate(parse(r.d))} · ${reqWhat(r, C2)}`, r.reason, to)); }
  $("rqdModal").classList.remove("on"); $("rqdSend").disabled = false; return;
  $("rqdTitle").textContent = t("rqdDoneTitle"); $("rqdHint").textContent = t("rqdDoneHint");
  $("rqdAsk").style.display = "none"; $("rqdDone").style.display = ""; $("rqdMsg").textContent = "";
  $("rqdShare").style.display = navigator.share ? "" : "none";
};
$("rqdShare").onclick = async () => { try { await navigator.share({text: $("rqdText").value}); } catch(e) {} };
$("rqdCopy").onclick = () => { copy($("rqdText").value, t("copied")); $("rqdMsg").className = "hint"; $("rqdMsg").textContent = t("rqdCopied"); };

// 마스터: 요청 링크(#req=...)를 열면 승인 창
let incoming = null;
function checkReq(){
  const m = location.hash.match(/^#req=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  try { incoming = cleanReq(JSON.parse(unb64url(m[1]))); } catch(e){ incoming = null; } if (!incoming) return;
  showReq();
}
function clearReqHash(){ incoming = null; try { history.replaceState(null, "", location.pathname + location.search); } catch(e) { location.hash = ""; } }
function showReq(){
  const r = incoming; if (!r) return;
  const C = cfg(), s = buildSessions(sundays(C.start, C.months, C.count), C).find(x => x.id === r.id);
  const lines = [[t("rqTarget"), s ? `${kdate(parse(r.d))} ${labelOf(s)}` : kdate(parse(r.d))], [t("rqWhat"), reqWhat(r, C)],
    [t("rqWhy"), (r.cause ? t("cause")[r.cause] + " · " : "") + (r.reason || "")], [t("rqWhen"), r.at]];
  $("reqInBody").innerHTML = lines.map(([k,v]) => `<div><b>${k}</b> · ${String(v).replace(/</g,"&lt;")}</div>`).join("");
  const stale = s && (fmt(s.d) !== r.d || s.act !== "plan");
  const pv = $("reqInPv"); pv.className = "preview" + (r.cause === "teacher" ? " teacher" : "");
  pv.innerHTML = !s ? t("rqGone") : (stale ? t("rqStale") + "<br>" : "") + (r.act === "edit" ? t("rqPvEdit")(kdate(parse(r.to)), r.toTime) + (r.cause === "teacher" ? "<br>" + outcomeHtml("edit", "teacher", null, String(r.at).slice(0,10) === r.d) : "") : outcomeHtml("move", r.cause, r.how, String(r.at).slice(0,10) === r.d));
  $("reqApprove").style.display = isMaster() && s ? "" : "none";
  $("reqReject").style.display = isMaster() ? "" : "none";
  $("reqInMsg").textContent = isMaster() ? "" : t("rqNeedLogin");
  openModal("reqModal");
}
$("reqApprove").onclick = () => {
  const r = incoming; if (!r || !isMaster()) return;
  applyReq(r);
  $("reqModal").classList.remove("on"); clearReqHash();
};
$("reqReject").onclick = () => {
  const r = incoming; if (!r || !isMaster()) return;
  const C = cfg();
  notifyKind = "declined"; addLog(bothLangs(() => t("rqRejected")(`${kdate(parse(r.d))} · ${reqWhat(r, C)} · ${r.reason || ""}`)), r.id); notifyKind = "change"; save(); render();
  $("reqModal").classList.remove("on"); clearReqHash();
};
window.addEventListener("hashchange", checkReq);
/* ---------- 승인 대기 요청 (data/requests.json): 등록 사용자가 저장 → 마스터가 웹에서 승인 ---------- */
let requests = [];
const pendingFor = sid => requests.find(r => r.id === sid && r.status === "pending");
async function fetchRequests(){
  if (!isEditor()) return {list: [], sha: null};
  const g = await ghGet(SHARE_REPO, "requests.json");
  return {list: ((g.data && g.data.requests) || []).map(cleanReq).filter(Boolean), sha: g.sha};
}
async function loadRequests(){ if (!isEditor()) return; try { requests = (await fetchRequests()).list; } catch(e) {} overlayApprovals(); render(); renderPending(); runReminders(); await runAutoApply(); if (isMaster()) applyTeacherApproved(); }
async function mutateRequests(fn, message, retry){
  const {list, sha} = await fetchRequests();
  fn(list);
  const body = {message, content: b64enc(JSON.stringify({requests: list}, null, 1)), branch: BRANCH}; if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${ownerOf()}/${SHARE_REPO}/contents/requests.json`, {method:"PUT", headers:{...apiHeaders(), "Content-Type":"application/json"}, body: JSON.stringify(body)});
  if ((r.status === 409 || r.status === 422) && !retry) return mutateRequests(fn, message, true);
  if (!r.ok) throw new Error("HTTP " + r.status);
  requests = list;
}
// 저장된 사유("학생 요청 – 메모")를 지금 언어로: 한국어·영어 목록에서 앞부분을 찾아 바꿔 줌
function reasonTr(s){
  s = String(s || "");
  for (const l of ["ko","en"]){ const i = L[l].rqReasons.findIndex(x => s === x || s.startsWith(x + " – ")); if (i >= 0) return t("rqReasons")[i] + s.slice(L[l].rqReasons[i].length); }
  return s;
}
const reasonIdx = s => { s = String(s || ""); for (const l of ["ko","en"]){ const i = L[l].rqReasons.findIndex(x => s === x || s.startsWith(x + " – ")); if (i >= 0) return i; } return -1; };
const stampMs = st => { const m = String(st || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/); return m ? Date.UTC(+m[1], m[2]-1, +m[3], m[4]-9, +m[5]) : NaN; };   // KST 기록 → 시각
const msStamp = ms => { const p = kstParts(new Date(ms)); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; };
const msHM = ms => { const p = kstParts(new Date(ms)); return `${+p.month}/${+p.day} ${p.hour}:${p.minute}`; };
function classStartMs(s){ const [h, m] = safeTime(s.time, "17:00").split(":").map(Number); return s.d.getTime() + (h - 9) * 3600e3 + m * 60e3; }
// 학생 요청 자동 반영 정보: 대상이면 {due, start}, 아니면 null (끄기·늦게 낸 요청·이미 바뀐 수업 제외)
function autoInfo(r, C, s){
  if (!s || r.byKind !== "student" || !C.autoMin || fmt(s.d) !== r.d || s.act !== "plan") return null;
  const start = classStartMs(s), due = start - C.autoMin * 60e3, filed = stampMs(r.at);
  return {start, due, filed, late: !(filed < due)};
}
const lateReq = (r, C) => Math.round((parse(r.d) - parse(String(r.at || todayStr()).slice(0, 10))) / 86400000) < C.minNotice;
// 화면 표시용: 사유를 "학생 요청"으로 고른 요청은 보낸 계정 역할과 상관없이 학생 요청으로 보여 줌
const shownKind = r => r.byKind === "student" || reasonIdx(r.reason) === 4 ? "student" : "teacher";
function reqBadges(r, C){
  const b = [];
  if (r.cause === "mutual") b.push(`<span class="rqb mut">${t("bMut")}</span>`);
  b.push(shownKind(r) === "student" ? `<span class="rqb stu">${t("bStuReq")}</span>` : `<span class="rqb tch">${t("bTchReq")}</span>`);
  if (r.cause === "teacher") b.push(`<span class="rqb plain">${t("bTch")}</span>`);
  if (r.cause === "me") b.push(`<span class="rqb plain">${r.byKind === "student" ? t("bMe") : t("bTch")}</span>`);
  if (r.act === "move" && lateReq(r, C) && r.status === "pending") b.push(`<span class="rqb late">${t("bLate")}</span>`);
  return `<div class="rqbs">${b.join("")}</div>`;
}
// 대기 중 학생 요청: 알림 일정 + 자동 반영까지 남은 시간 (학생·선생님 화면 같은 내용)
function autoHtml(r, C, s){
  if (r.byKind !== "student" || r.status !== "pending") return "";
  if (!C.autoMin) return `<div class="hint">${t("autoOff")}</div>`;
  const a = autoInfo(r, C, s); if (!a) return "";
  if (a.late) return `<div class="hint">${t("autoNoLate")}</div>`;
  const now = Date.now(), left = a.due - now, soon = left < 60 * 60e3;
  const steps = [[a.filed, "filed"], [a.start - 1440 * 60e3, "day"], [a.start - 180 * 60e3, "three"]].filter(x => x[1] === "filed" || (x[0] > a.filed && x[0] < a.due));
  const tl = steps.map(([ms, k]) => `<li class="${ms <= now ? "ok" : ""}"><span>${ms <= now ? t("remSent") : t("remWait")}</span><span class="mono">${msHM(ms)}</span><span>${t("remSteps")[k]}</span></li>`).join("") + `<li class="due"><span>⏱</span><span class="mono">${msHM(a.due)}</span><span>${t("remSteps").due}</span></li>`;
  return `<div class="rqauto${soon ? " soon" : ""}">${soon ? t("autoSoon")(msHM(a.due)) : t("autoIn")(msHM(a.due), t("leftFmt")(left))}</div><ul class="rqtl">${tl}</ul><div class="hint">${t("autoSame")}</div>`;
}
function reqLines(r, C){
  const s = buildSessions(sundays(C.start, C.months, C.count), C).find(x => x.id === r.id);
  const late = r.act === "move" && r.status === "pending" && lateReq(r, C);
  const auto = r.auto && !r.undone ? `<div class="rqdone">${t("autoDone")} <span class="rqb plain">${t("autoTagNo")}</span> <span class="hint">${esc(t("autoRec")(r.at, r.decidedAt || ""))}</span></div>` : "";
  return {s, html: `<div><b>${kdate(parse(r.d))} ${s ? labelOf(s) : ""}</b> · ${reqWhat(r, C)}</div>${reqBadges(r, C)}
    <div class="hint">${esc(reasonTr(r.reason))}</div>${late ? `<div class="hint">${t("lateNote")}</div>` : ""}${auto}${autoHtml(r, C, s)}`};
}
/* ---------- 학생 요청 자동 반영 + 알림 ----------
   서버 없이 동작: 누구든(학생·선생님·마스터) 사이트를 열어 두면 1분마다 확인해서
   반영 시각이 지난 대기 요청을 teacherOk(auto) 로 바꿈 → 선생님 승인과 같은 길로 달력에 반영 */
let autoRunning = false;
async function runAutoApply(){
  if (!isEditor() || autoRunning || !requests.length) return;
  const C = cfg(), sess = buildSessions(sundays(C.start, C.months, C.count), C), now = Date.now();
  const due = requests.filter(r => r.status === "pending").filter(r => { const a = autoInfo(r, C, sess.find(x => x.id === r.id)); return a && !a.late && now >= a.due && now < a.start + C.dur * 60e3; });
  if (!due.length) return;
  autoRunning = true; const ids = due.map(r => r.rid), stamp = nowStamp(), done = [];
  try {
    await mutateRequests(list => list.forEach(x => { if (ids.includes(x.rid) && x.status === "pending"){ x.status = "teacherOk"; x.auto = true; x.decidedAt = stamp; x.decidedBy = "auto"; done.push(x.rid); } }), `Auto-apply ${ids.length} student request(s) (no teacher answer)`);
  } catch(e){ autoRunning = false; return; }
  autoRunning = false;
  due.filter(r => done.includes(r.rid)).forEach(r => announceB("approved", () => t("nfAuto")(`${kdate(parse(r.d))} · ${reqWhat(r, C)}`, t("mins")(C.autoMin))));
  overlayApprovals(); render(); renderPending();
  if (isMaster()) applyTeacherApproved();
}
const REMKEY = "ecc-rq-reminded";
function runReminders(){
  if (!(isMaster() || isStudent()) || !requests.length) return;
  const C = cfg(); if (!C.autoMin) return;
  const sess = buildSessions(sundays(C.start, C.months, C.count), C), now = Date.now();
  let seen = []; try { seen = JSON.parse(localStorage.getItem(REMKEY) || "[]"); } catch(e) {}
  requests.filter(r => r.status === "pending" && (isMaster() || r.by === auth.login)).forEach(r => {
    const a = autoInfo(r, C, sess.find(x => x.id === r.id)); if (!a || a.late || now >= a.due) return;
    const stage = [["three", a.start - 180 * 60e3], ["day", a.start - 1440 * 60e3]].find(([, ms]) => ms > a.filed && ms < a.due && now >= ms);
    if (!stage || seen.includes(r.rid + ":" + stage[0]) || seen.includes(r.rid + ":three")) return;
    seen.push(r.rid + ":" + stage[0]);
    announceB("request", () => t("nfRemind")(r.name || r.by, `${kdate(parse(r.d))} · ${reqWhat(r, C)}`, msHM(a.due)));
  });
  try { localStorage.setItem(REMKEY, JSON.stringify(seen.slice(-200))); } catch(e) {}
}
setInterval(() => { if (!requests.length) return; runAutoApply(); runReminders(); renderPending(); }, 60e3);
// 선생님: 자동 반영에 이의 → 마스터에게 되돌리기 요청
async function askUndo(rid){
  if (!isTeacher()) return; const r = requests.find(x => x.rid === rid); if (!r || !r.auto) return;
  try { await mutateRequests(list => { const x = list.find(y => y.rid === rid); if (x && x.auto && !x.undoReq) x.undoReq = {by: auth.login, at: nowStamp()}; }, `Undo request for auto-applied ${rid} by ${auth.login}`); }
  catch(e){ setSync(t("rqSaveFail")(e.message), true); return; }
  announceB("request", () => t("nfUndoReq")(auth.name || auth.login, `${kdate(parse(r.d))} · ${reqWhat(r, cfg())}`)); renderPending();
}
// 마스터: 되돌리기 (아직 달력 반영 전이면 요청만 거절, 반영 후면 그 수업을 원래대로)
async function masterUndo(rid, undo){
  if (!isMaster()) return; const r = requests.find(x => x.rid === rid); if (!r) return;
  if (!(await confirmMaster())) return;
  const C = cfg(), what = `${kdate(parse(r.d))} · ${reqWhat(r, C)}`;
  if (undo && r.status === "approved"){
    const m = state[r.id];
    if (m){ if (r.act === "edit"){ const n = {...m}; delete n.ed; delete n.edCause; delete n.edSameDay; if (Object.keys(n).some(k => !["agreed","notice"].includes(k))) state[r.id] = n; else delete state[r.id]; }
      else if (m.ed) state[r.id] = {ed: m.ed, ...(m.edCause ? {edCause: m.edCause} : {})}; else delete state[r.id]; }
    addLog(bothLangs(() => t("logUndo")(what)), r.id); save();
  }
  try { await mutateRequests(list => { const x = list.find(y => y.rid === rid); if (!x) return; if (x.undoReq) x.undoReq.closed = true; if (undo){ x.undone = true; if (x.status === "teacherOk") x.status = "rejected"; } }, `${undo ? "Undo" : "Keep"} auto-applied ${rid}`); }
  catch(e){ setSync(t("rqSaveFail")(e.message), true); return; }
  if (undo) announceB("info", () => t("nfUndone")(what));
  setSync(undo ? t("undoDone") : t("undoKept")); render(); renderPending();
}
// 마스터: 승인 대기 목록
/* ---------- 학생 요청 → 선생님 승인 → 달력 변경 ----------
   선생님이 승인하면 requests.json 상태가 teacherOk 가 되고, 선생님·학생 화면에는 곧바로 바뀐 일정이 보임.
   마스터가 사이트를 열면 비밀번호 확인 한 번으로 달력(비공개 저장소)에 정식 반영 → approved */
function reqMeta(r, sess, prev){
  const notice = sess ? Math.round((sess.d - parse(String(r.at || todayStr()).slice(0, 10))) / 86400000) : 0, agreed = String(r.at || todayStr()).slice(0, 10);
  if (r.act === "edit") return {...prev, ed:{date: r.to, time: r.toTime || cfg().time}, edCause: r.cause || undefined, agreed, notice};
  const m = {act: "move", cause: r.cause, how: r.how || "end", agreed, notice, late: notice < cfg().minNotice, ...(prev.ed ? {ed: prev.ed} : {})};
  if (m.how === "date"){ m.to = r.to; m.toTime = r.toTime || cfg().time; }
  return m;
}
function overlayApprovals(){
  if (isMaster() || !baseState) return;
  const ok = requests.filter(r => r.status === "teacherOk" && !r.undone);
  state = baseState;
  if (!ok.length) return;
  const C = cfg(), P = sundays(C.start, C.months, C.count), next = JSON.parse(JSON.stringify(baseState));
  ok.forEach(r => { state = next; const s = buildSessions(P, C).find(x => x.id === r.id); if (s && fmt(s.d) === r.d) next[r.id] = reqMeta(r, s, next[r.id] || {}); });
  state = next;
}
async function teacherDecide(rid, ok){
  if (!isTeacher()) return;
  const r = requests.find(x => x.rid === rid); if (!r || r.byKind !== "student" || r.status !== "pending") return;
  try { await mutateRequests(list => { const x = list.find(y => y.rid === rid); if (x && x.status === "pending"){ x.status = ok ? "teacherOk" : "rejected"; x.decidedAt = nowStamp(); x.decidedBy = auth.login; } }, `${ok ? "Teacher approve" : "Teacher decline"} request ${rid} by ${auth.login}`);
    logActivity(ok ? "reqApprove" : "reqDecline", `${r.d} ${r.act}`); }
  catch(e){ setSync(t("rqSaveFail")(e.message), true); return; }
  overlayApprovals(); render(); renderPending();
  const C = cfg();
  announceB(ok ? "approved" : "declined", () => t("nfTd")(ok, `${kdate(parse(r.d))} · ${reqWhat(r, C)}`, r.name || r.by, auth.name || auth.login));
  setSync(ok ? t("tdDone") : t("tdDeclined"));
}
let autoApplying = false;
async function applyTeacherApproved(){
  if (!isMaster() || autoApplying) return;
  const list = requests.filter(r => r.status === "teacherOk"); if (!list.length) return;
  autoApplying = true;
  try {
    setSync(t("tdNeedPw")(list.length));
    if (!(await confirmMaster())){ setSync(t("tdLater"), true); return; }
    const C = cfg(), sess = buildSessions(sundays(C.start, C.months, C.count), C), done = [];
    list.forEach(r => { const s = sess.find(x => x.id === r.id); if (s && fmt(s.d) === r.d && s.act === "plan") applyReq(r); done.push(r.rid); });
    clearTimeout(saveTimer); await saveRemote();
    if (done.length) await mutateRequests(rl => rl.forEach(x => { if (done.includes(x.rid) && x.status === "teacherOk"){ x.status = "approved"; x.appliedAt = nowStamp(); } }), `Apply ${done.length} teacher-approved request(s)`);
    setSync(t("tdApplied")(done.length));
  } catch(e){ setSync(t("rqSaveFail")(e.message), true); }
  finally { autoApplying = false; }
  render(); renderPending();
}
function renderPending(){
  const box = $("pendList"); if (!box) return;
  const C = cfg(), today = todayStr();
  const autoShown = r => r.auto && !r.undone && r.d >= today && (isTeacher() ? !(r.undoReq && r.undoReq.closed) : (r.undoReq && !r.undoReq.closed));
  const list = requests.filter(r => (r.status === "pending" || (isMaster() && r.status === "teacherOk") || ((r.status === "teacherOk" || r.status === "approved") && autoShown(r))) && (isMaster() || (isTeacher() && r.byKind === "student"))).sort((a,b) => String(a.at).localeCompare(String(b.at)));
  $("pendCard").style.display = (isMaster() || isTeacher()) && list.length ? "" : "none";
  $("pendTitle").textContent = isTeacher() ? t("hPendT") : t("hPend");
  $("pendCount").textContent = list.length ? `(${list.length})` : "";
  box.innerHTML = list.map(r => {
    const {s, html} = reqLines(r, C);
    const stale = r.status === "pending" && (!s || fmt(s.d) !== r.d || s.act !== "plan");
    return `<div class="pendrow"><div class="hint">${shownKind(r) === "student" ? "🎓 " : "👨‍🏫 "}${esc(t("pendBy")(r.name || r.by, r.by, r.at))}${isMaster() && r.byKind === "student" && r.status === "pending" ? ` · <b>${t("pendWaitT")}</b>` : ""}</div>${html}
      ${stale ? `<div class="hint bad">${s ? t("rqStale") : t("rqGone")}</div>` : ""}
      ${r.auto && !r.undone && isTeacher() ? `<div class="btns">${r.undoReq ? `<span class="hint">${t("undoSent")}</span>` : `<button class="ghost sm" data-undo="${esc(r.rid)}">${t("undoBtn")}</button>`}</div></div>` :
      r.auto && r.undoReq && !r.undoReq.closed && isMaster() ? `<div class="hint"><b>${esc(t("undoAsk")(r.undoReq.by, r.undoReq.at))}</b></div><div class="btns"><button class="sm danger" data-mundo="${esc(r.rid)}">${t("undoDo")}</button><button class="ghost sm" data-mkeep="${esc(r.rid)}">${t("undoKeep")}</button>${r.status === "teacherOk" ? `<button class="sm" data-apply="1">${t("tdApplyBtn")}</button>` : ""}</div></div>` :
      r.status === "teacherOk" ? `<div class="hint"><b>${t("st_teacherOk")}</b> · ${esc(r.decidedBy || "")} ${esc(r.decidedAt || "")}</div><div class="btns"><button class="sm" data-apply="1">${t("tdApplyBtn")}</button></div></div>` :
      `<div class="btns">${s ? `<button class="sm" data-pa="${esc(r.rid)}">${t("pendApprove")}</button>` : ""}<button class="ghost sm danger" data-pr="${esc(r.rid)}">${t("pendReject")}</button></div></div>`}`;
  }).join("");
  // 선생님: 팝업 대신 같은 자리에서 한 번 더 확인 (휴대폰·앱 안 브라우저에서도 동작)
  const askInline = (b, rid, ok) => { const r = requests.find(x => x.rid === rid); const row = b.closest(".btns");
    row.innerHTML = `<div class="hint" style="width:100%"><b>${esc(ok ? t("tdAskOk")(r.name || r.by) : t("tdAskNo")(r.name || r.by))}</b></div><button class="sm ${ok ? "" : "danger"}" data-yes>${ok ? t("tdYes") : t("tdYesNo")}</button><button class="ghost sm" data-no>${t("tdNo")}</button>`;
    row.querySelector("[data-yes]").onclick = e => { e.target.disabled = true; e.target.textContent = "…"; teacherDecide(rid, ok); };
    row.querySelector("[data-no]").onclick = () => renderPending(); };
  box.querySelectorAll("[data-pa]").forEach(b => b.onclick = () => isTeacher() ? askInline(b, b.dataset.pa, true) : decide(b.dataset.pa, true));
  box.querySelectorAll("[data-apply]").forEach(b => b.onclick = () => applyTeacherApproved());
  box.querySelectorAll("[data-undo]").forEach(b => b.onclick = () => { b.disabled = true; askUndo(b.dataset.undo); });
  box.querySelectorAll("[data-mundo]").forEach(b => b.onclick = () => masterUndo(b.dataset.mundo, true));
  box.querySelectorAll("[data-mkeep]").forEach(b => b.onclick = () => masterUndo(b.dataset.mkeep, false));
  box.querySelectorAll("[data-pr]").forEach(b => b.onclick = () => isTeacher() ? askInline(b, b.dataset.pr, false) : decide(b.dataset.pr, false));
  renderMyRequests();
}
let notifyKind = "change", notifyItems = [], notifyLang = null, notifySent = false;
const UNSENT = "ecc-unsent-notices";
function notifyAdd(entry){
  if (!$("notify").classList.contains("on")){ notifyItems = loadUnsent(); notifySent = false; notifyLang = notifyLang || lang; }
  notifyItems.push({kind: notifyKind, ko: entry.ko, en: entry.en, at: nowStamp()});
  saveUnsent(notifyItems); renderNotify(); $("notify").classList.add("on");
}
// 단톡방 공지 한 줄 추가 (누가 무엇을 하든 같은 상자에 모임)
function announce(kind, ko, en){ const k = notifyKind; notifyKind = kind; try { notifyAdd({ko, en: en || ko}); } finally { notifyKind = k; } }
function announceB(kind, fn){ const b = bothLangs(fn); announce(kind, b.ko, b.en); }
function loadUnsent(){ try { return JSON.parse(localStorage.getItem(UNSENT) || "[]").slice(-20); } catch(e) { return []; } }
function saveUnsent(list){ try { list.length ? localStorage.setItem(UNSENT, JSON.stringify(list.slice(-20))) : localStorage.removeItem(UNSENT); } catch(e) {} renderUnsentChip(); }
function renderUnsentChip(){ const el = $("unsentChip"); if (!el) return; const n = $("notify").classList.contains("on") ? 0 : loadUnsent().length;
  el.style.display = n && isEditor() ? "" : "none"; el.textContent = t("nfUnsent")(n); }
const NF_ICON = {change: "🔄", approved: "✅", declined: "✖️", request: "🙋", info: "📌"};
function renderNotify(){
  const L2 = notifyLang || lang, url = teacherLink();
  const lines = notifyItems.map(x => `${NF_ICON[x.kind] || "•"} ${x[L2] || x.ko}`);
  $("nfText").value = `${L2 === "en" ? "📢 [English class notice]" : "📢 [영어수업 공지]"}\n${lines.join("\n")}\n👉 ${url}`;
  document.querySelectorAll("#notify [data-nl]").forEach(b => b.classList.toggle("on", b.dataset.nl === L2));
}
function markSent(){ notifySent = true; saveUnsent([]); }
document.querySelectorAll("#notify [data-nl]").forEach(b => b.onclick = () => { notifyLang = b.dataset.nl; renderNotify(); });
$("nfX").onclick = () => { $("notify").classList.remove("on"); if (notifySent) saveUnsent([]); notifyItems = []; renderUnsentChip(); };
$("nfCopy").onclick = () => { copy($("nfText").value, t("nfCopied")); markSent(); };
// 💬 단톡방에 보내기: 휴대폰은 공유창 → 카카오톡 → 단톡방 선택, PC는 복사 후 안내
$("nfShare").onclick = async () => {
  const text = $("nfText").value;
  if (navigator.share){ try { await navigator.share({text}); markSent(); setSync(t("nfSentHint")); } catch(e) {} }
  else { await copy(text, t("nfCopied")); markSent(); setSync(t("nfCopied")); }
};
$("unsentChip") && ($("unsentChip").onclick = () => { notifyItems = loadUnsent(); notifySent = false; renderNotify(); $("notify").classList.add("on"); renderUnsentChip(); });
function applyReq(r){
  selected = r.id; pick = {act: r.act, cause: r.cause || null, how: r.how || "end"};
  $("toDate").value = r.to || ""; $("toTime").value = r.toTime || $("time").value; $("agreed").value = String(r.at).slice(0,10);
  $("memo").value = `[${t(r.byKind === "student" ? "rqTagS" : "rqTag")}${r.by ? " · " + r.by : ""}${r.auto ? " · " + t("rqTagAuto")(r.at) : r.status === "teacherOk" && r.decidedBy ? " · " + t("rqTagOk")(r.decidedBy) : ""}] ${reasonTr(r.reason)}`;
  notifyKind = "approved"; try { $("applyBtn").onclick(); } finally { notifyKind = "change"; }
}
async function decide(rid, ok){
  if (!isMaster()) return;
  if (!(await confirmMaster())) return;
  const r = requests.find(x => x.rid === rid); if (!r) return;
  if (ok) applyReq(r);
  else { notifyKind = "declined"; addLog(bothLangs(() => t("rqRejected")(`${kdate(parse(r.d))} · ${reqWhat(r, cfg())} · ${r.reason || ""}${r.by ? " (" + r.by + ")" : ""}`)), r.id); notifyKind = "change"; save(); }
  try { await mutateRequests(list => { const x = list.find(y => y.rid === rid); if (x){ x.status = ok ? "approved" : "rejected"; x.decidedAt = nowStamp(); } }, `${ok ? "Approve" : "Decline"} request ${rid}`); }
  catch(e){ setSync(t("rqSaveFail")(e.message), true); }
  render(); renderPending();
}
// 사용자: 내 요청 현황
function renderMyRequests(){
  const box = $("myReqList"); if (!box) return;
  if (!isSub()){ box.innerHTML = ""; return; }
  const C = cfg(), mine = requests.filter(r => r.by === auth.login).sort((a,b) => String(b.at).localeCompare(String(a.at))).slice(0, 20);
  box.innerHTML = mine.length ? mine.map(r => `<div class="pendrow">${reqLines(r, C).html}
      <div class="hint">${esc(r.at)} · <b class="st-${esc(r.status)}">${t("st_" + r.status)}</b>${r.decidedAt ? " · " + esc(r.decidedAt) : ""}
      ${r.status === "pending" ? ` · <a href="#" data-cancel="${esc(r.rid)}">${t("myCancel")}</a>` : ""}</div></div>`).join("")
    : `<div class="empty">${t("myNone")}</div>`;
  box.querySelectorAll("[data-cancel]").forEach(a => a.onclick = async e => {
    e.preventDefault();
    try { await mutateRequests(list => { const i = list.findIndex(y => y.rid === a.dataset.cancel && y.status === "pending"); if (i >= 0) list.splice(i, 1); }, "Cancel request"); logActivity("reqCancel");
      const rc = requests.find(y => y.rid === a.dataset.cancel); if (rc){ announceB("info", () => t("nfCancel")(rc.name || rc.by, `${kdate(parse(rc.d))} · ${reqWhat(rc, cfg())}`)); } }
    catch(err){ setSync(t("rqSaveFail")(err.message), true); }
    render(); renderPending();
  });
}



/* ---------- 수업 피드백 (선생님 작성 → 학생 답장) : english-class-share/feedback.json ---------- */
let feedback = {}, fbSid = null, fbSha = null;
const FB_KEYS = ["topics","expr","good","hw"];
function cleanFb(f){
  if (!f || typeof f !== "object") return null;
  const o = {}; FB_KEYS.concat(["reply"]).forEach(k => o[k] = String(f[k] || "").slice(0, 2000));
  o.by = String(f.by || "").slice(0, 40); o.name = String(f.name || "").slice(0, 40);
  o.at = String(f.at || "").slice(0, 20); o.replyAt = String(f.replyAt || "").slice(0, 20);
  return o;
}
const fbDue = s => s.act === "done" && !feedback[s.id];
async function fetchFeedback(){
  if (!isEditor()) return {items: {}, sha: null};
  const g = await ghGet(SHARE_REPO, "feedback.json"); const raw = (g.data && g.data.items) || {}, items = {};
  Object.keys(raw).forEach(k => { if (/^[\w:]{1,40}$/.test(k)){ const f = cleanFb(raw[k]); if (f) items[k] = f; } });
  return {items, sha: g.sha};
}
async function loadFeedback(){ if (!isEditor()) return; try { feedback = (await fetchFeedback()).items; } catch(e) {} render(); }
async function mutateFeedback(fn, message, retry){
  const {items, sha} = await fetchFeedback(); fn(items);
  const body = {message, content: b64enc(JSON.stringify({items}, null, 1)), branch: BRANCH}; if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${ownerOf()}/${SHARE_REPO}/contents/feedback.json`, {method:"PUT", headers:{...apiHeaders(), "Content-Type":"application/json"}, body: JSON.stringify(body)});
  if ((r.status === 409 || r.status === 422) && !retry) return mutateFeedback(fn, message, true);
  if (!r.ok) throw new Error("HTTP " + r.status);
  feedback = items;
}
function fbText(s, f){
  const L = t("fbL"), parts = [t("fbMsgHead")(`${kdate(s.d)} ${s.time} ${labelOf(s)}`)];
  FB_KEYS.forEach(k => { if (f[k]) parts.push(`${L[k]}: ${f[k]}`); });
  parts.push(`— ${f.name || f.by}`);
  if (f.reply) parts.push("", `${t("fbReplyL")}: ${f.reply}`);
  parts.push("", teacherLink());
  return parts.join("\n");
}
function fbHtml(f){
  const L = t("fbL");
  return FB_KEYS.filter(k => f[k]).map(k => `<div class="fbline"><b>${L[k]}</b> ${esc(f[k]).replace(/\n/g,"<br>")}</div>`).join("")
    + `<div class="hint">${esc(f.name || f.by)} · ${esc(f.at)}</div>`;
}
// 선생님: 지난 수업 → 피드백 작성 창
function openFb(id){
  fbSid = id; reqSid = null;
  const f = id && feedback[id] || {};
  FB_KEYS.forEach(k => $("fb_" + k).value = f[k] || "");
  $("fbMsg").textContent = ""; $("fbShareRow").style.display = "none";
  render();
}
function renderFb(sel){
  const f = feedback[sel.id];
  $("fbTitle").innerHTML = `<b>${t("fbTitle")(kdate(sel.d) + " " + sel.time, labelOf(sel))}</b>`;
  $("fbReplyView").innerHTML = f && f.reply ? `<div class="fbreply"><b>${t("fbReplyL")}</b> ${esc(f.reply).replace(/\n/g,"<br>")}<div class="hint">${esc(f.replyAt)}</div></div>` : "";
  $("fbSave").textContent = f ? t("fbUpdate") : t("fbSave");
  $("fbDel").textContent = t("fbDelB"); $("fbDel").style.display = f ? "" : "none";
}
$("fbSave").onclick = async () => {
  if (!isTeacher() || !fbSid) return;
  const C = cfg(), s = buildSessions(sundays(C.start, C.months, C.count), C).find(x => x.id === fbSid); if (!s) return;
  const v = {}; FB_KEYS.forEach(k => v[k] = $("fb_" + k).value.trim());
  if (!v.topics && !v.expr && !v.good && !v.hw){ $("fbMsg").className = "hint bad"; $("fbMsg").textContent = t("fbEmpty"); return; }
  $("fbSave").disabled = true; $("fbMsg").className = "hint"; $("fbMsg").textContent = t("rqdSaving");
  try {
    await mutateFeedback(items => { const old = items[fbSid] || {}; items[fbSid] = Object.assign({}, old, v, {by: auth.login, name: auth.name, at: nowStamp()}); }, `Feedback ${fmt(s.d)} ${labelOf(s)} by ${auth.login}`); logActivity("feedback", `${fmt(s.d)} ${labelOf(s)}`);
    announceB("info", () => t("nfFb")(`${kdate(s.d)} ${labelOf(s)}`, auth.name || auth.login));
    $("fbText").value = fbText(s, feedback[fbSid]); $("fbShareRow").style.display = "";
    $("fbShare").style.display = navigator.share ? "" : "none";
    $("fbMsg").textContent = t("fbSaved"); render();
  } catch(e){ $("fbMsg").className = "hint bad"; $("fbMsg").textContent = t("rqSaveFail")(e.message); }
  $("fbSave").disabled = false;
};
$("fbDel").onclick = async () => {
  if (!isTeacher() || !fbSid || !feedback[fbSid] || !confirm(t("fbDelAsk"))) return;
  try { await mutateFeedback(items => { delete items[fbSid]; }, `Delete feedback ${fbSid} by ${auth.login}`);
    FB_KEYS.forEach(k => $("fb_" + k).value = ""); $("fbShareRow").style.display = "none"; $("fbMsg").className = "hint"; $("fbMsg").textContent = t("fbDeleted"); render(); }
  catch(e){ $("fbMsg").className = "hint bad"; $("fbMsg").textContent = t("rqSaveFail")(e.message); }
};
$("fbShare").onclick = async () => { try { await navigator.share({text: $("fbText").value}); } catch(e) {} };
$("fbCopy").onclick = () => copy($("fbText").value, t("copied"));
$("xFb").onclick = $("fbClose").onclick = () => { fbSid = null; render(); };
// 마스터: 수업 패널 안에 피드백 보기 + 답장
function renderFbBox(sel){
  const box = $("fbBox"); if (!box) return;
  if (!isMaster() || sel.act !== "done"){ box.innerHTML = ""; box.style.display = "none"; return; }
  box.style.display = ""; const f = feedback[sel.id];
  box.innerHTML = `<h4>📝 ${t("fbHead")}</h4>` + (f ? fbHtml(f) + `
    <label>${t("fbReplyL")}</label><textarea id="fbReplyIn" rows="2" placeholder="${t("fbReplyPh")}">${esc(f.reply || "")}</textarea>
    <div class="btns"><button class="sm" id="fbReplySave">${t("fbReplySave")}</button><button class="ghost sm" id="fbMCopy">${t("fbCopyMsg")}</button></div>
    <div class="btns"><button class="ghost sm" id="fbMEdit">${t("fbEditB")}</button><button class="ghost sm danger" id="fbMDel">${t("fbDelB")}</button></div>
    <div id="fbMEditBox" style="display:none">${FB_KEYS.map(k => `<label>${t("fbL")[k]}</label><textarea id="fbm_${k}" rows="2">${esc(f[k] || "")}</textarea>`).join("")}
      <div class="btns"><button class="sm" id="fbMEditSave">${t("fbEditSave")}</button></div></div>
    <div class="hint" id="fbReplyMsg"></div>`
    : `<div class="hint">${t("fbNone")}</div>`);
  if (!f) return;
  $("fbReplySave").onclick = async () => {
    const txt = $("fbReplyIn").value.trim(), out = $("fbReplyMsg"); out.className = "hint"; out.textContent = t("rqdSaving");
    try { await mutateFeedback(items => { if (items[sel.id]){ items[sel.id].reply = txt; items[sel.id].replyAt = nowStamp(); } }, `Reply to feedback ${fmt(sel.d)}`);
      out.textContent = t("fbReplied"); copy(fbText(sel, feedback[sel.id]), t("fbReplyCopied")); }
    catch(e){ out.className = "hint bad"; out.textContent = t("rqSaveFail")(e.message); }
  };
  $("fbMCopy").onclick = () => copy(fbText(sel, f), t("copied"));
  const out = $("fbReplyMsg");
  $("fbMEdit").onclick = () => { const b = $("fbMEditBox"); b.style.display = b.style.display === "none" ? "" : "none"; };
  $("fbMEditSave").onclick = async () => {
    const v = {}; FB_KEYS.forEach(k => v[k] = $("fbm_" + k).value.trim().slice(0, 2000));
    if (!(await confirmMaster())) return;
    out.className = "hint"; out.textContent = t("rqdSaving");
    try { await mutateFeedback(items => { if (items[sel.id]) Object.assign(items[sel.id], v, {editedBy: auth.login, editedAt: nowStamp()}); }, `Edit feedback ${fmt(sel.d)} (master)`);
      out.textContent = t("fbEdited"); render(); }
    catch(e){ out.className = "hint bad"; out.textContent = t("rqSaveFail")(e.message); }
  };
  $("fbMDel").onclick = async () => {
    if (!confirm(t("fbDelAsk"))) return;
    if (!(await confirmMaster())) return;
    try { await mutateFeedback(items => { delete items[sel.id]; }, `Delete feedback ${fmt(sel.d)} (master)`); render(); }
    catch(e){ out.className = "hint bad"; out.textContent = t("rqSaveFail")(e.message); }
  };
}
// 피드백 카드 (선생님: 작성 대기 + 최근 / 마스터: 최근 피드백)
function renderFbCard(S){
  const card = $("fbCard"); if (!card) return;
  if (!isEditor()){ card.style.display = "none"; return; }
  card.style.display = "";
  const done = S.filter(s => s.act === "done").sort(byTime).reverse();
  const due = isTeacher() ? done.filter(s => !feedback[s.id]) : [];
  const have = done.filter(s => feedback[s.id]).slice(0, 6);
  const newCnt = isMaster() ? have.filter(s => feedback[s.id].at > (localStorage.getItem("eng-class-fb-seen") || "")).length : 0;
  $("fbCount").textContent = isTeacher() ? (due.length ? t("fbDueCnt")(due.length) : "") : (newCnt ? t("fbNewCnt")(newCnt) : "");
  const row = (s, f) => `<div class="pendrow fbrow" data-fbs="${esc(s.id)}"><div><b>${kdate(s.d)} ${labelOf(s)}</b>${f ? ` · ${esc(f.topics || f.expr || "").slice(0, 60)}` : ""}</div>
    ${f ? `<div class="hint">${f.hw ? `${t("fbL").hw}: ${esc(f.hw).slice(0,60)} · ` : ""}${esc(f.name || f.by)} · ${esc(f.at)}${f.reply ? " · 💬 " + t("fbReplied2") : ""}</div>`
        : `<div class="hint"><b class="st-pending">✍ ${t("fbDue")}</b></div>`}</div>`;
  $("fbList").innerHTML = (due.slice(0, 4).map(s => row(s, null)).join("") + have.map(s => row(s, feedback[s.id])).join("")) || `<div class="empty">${t("fbEmptyList")}</div>`;
  $("fbList").querySelectorAll("[data-fbs]").forEach(r => r.onclick = () => {
    const id = r.dataset.fbs;
    if (isTeacher()) openFb(id); else { try { localStorage.setItem("eng-class-fb-seen", nowStamp()); } catch(e) {} selectSession(id); }
    const it = [...document.querySelectorAll("#calcard .it.sel")][0]; if (it) it.scrollIntoView({behavior:"smooth", block:"center"});
  });
}

/* ---------- 수업 추가 ---------- */
function openAdd(k){
  selected = null; addDate = k; addPaid = "paid";
  $("addTime").value = $("time").value || "17:00"; $("addMemo").value = "";
  render();
}
function renderAdd(C){
  $("addTitle").innerHTML = `<b>${t("addTitle")(kdate(parse(addDate)))}</b>`;
  setSeg("segPaid", addPaid);
  $("addPreview").textContent = t("addPv")(addPaid === "paid", usd(C.price));
}
$("segPaid").querySelectorAll("button").forEach(b => b.onclick = () => { addPaid = b.dataset.v; render(); });
$("xAdd").onclick = $("addClose").onclick = () => { addDate = null; render(); };
$("addBtn").onclick = () => {
  const C = cfg(), S = buildSessions(sundays(C.start, C.months, C.count), C);
  const last = S.filter(occupies).reduce((m,x) => x.d > m ? x.d : m, C.start);
  openAdd(fmt(nextSundayAfter(last)));
};
$("expandBtn").onclick = () => { calExpanded = !calExpanded; try { localStorage.setItem("eng-class-cal6", calExpanded ? "1" : "0"); } catch(e) {} render(); };
$("addApply").onclick = () => {
  if (!addDate) return;
  const x = {id:"X"+Date.now().toString(36), date:addDate, time:$("addTime").value || $("time").value || "17:00", paid: addPaid === "paid", memo: $("addMemo").value.trim() || undefined};
  extras.push(x);
  const C = cfg(), sx = buildSessions(sundays(C.start, C.months, C.count), C).find(s => s.id === x.id);
  const entry = bothLangs(() => t("logAdd")(kdate(sx.d), sx.time, labelOf(sx), x.paid) + (x.memo ? " · " + t("nReason")(x.memo) : ""));
  addLog(entry, x.id);
  addDate = null; save(); render();
};
function renderPanel(sel, C){
  const origin = sel.kind === "bonus" ? t("origBonus")(kdate(sel.from.d), labelOf(sel.from))
    : sel.kind === "moved" ? t("origMakeup")(kdate(sel.from.d), labelOf(sel.from)) : "";
  $("actTitle").innerHTML = `<b>${kdate(sel.d)} ${sel.time}</b> · ${labelOf(sel)}${origin}<br><span class="hint">${t("nowIs")(statusText(sel))}</span>`;
  const a = pick.act;
  $("segAct").querySelector("[data-v=plan]").textContent = sel.kind === "reg" ? t("aPlan") : sel.kind === "extra" ? t("aDelX") : t("aUndo");
  setSeg("segAct", a); setSeg("quickAct", a); setSeg("segCause", pick.cause); setSeg("segHow", pick.how);
  const needCause = ["move","hold","cancel","noshow"].includes(a);
  $("fldCause").classList.toggle("on", needCause || a === "edit");
  $("fldMoveHow").classList.toggle("on", a === "move" && !!pick.cause);
  const showDates = a === "edit" || (needCause && (a === "hold" || a === "move"));
  $("fldDates").classList.toggle("on", showDates);
  $("wrapAgreed").style.display = "";
  const dateNeeded = a === "edit" || (a === "move" && pick.how === "date");
  $("wrapTo").style.display = dateNeeded ? "" : "none";
  $("wrapToTime").style.display = dateNeeded ? "" : "none";
  $("datesTitle").textContent = a === "edit" ? t("datesEdit") : t("datesMove");
  if (a === "edit" && !$("toDate").value) $("toDate").value = fmt(sel.d);
  updatePreview(sel, C);
  renderFbBox(sel);
}
function outcomeHtml(act, cause, how, sameDay){
  const pv = t("pv");
  if (act === "edit") return cause === "teacher" ? (sameDay ? pv.editBonus : pv.editNoBonus) : pv.edit;
  if (cause === "teacher"){
    if (act === "cancel" || act === "noshow") return pv.teacher;
    if (act === "hold") return sameDay ? pv.holdPenalty : pv.hold + "<br>" + pv.noPenalty;
    return sameDay ? (how === "date" ? pv.teacherDate : pv.teacher) : (how === "date" ? pv.toDate : pv.toEnd) + "<br>" + pv.noPenalty;
  }
  if (act === "hold") return pv.hold;
  return how === "date" ? pv.toDate : pv.toEnd;
}
function noticeDays(sel){ const ag = $("agreed").value; return ag ? Math.round((sel.d - parse(ag)) / 86400000) : 0; }
function updatePreview(sel, C){
  const p = $("preview"), a = pick.act, c = pick.cause, pv = t("pv"), act = t("act");
  p.className = "preview";
  let x = "";
  if (!a) x = pv.pick;
  else if (a === "done") x = pv.done;
  else if (a === "plan" && sel.kind === "extra") x = pv.delX;
  else if (a === "plan" && sel.kind !== "reg") x = pv.undo(kdate(sel.from.origD || sel.from.d), labelOf(sel.from));
  else if (a === "plan" && sel.act === "plan" && !state[sel.id]) x = pv.already;
  else if (a === "plan") x = pv.plan;
  else if (a === "edit"){ const sd = noticeDays(sel) <= 0; x = outcomeHtml("edit", c, null, sd); if (c === "teacher" && sd) p.className = "preview teacher"; }
  else if (!c) x = pv.cause;
  else if (c === "teacher"){
    const sd = noticeDays(sel) <= 0;
    x = outcomeHtml(a, c, pick.how, sd);
    if (sd || a === "cancel" || a === "noshow") p.className = "preview teacher";
    if (a === "move" || a === "hold") x += "<br>" + pv.notice(noticeDays(sel), C.minNotice, noticeDays(sel) < C.minNotice);
  }
  else if (c === "me" && (a === "cancel" || a === "noshow")) x = pv.consumed(act[a]);
  else {
    const n = noticeDays(sel), late = n < C.minNotice;
    const where = a === "hold" ? pv.hold : a === "move" && pick.how === "date" ? pv.toDate : pv.toEnd;
    x = pv.head(act[a], t("cause")[c], where) + "<br>" + pv.notice(n, C.minNotice, late);
    if (late) p.className = "preview bad";
  }
  p.innerHTML = x;
}
["segAct","quickAct"].forEach(id => $(id).querySelectorAll("button").forEach(b => b.onclick = () => { pick.act = b.dataset.v; render(); }));
$("xAct").onclick = () => selectSession(null);
$("segCause").querySelectorAll("button").forEach(b => b.onclick = () => { pick.cause = b.dataset.v; render(); });
$("segHow").querySelectorAll("button").forEach(b => b.onclick = () => { pick.how = b.dataset.v; render(); });
["agreed","toDate","toTime"].forEach(id => $(id).addEventListener("input", () => {
  const C = cfg(); const s = buildSessions(sundays(C.start, C.months, C.count), C).find(x => x.id === selected); if (s) updatePreview(s, C);
}));
$("closeAct").onclick = () => selectSession(null);

// 기록 문장을 두 언어로 만들어 저장
function bothLangs(fn){ const keep = lang; const out = {}; for (const l of ["ko","en"]){ lang = l; out[l] = fn(); } lang = keep; return out; }

$("applyBtn").onclick = () => {
  const a = pick.act; if (!a || !selected) return;
  const C = cfg(), P = sundays(C.start, C.months, C.count);
  if (a === "plan"){
    const cur = buildSessions(P, C).find(x => x.id === selected);
    if (cur && cur.kind === "extra"){                                // 추가 수업 삭제
      const entry = bothLangs(() => t("logDel")(kdate(cur.d), labelOf(cur)));
      extras = extras.filter(x => x.id !== cur.id);
      ["", "M:", "B:", "BE:"].forEach(p => delete state[p + cur.id]);
      addLog(entry, cur.id); selected = null; save(); render(); return;
    }
    if (cur && cur.kind !== "reg") selected = cur.from.id;          // 보강·보너스 → 원래 수업을 되돌림
  }
  const before = buildSessions(P, C).find(x => x.id === selected);
  if (a === "plan" && before.act === "plan" && !(state[selected] && state[selected].memo)){
    if (!before.edited){ $("preview").className = "preview"; $("preview").textContent = t("pv").already; return; }
  }
  const needCause = ["move","hold","cancel","noshow"].includes(a);
  if (needCause && !pick.cause){ updatePreview(before, C); return; }
  if ((a === "edit" || (a === "move" && pick.how === "date")) && !$("toDate").value){
    $("preview").className = "preview bad"; $("preview").textContent = t("pv").needDate; return;
  }
  const memo = $("memo").value.trim();
  const prev = state[selected] || {};
  let meta;
  if (a === "plan") meta = prev.ed ? {ed: prev.ed} : null;
  else if (a === "done") meta = {...(prev.ed?{ed:prev.ed}:{}), act:"done", memo: memo || undefined};
  else if (a === "edit"){
    const n = noticeDays(before);
    meta = {...prev, ed:{date:$("toDate").value, time:$("toTime").value || C.time}, memo: memo || prev.memo,
      edCause: pick.cause || undefined, edSameDay: pick.cause === "teacher" && n <= 0, agreed: $("agreed").value || todayStr(), notice: n};
  }
  else {
    meta = {act:a, cause:pick.cause, memo: memo || undefined, ...(prev.ed?{ed:prev.ed}:{})};
    if (a === "move" || a === "hold"){
      const n = noticeDays(before);
      meta.agreed = $("agreed").value || todayStr(); meta.notice = n; meta.late = n < C.minNotice;
    }
    if (a === "move"){
      meta.how = pick.how;
      if (pick.how === "date"){ meta.to = $("toDate").value; meta.toTime = $("toTime").value || C.time; }
    }
  }
  if (meta) state[selected] = meta; else delete state[selected];
  if (a === "plan"){ delete state["M:"+selected]; delete state["B:"+selected]; delete state["BE:"+selected]; }   // 지워진 보강·보너스의 남은 상태 정리

  const entry = bothLangs(() => {
    const b4 = buildSessions(P, C);  // after-state (state already updated)
    const after = b4.find(x => x.id === selected);
    const kids = x => (x.children||[]).map(c => `${labelOf(c)} ${kdate(c.d)}`).join(", ");
    // 'before' 표시는 저장 전 상태값으로 다시 계산
    const saved = state[selected]; if (prev && Object.keys(prev).length) state[selected] = prev; else delete state[selected];
    const bef = buildSessions(P, C).find(x => x.id === selected);
    if (saved) state[selected] = saved; else delete state[selected];
    let x = `${kdate(bef.origD)} ${labelOf(bef)}: ${statusText(bef)} → ${a === "edit" ? t("logEdit")(kdate(after.d), after.time) : statusText(after)}`;
    if (bef.children && kids(bef) !== kids(after)) x += t("logFreed")(kids(bef));
    if (after.children && kids(bef) !== kids(after)) x += t("logMade")(kids(after));
    if (meta && meta.agreed) x += " · " + t("nContact")(meta.agreed, meta.notice, meta.late);
    if (memo) x += " · " + t("nReason")(memo);
    return x;
  });
  addLog(entry, selected);
  save();
  selected = null; render();
};

/* ---------- 변경 기록: 삭제 · 보관 로그 · 1년 정리 ---------- */
let archive = null, archSha = null, archTimer = null, clearArm = false;
function hashStr(str){ let x = 0; for (const c of str) x = (x*31 + c.codePointAt(0)) | 0; return (x >>> 0).toString(36); }
function logId(l){ if (!l.id) l.id = "L" + hashStr(l.at + (l.ko || l.text || "")); return l.id; }
function addLog(entry, sid){ if (isMaster() && !String(sid || "").startsWith("pay:")) notifyAdd(entry); log.push({id: "L" + Date.now().toString(36) + Math.random().toString(36).slice(2,5), at: nowStamp(), sid, ...(isSub() ? {by: auth.login} : {}), ...entry}); queueArchive(); }
function logKey(l){                       // 같은 수업의 기록끼리 묶는 키
  if (l.sid) return l.sid;
  const m = (l.ko || l.text || "").match(/^(\d{4}\.\d{2}\.\d{2}\([^)]*\)\s+[^:\s]+)/);
  return m ? m[1] : "misc";
}
const atTime = l => new Date(String(l.at).replace(" ", "T")).getTime();
function compactYear(list){              // 1년 지난 기록은 수업(키)별 마지막 변경만 남김
  const cutoff = Date.now() - 365*864e5, latest = {};
  list.forEach(l => { if (atTime(l) < cutoff){ const k = logKey(l); if (!latest[k] || atTime(latest[k]) <= atTime(l)) latest[k] = l; } });
  return list.filter(l => atTime(l) >= cutoff || latest[logKey(l)] === l);
}
function mergeArchive(){
  const byId = new Map(archive.map(a => [a.id, a]));
  log.forEach(l => { logId(l); if (!byId.has(l.id)){ const c = {...l}; archive.push(c); byId.set(l.id, c); } });
  archive.sort((a,b) => String(a.at).localeCompare(String(b.at)));
  archive = compactYear(archive);
}
async function loadArchive(){
  if (!isMaster()) return;
  try {
    const r = await fetch(privUrl("log-archive.json") + `?t=${Date.now()}`, {headers: apiHeaders(), cache:"no-store"});
    if (r.status === 404){ archive = []; archSha = null; }
    else if (!r.ok) throw new Error(r.status);
    else { const j = await r.json(); archSha = j.sha; archive = JSON.parse(b64dec(j.content)); }
  } catch(e){ archive = null; render(); return; }
  log.forEach(logId);
  const before = log.length; log = compactYear(log);
  if (log.length !== before) save();
  saveArchive(); render();
}
function queueArchive(){ if (!isMaster() || archive === null) return; clearTimeout(archTimer); archTimer = setTimeout(saveArchive, 1500); }
async function saveArchive(retry){
  if (archive === null) return;
  mergeArchive();
  try { archSha = await privPut("log-archive.json", b64enc(JSON.stringify(archive, null, 1)), `Update log archive (${nowStamp()})`, archSha); }
  catch(e){
    if (retry) return;
    const g = await fetch(privUrl("log-archive.json") + `?t=${Date.now()}`, {headers: apiHeaders(), cache:"no-store"});
    if (g.ok){ const j = await g.json(); archSha = j.sha; const remote = JSON.parse(b64dec(j.content)); const ids = new Set(archive.map(a => a.id)); remote.forEach(a => { if (!ids.has(a.id)) archive.push(a); }); }
    saveArchive(true);
  }
}
async function removeLogs(ids){
  if (!(await confirmMaster())) return;
  if (archive !== null) mergeArchive();          // 지우기 전에 보관 로그에 먼저 담기
  const stamp = nowStamp();
  (archive || []).forEach(a => { if (ids.includes(a.id) && !a.deletedAt) a.deletedAt = stamp; });
  log = log.filter(l => !ids.includes(logId(l)));
  save(); queueArchive(); render();
}

/* ---------- 수업료 납부 기록 (비공개 저장소) ---------- */
const PRIV_DEFAULT = "english-class-private";
let payments = [], paySha = null, payLoaded = false, payErr = null, lastCalc = null, payFiles = [], delArm = null;
const thumbCache = {};
const privRepo = () => (auth && auth.privRepo) || PRIV_DEFAULT;
const privUrl = path => `https://api.github.com/repos/${auth.owner}/${privRepo()}/contents/${path}`;
async function privPut(path, b64, message, sha){
  const body = {message, content: b64}; if (sha) body.sha = sha;
  const r = await fetch(privUrl(path), {method:"PUT", headers:{...apiHeaders(), "Content-Type":"application/json"}, body: JSON.stringify(body)});
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()).content.sha;
}
async function loadPayments(){
  if (!isMaster()) return;
  payLoaded = false; payErr = null; renderPayments();
  try {
    const r = await fetch(privUrl("payments.json") + `?t=${Date.now()}`, {headers: apiHeaders(), cache:"no-store"});
    if (r.status === 404){
      const rr = await fetch(`https://api.github.com/repos/${auth.owner}/${privRepo()}`, {headers: apiHeaders()});
      if (!rr.ok) throw new Error("norepo");
      payments = []; paySha = null;
    } else if (!r.ok) throw new Error("norepo");
    else { const j = await r.json(); paySha = j.sha; payments = JSON.parse(b64dec(j.content)); }
  } catch(e) { payErr = e.message; }
  payLoaded = true; renderPayments(); render(); reconcilePayments();
}
// 정정이 있으면 그 기간의 납부 기록도 새 횟수·가격·종료일로 맞춤 (원래 값은 orig에 보관)
async function reconcilePayments(){
  if (!isMaster() || !payLoaded || payErr || !fixes.length || !lastCalc) return;
  const f = fixes[fixes.length-1], start = fmt(lastCalc.P.start); let changed = false;
  payments.forEach(p => { if (p.periodStart === start && !p.orig && (+p.classes !== f.c2 || +p.priceUsd !== f.p2)){
    p.orig = {classes: p.classes, priceUsd: p.priceUsd, periodEnd: p.periodEnd, fixedAt: f.at};
    p.classes = f.c2; p.priceUsd = f.p2; p.periodEnd = f.e2; changed = true; } });
  if (changed){ try { await savePayments("Align payment record with class-terms correction"); } catch(e) {} renderPayments(); }
}
async function savePayments(msg){ paySha = await privPut("payments.json", b64enc(JSON.stringify(payments, null, 1)), msg, paySha); }
async function receiptUrl(path){
  if (thumbCache[path]) return thumbCache[path];
  const r = await fetch(privUrl(path), {headers:{...apiHeaders(), Accept:"application/vnd.github.raw"}});
  if (!r.ok) throw new Error(r.status);
  return thumbCache[path] = URL.createObjectURL(await r.blob());
}
function renderPayments(){
  const box = $("payBox"); if (!box) return;
  $("payAddBtn").disabled = !!payErr || !payLoaded;
  if (!isMaster()){ box.innerHTML = ""; return; }
  if (!payLoaded){ box.innerHTML = `<div class="empty">${t("payLoading")}</div>`; return; }
  if (payErr){ box.innerHTML = `<div class="hint bad">${t("payNoRepo")(privRepo())}</div>`; return; }
  if (!payments.length){ box.innerHTML = `<div class="empty">${t("payNone")}</div>`; return; }
  const list = payments.slice().sort((a,b) => b.paidOn.localeCompare(a.paidOn));
  const sumU = list.reduce((a,p) => a + (+p.totalUsd||0), 0), sumZ = list.reduce((a,p) => a + (+p.paidUzs||0), 0);
  box.innerHTML = `<table class="paytable"><thead><tr><th>${t("pthDate")}</th><th>${t("pthPeriod")}</th><th class="r">${t("pthCls")}</th><th class="r">USD</th><th class="r">UZS</th><th>${t("pthRcpt")}</th><th></th></tr></thead><tbody>` +
    list.map(p => `<tr><td>${p.paidOn}</td><td>${kdate(parse(p.periodStart))}<br><span class="hint">~ ${kdate(parse(p.periodEnd))}</span></td>
      <td class="r">${p.classes}${p.orig ? `<br><span class="hint">(${t("payWas")(p.orig.classes, kdate(parse(p.orig.periodEnd)))})</span>` : ""}</td><td class="r mono">${usd(+p.totalUsd)}</td>
      <td class="r mono">${Math.round(+p.paidUzs).toLocaleString("en-US")}<br><span class="hint">@ ${uzs2(+p.rate)}</span></td>
      <td><div class="thumbs">${(p.receipts||[]).map(r => `<img data-path="${r}" alt="">`).join("")}</div>${p.memo?`<div class="hint">${p.memo.replace(/</g,"&lt;")}</div>`:""}</td>
      <td><button class="ghost sm paydel" data-id="${p.id}">${delArm === p.id ? t("payDelQ") : "🗑"}</button></td></tr>`).join("") +
    `</tbody></table><div class="hint paysum">${t("payTotal")(list.length, usd(sumU), uzs(sumZ))}</div>`;
  box.querySelectorAll("img[data-path]").forEach(img => receiptUrl(img.dataset.path).then(u => { img.src = u; img.onclick = () => { $("lightImg").src = u; openModal("lightModal"); }; }).catch(() => img.classList.add("broken")));
  box.querySelectorAll(".paydel").forEach(btn => btn.onclick = () => deletePayment(btn.dataset.id));
}
async function deletePayment(id){
  if (delArm !== id){ delArm = id; renderPayments(); return; }
  delArm = null;
  const p = payments.find(x => x.id === id); if (!p) return;
  payments = payments.filter(x => x.id !== id);
  try {
    await savePayments(`Delete payment ${p.paidOn}`);
    for (const path of (p.receipts||[])){
      const g = await fetch(privUrl(path), {headers: apiHeaders()}); if (!g.ok) continue;
      await fetch(privUrl(path), {method:"DELETE", headers:{...apiHeaders(), "Content-Type":"application/json"}, body: JSON.stringify({message:`Delete receipt ${path}`, sha:(await g.json()).sha})});
    }
    addLog(bothLangs(() => t("logPayDel")(kdate(parse(p.periodStart)), kdate(parse(p.periodEnd)))), "pay:"+p.id); save();
  } catch(e) { payments.push(p); alertPay(t("pfFail")(e.message)); }
  renderPayments(); render();
}
function alertPay(msg){ const el = $("payMsg"); if (el){ el.textContent = msg; el.className = "hint bad"; } }

// 납부 입력 창
function openPayForm(){
  if (!lastCalc || payErr) return;
  const {C, P, NP} = lastCalc;
  const curPaid = payments.some(p => p.periodStart === fmt(P.start));
  $("pfPeriodSel").value = curPaid ? "next" : "cur";
  $("pfDate").value = todayStr(); $("pfPrice").value = C.price; $("pfRate").value = C.rate; $("pfRateDate").value = C.rateDate;
  $("pfMemo").value = ""; $("pfFiles").value = ""; payFiles = []; $("pfPreview").innerHTML = ""; $("payMsg").textContent = "";
  fillPeriod(); openModal("payModal");
}
function fillPeriod(){
  const {P, Pend, NP, prepaid, nCount} = lastCalc, next = $("pfPeriodSel").value === "next";
  const a = next ? NP.start : P.start, b = next ? NP.end : Pend;
  $("pfPeriodTxt").textContent = `${kdate(a)} ~ ${kdate(b)}`;
  $("pfCls").value = next ? nCount : prepaid;
  calcPay(true);
}
function calcPay(resetUzs){
  const n = +$("pfCls").value || 0, p = +$("pfPrice").value || 0, r = +$("pfRate").value || 0;
  if (resetUzs) $("pfUzs").value = Math.round(n*p*r);
  $("pfCalc").textContent = t("pfCalc")(n, usd(p), usd(n*p), uzs2(r), uzs(n*p*r));
}
function compressImage(file){
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width*k); c.height = Math.round(img.height*k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src); res(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => rej(new Error("image"));
    img.src = URL.createObjectURL(file);
  });
}
async function submitPay(){
  if (!(await confirmMaster())) return;
  const {P, NP} = lastCalc, next = $("pfPeriodSel").value === "next";
  const n = +$("pfCls").value, price = +$("pfPrice").value, rate = +$("pfRate").value;
  if (!$("pfDate").value || !n){ alertPay(t("pfNeed")); return; }
  const id = "P" + Date.now().toString(36);
  const rec = {id, paidOn: $("pfDate").value, periodStart: fmt(next ? NP.start : P.start), periodEnd: fmt(next ? NP.end : lastCalc.Pend),
    classes: n, priceUsd: price, totalUsd: +(n*price).toFixed(2), rate, rateDate: $("pfRateDate").value, paidUzs: +$("pfUzs").value || Math.round(n*price*rate),
    memo: $("pfMemo").value.trim() || undefined, receipts: [], createdAt: new Date().toISOString()};
  $("pfSave").disabled = true;
  try {
    for (let i = 0; i < payFiles.length; i++){
      $("payMsg").className = "hint"; $("payMsg").textContent = t("pfSaving")(i+1, payFiles.length);
      const path = `receipts/${rec.paidOn}_${id}_${i+1}.jpg`;
      await privPut(path, payFiles[i].split(",")[1], `Receipt ${rec.paidOn} (${i+1})`);
      thumbCache[path] = payFiles[i]; rec.receipts.push(path);
    }
    payments.push(rec);
    await savePayments(`Payment ${rec.paidOn} (${rec.periodStart} ~ ${rec.periodEnd})`);
    addLog(bothLangs(() => t("logPay")(kdate(parse(rec.periodStart)), kdate(parse(rec.periodEnd)))), "pay:"+rec.id); save();
    $("payModal").classList.remove("on"); renderPayments(); render();
  } catch(e) { payments = payments.filter(x => x.id !== id); alertPay(t("pfFail")(e.message)); }
  $("pfSave").disabled = false;
}
$("pfPeriodSel").onchange = fillPeriod;
["pfCls","pfPrice","pfRate"].forEach(id => $(id).addEventListener("input", () => calcPay(true)));
$("pfFiles").onchange = async e => {
  const files = [...e.target.files];
  payFiles = []; $("pfPreview").innerHTML = "";
  for (const f of files){ try { const d = await compressImage(f); payFiles.push(d); $("pfPreview").insertAdjacentHTML("beforeend", `<img src="${d}" alt="">`); } catch(err) {} }
};
$("pfSave").onclick = submitPay;
$("payAddBtn").onclick = openPayForm;

/* ---------- 모달 ---------- */
function openModal(id){ document.querySelectorAll(".modal.on").forEach(m => m.classList.remove("on")); $(id).classList.add("on"); }
document.querySelectorAll(".modal").forEach(m => {
  m.addEventListener("click", e => { if (e.target === m || e.target.hasAttribute("data-close")){ if (m.id === "pwcModal") $("pwcCancel").click(); else m.classList.remove("on"); } });
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if ($("pwcModal").classList.contains("on")){ $("pwcCancel").click(); return; }
  const open = document.querySelectorAll(".modal.on");
  if (open.length) open.forEach(m => m.classList.remove("on")); else if (selected) selectSession(null);
});
$("openSettings").onclick = () => { openModal("settingsModal"); renderUsers(); renderRepoStatus(); renderMasterId(); };
$("midSave").onclick = saveMasterId; $("midDel").onclick = deleteMasterId;

/* ---------- 환율 추세 차트 ---------- */
let fxCur = "KRW";
function openFx(c){ fxCur = c; drawFx(); openModal("fxModal"); }
function seriesOf(c){
  const now = c === "UZS" ? cfg().rate : NOW[c];
  return [...YEARS.map((y,i) => ({x:String(y), v:FX[c].v[i]})), {x:"2026.11", v:now}];
}
function drawFx(){
  const tabs = $("fxTabs"), tab = t("fxTab");
  tabs.innerHTML = ["KRW","JPY","CNY","UZS","IDX"].map(c => `<button data-c="${c}" class="${c===fxCur?"on":""}">${tab[c]}</button>`).join("");
  tabs.querySelectorAll("button").forEach(b => b.onclick = () => { fxCur = b.dataset.c; drawFx(); });

  const W=680,H=300,Lm=62,R=16,T=18,B=34;
  const svg = $("fxChart");
  let lines, fmtY, title;
  if (fxCur === "IDX"){
    lines = ["KRW","JPY","CNY","UZS"].map(c => { const s = seriesOf(c); const base = s[0].v; return {c, color:FX[c].color, pts:s.map(p => ({x:p.x, v:p.v/base*100, raw:p.v}))}; });
    fmtY = v => v.toFixed(0); title = t("fxIdxTitle");
  } else {
    lines = [{c:fxCur, color:FX[fxCur].color, pts:seriesOf(fxCur).map(p => ({x:p.x, v:p.v, raw:p.v}))}];
    fmtY = v => fxFmt(fxCur, v); title = t("fxUnitTitle")(fxCur, tab[fxCur]);
  }
  $("fxTitle").textContent = t("fxTitle")(fxCur==="IDX" ? t("fxCompare") : tab[fxCur]);
  const all = lines.flatMap(l => l.pts.map(p => p.v));
  let lo = Math.min(...all), hi = Math.max(...all); const pad = (hi-lo)*0.08 || 1; lo -= pad; hi += pad;
  if (fxCur === "IDX" || fxCur === "UZS") lo = Math.max(0, lo);
  const n = lines[0].pts.length;
  const X = i => Lm + (W-Lm-R) * i/(n-1), Y = v => T + (H-T-B) * (1 - (v-lo)/(hi-lo));
  let g = `<text x="${Lm}" y="12" font-size="11" fill="#6b7177">${title}</text>`;
  for (let k=0;k<=4;k++){ const v = lo + (hi-lo)*k/4, y = Y(v);
    g += `<line x1="${Lm}" x2="${W-R}" y1="${y}" y2="${y}" stroke="#ece9e1"/><text x="${Lm-8}" y="${y+4}" font-size="11" fill="#6b7177" text-anchor="end">${fmtY(v)}</text>`; }
  lines[0].pts.forEach((p,i) => { if (i%2===0 || i===n-1) g += `<text x="${X(i)}" y="${H-12}" font-size="10.5" fill="#6b7177" text-anchor="middle">${p.x==="2026.11"?"26.11":"'"+p.x.slice(2)}</text>`; });
  lines.forEach(l => {
    g += `<polyline fill="none" stroke="${l.color}" stroke-width="2.2" stroke-linejoin="round" points="${l.pts.map((p,i)=>`${X(i)},${Y(p.v)}`).join(" ")}"/>`;
    l.pts.forEach((p,i) => { g += `<circle cx="${X(i)}" cy="${Y(p.v)}" r="${i===n-1?4.5:3}" fill="${i===n-1?"#fff":l.color}" stroke="${l.color}" stroke-width="2"/>`; });
    if (fxCur === "IDX"){ const last = l.pts[n-1]; g += `<text x="${X(n-1)-6}" y="${Y(last.v)-8}" font-size="11" fill="${l.color}" text-anchor="end">${l.c}</text>`; }
  });
  g += `<rect id="hit" x="${Lm}" y="${T}" width="${W-Lm-R}" height="${H-T-B}" fill="transparent"/>`;
  svg.innerHTML = g;
  const tip = $("fxTip");
  svg.querySelector("#hit").onmousemove = e => {
    const r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) * W / r.width;
    const i = Math.max(0, Math.min(n-1, Math.round((sx-Lm)/(W-Lm-R)*(n-1))));
    tip.innerHTML = `<b>${lines[0].pts[i].x}</b><br>` + lines.map(l => `${l.c}: ${fxFmt(l.c, l.pts[i].raw)}${fxCur==="IDX"?` (${l.pts[i].v.toFixed(0)})`:""}`).join("<br>");
    tip.style.display = "block";
    tip.style.left = Math.min(r.width-150, X(i)*r.width/W + 10) + "px";
    tip.style.top = (Y(lines[0].pts[i].v)*r.height/H - 10) + "px";
  };
  svg.querySelector("#hit").onmouseleave = () => tip.style.display = "none";

  const cs = fxCur === "IDX" ? ["KRW","JPY","CNY","UZS"] : [fxCur];
  const rows = seriesOf("KRW").map((p,i) => `<tr><td>${p.x}</td>${cs.map(c => `<td class="r mono">${fxFmt(c, seriesOf(c)[i].v)}</td>`).join("")}</tr>`).reverse().join("");
  $("fxTable").innerHTML = `<table><thead><tr><th>${t("fxYear")}</th>${cs.map(c => `<th class="r">${c}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
  const first = seriesOf(cs[0])[0].v, last = seriesOf(cs[0])[n-1].v;
  const pct = ((last/first-1)*100).toFixed(1);
  $("fxNote").innerHTML = (fxCur==="IDX" ? "" : t("fxChange")(pct, last>first)) + t("fxBasis")(CBU.date) + "<br>" +
    cs.map(c => `${c}: ${t("fxSrc")[c]}`).join("<br>") + "<br>" + t("fxCross");
}

/* ---------- 이벤트 ---------- */
let zoomAnnounced = null;
$("zoom").addEventListener("change", () => { const u = zoomUrl(); if (!isMaster() || !u) return; if (zoomAnnounced === null) zoomAnnounced = ""; if (u !== zoomAnnounced){ zoomAnnounced = u; announceB("info", () => t("nfZoom")); } });
["start","months","count","time","dur","price","alertN","minNotice","autoMin","rate","rateDate","zoom","asof"].forEach(id => $(id).addEventListener("input", () => { if (id === "zoom"){ const v = $("zoom").value.trim(); $("zoom").setCustomValidity(v && !zoomUrl() ? t("zBadUrl") : ""); $("zoom").title = v && !zoomUrl() ? t("zBadUrl") : ""; } render(); if (id !== "asof") queueRemoteSave(); }));
$("loginBtn").onclick = () => { const tokMode = /^#master$/.test(location.hash);
  $("loginTabs").style.display = tokMode ? "" : "none";
  document.querySelector(`#loginTabs [data-v="${tokMode ? "master" : "sub"}"]`).click(); const c = repoCoords(); $("ghOwner").value = c.owner; $("ghRepo").value = c.repo; $("ghPriv").value = PRIV_DEFAULT; $("loginMsg").textContent = ""; openModal("loginModal"); };
$("doLogin").onclick = doLogin;
$("logoutBtn").onclick = () => { state = {}; log = []; extras = []; requests = []; feedback = {}; fbSid = null; try { ["eng-class-state-v4","eng-class-log-v4","eng-class-extras-v1"].forEach(k => localStorage.removeItem(k)); } catch(e) {} archive = null; auth = null; payments = []; payLoaded = false; renderPayments(); try { localStorage.removeItem(AUTHKEY); } catch(e) {} selectSession(null); renderAcct(); loadRemote(); };
$("linkBtn").onclick = () => copy(teacherLink(), t("linkCopied")(teacherLink()));
async function copy(text, ok){
  try { await navigator.clipboard.writeText(text); $("toast").textContent = ok; }
  catch(e){ $("toast").textContent = t("copyFail"); }
}
$("copyMsg").addEventListener("click", () => copy($("msg").value, t("copied")));
// 변경 기록 내려받기
function logRows(){ return log.slice().reverse().map(l => [l.at, (l.by ? `[${l.by}] ` : "") + (l[lang] || l.ko || l.text || "")]); }
function download(name, text, type){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const fileStamp = () => todayStr().replace(/-/g,"");
$("dlCsv").onclick = () => {
  const esc = v => `"${String(v).replace(/"/g,'""')}"`;
  const csv = [t("csvHead"), ...logRows()].map(r => r.map(esc).join(",")).join("\r\n");
  download(`english-class-log-${fileStamp()}.csv`, "\ufeff" + csv, "text/csv;charset=utf-8");   // BOM: 엑셀 한글 깨짐 방지
};
$("dlTxt").onclick = () => {
  const txt = `${t("logFileTitle")} (${nowStamp()})\n${"=".repeat(40)}\n` + logRows().map(([a,b]) => `${a}\n  ${b}`).join("\n\n");
  download(`english-class-log-${fileStamp()}.txt`, txt, "text/plain;charset=utf-8");
};
$("logClear").onclick = () => {
  if (!clearArm){ clearArm = true; render(); setTimeout(() => { clearArm = false; render(); }, 4000); return; }
  clearArm = false; removeLogs(log.map(logId));
};
$("dlArch").onclick = () => {
  if (archive === null) return;
  mergeArchive();
  const esc = v => `"${String(v ?? "").replace(/"/g,'""')}"`;
  const rows = archive.slice().reverse().map(a => [a.at, a[lang] || a.ko || a.text || "", a.deletedAt ? t("archDeleted")(a.deletedAt) : t("archKept")]);
  download(`english-class-log-archive-${fileStamp()}.csv`, "\ufeff" + [t("archHead"), ...rows].map(r => r.map(esc).join(",")).join("\r\n"), "text/csv;charset=utf-8");
};
// 휴대폰에서는 처음에 접힌 상태
if (window.innerWidth <= 860) $("logDetails").open = false;
$("copyLog").addEventListener("click", () => copy(log.map(l => `${l.at}  ${l[lang] || l.ko || l.text || ""}`).join("\n") || t("noLogTxt"), t("logCopied")));
applyStatic();
renderAcct();
render();
if (/^#master$/.test(location.hash) && !isEditor()) setTimeout(() => $("loginBtn").click(), 300);
loadRemote().then(() => { if (isEditor() && zoomUrl() && zCurrent()){ zWasOpen = true; zFetch().then(renderZoom); } if (isSub()) logActivity("visit"); if (isMaster()) drainActivity(); loadFeedback(); loadPayments(); loadArchive(); checkReq(); checkInvite(); checkRegReq(); checkPendingReg(); loadRequests(); });
