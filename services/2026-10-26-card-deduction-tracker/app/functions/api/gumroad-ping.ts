/**
 * Cloudflare Pages Function: POST /api/gumroad-ping
 *
 * Gumroad Ping (https://gumroad.com/ping, 2026-10-26 확인):
 * - HTTP POST, body = application/x-www-form-urlencoded. 2xx 응답이면 수신 확인(본문은 읽지 않음).
 * - at-least-once 전달 → sale_id + resource_name 으로 중복 제거(환불 ping은 같은 sale_id, resource_name=refund).
 * - 재시도는 499/500/502/503/504 응답에만(1분·3분·10분·1시간 후). 그 외 non-2xx는 재시도 안 함.
 * - 5초 안에 응답해야 함. 페이로드는 서명이 없다.
 *
 * 검증(둘 다 필수): (1) URL ?token= === GUMROAD_PING_TOKEN, (2) seller_id === GUMROAD_SELLER_ID.
 * 불일치 → 403 (기록 안 함, Gumroad도 재시도 안 함).
 * 설정 누락(GUMROAD_SELLER_ID·GUMROAD_PING_TOKEN·SALES 중 하나라도) → 503 (fail-closed, 설정 고친 뒤 Gumroad 재시도로 복구 가능).
 * 저장: KV(SALES)에 key `sale:<sale_id>:<resource_name>` → 최소 정보만. 이메일·이름·구매자 ID·IP 국가·카드 정보 등 개인정보는 저장하지 않는다.
 *
 * 이 기록은 매출 측정용(`purchase`)이다. 유료 파일 전달은 Gumroad가 하며, 이 기록으로 무언가를 잠금 해제하지 않는다.
 */

export interface KVLike {
  put(key: string, value: string): Promise<void>;
}

export interface Env {
  GUMROAD_SELLER_ID?: string;
  GUMROAD_PING_TOKEN?: string;
  SALES?: KVLike;
}

interface Ctx {
  request: Request;
  env: Env;
}

export interface SaleRecord {
  sale_id: string;
  resource_name: string;
  product_permalink: string | null;
  price_cents: number | null;
  currency: string | null;
  quantity: number | null;
  sale_timestamp: string | null;
  test: boolean;
  refunded: boolean;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  received_at: string;
}

const MAX_BODY = 64 * 1024;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

function clip(v: string | null | undefined, max = 100): string | null {
  if (v == null) return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function toInt(v: string | null): number | null {
  if (v == null || !/^\d{1,12}$/.test(v.trim())) return null;
  return Number(v.trim());
}

function toBool(v: string | null): boolean {
  return v === 'true' || v === '1';
}

/** url_params는 폼 인코딩에서 `url_params[utm_source]=x` 형태로 온다. 해시 문자열로 올 경우도 대비. */
export function extractUtm(form: URLSearchParams): Record<(typeof UTM_KEYS)[number], string | null> {
  const out = { utm_source: null, utm_medium: null, utm_campaign: null } as Record<(typeof UTM_KEYS)[number], string | null>;
  const raw = form.get('url_params');
  for (const k of UTM_KEYS) {
    let v = form.get(`url_params[${k}]`);
    if (v == null && raw) {
      const m = raw.match(new RegExp(`["']${k}["']\\s*(?:=>|:)\\s*["']([^"']*)["']`));
      if (m) v = m[1];
    }
    if (v != null) {
      try {
        v = decodeURIComponent(v);
      } catch {
        /* 그대로 사용 */
      }
    }
    out[k] = clip(v);
  }
  return out;
}

export async function onRequest({ request, env }: Ctx): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
  }
  if (!env.GUMROAD_SELLER_ID || !env.GUMROAD_PING_TOKEN || !env.SALES) {
    console.error('gumroad-ping: GUMROAD_SELLER_ID, GUMROAD_PING_TOKEN or SALES binding missing');
    return text('not configured', 503);
  }
  const token = new URL(request.url).searchParams.get('token') ?? '';
  if (!safeEqual(token, env.GUMROAD_PING_TOKEN)) {
    console.warn('gumroad-ping: token mismatch, not recorded');
    return text('forbidden', 403);
  }
  const len = Number(request.headers.get('content-length') ?? '0');
  if (len > MAX_BODY) return text('payload too large', 413);
  const body = await request.text();
  if (body.length > MAX_BODY) return text('payload too large', 413);
  const form = new URLSearchParams(body);

  const sellerId = form.get('seller_id') ?? '';
  if (!safeEqual(sellerId, env.GUMROAD_SELLER_ID)) {
    // seller_id는 판매자 식별자(구매자 개인정보 아님). 최초 설정 시 운영자가 로그에서 값을 확인할 수 있게 남긴다.
    console.warn(`gumroad-ping: seller_id mismatch, not recorded (received=${sellerId.replace(/[^\w=-]/g, '').slice(0, 64) || '(none)'})`);
    return text('forbidden', 403);
  }

  const saleId = form.get('sale_id') ?? '';
  if (!/^[A-Za-z0-9_\-=]{1,128}$/.test(saleId)) return text('bad request', 400);
  const resourceRaw = form.get('resource_name') ?? 'sale';
  const resource = /^[a-z_]{1,32}$/.test(resourceRaw) ? resourceRaw : 'unknown';

  const record: SaleRecord = {
    sale_id: saleId,
    resource_name: resource,
    product_permalink: clip(form.get('product_permalink')),
    price_cents: toInt(form.get('price')),
    currency: clip(form.get('currency'), 8),
    quantity: toInt(form.get('quantity')),
    sale_timestamp: clip(form.get('sale_timestamp'), 40),
    test: toBool(form.get('test')),
    refunded: toBool(form.get('refunded')),
    ...extractUtm(form),
    received_at: new Date().toISOString(),
  };

  try {
    await env.SALES.put(`sale:${saleId}:${resource}`, JSON.stringify(record));
  } catch (e) {
    console.error('gumroad-ping: KV put failed', e);
    return text('storage error', 500); // 500 → Gumroad 재시도
  }
  console.log(`purchase recorded resource=${resource} test=${record.test}`);
  return text('ok', 200);
}
