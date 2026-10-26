import { describe, expect, it } from 'vitest';
import { onRequest, type Env, type KVLike } from '../functions/api/gumroad-ping';

class MemKV implements KVLike {
  store = new Map<string, string>();
  async put(k: string, v: string) {
    this.store.set(k, v);
  }
}

const SELLER = 'seller_abc123';
const TOKEN = 'tok-0123456789abcdef0123456789abcdef';
const Q = `?token=${TOKEN}`;

function ping(fields: Record<string, string>, query = Q) {
  return new Request(`https://example.pages.dev/api/gumroad-ping${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

function env(kv: KVLike = new MemKV(), over: Partial<Env> = {}): Env {
  return { GUMROAD_SELLER_ID: SELLER, GUMROAD_PING_TOKEN: TOKEN, SALES: kv, ...over };
}

const sale = {
  seller_id: SELLER,
  sale_id: 'FQ1abc==',
  sale_timestamp: '2026-10-26T10:00:00Z',
  product_permalink: 'card-tracker',
  email: 'buyer@example.com',
  full_name: 'Kim Buyer',
  purchaser_id: '999',
  ip_country: 'South Korea',
  price: '699',
  currency: 'usd',
  quantity: '1',
  test: 'true',
  resource_name: 'sale',
  'url_params[utm_source]': 'geeknews',
  'url_params[utm_medium]': 'community',
  'url_params[utm_campaign]': 'card-deduction-2026',
};

describe('gumroad-ping', () => {
  it('token + seller_id 일치 → 200, 최소 정보만 KV에 기록 (개인정보 없음)', async () => {
    const kv = new MemKV();
    const res = await onRequest({ request: ping(sale), env: env(kv) });
    expect(res.status).toBe(200);
    const v = kv.store.get('sale:FQ1abc==:sale');
    expect(v).toBeDefined();
    const rec = JSON.parse(v!);
    expect(rec).toMatchObject({
      price_cents: 699,
      utm_source: 'geeknews',
      utm_medium: 'community',
      utm_campaign: 'card-deduction-2026',
      test: true,
      product_permalink: 'card-tracker',
    });
    for (const pii of ['buyer@example.com', 'Kim Buyer', 'South Korea', '999']) expect(v).not.toContain(pii);
    expect(Object.keys(rec)).not.toContain('email');
  });

  it('seller_id 불일치 → 403, 기록 안 함', async () => {
    const kv = new MemKV();
    const res = await onRequest({ request: ping({ ...sale, seller_id: 'attacker' }), env: env(kv) });
    expect(res.status).toBe(403);
    expect(kv.store.size).toBe(0);
  });

  it('seller_id 누락 → 403, 기록 안 함', async () => {
    const kv = new MemKV();
    const { seller_id: _omit, ...rest } = sale;
    const res = await onRequest({ request: ping(rest), env: env(kv) });
    expect(res.status).toBe(403);
    expect(kv.store.size).toBe(0);
  });

  it('?token 불일치·누락 → 403, 기록 안 함 (seller_id가 맞아도)', async () => {
    const kv = new MemKV();
    expect((await onRequest({ request: ping(sale, '?token=wrong'), env: env(kv) })).status).toBe(403);
    expect((await onRequest({ request: ping(sale, ''), env: env(kv) })).status).toBe(403);
    expect(kv.store.size).toBe(0);
  });

  it('GUMROAD_PING_TOKEN 미설정 → 503 (fail-closed), seller_id만으로는 기록 안 됨', async () => {
    const kv = new MemKV();
    const res = await onRequest({ request: ping(sale, ''), env: env(kv, { GUMROAD_PING_TOKEN: undefined }) });
    expect(res.status).toBe(503);
    expect(kv.store.size).toBe(0);
  });

  it('환불 ping은 별도 키(sale_id + resource_name), 중복 ping은 같은 키에 덮어씀', async () => {
    const kv = new MemKV();
    await onRequest({ request: ping(sale), env: env(kv) });
    await onRequest({ request: ping(sale), env: env(kv) });
    await onRequest({ request: ping({ ...sale, resource_name: 'refund', refunded: 'true' }), env: env(kv) });
    expect([...kv.store.keys()].sort()).toEqual(['sale:FQ1abc==:refund', 'sale:FQ1abc==:sale']);
  });

  it('설정 누락(seller_id·KV) → 503 (Gumroad 재시도 대상), GET → 405', async () => {
    expect((await onRequest({ request: ping(sale), env: env(new MemKV(), { GUMROAD_SELLER_ID: undefined }) })).status).toBe(503);
    expect((await onRequest({ request: ping(sale), env: { GUMROAD_SELLER_ID: SELLER, GUMROAD_PING_TOKEN: TOKEN } })).status).toBe(503);
    const get = new Request(`https://example.pages.dev/api/gumroad-ping${Q}`);
    expect((await onRequest({ request: get, env: env() })).status).toBe(405);
  });

  it('url_params가 해시 문자열로 와도 UTM 추출', async () => {
    const kv = new MemKV();
    const { 'url_params[utm_source]': _a, 'url_params[utm_medium]': _b, 'url_params[utm_campaign]': _c, ...rest } = sale;
    await onRequest({
      request: ping({ ...rest, url_params: "{'utm_source' => 'clien', 'utm_medium' => 'community'}" }),
      env: env(kv),
    });
    const rec = JSON.parse(kv.store.get('sale:FQ1abc==:sale')!);
    expect(rec.utm_source).toBe('clien');
    expect(rec.utm_medium).toBe('community');
    expect(rec.utm_campaign).toBeNull();
  });
});
