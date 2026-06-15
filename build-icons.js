'use strict';

// 生成自定义图标字体 icons/claude-usage.woff，仅含 Claude 官方 logo 字形（码位 E001）。
// 用法：node build-icons.js   （可用 qlmanage 把 icons/claude-logo.svg 渲染成 PNG 自查）

const fs = require('fs');
const path = require('path');
const { SVGIcons2SVGFontStream } = require('svgicons2svgfont');
const svg2ttf = require('svg2ttf');
const ttf2woff = require('ttf2woff');

// 官方 Claude logo（单条闭合轮廓，viewBox 0 0 100 100）
const CLAUDE_PATH =
  'm19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z';

const GLYPHS = [{ name: 'claude-logo', unicode: String.fromCodePoint(0xe001), d: CLAUDE_PATH, vb: 100 }];

const iconsDir = path.join(__dirname, 'icons');
fs.mkdirSync(iconsDir, { recursive: true });
for (const g of GLYPHS) {
  fs.writeFileSync(
    path.join(iconsDir, `${g.name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.vb} ${g.vb}"><path d="${g.d}"/></svg>\n`
  );
}

function buildFont() {
  return new Promise((resolve, reject) => {
    const stream = new SVGIcons2SVGFontStream({
      fontName: 'claude-usage',
      fontHeight: 1000,
      normalize: true,
      centerHorizontally: true,
      descent: 120,
      log: () => {},
    });
    let svgFont = '';
    stream.on('data', (c) => (svgFont += c));
    stream.on('end', () => resolve(svgFont));
    stream.on('error', reject);
    for (const g of GLYPHS) {
      const file = fs.createReadStream(path.join(iconsDir, `${g.name}.svg`));
      file.metadata = { unicode: [g.unicode], name: g.name };
      stream.write(file);
    }
    stream.end();
  });
}

(async () => {
  const svgFont = await buildFont();
  const ttf = svg2ttf(svgFont, { description: 'Claude usage icons' });
  const woff = ttf2woff(new Uint8Array(ttf.buffer));
  fs.writeFileSync(path.join(iconsDir, 'claude-usage.woff'), Buffer.from(woff.buffer));
  console.log('built icons/claude-usage.woff');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
