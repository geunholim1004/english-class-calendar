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
  if (!["pending","approved","rejected", undefined].includes(o.status)) o.status = "pending";
  return o;
}
// 사용자가 입력한 글자는 화면에 그릴 때 반드시 이스케이프 (악성 코드 실행 방지)
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const KEY = "eng-class-state-v4", LOGKEY = "eng-class-log-v4", LANGKEY = "eng-class-lang";
let state = {}, log = [], extras = [], selected = null, lang = "ko", addDate = null, addPaid = "paid", calExpanded = false;
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
let remoteSha = null, lastUpdated = null, syncStatus = "", saveTimer = null, loadingRemote = false;
const SETTING_IDS = ["start","months","time","dur","price","alertN","minNotice","rate","rateDate"];
function snapshot(){ const settings = {}; SETTING_IDS.forEach(id => settings[id] = $(id).value);
  return {version:1, updatedAt:new Date().toISOString(), settings, state, log, extras}; }
function applySnapshot(d){
  if (!d) return;
  if (d.settings) SETTING_IDS.forEach(id => { if (d.settings[id] !== undefined) $(id).value = d.settings[id]; });
  state = d.state || {}; log = d.log || []; extras = d.extras || []; lastUpdated = d.updatedAt || null;
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
function shareView(snap){ const settings = {...snap.settings}; MONEY_KEYS.forEach(k => delete settings[k]); return {...snap, settings}; }
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
  await saveRemote();
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
function renderAcct(){
  const m = isMaster();
  document.querySelector(".sub").textContent = m ? t("sub") : t("subV");
  const sb = isSub();
  document.querySelector(".calHintEl").textContent = m ? t("calHint") : sb ? t("calHintS") : t("calHintV");
  document.body.classList.toggle("viewer", !m);
  document.body.classList.toggle("subm", sb);
  if (typeof renderPending === "function") renderPending();
  $("roleBadge").textContent = m ? t("roleMaster")(auth.login || auth.owner) : sb ? t("roleUser")(auth.name || auth.login) : t("roleViewer");
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
    renderAcct(); await loadRemote(); loadPayments(); loadArchive(); loadRequests(); if (incoming) showReq();
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
  nfTitle:"카톡 알림 메시지", nfCopy:"복사", nfShare:"공유", nfHint:"복사해서 선생님과의 단톡방에 붙여넣으세요. 계속 바꾸면 이 메시지에 이어서 모입니다.",
  hPend:"승인 대기 요청", pendBy:(n,id,at) => `${n} (${id}) · ${at}`, pendApprove:"✓ 승인", pendReject:"✕ 거절",
  hMyReq:"내 변경 요청", myNone:"보낸 요청이 없어요.", st_pending:"⏳ 승인 대기", st_approved:"✓ 승인됨", st_rejected:"✕ 거절됨", myCancel:"요청 취소",
  rqSaveFail:e => `요청 저장 실패 (${e})`, rqAlready:"이 수업에는 이미 승인 대기 중인 요청이 있어요.",
  rqMsg2:o => `[영어 수업 변경 요청]\n${o.target}\n요청: ${o.what}\n사유: ${o.why}\n요청자: ${o.who}\n\n웹에서 확인·승인해 주세요 👇\n${o.url}`,

  rrLink:"아이디가 없나요? 등록 요청", hRR:"사용 등록 요청", rrId:"희망 아이디 (영문 소문자·숫자)", rrName:"이름", rrSend:"📨 등록 요청 보내기", rrNeedName:"이름을 입력하세요.",
  rrText:o => `[영어 수업 앱 등록 요청]\n이름: ${o.name}\n희망 아이디: ${o.id}\n\n승인 링크 👇\n${o.url}`,
  rrHint:"이 내용을 카카오톡으로 Edward에게 보내세요. 승인되면 이 기기에서 사이트를 다시 열어 비밀번호만 정하면 됩니다.",
  rrWaiting:id => `'${id}' 등록 승인 대기 중`, rrApproved:"승인됐어요! 사용할 비밀번호를 정하면 등록이 끝납니다.",
  hRA:"사용 등록 요청", raApprove:"✓ 승인", raReject:"✕ 거절", raNeedTok:"설정 → 사용자 관리에서 선생님용 토큰을 먼저 저장하세요.",
  raExists:"이미 사용 중인 아이디예요. 승인하면 기존 등록을 덮어씁니다.", raDone:n => `승인했어요. ${n}님이 같은 기기에서 사이트를 다시 열면 비밀번호를 정해 등록이 끝납니다.`,

  roleUser:n => `사용자 · ${n}`, loginTabSub:"아이디 로그인", uIdL:"아이디", subPwL:"비밀번호", subLoginBtn:"로그인",
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
  rqGone:"요청한 수업을 찾을 수 없어요 (이미 삭제·변경됨).", rqTag:"선생님 요청", rqRejected:(x) => `선생님 변경 요청 거절: ${x}`,

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

  roleMaster:u => `마스터 · ${u}`, roleViewer:"로그인 전", login:"로그인", logout:"로그아웃", teacherLinkBtn:"선생님 링크 복사",
  linkCopied:u => `선생님 링크를 복사했어요: ${u}`,
  syncLoading:"불러오는 중…", syncLoaded:d => `마지막 업데이트 ${d}`, syncPending:"변경 사항 저장 대기…", syncSaving:"GitHub에 저장 중…",
  syncSaved:d => `저장됨 · ${d}`, syncFail:e => `저장 실패 (${e}) — 토큰 권한을 확인하세요`, syncOffline:"GitHub에서 불러오지 못해 이 브라우저 데이터로 표시 중",
  hLogin:"마스터 로그인", ghOwner:"GitHub 계정", ghRepo:"저장소 이름", ghToken:"GitHub 토큰 (Fine-grained)",
  tokenHelp:'<a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">토큰 만들기</a> → Repository access: <b>Only select repositories</b>에서 이 저장소만 선택 → Permissions: <b>Contents = Read and write</b> → 생성 후 붙여넣기. 토큰은 이 브라우저에만 저장됩니다.',
  doLogin:"로그인", loginChecking:"확인 중…", loginNoRepo:s => `저장소에 접근할 수 없어요 (HTTP ${s}). 계정·저장소 이름·토큰을 확인하세요.`, loginNoPush:"이 토큰에는 쓰기 권한이 없어요. Contents = Read and write로 만들어 주세요.",
  docTitle:"영어 수업 달력 & 수업료 계산기 (USD→UZS)",
  title:"영어 수업 달력 & 수업료 계산기",
  sub:"선불제 · 매주 일요일 17:00 · 25분 = 1 Class · $6 · CBU 공식 환율로 UZS 환산 · 취소·이동·보류·No-show를 사유와 함께 기록",
  subV:"매주 일요일 17:00 · 25분 = 1 Class · 취소·이동·보류·No-show를 사유와 함께 기록",
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
  hSettings:"나의 수업 설정", sStart:"시작일", sMonths:"선불 기간(개월)", sTime:"수업 시각", sDur:"수업 길이(분)", sPrice:"1 Class 가격 (USD)",
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
    `① 선불 기간: ${o.ps} ~ ${o.pe}${o.ext ? "" : ` (시작일 + ${o.months}개월 − 1일)`}`,
    `② 선불 수업 <b>${o.prepaid}회</b> — 매주 일요일 ${o.slot} (${o.dur}분 = 1 Class)`,
    `③ 선불액: ${o.prepaid}회 × ${o.price} = <b>${o.usd}</b> × ${o.rate} UZS (CBU ${o.rateDate}) = <b>${o.uzs} UZS</b>`,
    `④ 내 사유 취소·No-show ${o.consumed}회 → 선불 차감, 보강 없음`,
    `⑤ 선생님 사유 ${o.teacher}회 · 한국 시간 기준 수업 당일 변경, 또는 취소·No-show → 패널티 보너스 수업 총 ${o.bonus}회 ($0). 미리 연락한 변경은 패널티 없음`,
    `⑥ 사전 합의·내 사유 이동 ${o.relocated}회 · Hold ${o.holds}회 → 선불분 유지, 차감 없음`,
    `⑦ 실제 마지막 수업: ${o.last} · 정산 알림: 남은 수업 ${o.N}회가 되는 ${o.alert}`],
  next:(o) => [
    `기간: ${o.a} ~ ${o.b} (마지막 수업 다음 날부터 ${o.months}개월)`,
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
  nfTitle:"KakaoTalk message", nfCopy:"Copy", nfShare:"Share", nfHint:"Copy it into the group chat with the teacher. Further changes keep adding to this message.",
  hPend:"Pending requests", pendBy:(n,id,at) => `${n} (${id}) · ${at}`, pendApprove:"✓ Approve", pendReject:"✕ Decline",
  hMyReq:"My change requests", myNone:"No requests yet.", st_pending:"⏳ Pending", st_approved:"✓ Approved", st_rejected:"✕ Declined", myCancel:"Cancel request",
  rqSaveFail:e => `Couldn’t save the request (${e})`, rqAlready:"There’s already a pending request for this class.",
  rqMsg2:o => `[English class – change request]\n${o.target}\nRequest: ${o.what}\nReason: ${o.why}\nFrom: ${o.who}\n\nPlease review and approve on the web 👇\n${o.url}`,

  rrLink:"No ID yet? Request access", hRR:"Request access", rrId:"Preferred ID (lowercase letters / digits)", rrName:"Name", rrSend:"📨 Send request", rrNeedName:"Enter your name.",
  rrText:o => `[English class app – access request]\nName: ${o.name}\nPreferred ID: ${o.id}\n\nApprove here 👇\n${o.url}`,
  rrHint:"Send this to Edward on KakaoTalk. Once approved, reopen the site on this device and just choose a password.",
  rrWaiting:id => `'${id}' waiting for approval`, rrApproved:"Approved! Choose a password to finish registering.",
  hRA:"Access request", raApprove:"✓ Approve", raReject:"✕ Decline", raNeedTok:"Save the teacher token first under Settings → Users.",
  raExists:"This ID is already in use. Approving will replace the existing registration.", raDone:n => `Approved. When ${n} reopens the site on the same device, they set a password and they’re done.`,

  roleUser:n => `User · ${n}`, loginTabSub:"ID login", uIdL:"ID", subPwL:"Password", subLoginBtn:"Log in",
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
  rqGone:"The requested class can’t be found (already deleted or changed).", rqTag:"Teacher request", rqRejected:(x) => `Teacher’s change request declined: ${x}`,

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

  roleMaster:u => `Master · ${u}`, roleViewer:"Not logged in", login:"Log in", logout:"Log out", teacherLinkBtn:"Copy teacher link",
  linkCopied:u => `Teacher link copied: ${u}`,
  syncLoading:"Loading…", syncLoaded:d => `Last updated ${d}`, syncPending:"Waiting to save…", syncSaving:"Saving to GitHub…",
  syncSaved:d => `Saved · ${d}`, syncFail:e => `Save failed (${e}) — check the token’s permissions`, syncOffline:"Couldn’t load from GitHub; showing this browser’s data",
  hLogin:"Master login", ghOwner:"GitHub account", ghRepo:"Repository", ghToken:"GitHub token (fine-grained)",
  tokenHelp:'<a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Create a token</a> → Repository access: <b>Only select repositories</b>, pick this repo → Permissions: <b>Contents = Read and write</b> → paste it here. The token is stored only in this browser.',
  doLogin:"Log in", loginChecking:"Checking…", loginNoRepo:s => `Can’t access the repository (HTTP ${s}). Check the account, repo name and token.`, loginNoPush:"This token can’t write. Create it with Contents = Read and write.",
  docTitle:"English Class Calendar & Fee Calculator (USD→UZS)",
  title:"English Class Calendar & Fee Calculator",
  subV:"Every Sunday 17:00 · 25 min = 1 class · Cancellations, moves, holds and no-shows logged with reasons",
  sub:"Prepaid · Every Sunday 17:00 · 25 min = 1 class · $6 · Converted to UZS at the official CBU rate · Cancellations, moves, holds and no-shows logged with reasons",
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
  hSettings:"My class settings", sStart:"Start date", sMonths:"Prepaid period (months)", sTime:"Class time", sDur:"Length (min)", sPrice:"Price per class (USD)",
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
    `① Prepaid period: ${o.ps} – ${o.pe}${o.ext ? "" : ` (start date + ${o.months} months − 1 day)`}`,
    `② <b>${o.prepaid} prepaid classes</b> — every Sunday ${o.slot} (${o.dur} min = 1 class)`,
    `③ Prepaid: ${o.prepaid} × ${o.price} = <b>${o.usd}</b> × ${o.rate} UZS (CBU ${o.rateDate}) = <b>${o.uzs} UZS</b>`,
    `④ My cancellations / no-shows: ${o.consumed} → used from prepaid, no makeup`,
    `⑤ Teacher’s reason: ${o.teacher} · same-day changes (Korea time) or cancel / no-show → ${o.bonus} penalty bonus class(es) in total ($0). Changes with advance notice: no penalty`,
    `⑥ Moves by me or by agreement: ${o.relocated} · On hold: ${o.holds} → stays prepaid, nothing used`,
    `⑦ Actual last class: ${o.last} · Payment alert on ${o.alert}, when ${o.N} classes are left`],
  next:(o) => [
    `Period: ${o.a} – ${o.b} (${o.months} months from the day after the last class)`,
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
    price: +$("price").value || 0,
    rate: +$("rate").value || 0,
    rateDate: $("rateDate").value,
    N: Math.max(1, +$("alertN").value || 2),
    time: $("time").value || "17:00",
    dur: +$("dur").value || 25,
    minNotice: Math.max(0, +$("minNotice").value || 0),
    asof: parse($("asof").value || todayStr()),
  };
}
function sundays(start, months){
  const end = addDays(addMonths(start, months), -1);
  let d = new Date(start);
  while (d.getUTCDay() !== 0) d = addDays(d,1);
  const list = [];
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
  if (s.act === "plan" || s.act === "done") return t("act")[s.act] + (s.edited ? t("edited") : "");
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
  return S;
}
const byTime = (a,b) => a.d - b.d || (a.time||"").localeCompare(b.time||"");

