// OG 이미지·파비콘 PNG 렌더 (Playwright Chromium 필요, 로컬에서 1회 실행 후 public/ PNG 커밋)
//   SITE_URL=https://<도메인> PRETENDARD_DIR=/path/to/woff2 node scripts/render-images.mjs
// - PRETENDARD_DIR: Pretendard-{Regular,SemiBold,Bold,ExtraBold}.woff2 가 있는 폴더.
//   없으면 시스템 한글 폰트(Noto Sans KR / WenQuanYi Zen Hei 등)로 렌더된다(그 사실을 콘솔에 출력).
// - SITE_URL 미설정(또는 example.pages.dev)이면 OG 우하단 도메인 텍스트를 비운다.
import { createRequire } from 'node:module';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// playwright는 devDependency로 넣지 않는다(브라우저 다운로드 방지). 전역 설치본을 require로 사용(NODE_PATH).
const { chromium } = createRequire(import.meta.url)('playwright');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pub = resolve(root, 'public');
const site = (process.env.SITE_URL || '').replace(/\/+$/, '');
const domain = site && !site.includes('example.pages.dev') ? new URL(site).host : '';
const fontDir = process.env.PRETENDARD_DIR || '';

const weights = { Regular: 400, SemiBold: 600, Bold: 700, ExtraBold: 800 };
let fontCss = '';
let fontNote = '시스템 한글 폰트(Pretendard 없음)';
if (fontDir && Object.keys(weights).every((w) => existsSync(resolve(fontDir, `Pretendard-${w}.woff2`)))) {
  fontCss = Object.entries(weights)
    .map(([w, n]) => {
      const b64 = readFileSync(resolve(fontDir, `Pretendard-${w}.woff2`)).toString('base64');
      return `@font-face{font-family:"Pretendard";font-weight:${n};src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
    })
    .join('\n');
  fontNote = 'Pretendard (PRETENDARD_DIR)';
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const html = (svg, w, h) => `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}
html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}
text{font-family:Pretendard,"Noto Sans KR","WenQuanYi Zen Hei",sans-serif}</style></head><body>${svg}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(svg, w, h, out, transparent = false) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html(svg, w, h), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: w, height: h }, omitBackground: transparent });
  console.log(`${out}  ${(statSync(out).size / 1024).toFixed(1)} KB`);
}

for (const name of ['og', 'og-2027']) {
  const svg = readFileSync(resolve(root, 'assets-src', `${name}.svg`), 'utf8').replace('{{DOMAIN}}', esc(domain));
  await render(svg, 1200, 630, resolve(pub, `${name}.png`));
}
const fav = readFileSync(resolve(pub, 'favicon.svg'), 'utf8');
const sized = (n) => fav.replace('<svg ', `<svg width="${n}" height="${n}" `);
await render(sized(32), 32, 32, resolve(pub, 'favicon-32.png'), true);
// apple-touch-icon: 여백 없이, 투명 모서리 대신 배경색으로 채움(iOS가 자동으로 둥글림)
await render(sized(180).replace('rx="7"', 'rx="0"'), 180, 180, resolve(pub, 'apple-touch-icon.png'));
await browser.close();
console.log(`font: ${fontNote}; domain text: ${domain || '(비움 — SITE_URL 확정 후 재렌더)'}`);
