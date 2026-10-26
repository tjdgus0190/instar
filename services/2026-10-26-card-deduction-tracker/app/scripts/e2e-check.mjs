// 로컬 프리뷰 서버 대상 E2E 확인 (Playwright 전역 설치본 사용)
//   BASE_URL=http://localhost:4173 SCREEN_DIR=/tmp/screens node scripts/e2e-check.mjs
//   EXPECT_GUMROAD=1 이면 구매 버튼 href·UTM 부착까지 확인(VITE_GUMROAD_URL 넣고 빌드한 경우)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:4173';
const SCREEN_DIR = process.env.SCREEN_DIR || '';
const EXPECT_GUMROAD = process.env.EXPECT_GUMROAD === '1';
if (SCREEN_DIR) mkdirSync(SCREEN_DIR, { recursive: true });

const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
}

const CASES = {
  1: { in: { g: '50000000', c: '12000000', d: '3000000', x: '4000000' }, k: 0,
       sentence: '남은 4,000,000원을 체크카드·현금영수증으로 쓰면 소득공제가 525,000원 늘어납니다 (신용 1,425,000원 → 체크 1,950,000원).',
       hero: '+525,000원', type: 'rule3' },
  2: { in: { g: '40000000', c: '6000000', d: '1000000', x: '3000000', t: '500000' }, k: 0,
       sentence: '남은 지출은 대부분 25% 문턱을 채우는 데 쓰여 결제수단에 따른 차이가 없습니다.', hero: '0원', type: 'zero_diff',
       extra: ['문턱까지 남은 금액(지금): 2,500,000원'] },
  3: { in: { g: '80000000', c: '30000000', d: '10000000', x: '5000000', t: '2000000' }, k: 1,
       sentence: '이미 공제 한도에 도달해 체크카드로 바꿔도 공제액이 같습니다. 혜택 좋은 신용카드를 쓰세요.', hero: '3,550,000원', type: 'rule2',
       extra: ['예상 카드 소득공제 (기본 한도 2,750,000원)'] },
  '3-K0': { in: { g: '80000000', c: '30000000', d: '10000000', x: '5000000', t: '2000000' }, k: 0,
       sentence: '이미 공제 한도에 도달해 체크카드로 바꿔도 공제액이 같습니다. 혜택 좋은 신용카드를 쓰세요.', hero: '3,300,000원', type: 'rule2' },
  4: { in: { g: '70000000', c: '40000000', d: '0', x: '0' }, k: 0,
       sentence: '이미 공제 한도에 도달해 체크카드로 바꿔도 공제액이 같습니다. 혜택 좋은 신용카드를 쓰세요.', hero: '3,000,000원', type: 'rule2' },
  '4-G+1': { in: { g: '70000001', c: '40000000', d: '0', x: '0' }, k: 0,
       sentence: '이미 공제 한도에 도달해 체크카드로 바꿔도 공제액이 같습니다. 혜택 좋은 신용카드를 쓰세요.', hero: '2,500,000원', type: 'rule2' },
  'm4-X0': { in: { g: '30000000', c: '0', d: '0', x: '0', t: '10000000' }, k: 0,
       sentence: '11~12월 예상 지출이 0원이라 비교할 남은 지출이 없어요. 남은 지출을 입력하면 결제수단별 차이를 계산해 드려요.', hero: '0원', type: 'zero_diff' },
  'm4-문턱': { in: { g: '50000000', c: '8000000', d: '2000000', x: '2500000' }, k: 0,
       sentence: '11~12월 지출까지 써야 25% 문턱에 겨우 닿아 어느 쪽으로 써도 공제가 0원이에요. 문턱을 넘는 지출부터 결제수단에 따라 공제가 달라집니다.', hero: '0원', type: 'zero_diff' },
};

const SECRET_STRINGS = (c) => {
  const out = new Set();
  for (const v of Object.values(c.in)) {
    if (v.length < 6) continue;
    out.add(v);
    out.add(Number(v).toLocaleString('ko-KR'));
    out.add(encodeURIComponent(Number(v).toLocaleString('ko-KR')));
  }
  return [...out];
};

