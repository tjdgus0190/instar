import './styles.css';
import { calculate, copyText, manLabel, MAX_AMOUNT, roundMan, ruleSentence, won, type CalcResult } from './calc';
import { initCommon, wireBuyButtons } from './common';
import { track } from './analytics';

/*
 * 개인정보 원칙: 입력값은 이 파일 안의 지역 변수에만 존재한다.
 * localStorage·sessionStorage·URL·쿼리·해시·네트워크·분석 이벤트 어디에도 넣지 않는다.
 */

type Key = 'g' | 'c' | 'd' | 'x' | 't';
const MONEY_KEYS: Key[] = ['g', 'c', 'd', 'x', 't'];
const REQUIRED: Key[] = ['g', 'c', 'd', 'x'];
const MAX_DIGITS = 11;

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const inputOf = (k: Key) => $<HTMLInputElement>(`#in-${k}`);
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function digitsOf(s: string): string {
  return s.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITS);
}

function valueOf(k: Key): number | null {
  const d = digitsOf(inputOf(k).value);
  return d === '' ? null : parseInt(d, 10);
}

/** 천 단위 콤마 + 커서 위치 보존 */
function formatInput(el: HTMLInputElement): void {
  const caret = el.selectionStart ?? el.value.length;
  const digitsBefore = el.value.slice(0, caret).replace(/\D/g, '').length;
  const raw = el.value.replace(/\D/g, '');
  const leadingZeros = raw.length - raw.replace(/^0+(?=\d)/, '').length;
  const digits = digitsOf(el.value);
  const formatted = digits === '' ? '' : Number(digits).toLocaleString('ko-KR');
  el.value = formatted;
  let want = Math.max(0, Math.min(digitsBefore - leadingZeros, digits.length));
  let pos = 0;
  while (want > 0 && pos < formatted.length) {
    if (/\d/.test(formatted[pos])) want--;
    pos++;
  }
  if (document.activeElement === el) el.setSelectionRange(pos, pos);
}

function updateMan(k: Key): void {
  const v = valueOf(k);
  const man = $<HTMLElement>(`#in-${k}-man`);
  man.textContent = v === null ? '' : manLabel(v);
}

function setError(k: Key, msg: string | null): void {
  const el = inputOf(k);
  const err = $<HTMLElement>(`#in-${k}-err`);
  if (msg) {
    el.setAttribute('aria-invalid', 'true');
    err.textContent = msg;
    err.hidden = false;
  } else {
    el.removeAttribute('aria-invalid');
    err.textContent = '';
    err.hidden = true;
  }
}

function kValue(): number {
  const r = document.querySelector<HTMLInputElement>('input[name="in-k"]:checked');
  return r ? parseInt(r.value, 10) : 0;
}

function updateOptionalFilled(): void {
  const filled = valueOf('t') !== null || kValue() > 0;
  $<HTMLElement>('.opt-filled').hidden = !filled;
}

function validate(): { ok: boolean; first?: Key } {
  let first: Key | undefined;
  for (const k of MONEY_KEYS) {
    const v = valueOf(k);
    let msg: string | null = null;
    if (v === null) {
      if (REQUIRED.includes(k)) msg = k === 'g' ? '올해 총급여를 입력해 주세요.' : '금액을 입력해 주세요. 없으면 0을 넣으세요.';
    } else if (k === 'g' && v === 0) {
      msg = '총급여는 1원 이상이어야 해요.';
    } else if (v > MAX_AMOUNT) {
      msg = '100억원 이하로 입력해 주세요.';
    }
    setError(k, msg);
    if (msg && !first) first = k;
  }
  $<HTMLElement>('#err-summary').hidden = !first;
  if (first === 't') ($<HTMLDetailsElement>('#optional')).open = true;
  return { ok: !first, first };
}

/* ---------- 결과 렌더 ---------- */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function heroFor(r: CalcResult): { eyebrow: string; num: string; numClass: string; sub: string } {
  switch (r.resultType) {
    case 'rule1': {
      const man = roundMan(r.remainingAfter);
      const sub = r.remainingAfter >= 5_000
        ? `11~12월 지출 후에도 문턱까지 남는 금액 (약 ${man.toLocaleString('ko-KR')}만원)`
        : '11~12월 지출 후에도 문턱까지 남는 금액';
      return { eyebrow: '아직 25% 문턱 아래예요', num: won(r.remainingAfter), numClass: '', sub };
    }
    case 'rule2':
      return {
        eyebrow: '이미 공제 한도에 도달했어요',
        num: won(r.A),
        numClass: 'is-primary',
        sub: `예상 카드 소득공제 (기본 한도 ${won(r.basicLimit)})`,
      };
    case 'zero_diff':
      return { eyebrow: '결제수단에 따른 차이가 없어요', num: '0원', numClass: '', sub: `신용카드로 써도, 체크카드로 써도 공제액 ${won(r.A)}` };
    case 'rule3': {
      const sub = r.diff >= 5_000 ? `소득공제가 늘어요 (약 ${roundMan(r.diff).toLocaleString('ko-KR')}만원)` : '소득공제가 늘어요';
      return { eyebrow: '체크카드로 바꾸면', num: `+${won(r.diff)}`, numClass: 'is-gain', sub };
    }
  }
}

