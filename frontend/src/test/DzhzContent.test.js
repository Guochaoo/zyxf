import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dzhzHtml from '../pages/Dzhz/content.html?raw';

/* ============================================================
 * 岱宗盒子落地页的复刻残留守卫：
 *   1. 移动端菜单不能再出现原站专属入口（开发者文档 / 社区插件 / Cordis 论文）；
 *   2. public/dzhz 下的每个静态资源都必须在页面的 HTML/CSS/JS 里被引用，
 *      防止再出现 file-types 那种「加了但没人用」的原站图标。
 * ============================================================ */

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, '../..');

describe('岱宗盒子落地页 · 复刻残留', () => {
  test('移动端菜单不再有原站专属入口', () => {
    for (const token of [
      'deepseek-harness.github.io',
      'github.com/topics/dsh-plugin',
      'arxiv.org/abs/2608.25512',
      '>开发者文档</a>',
      '>社区插件</a>',
      '>Cordis 论文</a>',
      'ds-locale-toggle',
    ]) {
      expect(dzhzHtml).not.toContain(token);
    }
  });

  test('public/dzhz 下所有资源都被页面引用', () => {
    const sources = [
      'src/pages/Dzhz/content.html',
      'src/pages/Dzhz/base.css',
      'src/pages/Dzhz/dzhz.css',
      'src/pages/DzhzPage.jsx',
      'src/pages/Dzhz/DocPageShell.jsx',
      'src/pages/DzhzLegalPage.jsx',
      'src/pages/DzhzLicensePage.jsx',
    ]
      .map((rel) => fs.readFileSync(path.join(frontendRoot, rel), 'utf8'))
      .join('\n');

    const assets = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const target = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(target);
        else assets.push(target);
      }
    };
    walk(path.join(frontendRoot, 'public/dzhz'));

    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      const publicPath = `/${path
        .relative(path.join(frontendRoot, 'public'), asset)
        .split(path.sep)
        .join('/')}`;
      expect(sources, publicPath).toContain(publicPath);
    }
  });
});
