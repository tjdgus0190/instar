/**
 * 공급자 비종속 분석 래퍼.
 * - VITE_GA4_ID 있으면 GA4(gtag), VITE_CF_BEACON_TOKEN 있으면 Cloudflare Web Analytics 비컨.
 * - 둘 다 없으면 외부 전송 없음(no-op). 디버그/테스트용으로 window에 'cdt:track' CustomEvent만 발행.
 * - 입력값·금액은 절대 넣지 않는다: 허용된 키와 짧은 문자열 값만 통과시킨다.
 */

type Params = Record<string, string>;

const ALLOWED_KEYS = new Set(['location', 'result_type', 'utm_source', 'utm_medium', 'utm_campaign', 'page_path']);
const VALUE_RE = /^[A-Za-z0-9_\-./]{1,64}$/;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const GA4_ID = (import.meta.env.VITE_GA4_ID || '').trim();
const CF_TOKEN = (import.meta.env.VITE_CF_BEACON_TOKEN || '').trim();

export function sanitize(params: Record<string, unknown>): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(params)) {
    if (!ALLOWED_KEYS.has(k) || typeof v !== 'string' || !VALUE_RE.test(v)) continue;
    // 숫자만으로 된 값(금액 가능성)은 버린다
    if (/^\d+$/.test(v)) continue;
    out[k] = v;
  }
  return out;
}

let initialized = false;

export function initAnalytics(): void {
  if (initialized) return;
  initialized = true;
  if (/^G-[A-Z0-9]{4,20}$/i.test(GA4_ID)) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    window.gtag('js', new Date());
    // page_view는 GA4 기본 수집(URL에는 입력값이 없다)
    window.gtag('config', GA4_ID);
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_ID)}`;
    document.head.appendChild(s);
  }
  if (CF_TOKEN) {
    const s = document.createElement('script');
    s.defer = true;
    s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    s.setAttribute('data-cf-beacon', JSON.stringify({ token: CF_TOKEN }));
    document.head.appendChild(s);
  }
}

/** page_view는 공급자 기본 수집에 맡기고(중복 방지) 디버그 이벤트만 발행 */
export function track(event: 'page_view' | 'calc_complete' | 'checkout_click', params: Record<string, unknown> = {}): void {
  const clean = sanitize(params);
  try {
    window.dispatchEvent(new CustomEvent('cdt:track', { detail: { event, params: clean } }));
  } catch {
    /* noop */
  }
  if (event === 'page_view') return;
  if (window.gtag && GA4_ID) window.gtag('event', event, clean);
  // Cloudflare Web Analytics는 맞춤 이벤트를 지원하지 않는다(page_view만).
}