/* ---------- 정적 문구 적용 ---------- */
function applyStatic(){
  document.documentElement.lang = lang;
  document.title = t("docTitle");
  document.querySelectorAll("[data-i18n]").forEach(el => el.textContent = t(el.dataset.i18n));
  document.querySelectorAll("[data-i18n-html]").forEach(el => el.innerHTML = t(el.dataset.i18nHtml));
  document.querySelectorAll("[data-i18n-ph]").forEach(el => el.placeholder = t(el.dataset.i18nPh));
  document.querySelectorAll("[data-i18n-title]").forEach(el => el.title = t(el.dataset.i18nTitle));
  document.querySelectorAll("[data-lang]").forEach(b => b.classList.toggle("on", b.dataset.lang === lang));
}
function setLang(l){
  lang = l; try { localStorage.setItem(LANGKEY, l); } catch(e) {}
  applyStatic(); renderAcct(); render(); renderPayments(); renderPending();
  if ($("fxModal").classList.contains("on")) drawFx();
}
document.querySelectorAll("[data-lang]").forEach(b => b.onclick = () => setLang(b.dataset.lang));

/* ---------- 렌더링 ---------- */
function render(){
  const C = cfg();
  const P = sundays(C.start, C.months);
  const S = buildSessions(P, C);
  const paidX = extras.filter(x => x.paid).length, freeX = extras.length - paidX;
  const prepaid = P.list.length + paidX;
  const paidDates = extras.filter(x => x.paid && DATE_RE.test(x.date || "")).map(x => parse(x.date));
  const Pend = paidDates.length ? new Date(Math.max(P.list.length ? +P.list[P.list.length-1] : 0, ...paidDates.map(Number))) : P.end;
  const prepaidUsd = prepaid*C.price, prepaidUzs = prepaidUsd*C.rate;

  const timeline = S.filter(occupies).sort(byTime);
  const holds = S.filter(s => s.act === "hold");
  const bonusCount = S.filter(s => s.kind === "bonus").length;
  const movedCount = S.filter(s => s.kind === "moved").length;
  const lastSession = timeline.length ? timeline[timeline.length-1].d : P.end;
  const left = timeline.filter(s => s.act === "plan" && s.d >= C.asof).length;
  const alertItem = timeline.length > C.N ? timeline[timeline.length-C.N-1] : timeline[0];

  const NP = sundays(addDays(lastSession,1), C.months);
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
          if (isMaster()) it.onclick = () => selectSession(selected === s.id ? null : s.id);
          else if (isSub() && s.act === "plan" && s.d >= C.asof && !pendingFor(s.id)) it.onclick = () => openReq(reqSid === s.id ? null : s.id);
          else it.style.cursor = "default";
          if (pendingFor(s.id)){ it.classList.add("pending"); it.textContent += " ⏳"; it.title += " · " + t("st_pending"); }
          if (reqSid === s.id) it.classList.add("sel");
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
    ps:kdate(P.start), pe:kdate(Pend), ext: paidDates.length > 0, months:C.months, prepaid, slot:tEnd(C.time), dur:C.dur,
    price:usd(C.price), usd:usd(prepaidUsd), rate:uzs2(C.rate), rateDate:C.rateDate, uzs:uzs2(prepaidUzs),
    consumed:cnt(s => klass(s)==="consumed"), teacher:cnt(s => klass(s)==="teacher"), bonus:bonusCount,
    relocated:cnt(s => klass(s)==="relocated"), holds:holds.length, last:kdate(lastSession), N:C.N, alert:alertItem?kdate(alertItem.d):"–"
  }).map((x,i) => `<div${i===2?' class="money"':""}>${isMaster() ? x : x.replace(/ \(\$0\)/, "")}</div>`)
    .map((x,i,arr) => (i === 1 && freeX) ? x + `<div>${t("basisExtra")(freeX)}</div>` : x).join("");
  $("nextBasis").innerHTML = t("next")({a:kdate(NP.start), b:kdate(NP.end), months:C.months, n:nCount, list:NP.list.map(sdate).join(", "),
    price:usd(C.price), usd:usd(nUsd), rate:uzs2(C.rate), uzs:uzs2(nUzs)}).map((x,i) => `<div${i===2?' class="money"':""}>${x}</div>`).join("")
    + `<div class="hint">${t("nextHint")(holds.length)}</div>`;

  // 기록
  $("logCount").textContent = log.length ? "(" + t("logCountTxt")(log.length) + ")" : "";
  $("log").innerHTML = log.length ? log.slice().reverse().map(l => `<div class="logrow"><div><time>${esc(l.at)}${l.by ? ` · <span class="bytag">${esc(l.by)}</span>` : ""}</time>${esc(l[lang] || l.ko || l.text || "")}</div>${isMaster() ? `<button class="logdel" data-id="${esc(logId(l))}" title="${t("logDel")}">×</button>` : ""}</div>`).join("")
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
  if (!selected && !addDate && !reqSid) return;
  if (reqSid && !e.target.closest(".actions") && !e.target.closest(".it") && !e.target.closest(".lang")){ reqSid = null; render(); return; }
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
  auth = {token, owner: c.owner, repo: c.repo, role: "sub", login: u.id, name: u.name};
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
  renderAcct(); await loadRemote(); loadPayments(); loadArchive(); loadRequests(); if (incoming) showReq();
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
    if (!u) throw new Error(t("uNoId"));
    if (u.status !== "active") throw new Error(t("uNotRegistered"));
    let token; try { token = await unlockToken(u.box, pw); } catch(e) { throw new Error(t("subBadPw")); }
    becomeUser(u, token);
    $("loginModal").classList.remove("on"); $("subPw").value = "";
    renderAcct(); await loadRemote(); loadRequests();
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
    renderAcct(); await loadRemote(); loadRequests();
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
  $("uList").innerHTML = users.length ? users.map(u => `<div class="urow"><span><b>${esc(u.id)}</b> · ${esc(u.name)}<br>
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
  const id = normId(idArg || $("uNewId").value), name = idArg ? null : $("uNewName").value.trim();
  if (!teacherToken){ out.className = "hint bad"; out.textContent = t("uNeedTok"); return; }
  if (!/^[a-z0-9._-]{2,20}$/.test(id)){ out.className = "hint bad"; out.textContent = t("uIdRule"); return; }
  try {
    const {users, sha} = await fetchUsers();
    let u = users.find(x => x.id === id);
    if (u && !idArg){ out.className = "hint bad"; out.textContent = t("uDup"); return; }
    const code = inviteCode();
    if (!u){ u = {id, name: name || id}; users.push(u); }
    u.box = await lockToken(teacherToken, code); u.status = "invited"; u.invitedAt = new Date().toISOString(); delete u.registeredAt;
    await saveUsers(users, sha, auth.token, `Invite user: ${id}`);
    $("uNewId").value = $("uNewName").value = "";
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
  const id = normId($("rrId").value), name = $("rrName").value.trim(), out = $("rrMsg");
  out.className = "hint";
  if (!/^[a-z0-9._-]{2,20}$/.test(id)){ out.className = "hint bad"; out.textContent = t("uIdRule"); return; }
  if (!name){ out.className = "hint bad"; out.textContent = t("rrNeedName"); return; }
  const s = inviteCode() + inviteCode();                     // 이 기기에만 남는 1회용 비밀값
  try { localStorage.setItem(PENDKEY, JSON.stringify({id, name, s})); } catch(e) {}
  const url = teacherLink() + "#regreq=" + b64url(JSON.stringify({id, name, s, at: nowStamp()}));
  const text = t("rrText")({id, name, url});
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
  $("raBody").innerHTML = `<div><b>${t("uIdL")}</b> · ${String(r.id).replace(/</g,"&lt;")}</div><div><b>${t("uNewName")}</b> · ${String(r.name).replace(/</g,"&lt;")}</div><div><b>${t("rqWhen")}</b> · ${esc(r.at)}</div>`;
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
    u.name = r.name; u.box = await lockToken(teacherToken, r.s); u.status = "invited"; u.invitedAt = new Date().toISOString(); delete u.registeredAt;
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
  const C = cfg(), sel = buildSessions(sundays(C.start, C.months), C).find(x => x.id === reqSid);
  if (!sel || !rq.act) return;
  if (rq.act === "move" && !rq.cause){ $("reqPreview").textContent = t("rqNeedCause"); return; }
  const needDate = rq.act === "edit" || (rq.act === "move" && rq.how === "date");
  if (needDate && !$("reqDate").value){ $("reqPreview").textContent = t("rqNeedDate"); return; }
  const reason = t("rqReasons")[+$("reqReason").value] + ($("reqNote").value.trim() ? " – " + $("reqNote").value.trim() : "");
  const r = {rid: "Q" + Date.now().toString(36), id: sel.id, d: fmt(sel.d), act: rq.act, cause: rq.cause || undefined,
    how: rq.act === "move" ? rq.how : undefined,
    to: needDate ? $("reqDate").value : undefined, toTime: needDate ? ($("reqTime").value || C.time) : undefined,
    reason, by: auth.login, name: auth.name, status: "pending"};
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
    await mutateRequests(list => { if (list.some(x => x.id === r.id && x.status === "pending")) throw new Error(t("rqAlready")); list.push(r); }, `Request from ${r.by}: ${r.d} ${r.act}`);
  } catch(e){ $("rqdSend").disabled = false; $("rqdMsg").className = "hint bad"; $("rqdMsg").textContent = t("rqSaveFail")(e.message); return; }
  rqDraft = null; reqSid = null; render(); renderPending();
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
  const C = cfg(), s = buildSessions(sundays(C.start, C.months), C).find(x => x.id === r.id);
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
async function loadRequests(){ if (!isEditor()) return; try { requests = (await fetchRequests()).list; } catch(e) {} render(); renderPending(); }
async function mutateRequests(fn, message, retry){
  const {list, sha} = await fetchRequests();
  fn(list);
  const body = {message, content: b64enc(JSON.stringify({requests: list}, null, 1)), branch: BRANCH}; if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${ownerOf()}/${SHARE_REPO}/contents/requests.json`, {method:"PUT", headers:{...apiHeaders(), "Content-Type":"application/json"}, body: JSON.stringify(body)});
  if ((r.status === 409 || r.status === 422) && !retry) return mutateRequests(fn, message, true);
  if (!r.ok) throw new Error("HTTP " + r.status);
  requests = list;
}
function reqLines(r, C){
  const s = buildSessions(sundays(C.start, C.months), C).find(x => x.id === r.id);
  return {s, html: `<div><b>${kdate(parse(r.d))} ${s ? labelOf(s) : ""}</b> · ${reqWhat(r, C)}</div>
    <div class="hint">${(r.cause ? t("cause")[r.cause] + " · " : "") + String(r.reason || "").replace(/</g,"&lt;")}</div>`};
}
// 마스터: 승인 대기 목록
function renderPending(){
  const box = $("pendList"); if (!box) return;
  const C = cfg(), list = requests.filter(r => r.status === "pending").sort((a,b) => String(a.at).localeCompare(String(b.at)));
  $("pendCard").style.display = isMaster() && list.length ? "" : "none";
  $("pendCount").textContent = list.length ? `(${list.length})` : "";
  box.innerHTML = list.map(r => {
    const {s, html} = reqLines(r, C);
    const stale = !s || fmt(s.d) !== r.d || s.act !== "plan";
    return `<div class="pendrow"><div class="hint">${esc(t("pendBy")(r.name || r.by, r.by, r.at))}</div>${html}
      ${stale ? `<div class="hint bad">${s ? t("rqStale") : t("rqGone")}</div>` : ""}
      <div class="btns">${s ? `<button class="sm" data-pa="${esc(r.rid)}">${t("pendApprove")}</button>` : ""}<button class="ghost sm danger" data-pr="${esc(r.rid)}">${t("pendReject")}</button></div></div>`;
  }).join("");
  box.querySelectorAll("[data-pa]").forEach(b => b.onclick = () => decide(b.dataset.pa, true));
  box.querySelectorAll("[data-pr]").forEach(b => b.onclick = () => decide(b.dataset.pr, false));
  renderMyRequests();
}
let notifyKind = "change", notifyItems = [], notifyLang = null;
function notifyAdd(entry){
  if (!$("notify").classList.contains("on")){ notifyItems = []; notifyLang = notifyLang || lang; }
  notifyItems.push({kind: notifyKind, ko: entry.ko, en: entry.en});
  renderNotify(); $("notify").classList.add("on");
}
function renderNotify(){
  const L2 = notifyLang || lang, url = teacherLink();
  const groups = {change: [], approved: [], declined: []};
  notifyItems.forEach(x => groups[x.kind].push("• " + (x[L2] || x.ko)));
  const head = L2 === "en"
    ? {change:"[English class – schedule change]", approved:"[English class – request approved]", declined:"[English class – request declined]"}
    : {change:"[영어 수업 변경 안내]", approved:"[영어 수업 변경 요청 승인]", declined:"[영어 수업 변경 요청 거절]"};
  const tail = L2 === "en"
    ? {change:"Please check and confirm 🙏", approved:"Updated on the calendar ✓", declined:"Not applied. Let’s talk if needed."}
    : {change:"확인 부탁드립니다 🙏", approved:"달력에 반영했습니다 ✓", declined:"반영하지 않았습니다. 필요하면 다시 이야기해요."};
  const parts = ["change","approved","declined"].filter(k => groups[k].length).map(k => `${head[k]}\n${groups[k].join("\n")}\n${tail[k]}`);
  $("nfText").value = parts.join("\n\n") + "\n\n" + url;
  document.querySelectorAll("#notify [data-nl]").forEach(b => b.classList.toggle("on", b.dataset.nl === L2));
}
document.querySelectorAll("#notify [data-nl]").forEach(b => b.onclick = () => { notifyLang = b.dataset.nl; renderNotify(); });
$("nfX").onclick = () => { $("notify").classList.remove("on"); notifyItems = []; };
$("nfCopy").onclick = () => copy($("nfText").value, t("copied"));
$("nfShare").onclick = async () => { try { await navigator.share({text: $("nfText").value}); } catch(e) {} };
if (!navigator.share) $("nfShare").style.display = "none";
function applyReq(r){
  selected = r.id; pick = {act: r.act, cause: r.cause || null, how: r.how || "end"};
  $("toDate").value = r.to || ""; $("toTime").value = r.toTime || $("time").value; $("agreed").value = String(r.at).slice(0,10);
  $("memo").value = `[${t("rqTag")}${r.by ? " · " + r.by : ""}] ${r.reason || ""}`;
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
    try { await mutateRequests(list => { const i = list.findIndex(y => y.rid === a.dataset.cancel && y.status === "pending"); if (i >= 0) list.splice(i, 1); }, "Cancel request"); }
    catch(err){ setSync(t("rqSaveFail")(err.message), true); }
    render(); renderPending();
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
  const C = cfg(), S = buildSessions(sundays(C.start, C.months), C);
  const last = S.filter(occupies).reduce((m,x) => x.d > m ? x.d : m, C.start);
  openAdd(fmt(nextSundayAfter(last)));
};
$("expandBtn").onclick = () => { calExpanded = !calExpanded; try { localStorage.setItem("eng-class-cal6", calExpanded ? "1" : "0"); } catch(e) {} render(); };
$("addApply").onclick = () => {
  if (!addDate) return;
  const x = {id:"X"+Date.now().toString(36), date:addDate, time:$("addTime").value || $("time").value || "17:00", paid: addPaid === "paid", memo: $("addMemo").value.trim() || undefined};
  extras.push(x);
  const C = cfg(), sx = buildSessions(sundays(C.start, C.months), C).find(s => s.id === x.id);
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
  const C = cfg(); const s = buildSessions(sundays(C.start,C.months), C).find(x => x.id === selected); if (s) updatePreview(s, C);
}));
$("closeAct").onclick = () => selectSession(null);

