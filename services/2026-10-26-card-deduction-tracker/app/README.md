# 카드공제 계산기 2026 + 2027 가계부·카드공제 트래커 (`2026-10-26-card-deduction-tracker`)

- 무료 웹 계산기(정적, Vite + 바닐라 TS) + Gumroad Ping 기록용 Pages Function 1개 + 유료 구글 시트 생성 스크립트(openpyxl).
- 기획: `../brief.md`, 디자인: `../design.md`. 계산 로직은 brief 부록 B-2/B-3 그대로(`src/calc.ts`).
- **입력값은 브라우저 밖으로 나가지 않는다**: 서버 전송·저장소·URL·분석 이벤트 어디에도 금액을 넣지 않는다.

```
app/
  index.html, 2027-card-deduction-changes.html, privacy.html, terms.html, refund.html, disclaimer.html, 404.html
  partials/            공통 head·면책 바·헤더·푸터·FAQ(+JSON-LD)·결제 고정 문구 (빌드 시 <!-- @include x --> 치환)
  src/calc.ts          계산 로직(정수, BigInt 스케일 10,000) + 결과 문구
  src/main.ts          계산기 UI      src/common.ts  UTM 보존·구매 버튼      src/analytics.ts  track() 래퍼
  functions/api/gumroad-ping.ts   Cloudflare Pages Function (POST /api/gumroad-ping)
  test/                vitest: 부록 C 케이스, Ping 함수
  public/              favicon.svg/png, og.png, og-2027.png, _headers
  assets-src/          OG 이미지 SVG 원본
  scripts/             render-images.mjs, e2e-check.mjs, build-guide-pdf.mjs
  sheet/               build_sheet.py, verify_sheet.py, sources.py, guide.md   (생성물은 sheet/out/, 커밋 안 함)
```

## 로컬 실행·테스트·빌드

```bash
cd services/2026-10-26-card-deduction-tracker/app
npm ci
npm test            # vitest: 계산(부록 C 1~4 + 변형) + gumroad-ping
npm run dev         # http://localhost:5173
npm run build       # tsc 타입체크 + vite build → build/
npm run preview     # http://localhost:4173 (build/ 서빙, 없는 경로 404)
```

- 빌드 출력 폴더는 `build/`다(서비스 폴더 규칙의 `dist/` 설명 폴더와 이름 충돌 방지). `build/`, `build-e2e/`, `sheet/out/`은 `.gitignore`.
- 빌드 시 `SITE_URL`·`VITE_GUMROAD_URL`·`CONTACT_EMAIL`·분석 ID가 비어 있으면 노란 경고가 출력된다. **운영 빌드에서 경고가 없어야 한다.**

### E2E 확인 (Playwright, 전역 설치본 사용 — `playwright install` 불필요)

```bash
npm run build && npm run preview &                  # 4173
SCREEN_DIR=/tmp/screens node scripts/e2e-check.mjs  # 케이스 1~4 화면 원 단위, 네트워크 입력값 0건, 375px 가로 스크롤, FAQ JSON-LD 일치, 404 등

# 구매 버튼 UTM까지 확인하려면 테스트용 Gumroad URL로 따로 빌드
VITE_GUMROAD_URL=https://example.gumroad.com/l/test npx vite build --outDir build-e2e
npx vite preview --port 4174 --outDir build-e2e &
BASE_URL=http://localhost:4174 EXPECT_GUMROAD=1 node scripts/e2e-check.mjs
```

## 환경변수

| 이름 | 어디에 | 필수 | 설명 |
|---|---|---|---|
| `SITE_URL` | Pages 빌드 변수 | 필수 | 운영 도메인(끝 `/` 없이). canonical·og:url·og:image·sitemap.xml·robots.txt·결과 복사 URL. 미설정 시 `https://example.pages.dev` 플레이스홀더 |
| `VITE_GUMROAD_URL` | Pages 빌드 변수 | 필수 | `https://<seller>.gumroad.com/l/<permalink>`. 버튼은 `?wanted=true&utm_source&utm_medium&utm_campaign` 자동 부착. 미설정 시 구매 버튼 3곳 비활성화 + "결제 링크 설정 전" 표시 |
| `CONTACT_EMAIL` | Pages 빌드 변수 | 필수 | 푸터·정책 페이지 문의 메일. 미설정 시 "문의 메일 설정 전" |
| `VITE_GA4_ID` | Pages 빌드 변수 | 권장 | GA4 측정 ID(`G-…`). `page_view`(자동)·`calc_complete`·`checkout_click` 기록 |
| `VITE_CF_BEACON_TOKEN` | Pages 빌드 변수 | 선택 | Cloudflare Web Analytics 토큰. **page_view만**(맞춤 이벤트 미지원) → 결제 클릭 측정에는 GA4 필요 |
| `NODE_VERSION` | Pages 빌드 변수 | 선택 | `.node-version`(22)이 있어 보통 불필요 |
| `GUMROAD_SELLER_ID` | Pages **Secret** (Production) | 필수 | Ping의 `seller_id`와 대조 |
| `GUMROAD_PING_TOKEN` | Pages **Secret** (Production) | 필수 | Ping URL `?token=` 값과 대조. Gumroad Ping은 서명이 없고 seller_id는 비밀값이 아니므로 필수(미설정 시 503, fail-closed). 32자 이상 무작위 문자열 |
| `SALES` | Pages KV 바인딩 | 필수 | Ping 기록 저장소 |