async function newPage(browser, mobile) {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 900 } },
  );
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() || '' }));
  await page.addInitScript(() => {
    window.__ev = [];
    window.addEventListener('cdt:track', (e) => window.__ev.push(e.detail));
  });
  return { ctx, page, requests };
}

async function fillCase(page, c) {
  if (c.in.t !== undefined || c.k) await page.locator('#optional > summary').click();
  for (const [k, v] of Object.entries(c.in)) {
    await page.locator(`#in-${k}`).fill('');
    await page.locator(`#in-${k}`).pressSequentially(v);
  }
  await page.locator(`input[name="in-k"][value="${c.k}"]`).check({ force: true });
  await page.locator('#calc-btn').click();
  await page.waitForSelector('#result');
}

const browser = await chromium.launch();

// ---------- 데스크톱: 케이스 1 + 네트워크·저장소 확인 + 스크린샷 ----------
{
  const { ctx, page, requests } = await newPage(browser, false);
  await page.goto(BASE + '/?utm_source=geeknews&utm_medium=community&utm_campaign=card-deduction-2026', { waitUntil: 'networkidle' });
  const before = requests.length;
  const c = CASES[1];
  await fillCase(page, c);
  check('케이스1 입력 콤마 포맷', (await page.inputValue('#in-g')) === '50,000,000', await page.inputValue('#in-g'));
  check('케이스1 만원 표기', (await page.textContent('#in-g-man')) === '= 5,000만원');
  check('케이스1 결과 문장', (await page.textContent('#rule-sentence')).trim() === c.sentence, (await page.textContent('#rule-sentence')).trim());
  check('케이스1 히어로 숫자', (await page.textContent('#result-heading')).trim() === c.hero);
  const resultText = await page.textContent('#result');
  for (const s of ['1,425,000원', '1,950,000원', '12,500,000원', '지금까지 15,000,000원 사용', '참고용 계산, 세무 자문 아님, 최종 공제액은 홈택스/회사 연말정산 결과 기준', '소비증가분 특례·문화비 별도 공제율·종합한도는 계산에 포함하지 않음']) {
    check(`케이스1 결과 카드에 "${s}"`, resultText.replace(/\s+/g, ' ').includes(s));
  }
  // 결과 복사
  await page.locator('#copy-btn').click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('결과 복사 텍스트(약 53만원, 입력값 없음)', /^남은 지출을 체크카드로 쓰면 카드 소득공제가 약 53만원 늘어요 — https?:\/\/[^ ]+\/$/.test(clip) && !SECRET_STRINGS(c).some((s) => clip.includes(s)), clip);

  await page.screenshot({ path: SCREEN_DIR ? `${SCREEN_DIR}/desktop-1280-case1-result.png` : undefined });
  if (SCREEN_DIR) await page.screenshot({ path: `${SCREEN_DIR}/desktop-1280-case1-full.png`, fullPage: true });

  // 네트워크: 계산 전후 요청에 입력값이 없어야 한다
  const leaks = requests.filter((r) => SECRET_STRINGS(c).some((s) => r.url.includes(s) || r.body.includes(s)));
  check('네트워크 요청에 입력값 0건', leaks.length === 0, `총 요청 ${requests.length}건, 계산 후 추가 ${requests.length - before}건`);
  // 계산 후 외부 요청은 Pretendard 다이나믹 서브셋 글꼴 조각(GET .woff2)만 허용 — 새 글자가 화면에 나타나면 CSS unicode-range로 받아온다
  const afterCalc = requests.slice(before).filter((r) => !r.url.startsWith(BASE));
  const nonFont = afterCalc.filter((r) => !(r.method === 'GET' && r.url.startsWith('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@') && r.url.endsWith('.woff2')));
  check('계산 클릭 후 외부 요청은 글꼴 파일 GET뿐', nonFont.length === 0, `글꼴 ${afterCalc.length - nonFont.length}건, 기타 ${nonFont.map((r) => r.url).join(', ')}`);
  const hosts = [...new Set(requests.map((r) => new URL(r.url).host))];
  results.push(`INFO  요청 호스트: ${hosts.join(', ')}`);
  const nonGet = requests.filter((r) => r.method !== 'GET');
  check('GET 외 요청 0건', nonGet.length === 0, nonGet.map((r) => r.method + ' ' + r.url).join(', '));

  // URL·저장소에 입력값 없음
  const url = page.url();
  check('URL에 입력값 없음', !SECRET_STRINGS(c).some((s) => url.includes(s)), url);
  const storage = await page.evaluate(() => ({ ls: JSON.stringify(localStorage), ss: JSON.stringify(sessionStorage) }));
  check('localStorage 비어 있음', storage.ls === '{}', storage.ls);
  check('sessionStorage는 UTM만', !SECRET_STRINGS(c).some((s) => storage.ss.includes(s)) && storage.ss.includes('geeknews'), storage.ss);

  // 분석 이벤트
  const ev = await page.evaluate(() => window.__ev);
  const calcEv = ev.filter((e) => e.event === 'calc_complete');
  check('calc_complete 1회, result_type만', calcEv.length === 1 && JSON.stringify(calcEv[0].params) === '{"result_type":"rule3"}', JSON.stringify(calcEv));
  const money = [...SECRET_STRINGS(c), '525000', '525,000', '1425000', '1950000', '12500000', '53'];
  const evParams = ev.map((e) => Object.entries(e.params).filter(([k]) => !k.startsWith('utm_')).map(([, v]) => v)).flat();
  check('이벤트 파라미터에 입력값·결과 금액 없음', !money.some((m) => JSON.stringify(ev).includes(m)) && evParams.every((v) => ['rule1', 'rule2', 'zero_diff', 'rule3', 'calc_cta', 'sheet_section', 'changes_page'].includes(v) || /^\/[a-z0-9-]*$/.test(v)), JSON.stringify(ev));

  // 구매 버튼
  const buys = await page.$$eval('a[data-cta]', (as) => as.map((a) => ({ cta: a.dataset.cta, href: a.getAttribute('href'), disabled: a.getAttribute('aria-disabled'), note: a.parentElement.querySelector('.buy-note')?.textContent })));
  check('구매 버튼 옆 F-2 원문(전부)', buys.every((b) => b.note === '$6.99(약 1만원), 달러 청구, 해외결제 가능한 Visa/Master 카드 필요'), JSON.stringify(buys.map((b) => b.cta)));
  if (EXPECT_GUMROAD) {
    const ok = buys.every((b) => b.href && b.href.includes('wanted=true') && b.href.includes('utm_source=geeknews') && b.href.includes('utm_medium=community') && b.href.includes('utm_campaign=card-deduction-2026'));
    check('구매 버튼 href에 wanted=true + UTM 유지', ok, buys.map((b) => b.href).join(' | '));
    const [popup] = await Promise.all([ctx.waitForEvent('page').catch(() => null), page.locator('a[data-cta="calc_cta"]').click()]);
    if (popup) await popup.close();
    const ck = (await page.evaluate(() => window.__ev)).filter((e) => e.event === 'checkout_click');
    check('checkout_click(location=calc_cta, UTM)', ck.length === 1 && ck[0].params.location === 'calc_cta' && ck[0].params.utm_source === 'geeknews', JSON.stringify(ck));
  } else {
    check('VITE_GUMROAD_URL 없음 → 구매 버튼 비활성화', buys.every((b) => b.href === null && b.disabled === 'true'));
  }

  // stale
  await page.locator('#in-x').pressSequentially('1');
  check('입력 변경 시 stale 표시', await page.locator('#result.is-stale').count() === 1 && (await page.textContent('#calc-btn')) === '다시 계산하기');
  await ctx.close();
}

