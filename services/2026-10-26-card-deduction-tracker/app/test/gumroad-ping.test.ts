import { describe, expect, it } from 'vitest';
import { onRequest, type KVLike } from '../functions/api/gumroad-ping';

class MemKV implements KVLike {
  store = new Map<string, string>();
  async put(k: string, v: string) {
    this.store.set(k, v);
  }
}

const SELLER = 'seller_abc123';

function ping(fields: Record<string, string>, query = '') {
  return new Request(`https://example.pages.dev/api/gumroad-ping${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
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
  it('seller_id 일치 → 200, 최소 정보만 KV에 기록 (개인정보 없음)', async () => {
    const kv = new MemKV();
    const res = await onRequest({ request: ping(sale), env: { GUMROAD_SELLER_ID: SELLER, SALES: kv } });
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
    expect(v).not.toContain('buyer@example.com');
    expect(v).not.toContain('Kim Buyer');
    expect(v).not.toContain('South Korea');
    expect(Object.keys(rec)).not.toContain('email');
  });

  it('seller_id 불일치 → 403, 기록 안 함', async () => {
    const kv = new MemKV();
    const res = await onRequest({ request: ping({ ...sale, seller_id: 'attacker' }), env: { GUMROAD_SELLER_ID: SELLER, SALES: kv } });
    expect(res.status).toBe(403);
    expect(kv.store.size).toBe(0);
  });

  it('seller_id 누락 → 403, 기록 안 함', async () => {
    const kv = new MemKV();
    const { seller_id: _omit, ...rest } = sale;
    const res = await onRequest({ request: ping(rest), env: { GUMROAD_SELLER_ID: SELLER, SALES: kv } });
    expect(res.status).toBe(403);
    expect(kv.store.size).toBe(0);
  });

  it('토큰 설정 시 ?token 불일치 → 403, 일치 → 200', async () => {
    const kv = new MemKV();
    const env = { GUMROAD_SELLER_ID: SELLER, GUMROAD_PING_TOKEN: 'tok-123', SALES: kv };
    expect((await onRequest({ request: ping(sale, '?token=wrong'), env })).status).toBe(403);
    expect((await onRequest({ request: ping(sale), env })).status).toBe(403);
    expect(kv.store.size).toBe(0);
    expect((await onRequest({ request: ping(sale, '?token=tok-123'), env })).status).toBe(200);
    expect(kv.store.size).toBe(1);
  });

  it('환불 ping은 별도 키(sale_id + resource_name), 중복 ping은 같은 키에 덮어씀', async () => {
    const kv = new MemKV();
    const env = { GUMROAD_SELLER_ID: SELLER, SALES: kv };
    await onRequest({ request: ping(sale), env });
    await onRequest({ request: ping(sale), env });
    await onRequest({ request: ping({ ...sale, resource_name: 'refund', refunded: 'true' }), env });
    expect([...kv.store.keys()].sort()).toEqual(['sale:FQ1abc==:refund', 'sale:FQ1abc==:sale']);
  });

  it('설정 누락 → 503 (Gumroad 재시도 대상), GET → 405', async () => {
    expect((await onRequest({ request: ping(sale), env: { SALES: new MemKV() } })).status).toBe(503);
    expect((await onRequest({ request: ping(sale), env: { GUMROAD_SELLER_ID: SELLER } })).status).toBe(503);
    const get = new Request('https://example.pages.dev/api/gumroad-ping');
    expect((await onRequest({ request: get, env: { GUMROAD_SELLER_ID: SELLER, SALES: new MemKV() } })).status).toBe(405);
  });

  it('url_params가 해시 문자열로 와도 UTM 추출', async () => {
    const kv = new MemKV();
    const { 'url_params[utm_source]': _a, 'url_params[utm_medium]': _b, 'url_params[utm_campaign]': _c, ...rest } = sale;
    await onRequest({
      request: ping({ ...rest, url_params: "{'utm_source' => 'clien', 'utm_medium' => 'community'}" }),
      env: { GUMROAD_SELLER_ID: SELLER, SALES: kv },
    });
    const rec = JSON.parse(kv.store.get('sale:FQ1abc==:sale')!);
    expect(rec.utm_source).toBe('clien');
    expect(rec.utm_medium).toBe('community');
    expect(rec.utm_campaign).toBeNull();
  });
});
