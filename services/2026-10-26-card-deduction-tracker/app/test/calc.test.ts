import { describe, expect, it } from 'vitest';
import { basicLimit, calculate, copyText, deduction, manLabel, ruleSentence } from '../src/calc';

// brief.md 부록 C 검증 케이스 (원 단위 일치)
describe('부록 C 케이스 1 — 문턱 통과, 전환 이득', () => {
  const input = { G: 50_000_000, C: 12_000_000, D: 3_000_000, T: 0, K: 0, X: 4_000_000 };
  const r = calculate(input);
  it('금액', () => {
    expect(r.threshold).toBe(12_500_000);
    expect(r.remainingNow).toBe(0);
    expect(r.remainingAfter).toBe(0);
    expect(r.A).toBe(1_425_000);
    expect(r.B).toBe(1_950_000);
    expect(r.diff).toBe(525_000);
    expect(r.resultType).toBe('rule3');
  });
  it('문구', () => {
    expect(ruleSentence(r, input.X)).toBe(
      '남은 4,000,000원을 체크카드·현금영수증으로 쓰면 소득공제가 525,000원 늘어납니다 (신용 1,425,000원 → 체크 1,950,000원).',
    );
    expect(copyText(r, 'https://example.pages.dev/')).toBe(
      '남은 지출을 체크카드로 쓰면 카드 소득공제가 약 53만원 늘어요 — https://example.pages.dev/',
    );
  });
});

describe('부록 C 케이스 2 — 문턱 근처, diff 0 (zero_diff)', () => {
  const input = { G: 40_000_000, C: 6_000_000, D: 1_000_000, T: 500_000, K: 0, X: 3_000_000 };
  const r = calculate(input);
  it('금액', () => {
    expect(r.threshold).toBe(10_000_000);
    expect(r.remainingNow).toBe(2_500_000);
    expect(r.remainingAfter).toBe(0);
    expect(r.A).toBe(200_000);
    expect(r.B).toBe(200_000);
    expect(r.diff).toBe(0);
    expect(r.resultType).toBe('zero_diff');
  });
  it('"0원 늘어납니다" 문구가 나오지 않는다', () => {
    const s = ruleSentence(r, input.X);
    expect(s).toBe('남은 지출은 대부분 25% 문턱을 채우는 데 쓰여 결제수단에 따른 차이가 없습니다.');
    expect(s).not.toContain('늘어납니다');
    expect(copyText(r, 'U')).toBe('카드공제 문턱·한도 30초 계산 — U');
  });
});

describe('부록 C 케이스 3 — 7천만원 초과 + 자녀 1명 + 한도 포화 (rule2)', () => {
  const input = { G: 80_000_000, C: 30_000_000, D: 10_000_000, T: 2_000_000, K: 1, X: 5_000_000 };
  it('K=1', () => {
    const r = calculate(input);
    expect(r.threshold).toBe(20_000_000);
    expect(r.remainingNow).toBe(0);
    expect(r.basicLimit).toBe(2_750_000);
    expect(r.extraLimit).toBe(2_000_000);
    expect(r.A).toBe(3_550_000);
    expect(r.B).toBe(3_550_000);
    expect(r.diff).toBe(0);
    expect(r.resultType).toBe('rule2');
    expect(ruleSentence(r, input.X)).toBe(
      '이미 공제 한도에 도달해 체크카드로 바꿔도 공제액이 같습니다. 혜택 좋은 신용카드를 쓰세요.',
    );
  });
  it('K=0 변형 → A = B = 3,300,000', () => {
    const r = calculate({ ...input, K: 0 });
    expect(r.basicLimit).toBe(2_500_000);
    expect(r.A).toBe(3_300_000);
    expect(r.B).toBe(3_300_000);
    expect(r.diff).toBe(0);
    expect(r.resultType).toBe('rule2');
  });
});

describe('부록 C 케이스 4 — 총급여 경계 70,000,000', () => {
  it('G = 70,000,000 → 3,000,000 ("이하" 구간)', () => {
    expect(deduction(70_000_000, 40_000_000, 0, 0, 0)).toBe(3_000_000);
    const r = calculate({ G: 70_000_000, C: 40_000_000, D: 0, T: 0, K: 0, X: 0 });
    expect(r.threshold).toBe(17_500_000);
    expect(r.A).toBe(3_000_000);
    expect(r.B).toBe(3_000_000);
  });
  it('G = 70,000,001 → 2,500,000', () => {
    expect(deduction(70_000_001, 40_000_000, 0, 0, 0)).toBe(2_500_000);
    expect(calculate({ G: 70_000_001, C: 40_000_000, D: 0, T: 0, K: 0, X: 0 }).A).toBe(2_500_000);
  });
});

describe('보조 규칙', () => {
  it('rule1: 문턱 미달', () => {
    const r = calculate({ G: 50_000_000, C: 3_000_000, D: 1_000_000, T: 0, K: 0, X: 2_000_000 });
    expect(r.resultType).toBe('rule1');
    expect(r.remainingAfter).toBe(6_500_000);
    expect(r.A).toBe(0);
    expect(r.B).toBe(0);
    expect(ruleSentence(r, 2_000_000)).toBe(
      '11~12월 지출을 다 써도 25% 문턱에 6,500,000원 못 미칩니다. 문턱 아래 지출은 결제수단과 상관없이 공제가 없어요.',
    );
  });
  it('총급여가 4의 배수가 아닐 때 문턱은 원 미만 올림, 공제는 내림', () => {
    // M = 12,500,000.25
    const r = calculate({ G: 50_000_001, C: 12_500_000, D: 0, T: 0, K: 0, X: 0 });
    expect(r.threshold).toBe(12_500_001);
    expect(r.remainingNow).toBe(1);
    expect(r.resultType).toBe('rule1');
    expect(deduction(50_000_001, 12_500_001, 0, 0, 0)).toBe(0); // 0.75 * 0.15 → 0
  });
  it('자녀 2명 이상은 2명으로 처리', () => {
    expect(basicLimit(50_000_000, 5)).toBe(4_000_000);
    expect(basicLimit(80_000_000, 2)).toBe(3_000_000);
  });
  it('최대 입력(100억)에서도 정확', () => {
    const r = calculate({ G: 10_000_000_000, C: 10_000_000_000, D: 10_000_000_000, T: 10_000_000_000, K: 2, X: 10_000_000_000 });
    expect(r.A).toBe(3_000_000 + 2_000_000);
  });
  it('만원 보조 표기', () => {
    expect(manLabel(9_999)).toBe('= 9,999원');
    expect(manLabel(50_000_000)).toBe('= 5,000만원');
    expect(manLabel(12_345_678)).toBe('= 약 1,234만원');
    expect(manLabel(125_000_000)).toBe('= 1억 2,500만원');
    expect(manLabel(200_000_000)).toBe('= 2억원');
    expect(manLabel(200_000_001)).toBe('= 약 2억원');
  });
});