// ---------- 데스크톱: 케이스 2~4 원 단위 ----------
for (const id of ['2', '3', '3-K0', '4', '4-G+1', 'm4-X0', 'm4-문턱']) {
  const c = CASES[id];
  const { ctx, page } = await newPage(browser, false);
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await fillCase(page, c);
  const sentence = (await page.textContent('#rule-sentence')).trim();
  const hero = (await page.textContent('#result-heading')).trim();
  const type = await page.getAttribute('#result', 'data-result-type');
  const text = (await page.textContent('#result')).replace(/\s+/g, ' ');
  const extraOk = (c.extra || []).every((s) => text.includes(s));
  check(`케이스${id} (${type}) 히어로 ${hero}`, sentence === c.sentence && hero === c.hero && type === c.type && extraOk && !text.includes('0원 늘어납니다'), sentence);
  await ctx.close();
}

// ---------- 모바일 375: 케이스 1 + 가로 스크롤 ----------
{
  const { ctx, page, requests } = await newPage(browser, true);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  if (SCREEN_DIR) await page.screenshot({ path: `${SCREEN_DIR}/mobile-375-first-view.png` });
  await fillCase(page, CASES[1]);
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('모바일 375 가로 스크롤 없음', overflow <= 0, `scrollWidth-clientWidth=${overflow}`);
  check('모바일 케이스1 결과 문장', (await page.textContent('#rule-sentence')).trim() === CASES[1].sentence);
  const heroBox = await page.locator('#result-heading').boundingBox();
  check('모바일 히어로 숫자 한 줄', heroBox && heroBox.height < 60, JSON.stringify(heroBox));
  if (SCREEN_DIR) {
    await page.locator('#result').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SCREEN_DIR}/mobile-375-case1-result.png` });
    await page.screenshot({ path: `${SCREEN_DIR}/mobile-375-case1-full.png`, fullPage: true });
  }
  const leaks = requests.filter((r) => SECRET_STRINGS(CASES[1]).some((s) => r.url.includes(s) || r.body.includes(s)));
  check('모바일 네트워크 요청에 입력값 0건', leaks.length === 0);
  // 다른 페이지 가로 스크롤
  for (const p of ['/2027-card-deduction-changes', '/privacy', '/refund', '/terms', '/disclaimer']) {
    await page.goto(BASE + p, { waitUntil: 'load' });
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`모바일 ${p} 가로 스크롤 없음`, o <= 0, String(o));
    if (SCREEN_DIR && p === '/2027-card-deduction-changes') await page.screenshot({ path: `${SCREEN_DIR}/mobile-375-2027.png`, fullPage: true });
  }
  await ctx.close();
}

// ---------- 정적 검사: 필수 검증 에러, FAQ JSON-LD, 금지 표현 ----------
{
  const { ctx, page } = await newPage(browser, false);
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.locator('#calc-btn').click();
  check('빈 입력 → 에러 요약 + 총급여 메시지', (await page.isVisible('#err-summary')) && (await page.textContent('#in-g-err')) === '올해 총급여를 입력해 주세요.');
  check('결과 카드 미렌더(에러 시)', (await page.locator('#result').count()) === 0);
  const faq = await page.evaluate(() => {
    const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
    const vis = [...document.querySelectorAll('.faq-item')].map((d) => ({ q: d.querySelector('h3').textContent.replace(/^Q\. /, ''), a: d.querySelector('p').textContent }));
    return { ld: ld.mainEntity.map((m) => ({ q: m.name, a: m.acceptedAnswer.text })), vis };
  });
  check('FAQ JSON-LD = 화면 FAQ (7개)', faq.ld.length === 7 && JSON.stringify(faq.ld) === JSON.stringify(faq.vis));
  for (const p of ['/', '/2027-card-deduction-changes', '/privacy', '/terms', '/refund', '/disclaimer']) {
    await page.goto(BASE + p, { waitUntil: 'load' });
    const body = await page.evaluate(() => document.body.innerText);
    const bad = body.match(/(?<!미)확정|사라진다|폐지 확정/g);
    check(`${p} 개정안 단정 표현 0개`, !bad, bad ? bad.join(',') : '');
    check(`${p} 면책 바 F-1`, body.includes('참고용 계산, 세무 자문 아님, 최종 공제액은 홈택스/회사 연말정산 결과 기준'));
  }
  const res404 = await page.goto(BASE + '/no-such-page');
  check('없는 경로 404', res404.status() === 404, String(res404.status()));
  await ctx.close();
}

await browser.close();
console.log(results.join('\n'));
console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.filter((r) => !r.startsWith('INFO')).length} checks)`);
process.exit(failed ? 1 : 0);
