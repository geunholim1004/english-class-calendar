# 영어 수업 달력 & 수업료 계산기 / English Class Calendar & Fee Calculator

매주 일요일 17:00, 25분 = 1 Class, $6 선불 수업을 달력으로 관리하고
우즈벡중앙은행(CBU) 공식 환율로 UZS 수업료를 계산하는 웹 앱입니다.

## 권한
| 역할 | 방법 | 할 수 있는 것 |
|---|---|---|
| 마스터 | 페이지 오른쪽 위 **마스터 로그인** → GitHub fine-grained 토큰 입력 (이 저장소만, Contents: Read and write) | 수업 완료·수정·이동·Hold·취소·No-show, 설정 변경. 변경은 `data/state.json`에 자동 커밋 |
| 선생님 | GitHub Pages 링크만 열기 | 보기 전용: 달력, 수업료, 계산 근거, 변경 기록, 환율 추세, 카톡 메시지 복사, 한/영 전환 |

토큰은 마스터의 브라우저(localStorage)에만 저장되고 저장소에는 올라가지 않습니다.

## 규칙
- 선불: 시작일부터 N개월 안의 일요일 수 × $6
- 선생님 사유(이동·Hold·취소·No-show): 그 수업은 마지막 수업 다음 일요일로 보강 이동 + 그다음 주 보너스 수업($0)
- 내 사유 취소·No-show: 선불 1회 차감, 보강 없음
- 내 사유·사전 합의 이동/Hold: 선불 유지 (합의 기준일 미달 시 기록에 표시)
- 남은 수업이 2회가 되는 날 다음 선불 기간 금액을 알림

## 파일
- `index.html` – 화면
- `app.js` – 계산·달력·권한·GitHub 동기화
- `data/state.json` – 설정, 수업 상태, 변경 기록 (공개 저장소이므로 누구나 읽을 수 있음)

## 환율 데이터 출처
- 현재값: CBU https://cbu.uz/en/arkhiv-kursov-valyut/ (2026-11-21 고시, 교차환율)
- 2010–2025 KRW/JPY/CNY: Federal Reserve G.5A (FRED AEXKOUS, AEXJPUS, AEXCHUS)
- 2010–2023 UZS: FRED XRNCUSUZA618NRUG · 2024–2025 UZS: TradersUnion 연평균