const BRIDGE_LINE: Record<CalcResult['resultType'], string> = {
  rule3: '올해는 11월에야 계산했지만, 내년엔 문턱을 넘는 달을 미리 볼 수 있어요.',
  rule1: '내년엔 매달 25% 문턱 진행률을 자동으로 보여 드려요.',
  rule2: '내년엔 공제 한도까지 얼마 남았는지 바로 확인할 수 있어요.',
  zero_diff: '내년엔 공제 한도까지 얼마 남았는지 바로 확인할 수 있어요.',
};

function renderResult(r: CalcResult, X: number, G: number, T: number): void {
  const slot = $<HTMLElement>('#result-slot');
  const hero = heroFor(r);
  const max = Math.max(r.A, r.B);
  const bars = max === 0
    ? '<p class="bars-zero">두 경우 모두 공제 0원</p>'
    : `<div class="bar-row"><span class="bar-label">신용카드로 쓸 때</span><span class="bar"><span class="bar-fill credit" style="width:${((r.A / max) * 100).toFixed(2)}%"></span></span><span class="bar-val num">${won(r.A)}</span></div>
       <div class="bar-row"><span class="bar-label">체크카드로 쓸 때</span><span class="bar"><span class="bar-fill debit" style="width:${((r.B / max) * 100).toFixed(2)}%"></span></span><span class="bar-val num">${won(r.B)}</span></div>`;
  const progress = r.threshold === 0 ? 1 : Math.min(1, r.usedNow / r.threshold);
  const warn = r.usedNow + X > G
    ? '<p class="warn-line">입력한 사용액 합계가 총급여보다 커요. 금액이 맞는지 한 번 확인해 주세요.</p>'
    : '';
  const limitLine = `기본 ${won(r.basicLimit)}` + (T > 0 ? ` · 전통시장·대중교통 추가 ${won(r.extraLimit)}까지` : '');
  const remainNowText = r.remainingNow === 0 ? '0원 · 이미 넘었어요' : won(r.remainingNow);

  slot.innerHTML = `
    <section id="result" class="result card" aria-live="polite" tabindex="-1" data-result-type="${r.resultType}">
      <p class="stale-bar" hidden>입력값이 바뀌었어요. 다시 계산해 주세요.</p>
      ${warn}
      <p class="eyebrow">${esc(hero.eyebrow)}</p>
      <h2 class="hero-num ${hero.numClass}" id="result-heading" tabindex="-1">${esc(hero.num)}</h2>
      <p class="hero-sub">${esc(hero.sub)}</p>
      <hr>
      <p class="rule-sentence" id="rule-sentence">${esc(ruleSentence(r, X))}</p>
      <hr>
      <h3 class="small-h">공제액 비교</h3>
      ${bars}
      <hr>
      <p class="th-line"><span>25% 문턱</span> <strong class="num">${won(r.threshold)}</strong></p>
      <div class="progress" role="img" aria-label="25% 문턱 진행률 ${Math.round(progress * 100)}%"><span class="progress-fill ${progress >= 1 ? 'is-full' : ''}" style="width:${(progress * 100).toFixed(2)}%"></span></div>
      <p class="th-detail">지금까지 <span class="num">${won(r.usedNow)}</span> 사용</p>
      <p class="th-detail ${r.resultType === 'zero_diff' ? 'is-strong' : ''}">문턱까지 남은 금액(지금): <span class="num">${remainNowText}</span></p>
      <p class="th-detail">11~12월 지출 후에도 남는 금액: <span class="num">${won(r.remainingAfter)}</span></p>
      <p class="th-detail">공제 한도: <span class="num">${limitLine}</span></p>
      <hr>
      <button type="button" class="btn btn-secondary btn-block" id="copy-btn"><span class="btn-label">결과 복사</span></button>
      <div class="copy-fallback" hidden>
        <textarea readonly rows="3" aria-label="복사할 문구"></textarea>
        <p class="help">복사가 안 되면 위 문구를 길게 눌러 복사하세요.</p>
      </div>
      <hr>
      <p class="fine">소득공제액 기준입니다. 실제 줄어드는 세금은 공제액 × 본인 세율(지방소득세 포함)이라 이보다 작습니다.</p>
      <p class="fine">소비증가분 특례·문화비 별도 공제율·종합한도는 계산에 포함하지 않음</p>
      <p class="fine notice-inline">참고용 계산, 세무 자문 아님, 최종 공제액은 홈택스/회사 연말정산 결과 기준</p>
    </section>`;

  const tpl = $<HTMLTemplateElement>('#bridge-tpl');
  const bridge = tpl.content.cloneNode(true) as DocumentFragment;
  $<HTMLElement>('.bridge-line', bridge).textContent = BRIDGE_LINE[r.resultType];
  slot.appendChild(bridge);
  wireBuyButtons(slot);

  const text = copyText(r, __SITE_URL__ + '/');
  const copyBtn = $<HTMLButtonElement>('#copy-btn');
  copyBtn.addEventListener('click', async () => {
    const label = $<HTMLElement>('.btn-label', copyBtn);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      label.textContent = '✓ 복사했어요';
      window.setTimeout(() => (label.textContent = '결과 복사'), 2000);
    } catch {
      const fb = $<HTMLElement>('.copy-fallback', slot);
      const ta = $<HTMLTextAreaElement>('textarea', fb);
      ta.value = text;
      fb.hidden = false;
      ta.focus();
      ta.select();
    }
  });

  const result = $<HTMLElement>('#result');
  result.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
  $<HTMLElement>('#result-heading').focus({ preventScroll: true });
  track('calc_complete', { result_type: r.resultType });
}

