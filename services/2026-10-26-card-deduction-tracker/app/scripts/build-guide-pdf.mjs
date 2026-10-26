// sheet/guide.md → sheet/out/guide.pdf (A4 세로, Playwright Chromium)
//   COPY_URL=https://docs.google.com/spreadsheets/d/<ID>/copy SITE_URL=https://<도메인> CONTACT_EMAIL=<메일> \
//   [PRETENDARD_DIR=/path/to/woff2] node scripts/build-guide-pdf.mjs
// 값이 비어 있으면 경고 후 <...> 자리표시로 생성(판매용 PDF는 반드시 3개 모두 넣고 생성).
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vars = {
  COPY_URL: process.env.COPY_URL || '',
  SITE_URL: (process.env.SITE_URL || '').replace(/\/+$/, ''),
  CONTACT_EMAIL: process.env.CONTACT_EMAIL || '',
};
for (const [k, v] of Object.entries(vars)) if (!v) console.warn(`경고: ${k} 미설정 → [${k} 미설정] 자리표시로 생성됩니다(판매용 아님).`);
if (vars.COPY_URL && !/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+\/copy$/.test(vars.COPY_URL)) console.warn('경고: COPY_URL이 .../spreadsheets/d/<ID>/copy 형식이 아닙니다.');

let md = readFileSync(resolve(root, 'sheet/guide.md'), 'utf8');
for (const [k, v] of Object.entries(vars)) md = md.replaceAll(`{{${k}}}`, v || `[${k} 미설정]`);

const fontDir = process.env.PRETENDARD_DIR || '';
const fontCss = fontDir && existsSync(resolve(fontDir, 'Pretendard-Regular.woff2'))
  ? ['Regular:400', 'SemiBold:600', 'Bold:700', 'ExtraBold:800'].map((x) => {
      const [w, n] = x.split(':');
      return `@font-face{font-family:Pretendard;font-weight:${n};src:url(data:font/woff2;base64,${readFileSync(resolve(fontDir, `Pretendard-${w}.woff2`)).toString('base64')})}`;
    }).join('')
  : '';

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${fontCss}
@page{size:A4;margin:18mm 16mm}
body{font-family:Pretendard,"Noto Sans KR","WenQuanYi Zen Hei",sans-serif;color:#1A1F1D;font-size:10.5pt;line-height:1.6;word-break:keep-all}
h1{font-size:18pt;margin:0 0 8pt;color:#0B6E4F}h2{font-size:13pt;margin:16pt 0 6pt;color:#1F3A33}h3{font-size:11pt;margin:12pt 0 4pt}
.banner{background:#FFF4E0;color:#7A4100;font-weight:700;padding:8pt 10pt;border-radius:6pt}
.cta{text-align:center;margin:18pt 0 6pt}.cta a{display:inline-block;background:#0B6E4F;color:#fff;text-decoration:none;font-weight:800;font-size:15pt;padding:12pt 28pt;border-radius:10pt}
.url{text-align:center;font-size:8.5pt;color:#56615C;word-break:break-all}
.scenario{background:#FDE8E8;color:#9B1C1C;font-weight:700;padding:6pt 10pt;border-radius:6pt;display:inline-block}
table{border-collapse:collapse;width:100%;font-size:9pt}th,td{border:1px solid #D9E0DD;padding:4pt 6pt;text-align:left;vertical-align:top}th{background:#1F3A33;color:#fff}
.page-break{page-break-after:always}
</style></head><body>${marked.parse(md)}</body></html>`;

mkdirSync(resolve(root, 'sheet/out'), { recursive: true });
const out = resolve(root, 'sheet/out/guide.pdf');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log(out);
