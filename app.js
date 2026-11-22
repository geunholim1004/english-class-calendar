const $ = id => document.getElementById(id);
const KEY = "eng-class-state-v4", LOGKEY = "eng-class-log-v4", LANGKEY = "eng-class-lang";
let state = {}, log = [], selected = null, lang = "ko";
try { state = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch(e) {}
try { log = JSON.parse(localStorage.getItem(LOGKEY) || "[]"); } catch(e) {}
try { lang = localStorage.getItem(LANGKEY) || "ko"; } catch(e) {}
function save(){ try { localStorage.setItem(KEY, JSON.stringify(state)); localStorage.setItem(LOGKEY, JSON.stringify(log)); } catch(e) {} queueRemoteSave(); }

/* ---------- 권한 & GitHub 동기화 (Roles & GitHub sync) ---------- */
// 저장소 위치: GitHub Pages 주소(owner.github.io/repo)에서 자동으로 읽고, 없으면 기본값
const DEFAULT_OWNER = "geunholim1004", DEFAULT_REPO = "english-class-calendar", DATA_PATH = "data/state.json", BRANCH = "main";
const AUTHKEY = "eng-class-gh-auth";
function repoCoords(){
  const h = location.hostname, seg = location.pathname.split("/").filter(Boolean);
  if (h.endsWith(".github.io")) return {owner: h.split(".")[0], repo: seg[0] || DEFAULT_REPO};
  return {owner: DEFAULT_OWNER, repo: DEFAULT_REPO};
}
let auth = null;   // {token, owner, repo, login}
try { auth = JSON.parse(localStorage.getItem(AUTHKEY) || "null"); } catch(e) {}
const isMaster = () => !!(auth && auth.token);
let remoteSha = null, lastUpdated = null, syncStatus = "", saveTimer = null, loadingRemote = false;
const SETTING_IDS = ["start","months","time","dur","price","alertN","minNotice","rate","rateDate"];
function snapshot(){ const settings = {}; SETTING_IDS.forEach(id => settings[id] = $(id).value);
  return {version:1, updatedAt:new Date().toISOString(), settings, state, log}; }
function applySnapshot(d){
  if (!d) return;
  if (d.settings) SETTING_IDS.forEach(id => { if (d.settings[id] !== undefined) $(id).value = d.settings[id]; });
  state = d.state || {}; log = d.log || []; lastUpdated = d.updatedAt || null;
  try { localStorage.setItem(KEY, JSON.stringify(state)); localStorage.setItem(LOGKEY, JSON.stringify(log)); } catch(e) {}
}
const b64enc = s => btoa(unescape(encodeURIComponent(s)));
const b64dec = s => decodeURIComponent(escape(atob(s.replace(/\n/g,""))));
function apiHeaders(){ const h = {"Accept":"application/vnd.github+json"}; if (isMaster()) h.Authorization = "Bearer " + auth.token; return h; }
async function loadRemote(){
  const {owner, repo} = isMaster() ? auth : repoCoords();
  loadingRemote = true; setSync(t("syncLoading"));
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${DATA_PATH}?ref=${BRANCH}&t=${Date.now()}`, {headers: apiHeaders(), cache:"no-store"});
    if (!r.ok) throw new Error("api " + r.status);
    const j = await r.json(); remoteSha = j.sha;
    applySnapshot(JSON.parse(b64dec(j.content)));
  } catch(e) {
    // API 한도 초과 등 → Pages에 올라간 정적 파일로 대체
    try { const r2 = await fetch(`${DATA_PATH}?t=${Date.now()}`, {cache:"no-store"}); if (!r2.ok) throw 0; applySnapshot(await r2.json()); }
    catch(e2) { setSync(t("syncOffline")); loadingRemote = false; render(); return; }
  }
  loadingRemote = false;
  setSync(lastUpdated ? t("syncLoaded")(fmtStamp(lastUpdated)) : "");
  render();
}
function fmtStamp(iso){ const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }
function queueRemoteSave(){ if (!isMaster() || loadingRemote) return; clearTimeout(saveTimer); setSync(t("syncPending")); saveTimer = setTimeout(saveRemote, 1200); }
async function saveRemote(retry){
  const {owner, repo, token} = auth;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${DATA_PATH}`;
  setSync(t("syncSaving"));
  try {
    if (!remoteSha || retry){ const g = await fetch(`${url}?ref=${BRANCH}&t=${Date.now()}`, {headers: apiHeaders(), cache:"no-store"}); if (g.ok) remoteSha = (await g.json()).sha; }
    const snap = snapshot();
    const body = {message:`Update class data (${fmtStamp(snap.updatedAt)})`, content: b64enc(JSON.stringify(snap, null, 1)), branch: BRANCH};
    if (remoteSha) body.sha = remoteSha;
    const r = await fetch(url, {method:"PUT", headers:{...apiHeaders(), "Content-Type":"application/json"}, body: JSON.stringify(body)});
    if ((r.status === 409 || r.status === 422) && !retry) return saveRemote(true);
    if (!r.ok) throw new Error(r.status);
    remoteSha = (await r.json()).content.sha; lastUpdated = snap.updatedAt;
    setSync(t("syncSaved")(fmtStamp(snap.updatedAt)));
  } catch(e) { setSync(t("syncFail")(e.message), true); }
}
function setSync(msg, bad){ const el = $("syncStatus"); if (!el) return; el.textContent = msg; el.classList.toggle("bad", !!bad); }
function teacherLink(){ const {owner, repo} = isMaster() ? auth : repoCoords(); return `https://${owner}.github.io/${repo}/`; }
function renderAcct(){
  const m = isMaster();
  document.body.classList.toggle("viewer", !m);
  $("roleBadge").textContent = m ? t("roleMaster")(auth.login || auth.owner) : t("roleViewer");
  $("roleBadge").className = "badge " + (m ? "master" : "viewer");
  $("loginBtn").style.display = m ? "none" : "";
  $("logoutBtn").style.display = m ? "" : "none";
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
    auth = {token, owner, repo, login: u.login || owner};
    try { localStorage.setItem(AUTHKEY, JSON.stringify(auth)); } catch(e) {}
    $("loginModal").classList.remove("on"); $("ghToken").value = "";
    renderAcct(); await loadRemote();
  } catch(e) { out.className = "hint bad"; out.textContent = e.message; }
}