let hasResult = false;

function markStale(): void {
  if (!hasResult) return;
  const result = document.querySelector<HTMLElement>('#result');
  if (!result || result.classList.contains('is-stale')) return;
  result.classList.add('is-stale');
  $<HTMLElement>('.stale-bar', result).hidden = false;
  $<HTMLButtonElement>('#calc-btn').textContent = '다시 계산하기';
}

function runCalc(): void {
  const v = validate();
  if (!v.ok) {
    const el = inputOf(v.first!);
    el.focus();
    el.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    return;
  }
  const G = valueOf('g')!;
  const X = valueOf('x')!;
  const T = valueOf('t') ?? 0;
  const r = calculate({ G, C: valueOf('c')!, D: valueOf('d')!, X, T, K: kValue() });
  hasResult = true;
  $<HTMLButtonElement>('#calc-btn').textContent = '계산하기';
  renderResult(r, X, G, T);
}

function lastField(): Key {
  return $<HTMLDetailsElement>('#optional').open ? 't' : 'x';
}

function init(): void {
  initCommon();
  const form = $<HTMLFormElement>('#calc-form');

  for (const k of MONEY_KEYS) {
    const el = inputOf(k);
    el.addEventListener('input', () => {
      formatInput(el);
      updateMan(k);
      setError(k, null);
      if (!document.querySelector('.field [aria-invalid="true"]')) $<HTMLElement>('#err-summary').hidden = true;
      if (k === 't') updateOptionalFilled();
      markStale();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const order: Key[] = $<HTMLDetailsElement>('#optional').open ? ['g', 'c', 'd', 'x', 't'] : ['g', 'c', 'd', 'x'];
      const i = order.indexOf(k);
      if (i >= 0 && i < order.length - 1) inputOf(order[i + 1]).focus();
      else runCalc();
    });
  }
  document.querySelectorAll<HTMLInputElement>('input[name="in-k"]').forEach((r) =>
    r.addEventListener('change', () => {
      updateOptionalFilled();
      markStale();
    }),
  );
  const optional = $<HTMLDetailsElement>('#optional');
  optional.addEventListener('toggle', () => {
    const last = lastField();
    inputOf('x').enterKeyHint = last === 'x' ? 'done' : 'next';
    inputOf('t').enterKeyHint = 'done';
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    runCalc();
  });

  // "숫자 찾는 법 ›" → 해당 FAQ 펼치고 스크롤 (해시는 남기지 않는다)
  document.querySelectorAll<HTMLAnchorElement>('a.faq-jump').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(a.dataset.faq!) as HTMLDetailsElement | null;
      if (!target) return;
      target.open = true;
      target.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
    }),
  );
}

init();
