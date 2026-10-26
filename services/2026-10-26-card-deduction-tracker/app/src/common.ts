import { initAnalytics, track } from './analytics';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;
type Utm = Record<(typeof UTM_KEYS)[number], string>;
const DEFAULT_UTM: Utm = { utm_source: 'organic', utm_medium: 'web', utm_campaign: 'card-deduction-2026' };
const STORE_KEY = 'cdt_utm';

/** 랜딩 시 URL의 utm_* 3종을 sessionStorage에 보존(입력값 아님). 없으면 기본값. */
export function getUtm(): Utm {
  const q = new URLSearchParams(location.search);
  const fromUrl: Partial<Utm> = {};
  for (const k of UTM_KEYS) {
    const v = q.get(k);
    if (v && /^[A-Za-z0-9_\-.]{1,64}$/.test(v)) fromUrl[k] = v;
  }
  try {
    if (Object.keys(fromUrl).length) {
      const merged = { ...DEFAULT_UTM, ...fromUrl };
      sessionStorage.setItem(STORE_KEY, JSON.stringify(merged));
      return merged;
    }
    const saved = sessionStorage.getItem(STORE_KEY);
    if (saved) return { ...DEFAULT_UTM, ...JSON.parse(saved) };
  } catch {
    /* sessionStorage 차단 */
  }
  return { ...DEFAULT_UTM, ...fromUrl };
}

export const GUMROAD_URL = (import.meta.env.VITE_GUMROAD_URL || '').trim();

export function checkoutHref(base: string, utm: Utm): string {
  const u = new URL(base);
  u.searchParams.set('wanted', 'true');
  for (const k of UTM_KEYS) u.searchParams.set(k, utm[k]);
  return u.toString();
}

/** data-cta 구매 버튼 연결. 새로 렌더된 버튼에도 다시 호출 가능. */
export function wireBuyButtons(root: ParentNode = document): void {
  const utm = getUtm();
  root.querySelectorAll<HTMLAnchorElement>('a[data-cta]:not([data-wired])').forEach((a) => {
    a.dataset.wired = '1';
    if (!GUMROAD_URL) {
      a.removeAttribute('href');
      a.setAttribute('aria-disabled', 'true');
      a.classList.add('is-disabled');
      const missing = a.parentElement?.querySelector<HTMLElement>('.buy-missing');
      if (missing) missing.hidden = false;
      return;
    }
    a.href = checkoutHref(GUMROAD_URL, utm);
    a.target = '_blank';
    a.rel = 'noopener';
    a.addEventListener('click', () => {
      track('checkout_click', { location: a.dataset.cta, ...utm });
      const label = a.querySelector<HTMLElement>('.btn-label') ?? a;
      const original = label.textContent;
      label.textContent = 'Gumroad 결제 창을 여는 중…';
      a.setAttribute('aria-busy', 'true');
      window.setTimeout(() => {
        label.textContent = original;
        a.removeAttribute('aria-busy');
      }, 2000);
    });
  });
}

export function initCommon(): void {
  initAnalytics();
  const utm = getUtm();
  track('page_view', { page_path: location.pathname, ...utm });
  wireBuyButtons();
}