`VITE_*`·`SITE_URL`·`CONTACT_EMAIL`은 빌드 시 정적 파일에 박히므로 값을 바꾸면 **재배포**해야 한다. 실제 값은 커밋하지 않는다(`.env.example`만 커밋).

## Cloudflare Pages 배포 설정 (운영자, CEO 배포 승인 후)

1. Cloudflare 대시보드 → Workers & Pages → Create → Pages → Git 저장소 연결.
2. Build settings
   - Framework preset: None
   - **Root directory**: `services/2026-10-26-card-deduction-tracker/app`
   - **Build command**: `npm run build`
   - **Build output directory**: `build`
   - `functions/` 폴더는 Root directory 기준으로 자동 인식된다(`/api/gumroad-ping`).
3. Settings → Variables and Secrets: 위 표의 빌드 변수와 Secret 등록(Production).
4. KV: Workers & Pages → KV → Create namespace(예: `card-deduction-sales`) → Pages 프로젝트 Settings → Bindings → KV namespace, **Variable name `SALES`**.
5. 재배포 후 확인: `/`, `/2027-card-deduction-changes`, `/privacy`, `/terms`, `/refund`, `/disclaimer`, `/sitemap.xml`, `/robots.txt`, `/og.png`, 없는 경로 → 404 페이지.
6. 도메인 확정 후 OG 이미지 우하단 도메인 표기: `SITE_URL=https://<도메인> PRETENDARD_DIR=<woff2 폴더> npm run images` → `public/*.png` 커밋.

보안 헤더: `public/_headers`에 CSP 포함(허용: self, GA4 `*.googletagmanager.com`/`*.google-analytics.com`/`*.analytics.google.com`, Cloudflare beacon, jsDelivr 글꼴). 새 외부 스크립트·도메인을 추가하면 CSP도 같이 고친다. 로컬 Playwright에서 헤더를 주입해 위반 0건 확인함(실배포 적용은 미확인).

CLI로 직접 올릴 경우(대안): `npm run build && npx wrangler pages deploy build --project-name <프로젝트>` — 이 경우에도 `functions/`는 현재 폴더 기준으로 함께 배포된다. KV·Secret은 대시보드에서 설정.

## Gumroad 상품 설정 (운영자)

1. **Payments에서 한국 은행 계좌 출금 가능 여부 확인**(brief 7장) — 불가하면 상품 공개 중단, CEO 보고.
2. 상품 등록: 이름 "2027 가계부 + 카드공제 트래커 (구글 시트)", $6.99, 파일 = 사용 설명 PDF(`sheet/out/guide.pdf`), 설명 하단에 F-1·F-2·F-3 원문(design 3-4).
3. **Ping URL**: Settings → Advanced → Ping endpoint
   `https://<도메인>/api/gumroad-ping?token=<GUMROAD_PING_TOKEN 값>`
4. seller_id 확인: `GUMROAD_PING_TOKEN`(실제 값)과 `GUMROAD_SELLER_ID` 임시 값(예: `unset`)을 넣고 배포 → 본인 테스트 구매(또는 100% 할인 코드) → Pages 프로젝트 → Deployments → 해당 배포 → **Functions 실시간 로그**(또는 `npx wrangler pages deployment tail`)에 `seller_id mismatch, not recorded (received=…)`가 찍힌다 → 그 값을 `GUMROAD_SELLER_ID` Secret에 넣고 재배포 → 다시 테스트 구매해 200·KV 기록 확인. (403 응답은 Gumroad가 재시도하지 않으므로 첫 테스트 구매 기록은 남지 않는다.)
5. 기록 확인: `npx wrangler kv key list --namespace-id <ID>` → `sale:<sale_id>:sale` 키, 값 예시
   `{"sale_id":"…","resource_name":"sale","price_cents":699,"test":true,"utm_source":"geeknews",…}`

### Ping 처리 규칙 (gumroad.com/ping 공식 문서, 2026-10-26 확인)

- POST, `application/x-www-form-urlencoded`. 2xx면 수신 확인(본문은 읽지 않음). 5초 안에 응답.
- 재시도는 499·500·502·503·504 응답에만(1분·3분·10분·1시간 후). 그 외 non-2xx는 재시도하지 않는다.
- at-least-once 전달 → `sale_id` + `resource_name`(sale/refund)으로 중복 제거. 환불 Ping은 같은 sale_id에 `resource_name=refund`.
- 페이로드 서명 없음 → 이 함수는 `?token=` + `seller_id` 두 겹으로 검증한다(둘 다 필수).

