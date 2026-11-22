# 영어 수업 달력 & 수업료 계산기 / English Class Calendar & Fee Calculator

매주 일요일 17:00, 25분 = 1 Class, $6 선불 수업을 달력으로 관리하고
우즈벡중앙은행(CBU) 공식 환율로 UZS 수업료를 계산하는 웹 앱입니다.

## 권한
| 역할 | 방법 | 할 수 있는 것 |
|---|---|---|
| 마스터 (Edward) | 로그인 → 마스터 탭 → GitHub fine-grained 토큰 (calendar · private · share · access 4개, Contents: Read and write) | 모든 수업 처리·추가, 설정, 납부·영수증, 사용자 관리, 요청 승인/거절 |
| 사용자 (선생님) | 마스터가 아이디 발급 → 카톡 초대 → 본인 비밀번호 등록 → 아이디 로그인 | 수정·이동 **요청만** (승인 대기 저장) · 금액·납부·설정은 안 보임 |
| 그 외 | 링크만 열기 | 로그인 화면만 보임 (데이터 없음) |

- 마스터 토큰은 마스터 브라우저(localStorage)에만 저장됩니다.
- 사용자용 토큰(share · access 2개만)은 `english-class-access/users.json`에 **각자 비밀번호로 암호화**(PBKDF2 25만 회 + AES-GCM)되어 저장되며, 원문·비밀번호는 어디에도 저장되지 않습니다.
- 요청은 `english-class-share/requests.json`에 승인 대기로 쌓이고, 마스터가 승인해야 반영됩니다.

## 보안
- 화면에 그리는 모든 사용자 입력은 이스케이프 처리, 저장소에서 읽은 요청·사용자·시각 값은 형식 검증 후 사용
- Content-Security-Policy: 이 사이트의 스크립트와 api.github.com 외 연결 차단
- 검색엔진·AI 수집 거부 메타 태그 (noindex, noai 등 — 지키는 수집기에만 효과)
- 저장소 4개로 권한 분리 (최소 권한):

| 저장소 | 공개 | 내용 | 쓰기 |
|---|---|---|---|
| english-class-calendar | 공개 | 코드만 (데이터 없음) | 마스터 |
| english-class-private | 비공개 | 전체 상태·금액·납부·영수증·로그 보관 | 마스터 |
| english-class-share | 비공개 | 금액을 뺀 수업 일정, 변경 요청 | 마스터 + 선생님 |
| english-class-access | 공개 | 암호화된 사용자 정보만 | 마스터 + 선생님 |

- 선생님 토큰으로는 코드·금액·납부 저장소에 접근할 수 없습니다 (사이트가 넓은 권한의 토큰은 거부).

## 규칙
- 선불: 시작일부터 N개월 안의 일요일 수 × $6
- '당일'은 접속 위치와 관계없이 **한국 시간(KST)** 기준
- 선생님 사유 + 수업 당일 변경(이동·수정·Hold) → 패널티 보너스 1회 / 전날 이전 연락 → 패널티 없음
- 선생님 사유 취소·No-show → 맨 뒤 보강 + 패널티 보너스 1회
- 내 사유 취소·No-show: 선불 1회 차감, 보강 없음
- 내 사유 Hold: 보류만 (차감 없음) · 내 사유·사전 합의 이동: 선불 유지 (합의 기준일 미달 시 기록에 표시)
- 남은 수업이 2회가 되는 날 다음 선불 기간 금액을 알림

## 파일
- `index.html` – 화면
- `app.js` – 계산·달력·권한·GitHub 동기화
- 데이터는 이 저장소에 두지 않습니다 (위 저장소 표 참고). 예전 `data/` 파일은 마스터 첫 접속 시 비공개 저장소로 옮겨진 뒤 삭제됩니다.

## 환율 데이터 출처
- 현재값: CBU https://cbu.uz/en/arkhiv-kursov-valyut/ (2026-11-21 고시, 교차환율)
- 2010–2025 KRW/JPY/CNY: Federal Reserve G.5A (FRED AEXKOUS, AEXJPUS, AEXCHUS)
- 2010–2023 UZS: FRED XRNCUSUZA618NRUG · 2024–2025 UZS: TradersUnion 연평균