// 기록 문장을 두 언어로 만들어 저장
function bothLangs(fn){ const keep = lang; const out = {}; for (const l of ["ko","en"]){ lang = l; out[l] = fn(); } lang = keep; return out; }

$("applyBtn").onclick = () => {
  const a = pick.act; if (!a || !selected) return;
  const C = cfg(), P = sundays(C.start, C.months);
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
  payLoaded = true; renderPayments(); render();
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
      <td class="r">${p.classes}</td><td class="r mono">${usd(+p.totalUsd)}</td>
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
["start","months","time","dur","price","alertN","minNotice","rate","rateDate","asof"].forEach(id => $(id).addEventListener("input", () => { render(); if (id !== "asof") queueRemoteSave(); }));
$("loginBtn").onclick = () => { const tokMode = /^#master$/.test(location.hash);
  $("loginTabs").style.display = tokMode ? "" : "none";
  document.querySelector(`#loginTabs [data-v="${tokMode ? "master" : "sub"}"]`).click(); const c = repoCoords(); $("ghOwner").value = c.owner; $("ghRepo").value = c.repo; $("ghPriv").value = PRIV_DEFAULT; $("loginMsg").textContent = ""; openModal("loginModal"); };
$("doLogin").onclick = doLogin;
$("logoutBtn").onclick = () => { state = {}; log = []; extras = []; requests = []; try { ["eng-class-state-v4","eng-class-log-v4","eng-class-extras-v1"].forEach(k => localStorage.removeItem(k)); } catch(e) {} archive = null; auth = null; payments = []; payLoaded = false; renderPayments(); try { localStorage.removeItem(AUTHKEY); } catch(e) {} selectSession(null); renderAcct(); loadRemote(); };
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
loadRemote().then(() => { loadPayments(); loadArchive(); checkReq(); checkInvite(); checkRegReq(); checkPendingReg(); loadRequests(); });