| 상황 | 응답 | 기록 |
|---|---|---|
| 정상 | 200 | `sale:<sale_id>:<resource_name>` ← sale_id, resource_name, product_permalink, price_cents, currency, quantity, sale_timestamp, test, refunded, utm_source/medium/campaign, received_at |
| token 불일치 / seller_id 불일치·누락 | 403 (재시도 안 됨) | 없음 |
| `GUMROAD_SELLER_ID`·`GUMROAD_PING_TOKEN`·`SALES` 중 하나라도 미설정 | 503 (Gumroad가 재시도 → 설정 고치면 복구) | 없음 |
| KV 쓰기 실패 | 500 (재시도) | 없음 |
| sale_id 형식 오류 | 400 | 없음 |

Ping 본문에는 이메일·이름·구매자 ID·IP 국가·카드 요약 등이 포함되어 서버로 전송되지만 **저장하지 않는다**(`/privacy`에 고지). 이 기록은 매출 측정용이며, 유료 파일 전달은 Gumroad가 한다(이 기록으로 잠금 해제하는 기능 없음).

## 유료 구글 시트 생성·검증·업로드

```bash
pip install openpyxl                       # 3.1.x
SITE_URL=https://<도메인> CONTACT_EMAIL=<메일> python3 sheet/build_sheet.py
#  → sheet/out/card-deduction-tracker-2027.xlsx (커밋 안 함)
python3 sheet/verify_sheet.py              # LibreOffice headless 재계산 → 부록 C 케이스 원 단위·토글·수식 오류 검증
```

- `verify_sheet.py`는 `soffice --headless --convert-to xlsx`로 재계산한 뒤 값을 읽는다(LibreOffice 필요: `apt install libreoffice-calc`).
- 설계 대비 차이(함수 허용 목록 안): 최종 공제액은 `ROUNDDOWN(ROUND(x,4),0)`(부동소수점으로 1원 덜 내림 방지), 25% 문턱·남은 금액은 원 미만 올림(웹 계산기와 동일). 자세한 내용은 `build_sheet.py` 머리말.

### 구글 시트 업로드 → `/copy` 링크

1. 판매자 구글 계정 드라이브 → 새로 만들기 → 파일 업로드 → `card-deduction-tracker-2027.xlsx`.
2. 파일 열기 → 파일 → **Google 스프레드시트로 저장**(변환본 생성). 원본 xlsx는 지운다.
3. 변환본에서 확인: '2026마무리'에 부록 C 케이스 1 입력 → C20 1,425,000 / C21 1,950,000 / C22 525,000, '설정' C4 드롭다운 동작, 수식 오류(#REF!, #ERROR!) 0개. 확인 후 입력값을 지운다.
4. 공유 → 일반 액세스 "링크가 있는 모든 사용자" **뷰어**.
5. 주소창 URL `https://docs.google.com/spreadsheets/d/<ID>/edit…` 의 `/edit…`를 `/copy`로 바꾼 것이 사본 만들기 링크.
6. 다른 구글 계정으로 `/copy` 링크 열기 → 사본 생성·수식 오류 0개 확인(brief 기능 2 완료 조건 3).
7. 스크린샷 3장(2027공제·2027가계부·설정 탭, 예시 데이터)을 캡처해 판매 섹션에 추가(design 3-2, 목업 금지).

### 설명 PDF

```bash
COPY_URL=https://docs.google.com/spreadsheets/d/<ID>/copy SITE_URL=https://<도메인> CONTACT_EMAIL=<메일> \
  PRETENDARD_DIR=<Pretendard woff2 폴더(선택)> npm run guide:pdf
#  → sheet/out/guide.pdf (A4 2쪽) → Gumroad 상품 파일로 업로드
```

원본은 `sheet/guide.md`. 세 값 중 하나라도 비면 `[COPY_URL 미설정]` 같은 자리표시가 들어가므로 판매용으로 쓰지 않는다.

### 엑셀(xlsx) 사본 동봉 여부 (brief 기능 2 완료 조건 4)

엑셀에서 열어 부록 C 케이스가 같은지 확인하기 전까지 동봉하지 않는다. 판매 섹션의 "⑤ 엑셀(xlsx) 파일" 항목은 `index.html`의 `#xlsx-item`에 `hidden`으로 숨겨져 있다. QA 통과 시 `hidden`을 지운다.

## OG 이미지·파비콘

`npm run images`(Playwright 전역 설치본)로 `assets-src/*.svg`, `public/favicon.svg` → `public/og.png`, `og-2027.png`, `favicon-32.png`, `apple-touch-icon.png`. `PRETENDARD_DIR`에 `Pretendard-{Regular,SemiBold,Bold,ExtraBold}.woff2`가 있으면 Pretendard로, 없으면 시스템 한글 폰트로 렌더된다. 현재 커밋된 PNG는 Pretendard v1.3.9(jsDelivr `packages/pretendard/dist/web/static/woff2/`)로 렌더했고, 도메인 미정이라 우하단 도메인 표기는 비어 있다.