/* ---------- 언어 사전 (Language dictionary) ---------- */
const L = {
ko: {
  roleMaster:u => `마스터 · ${u}`, roleViewer:"보기 전용 (선생님)", login:"마스터 로그인", logout:"로그아웃", teacherLinkBtn:"선생님 링크 복사",
  linkCopied:u => `선생님 링크를 복사했어요: ${u}`,
  syncLoading:"불러오는 중…", syncLoaded:d => `마지막 업데이트 ${d}`, syncPending:"변경 사항 저장 대기…", syncSaving:"GitHub에 저장 중…",
  syncSaved:d => `저장됨 · ${d}`, syncFail:e => `저장 실패 (${e}) — 토큰 권한을 확인하세요`, syncOffline:"GitHub에서 불러오지 못해 이 브라우저 데이터로 표시 중",
  hLogin:"마스터 로그인", ghOwner:"GitHub 계정", ghRepo:"저장소 이름", ghToken:"GitHub 토큰 (Fine-grained)",
  tokenHelp:'<a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">토큰 만들기</a> → Repository access: <b>Only select repositories</b>에서 이 저장소만 선택 → Permissions: <b>Contents = Read and write</b> → 생성 후 붙여넣기. 토큰은 이 브라우저에만 저장됩니다.',
  doLogin:"로그인", loginChecking:"확인 중…", loginNoRepo:s => `저장소에 접근할 수 없어요 (HTTP ${s}). 계정·저장소 이름·토큰을 확인하세요.`, loginNoPush:"이 토큰에는 쓰기 권한이 없어요. Contents = Read and write로 만들어 주세요.",
  docTitle:"영어 수업 달력 & 수업료 계산기 (USD→UZS)",
  title:"영어 수업 달력 & 수업료 계산기",
  sub:"선불제 · 매주 일요일 17:00 · 25분 = 1 Class · $6 · CBU 공식 환율로 UZS 환산 · 취소·이동·보류·No-show를 사유와 함께 기록",
  hHolds:"보류 중인 수업", hKakao:"카카오톡 알림 메시지", copyMsg:"메시지 복사",
  kakaoHint:"복사 후 카카오톡 ‘나와의 채팅’이나 선생님 채팅방에 붙여넣으세요.",
  hLog:"변경 기록", copyLog:"기록 복사",
  logHint:"마스터가 바꾼 내용은 GitHub(data/state.json)에 저장되고, 선생님 링크에도 그대로 보입니다.",
  openSettings:"수업 설정 열기",
  kPrepaid:"선불 수업", kUsdL:"선불액", kUzsL:"선불액 (UZS)", kMiscL:"보너스 / 이동 / 보류", kLeftL:"남은 수업",
  lg1:"정규 예정", lg2:"완료", lg3:"보너스", lg4:"이동된 수업", lg5:"보류", lg6:"선생님 사유", lg7:"내 사유 취소·No-show(차감)", lg8:"정산 알림일",
  aUndo:"↩ 이동 취소 (원래 날짜로)", close:"닫기", qDone:"✓ 완료", qEdit:"✎ 수정", qMove:"→ 이동", hOther:"다른 처리", aCancel:"취소", aPlan:"예정으로 되돌리기",
  hCause:"사유는 누구에게 있나요?", cMe:"나 (학생)", cTeacher:"선생님", cMutual:"사전 합의",
  hHow:"어디로 옮길까요?", howEnd:"마지막 수업 다음으로 자동", howDate:"날짜 지정",
  lAgreed:"합의(연락)한 날", lTo:"새 날짜", lToTime:"새 시각", lMemo:"사유 입력", memoPh:"예: 선생님 출장, 가족 행사, 인터넷 장애 …",
  apply:"적용", calHint:"달력의 수업을 클릭하면 완료·수정·이동·Hold·취소·No-show를 고를 수 있어요.",
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
  alertNext:(d,t) => `다음 정산 알림일: ${d} ${t}`,
  alertNextBody:(N,last) => `이날 수업 후 남은 수업이 ${N}회가 됩니다. 마지막 수업은 ${last}입니다.`,
  noHolds:"보류 중인 수업이 없어요.", pickDate:"날짜 정하기", noReason:"사유 없음",
  nEdited:d => `원래 ${d} → 수정`, nTBD:"날짜 미정", nConsumed:"선불 차감, 보강 없음",
  nBonus:d => `${d} 선생님 사유 보너스 (무료)`, nMakeup:(d,x) => `${d} ${x} 보강`,
  nReason:m => `사유: ${m}`, nContact:(d,n,late) => `연락 ${d} (${n}일 전${late?" ⚠기준 미달":""})`,
  inPrepaid:"선불 포함",
  listFoot:(p,b,m) => `선불 합계 (정규 ${p}회 · 보너스 ${b}회 무료 · 보강 ${m}회는 선불분)`,
  basis:(o) => [
    `① 선불 기간: ${o.ps} ~ ${o.pe} (시작일 + ${o.months}개월 − 1일)`,
    `② 기간 내 일요일 = 선불 수업 <b>${o.prepaid}회</b> (매회 ${o.slot}, ${o.dur}분 = 1 Class)`,
    `③ 선불액: ${o.prepaid}회 × ${o.price} = <b>${o.usd}</b> × ${o.rate} UZS (CBU ${o.rateDate}) = <b>${o.uzs} UZS</b>`,
    `④ 내 사유 취소·No-show ${o.consumed}회 → 선불 차감, 보강 없음`,
    `⑤ 선생님 사유 ${o.teacher}회 → 각 수업을 맨 뒤로 보강 이동 + 그다음 주 보너스 수업 ${o.bonus}회 ($0)`,
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
  pv:{ undo:(d,x) => `원래 수업 ${d} ${x}을(를) 되살리고, 거기서 생긴 보강·보너스를 모두 지웁니다.`, already:"이미 예정 상태예요. 바꿀 것이 없습니다.", pick:"위에서 할 일을 고르세요.", done:"이 수업을 완료로 표시합니다.", plan:"예정 상태로 되돌리고, 이 수업에서 생긴 보강·보너스를 해제합니다.",
    edit:"같은 수업의 날짜·시각만 바꿉니다. 선불 차감이나 보너스는 없습니다.", cause:"사유가 누구에게 있는지 고르세요.",
    teacher:`<b>선생님 사유 규칙:</b> 이 수업은 마지막 수업 다음 일요일로 자동 이동(보강)되고, 그다음 주에 <b>보너스 수업 1회($0)</b>가 새로 생깁니다. 사유가 기록에 남습니다.`,
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
  roleMaster:u => `Master · ${u}`, roleViewer:"View only (teacher)", login:"Master login", logout:"Log out", teacherLinkBtn:"Copy teacher link",
  linkCopied:u => `Teacher link copied: ${u}`,
  syncLoading:"Loading…", syncLoaded:d => `Last updated ${d}`, syncPending:"Waiting to save…", syncSaving:"Saving to GitHub…",
  syncSaved:d => `Saved · ${d}`, syncFail:e => `Save failed (${e}) — check the token’s permissions`, syncOffline:"Couldn’t load from GitHub; showing this browser’s data",
  hLogin:"Master login", ghOwner:"GitHub account", ghRepo:"Repository", ghToken:"GitHub token (fine-grained)",
  tokenHelp:'<a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Create a token</a> → Repository access: <b>Only select repositories</b>, pick this repo → Permissions: <b>Contents = Read and write</b> → paste it here. The token is stored only in this browser.',
  doLogin:"Log in", loginChecking:"Checking…", loginNoRepo:s => `Can’t access the repository (HTTP ${s}). Check the account, repo name and token.`, loginNoPush:"This token can’t write. Create it with Contents = Read and write.",
  docTitle:"English Class Calendar & Fee Calculator (USD→UZS)",
  title:"English Class Calendar & Fee Calculator",
  sub:"Prepaid · Every Sunday 17:00 · 25 min = 1 class · $6 · Converted to UZS at the official CBU rate · Cancellations, moves, holds and no-shows logged with reasons",
  hHolds:"Classes on hold", hKakao:"KakaoTalk message", copyMsg:"Copy message",
  kakaoHint:"Paste it into your KakaoTalk ‘Chat with myself’ or the teacher’s chat room.",
  hLog:"Change log", copyLog:"Copy log",
  logHint:"Changes made by the master are saved to GitHub (data/state.json) and appear on the teacher’s link too.",
  openSettings:"Open class settings",
  kPrepaid:"Prepaid classes", kUsdL:"Prepaid", kUzsL:"Prepaid (UZS)", kMiscL:"Bonus / Moved / Hold", kLeftL:"Remaining",
  lg1:"Scheduled", lg2:"Done", lg3:"Bonus", lg4:"Moved class", lg5:"On hold", lg6:"Teacher’s reason", lg7:"My cancel / no-show (used)", lg8:"Payment alert day",
  aUndo:"↩ Undo move (back to original)", close:"Close", qDone:"✓ Done", qEdit:"✎ Edit", qMove:"→ Move", hOther:"Other", aCancel:"Cancel", aPlan:"Reset to scheduled",
  hCause:"Whose reason is it?", cMe:"Me (student)", cTeacher:"Teacher", cMutual:"Agreed in advance",
  hHow:"Move it where?", howEnd:"Auto: after the last class", howDate:"Pick a date",
  lAgreed:"Date we agreed", lTo:"New date", lToTime:"New time", lMemo:"Reason", memoPh:"e.g. teacher travelling, family event, internet outage …",
  apply:"Apply", calHint:"Click a class on the calendar to mark it done, edit, move, hold, cancel or no-show.",
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
  alertNext:(d,t) => `Next payment alert: ${d} ${t}`,
  alertNextBody:(N,last) => `After this class, ${N} classes will be left. The last class is ${last}.`,
  noHolds:"No classes on hold.", pickDate:"Set a date", noReason:"no reason",
  nEdited:d => `Originally ${d} → edited`, nTBD:"Date to be decided", nConsumed:"Used from prepaid, no makeup",
  nBonus:d => `Bonus for teacher’s cancellation on ${d} (free)`, nMakeup:(d,x) => `Makeup for ${x} on ${d}`,
  nReason:m => `Reason: ${m}`, nContact:(d,n,late) => `Contacted ${d} (${n} day${n===1?"":"s"} before${late?", ⚠ below notice rule":""})`,
  inPrepaid:"In prepaid",
  listFoot:(p,b,m) => `Prepaid total (${p} regular · ${b} bonus free · ${m} makeup from prepaid)`,
  basis:(o) => [
    `① Prepaid period: ${o.ps} – ${o.pe} (start date + ${o.months} months − 1 day)`,
    `② Sundays in the period = <b>${o.prepaid} prepaid classes</b> (each ${o.slot}, ${o.dur} min = 1 class)`,
    `③ Prepaid: ${o.prepaid} × ${o.price} = <b>${o.usd}</b> × ${o.rate} UZS (CBU ${o.rateDate}) = <b>${o.uzs} UZS</b>`,
    `④ My cancellations / no-shows: ${o.consumed} → used from prepaid, no makeup`,
    `⑤ Teacher’s reason: ${o.teacher} → each moved to the end as a makeup + ${o.bonus} bonus class(es) the week after ($0)`,
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
  pv:{ undo:(d,x) => `Restores the original class ${x} on ${d} and removes the makeup and bonus created from it.`, already:"Already scheduled — nothing to change.", pick:"Choose what to do above.", done:"Marks this class as done.", plan:"Resets to scheduled and removes any makeup or bonus created from this class.",
    edit:"Changes only this class’s date and time. Nothing is used from prepaid and no bonus is added.", cause:"Choose whose reason it is.",
    teacher:`<b>Teacher’s-reason rule:</b> this class moves automatically to the Sunday after the last class (makeup), and a new <b>bonus class ($0)</b> is added the week after. The reason is logged.`,
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
function todayStr(){ const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`; }
function nowStamp(){ const n = new Date(); return `${todayStr()} ${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`; }
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
  return t("makeupL")(labelOf(s.from));
}
function klass(s){
  const a = s.act, c = s.cause;
  if (a === "plan" || a === "done") return a;
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
  let bonusNo = 0;
  const endSlot = () => nextSundayAfter(S.reduce((m,x) => x.d > m ? x.d : m, P.start));
  for (let i=0; i<S.length; i++){
    const s = S[i], meta = state[s.id] || {};
    s.meta = meta; s.act = meta.act || "plan"; s.cause = meta.cause || null;
    s.origD = s.d;
    if (meta.ed){ s.d = parse(meta.ed.date); s.time = meta.ed.time || s.time; s.edited = true; }
    const relocate = !["plan","done"].includes(s.act) && !occupies(s);
    if (!relocate) continue;
    if (s.cause === "teacher"){
      const mk = {id:"M:"+s.id, kind:"moved", from:s, d:endSlot(), time:C.time};
      S.push(mk);
      const bn = {id:"B:"+s.id, kind:"bonus", bno:++bonusNo, from:s, d:endSlot(), time:C.time};
      S.push(bn);
      s.children = [mk, bn];
    } else if (s.act === "move" && meta.how === "date" && meta.to){
      const mk = {id:"M:"+s.id, kind:"moved", from:s, d:parse(meta.to), time:meta.toTime || C.time};
      S.push(mk); s.children = [mk];
    } else if (s.act === "move" || s.act === "cancel" || s.act === "noshow"){
      const mk = {id:"M:"+s.id, kind:"moved", from:s, d:endSlot(), time:C.time};
      S.push(mk); s.children = [mk];
    }
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
  applyStatic(); renderAcct(); render();
  if ($("fxModal").classList.contains("on")) drawFx();
}
document.querySelectorAll("[data-lang]").forEach(b => b.onclick = () => setLang(b.dataset.lang));

/* ---------- 렌더링 ---------- */
function render(){
  const C = cfg();
  const P = sundays(C.start, C.months);
  const S = buildSessions(P, C);
  const prepaid = P.list.length;
  const prepaidUsd = prepaid*C.price, prepaidUzs = prepaidUsd*C.rate;

  const timeline = S.filter(occupies).sort(byTime);
  const holds = S.filter(s => s.act === "hold" && s.cause !== "teacher");
  const bonusCount = S.filter(s => s.kind === "bonus").length;
  const movedCount = S.filter(s => s.kind === "moved").length;
  const lastSession = timeline.length ? timeline[timeline.length-1].d : P.end;
  const left = timeline.filter(s => s.act === "plan" && s.d >= C.asof).length;
  const alertItem = timeline.length > C.N ? timeline[timeline.length-C.N-1] : timeline[0];

  const NP = sundays(addDays(lastSession,1), C.months);
  const nCount = NP.list.length, nUsd = nCount*C.price, nUzs = nUsd*C.rate;

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
      ${t("alertDueBody")(kdate(NP.start), kdate(NP.end), nCount, usd(C.price), usd(nUsd), uzs(nUzs))}${holdNote}${fxLine}`;
  } else {
    b.className = "banner on ok";
    b.innerHTML = alertItem ? `<b class="h">${t("alertNext")(kdate(alertItem.d), alertItem.time)}</b>
      ${t("alertNextBody")(C.N, kdate(lastSession))}${holdNote}${fxLine}` : fxLine;
  }
  b.querySelectorAll("[data-fx]").forEach(x => x.onclick = () => openFx(x.dataset.fx));

  // 달력
  const wrap = $("months-wrap"); wrap.innerHTML = "";
  const byDay = {};
  S.forEach(s => (byDay[fmt(s.d)] ||= []).push(s));
  Object.values(byDay).forEach(a => a.sort(byTime));
  const calEnd = S.reduce((m,x) => x.d > m ? x.d : m, lastSession);
  let m = new Date(Date.UTC(P.start.getUTCFullYear(), P.start.getUTCMonth(), 1));
  const lastM = new Date(Date.UTC(calEnd.getUTCFullYear(), calEnd.getUTCMonth(), 1));
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
      el.textContent = dd;
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
          if (isMaster()) it.onclick = () => selectSession(selected === s.id ? null : s.id); else it.style.cursor = "default";
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

  // 보류 목록
  $("holds").innerHTML = holds.length ? holds.map(h => `<div><span>${kdate(h.d)} ${labelOf(h)}<br><span class="hint">${t("cause")[h.cause]} · ${h.meta.memo||t("noReason")}</span></span>
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
    const fee = s.kind === "reg" ? usd(C.price) : s.kind === "bonus" ? "$0.00" : t("inPrepaid");
    const cc = s.act==="done" ? "c-done" : s.act==="plan" ? "" : s.cause ? "c-"+s.cause : "";
    return `<tr><td>${kdate(s.d)} ${s===alertItem?"🔔":""}<br><span class="hint">${tEnd(s.time)}</span></td>
      <td><span class="tag ${s.kind}">${labelOf(s)}</span></td>
      <td class="${cc}">${statusText(s)}</td><td>${notes.join("<br>")}</td><td class="r mono usdcol">${fee}</td></tr>`;
  }).join("") + `<tr><th colspan="4">${t("listFoot")(prepaid, bonusCount, movedCount)}</th><th class="r mono usdcol">${usd(prepaidUsd)}</th></tr>`;

  // 근거
  const cnt = f => S.filter(f).length;
  $("basis").innerHTML = t("basis")({
    ps:kdate(P.start), pe:kdate(P.end), months:C.months, prepaid, slot:tEnd(C.time), dur:C.dur,
    price:usd(C.price), usd:usd(prepaidUsd), rate:uzs2(C.rate), rateDate:C.rateDate, uzs:uzs2(prepaidUzs),
    consumed:cnt(s => klass(s)==="consumed"), teacher:cnt(s => klass(s)==="teacher"), bonus:bonusCount,
    relocated:cnt(s => klass(s)==="relocated"), holds:holds.length, last:kdate(lastSession), N:C.N, alert:alertItem?kdate(alertItem.d):"–"
  }).map(x => `<div>${x}</div>`).join("");
  $("nextBasis").innerHTML = t("next")({a:kdate(NP.start), b:kdate(NP.end), months:C.months, n:nCount, list:NP.list.map(sdate).join(", "),
    price:usd(C.price), usd:usd(nUsd), rate:uzs2(C.rate), uzs:uzs2(nUzs)}).map(x => `<div>${x}</div>`).join("")
    + `<div class="hint">${t("nextHint")(holds.length)}</div>`;

  // 기록
  $("log").innerHTML = log.length ? log.slice().reverse().map(l => `<div><time>${l.at}</time>${l[lang] || l.ko || l.text || ""}</div>`).join("")
    : `<div class="empty">${t("noLog")}</div>`;

  // 카톡 메시지
  const changed = S.filter(s => !["plan","done"].includes(s.act) || s.edited).sort((a,b)=>a.origD-b.origD)
    .map(s => `· ${sdate(s.origD)} ${labelOf(s)} ${statusText(s)}${s.children?" → "+s.children.map(c=>`${labelOf(c)} ${sdate(c.d)}`).join(", "):""}${s.meta.memo?` (${s.meta.memo})`:""}`).join("\n");
  $("msg").value = t("msg")({ps:kdate(P.start), pe:kdate(P.end), slot:tEnd(C.time), dur:C.dur, prepaid, price:usd(C.price), usd:usd(prepaidUsd),
    rate:uzs2(C.rate), rateDate:C.rateDate, uzs:uzs(prepaidUzs), changed, left, last:kdate(lastSession),
    na:kdate(NP.start), nb:kdate(NP.end), nn:nCount, nusd:usd(nUsd), nuzs:uzs(nUzs)});
}

/* ---------- 상태 변경 패널 ---------- */
let pick = {act:null, cause:null, how:"end"};
function selectSession(id, a){
  if (id && !isMaster()) return;
  selected = id;
  const m = id && state[id] || {};
  pick = {act: a || null, cause: m.cause || null, how: m.how || "end"};
  $("agreed").value = todayStr(); $("toDate").value = ""; $("toTime").value = $("time").value || "17:00";
  $("memo").value = m.memo || "";
  render();
}
function setSeg(id, v){ $(id).querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === v)); }
function positionPanel(){
  const p = $("actions"), card = $("calcard"), it = card.querySelector(".it.sel");
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
  if (!selected) return;
  if (e.target.closest("#actions") || e.target.closest(".it") || e.target.closest(".modal") || e.target.closest("[data-sel]") || e.target.closest(".lang")) return;
  selectSession(null);
});
function renderPanel(sel, C){
  const origin = sel.kind === "bonus" ? t("origBonus")(kdate(sel.from.d), labelOf(sel.from))
    : sel.kind === "moved" ? t("origMakeup")(kdate(sel.from.d), labelOf(sel.from)) : "";
  $("actTitle").innerHTML = `<b>${kdate(sel.d)} ${sel.time}</b> · ${labelOf(sel)}${origin}<br><span class="hint">${t("nowIs")(statusText(sel))}</span>`;
  const a = pick.act;
  $("segAct").querySelector("[data-v=plan]").textContent = sel.kind === "reg" ? t("aPlan") : t("aUndo");
  setSeg("segAct", a); setSeg("quickAct", a); setSeg("segCause", pick.cause); setSeg("segHow", pick.how);
  const needCause = ["move","hold","cancel","noshow"].includes(a);
  $("fldCause").classList.toggle("on", needCause);
  const teacher = pick.cause === "teacher";
  $("fldMoveHow").classList.toggle("on", a === "move" && needCause && !teacher);
  const showDates = a === "edit" || (needCause && !teacher && (a === "hold" || a === "move"));
  $("fldDates").classList.toggle("on", showDates);
  $("wrapAgreed").style.display = (a === "edit") ? "none" : "";
  const dateNeeded = a === "edit" || (a === "move" && pick.how === "date");
  $("wrapTo").style.display = dateNeeded ? "" : "none";
  $("wrapToTime").style.display = dateNeeded ? "" : "none";
  $("datesTitle").textContent = a === "edit" ? t("datesEdit") : t("datesMove");
  if (a === "edit" && !$("toDate").value) $("toDate").value = fmt(sel.d);
  updatePreview(sel, C);
}
function noticeDays(sel){ const ag = $("agreed").value; return ag ? Math.round((sel.d - parse(ag)) / 86400000) : 0; }
function updatePreview(sel, C){
  const p = $("preview"), a = pick.act, c = pick.cause, pv = t("pv"), act = t("act");
  p.className = "preview";
  let x = "";
  if (!a) x = pv.pick;
  else if (a === "done") x = pv.done;
  else if (a === "plan" && sel.kind !== "reg") x = pv.undo(kdate(sel.from.origD || sel.from.d), labelOf(sel.from));
  else if (a === "plan" && sel.act === "plan" && !state[sel.id]) x = pv.already;
  else if (a === "plan") x = pv.plan;
  else if (a === "edit") x = pv.edit;
  else if (!c) x = pv.cause;
  else if (c === "teacher"){ p.className = "preview teacher"; x = pv.teacher; }
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
    if (cur && cur.kind !== "reg") selected = cur.from.id;          // 보강·보너스 → 원래 수업을 되돌림
  }
  const before = buildSessions(P, C).find(x => x.id === selected);
  if (a === "plan" && before.act === "plan" && !(state[selected] && state[selected].memo)){
    if (!before.edited){ $("preview").className = "preview"; $("preview").textContent = t("pv").already; return; }
  }
  const needCause = ["move","hold","cancel","noshow"].includes(a);
  if (needCause && !pick.cause){ updatePreview(before, C); return; }
  if ((a === "edit" || (a === "move" && pick.how === "date" && pick.cause !== "teacher")) && !$("toDate").value){
    $("preview").className = "preview bad"; $("preview").textContent = t("pv").needDate; return;
  }
  const memo = $("memo").value.trim();
  const prev = state[selected] || {};
  let meta;
  if (a === "plan") meta = prev.ed ? {ed: prev.ed} : null;
  else if (a === "done") meta = {...(prev.ed?{ed:prev.ed}:{}), act:"done", memo: memo || undefined};
  else if (a === "edit") meta = {...prev, ed:{date:$("toDate").value, time:$("toTime").value || C.time}, memo: memo || prev.memo};
  else {
    meta = {act:a, cause:pick.cause, memo: memo || undefined, ...(prev.ed?{ed:prev.ed}:{})};
    if (pick.cause !== "teacher" && (a === "move" || a === "hold")){
      const n = noticeDays(before);
      meta.agreed = $("agreed").value || todayStr(); meta.notice = n; meta.late = n < C.minNotice;
    }
    if (a === "move" && pick.cause !== "teacher"){
      meta.how = pick.how;
      if (pick.how === "date"){ meta.to = $("toDate").value; meta.toTime = $("toTime").value || C.time; }
    }
  }
  if (meta) state[selected] = meta; else delete state[selected];
  if (a === "plan"){ delete state["M:"+selected]; delete state["B:"+selected]; }   // 지워진 보강·보너스의 남은 상태 정리

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
  log.push({at: nowStamp(), ...entry});
  save();
  selected = null; render();
};

/* ---------- 모달 ---------- */
function openModal(id){ $(id).classList.add("on"); }
document.querySelectorAll(".modal").forEach(m => {
  m.addEventListener("click", e => { if (e.target === m || e.target.hasAttribute("data-close")) m.classList.remove("on"); });
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  const open = document.querySelectorAll(".modal.on");
  if (open.length) open.forEach(m => m.classList.remove("on")); else if (selected) selectSession(null);
});
$("openSettings").onclick = () => openModal("settingsModal");

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
$("loginBtn").onclick = () => { const c = repoCoords(); $("ghOwner").value = c.owner; $("ghRepo").value = c.repo; $("loginMsg").textContent = ""; openModal("loginModal"); };
$("doLogin").onclick = doLogin;
$("logoutBtn").onclick = () => { auth = null; try { localStorage.removeItem(AUTHKEY); } catch(e) {} selectSession(null); renderAcct(); loadRemote(); };
$("linkBtn").onclick = () => copy(teacherLink(), t("linkCopied")(teacherLink()));
async function copy(text, ok){
  try { await navigator.clipboard.writeText(text); $("toast").textContent = ok; }
  catch(e){ $("toast").textContent = t("copyFail"); }
}
$("copyMsg").addEventListener("click", () => copy($("msg").value, t("copied")));
$("copyLog").addEventListener("click", () => copy(log.map(l => `${l.at}  ${l[lang] || l.ko || l.text || ""}`).join("\n") || t("noLogTxt"), t("logCopied")));
applyStatic();
renderAcct();
render();
loadRemote();
