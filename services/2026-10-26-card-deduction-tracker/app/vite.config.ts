import { defineConfig, loadEnv, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PLACEHOLDER_SITE = 'https://example.pages.dev';
const LASTMOD = '2026-10-26';

/** sitemap에 들어가는 공개 페이지 (404 제외) */
const PAGES = ['/', '/2027-card-deduction-changes', '/privacy', '/terms', '/refund', '/disclaimer'];

const HTML_INPUTS = {
  index: 'index.html',
  changes: '2027-card-deduction-changes.html',
  privacy: 'privacy.html',
  terms: 'terms.html',
  refund: 'refund.html',
  disclaimer: 'disclaimer.html',
  notfound: '404.html',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sitePlugin(siteUrl: string, contactEmail: string): Plugin {
  const root = __dirname;
  const contactHtml = contactEmail
    ? `<a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>`
    : '<span class="missing-config">문의 메일 설정 전</span>';
  return {
    name: 'card-deduction-site',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        let out = html.replace(/<!--\s*@include\s+([\w-]+)\s*-->/g, (_m, name: string) =>
          readFileSync(resolve(root, 'partials', `${name}.html`), 'utf8'),
        );
        out = out.replaceAll('{{SITE_URL}}', siteUrl).replaceAll('{{CONTACT}}', contactHtml);
        return out;
      },
    },
    generateBundle() {
      const urls = PAGES.map(
        (p) => `  <url><loc>${siteUrl}${p}</loc><lastmod>${LASTMOD}</lastmod></url>`,
      ).join('\n');
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${siteUrl}/sitemap.xml\n`,
      });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, __dirname, ''), ...process.env };
  const siteUrl = (env.SITE_URL || PLACEHOLDER_SITE).replace(/\/+$/, '');
  const contactEmail = env.CONTACT_EMAIL || '';
  const gumroad = env.VITE_GUMROAD_URL || '';

  if (command === 'build') {
    const warn = (m: string) => console.warn(`\n\x1b[33m[card-deduction] 경고: ${m}\x1b[0m`);
    if (siteUrl === PLACEHOLDER_SITE) warn(`SITE_URL 미설정 → canonical/sitemap이 플레이스홀더(${PLACEHOLDER_SITE})입니다. 운영 배포 전 반드시 설정하세요.`);
    if (!gumroad) warn('VITE_GUMROAD_URL 미설정 → 구매 버튼 3곳이 비활성화됩니다.');
    else if (!/^https:\/\/([a-z0-9-]+\.)?gumroad\.com\/l\/[\w-]+/i.test(gumroad)) warn(`VITE_GUMROAD_URL 형식 확인 필요: ${gumroad}`);
    if (!contactEmail) warn('CONTACT_EMAIL 미설정 → 푸터에 "문의 메일 설정 전" 표시.');
    if (!env.VITE_GA4_ID && !env.VITE_CF_BEACON_TOKEN) warn('분석 ID 없음(VITE_GA4_ID / VITE_CF_BEACON_TOKEN) → track()은 no-op.');
  }

  return {
    appType: 'mpa', // SPA 폴백 끔 (Cloudflare Pages처럼 없는 경로는 404)
    plugins: [sitePlugin(siteUrl, contactEmail)],
    define: {
      __SITE_URL__: JSON.stringify(siteUrl),
    },
    build: {
      outDir: 'build',
      emptyOutDir: true,
      rollupOptions: {
        input: Object.fromEntries(Object.entries(HTML_INPUTS).map(([k, v]) => [k, resolve(__dirname, v)])),
      },
    },
  };
});
