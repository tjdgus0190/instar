/**
 * 2026년 사용분 신용카드 등 소득공제 계산 (brief 부록 B-2 / B-3 그대로).
 *
 * - 모든 금액은 원 단위 정수 입력.
 * - 최저사용금액 M = G × 25% 는 소수(0.25원 단위)가 생길 수 있으므로,
 *   내부 계산은 "원 × 10,000" 스케일의 BigInt로 정확히 계산하고 최종 공제액만 내림한다.
 *   (공제율은 % 정수로 곱한 뒤 100으로 나눔 → 스케일 10,000에서는 항상 나누어떨어짐)
 * - 소비증가분 특례, 문화비 별도 공제율, 소득공제 종합한도는 포함하지 않는다(범위 밖).
 */

export const RATE_CREDIT = 15;
export const RATE_DEBIT = 30;
export const RATE_MARKET_TRANSIT = 40;
export const MIN_USE_RATE = 25;
/** 총급여 7천만원 "이하" 판정 기준 */
export const LIMIT_SPLIT = 70_000_000;
export const MAX_AMOUNT = 10_000_000_000;

const S = 10_000n; // 내부 스케일 (원 × 10,000)

export type ResultType = 'rule1' | 'rule2' | 'zero_diff' | 'rule3';

export interface CalcInput {
  /** 올해 총급여 */
  G: number;
  /** 지금까지 신용카드 (전통시장·대중교통 제외) */
  C: number;
  /** 지금까지 체크카드 + 현금영수증 (전통시장·대중교통 제외) */
  D: number;
  /** 11~12월 예상 지출 (일반) */
  X: number;
  /** 지금까지 전통시장 + 대중교통 */
  T: number;
  /** 20세 이하 자녀 수 (2 = 2명 이상) */
  K: number;
}

export interface CalcResult {
  /** 25% 문턱(최저사용금액), 원 미만 올림 표시값 */
  threshold: number;
  /** 지금까지 사용액 합계 C + D + T */
  usedNow: number;
  /** 문턱까지 남은 금액(지금), 원 미만 올림 */
  remainingNow: number;
  /** 11~12월 지출 후에도 남는 금액, 원 미만 올림 */
  remainingAfter: number;
  /** 남은 지출을 신용카드로 쓸 때 공제액 */
  A: number;
  /** 남은 지출을 체크카드·현금영수증으로 쓸 때 공제액 */
  B: number;
  /** B − A (항상 ≥ 0) */
  diff: number;
  basicLimit: number;
  extraLimit: number;
  resultType: ResultType;
}

function assertAmount(name: string, v: number): void {
  if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`${name} must be a non-negative integer`);
}

export function basicLimit(G: number, K: number): number {
  const k = Math.min(Math.max(Math.trunc(K), 0), 2);
  return G <= LIMIT_SPLIT ? 3_000_000 + k * 500_000 : 2_500_000 + k * 250_000;
}

export function extraLimit(G: number): number {
  return G <= LIMIT_SPLIT ? 3_000_000 : 2_000_000;
}

/** 최저사용금액 × 10,000 (정수) */
function threshold4(G: number): bigint {
  return (BigInt(G) * BigInt(MIN_USE_RATE) * S) / 100n; // G*2500, 항상 정수
}

/** 소득공제액(원, 정수). 부록 B-2 deduction(G, C, D, T, K). */
export function deduction(G: number, C: number, D: number, T: number, K: number): number {
  for (const [n, v] of [['G', G], ['C', C], ['D', D], ['T', T]] as const) assertAmount(n, v);
  const c = BigInt(C);
  const d = BigInt(D);
  const t = BigInt(T);
  const M4 = threshold4(G);
  const total4 = (c + d + t) * S;
  if (total4 <= M4) return 0;

  const rc = BigInt(RATE_CREDIT);
  const rd = BigInt(RATE_DEBIT);
  const rt = BigInt(RATE_MARKET_TRANSIT);

  // gross = (C*15 + D*30 + T*40) / 100   (스케일 10,000)
  const gross4 = ((c * rc + d * rd + t * rt) * S) / 100n;

  // 최저사용금액 차감: 공제율 낮은 바구니(신용 → 체크 → 전통시장·대중교통)부터
  let sub4: bigint;
  if (c * S >= M4) {
    sub4 = (M4 * rc) / 100n;
  } else if ((c + d) * S >= M4) {
    sub4 = (c * S * rc) / 100n + ((M4 - c * S) * rd) / 100n;
  } else {
    sub4 = (c * S * rc) / 100n + (d * S * rd) / 100n + ((M4 - (c + d) * S) * rt) / 100n;
  }

  const base4 = gross4 - sub4; // >= 0
  const BL4 = BigInt(basicLimit(G, K)) * S;
  if (base4 <= BL4) return Number(base4 / S);

  // 기본한도 초과분은 min(초과분, 전통시장·대중교통 × 40%, 추가한도)까지
  const extraTarget4 = (t * S * rt) / 100n;
  const EL4 = BigInt(extraLimit(G)) * S;
  let extra4 = base4 - BL4;
  if (extraTarget4 < extra4) extra4 = extraTarget4;
  if (EL4 < extra4) extra4 = EL4;
  return Number((BL4 + extra4) / S);
}

function ceilDiv(a4: bigint): number {
  if (a4 <= 0n) return 0;
  return Number((a4 + S - 1n) / S);
}

/** 부록 B-3 계산기 출력 */
export function calculate(input: CalcInput): CalcResult {
  const { G, C, D, X, T, K } = input;
  for (const [n, v] of Object.entries({ G, C, D, X, T })) assertAmount(n, v);
  const M4 = threshold4(G);
  const usedNow = C + D + T;
  const remainingNow4 = M4 - BigInt(usedNow) * S;
  const remainingAfter4 = M4 - BigInt(usedNow + X) * S;
  const A = deduction(G, C + X, D, T, K);
  const B = deduction(G, C, D + X, T, K);
  const diff = B - A;
  const BL = basicLimit(G, K);

  let resultType: ResultType;
  if (remainingAfter4 > 0n) resultType = 'rule1';
  else if (diff === 0 && A >= BL) resultType = 'rule2';
  else if (diff === 0) resultType = 'zero_diff';
  else resultType = 'rule3';

  return {
    threshold: ceilDiv(M4),
    usedNow,
    remainingNow: ceilDiv(remainingNow4),
    remainingAfter: ceilDiv(remainingAfter4),
    A,
    B,
    diff,
    basicLimit: BL,
    extraLimit: extraLimit(G),
    resultType,
  };
}

/* ---------- 표시 문구 (design.md 2-5 확정 카피) ---------- */

export function won(n: number): string {
  return n.toLocaleString('ko-KR') + '원';
}

/** 만원 단위 반올림 값 (결과 복사·히어로 보조) */
export function roundMan(n: number): number {
  return Math.round(n / 10_000);
}

export const ZERO_DIFF_DEFAULT = '남은 지출은 대부분 25% 문턱을 채우는 데 쓰여 결제수단에 따른 차이가 없습니다.';
/** X = 0: 비교할 남은 지출이 없음 */
export const ZERO_DIFF_NO_SPEND = '11~12월 예상 지출이 0원이라 비교할 남은 지출이 없어요. 남은 지출을 입력하면 결제수단별 차이를 계산해 드려요.';
/** X > 0인데 두 경우 모두 공제 0원: 남은 지출을 다 써야 문턱에 겨우 닿는 경우 */
export const ZERO_DIFF_AT_THRESHOLD = '11~12월 지출까지 써야 25% 문턱에 겨우 닿아 어느 쪽으로 써도 공제가 0원이에요. 문턱을 넘는 지출부터 결제수단에 따라 공제가 달라집니다.';

export function ruleSentence(r: CalcResult, X: number): string {
  switch (r.resultType) {
    case 'rule1':
      return `11~12월 지출을 다 써도 25% 문턱에 ${won(r.remainingAfter)} 못 미칩니다. 문턱 아래 지출은 결제수단과 상관없이 공제가 없어요.`;
    case 'rule2':
      return '이미 공제 한도에 도달해 체크카드로 바꿔도 공제액이 같습니다. 혜택 좋은 신용카드를 쓰세요.';
    case 'zero_diff':
      // brief B-3 규칙 2-1의 상황별 문구 (qa.md m4): 결과 유형은 그대로 zero_diff
      if (X === 0) return ZERO_DIFF_NO_SPEND;
      if (r.A === 0) return ZERO_DIFF_AT_THRESHOLD;
      return ZERO_DIFF_DEFAULT;
    case 'rule3':
      return `남은 ${won(X)}을 체크카드·현금영수증으로 쓰면 소득공제가 ${won(r.diff)} 늘어납니다 (신용 ${won(r.A)} → 체크 ${won(r.B)}).`;
  }
}

/** 결과 복사 텍스트 — 입력값(총급여·사용액) 원값은 절대 넣지 않는다 */
export function copyText(r: CalcResult, url: string): string {
  const man = roundMan(r.diff);
  if (r.resultType === 'rule3' && man >= 1) {
    return `남은 지출을 체크카드로 쓰면 카드 소득공제가 약 ${man}만원 늘어요 — ${url}`;
  }
  return `카드공제 문턱·한도 30초 계산 — ${url}`;
}

/** 입력칸 아래 "만원" 보조 표기 (design.md 2-4) */
export function manLabel(n: number): string {
  if (n < 10_000) return `= ${n.toLocaleString('ko-KR')}원`;
  if (n < 100_000_000) {
    const man = Math.floor(n / 10_000);
    const approx = n % 10_000 !== 0 ? '약 ' : '';
    return `= ${approx}${man.toLocaleString('ko-KR')}만원`;
  }
  const eok = Math.floor(n / 100_000_000);
  const man = Math.floor((n % 100_000_000) / 10_000);
  const approx = n % 10_000 !== 0 ? '약 ' : '';
  const tail = man > 0 ? ` ${man.toLocaleString('ko-KR')}만원` : '원';
  return `= ${approx}${eok.toLocaleString('ko-KR')}억${tail}`;
}
