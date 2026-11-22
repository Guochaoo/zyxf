import { describe, test, expect } from 'vitest';
import { isDzhzPathBlocked } from '../dzhz.js';

// 盒子域名只认落地页与两个协议页；其余路径整页跳回主站。
// 两个域名共用同一份 dist，这道守卫防止资料库/统计/设置在盒子域名上再开一个入口。
describe('isDzhzPathBlocked', () => {
  test.each(['/', '/legal', '/license', '/legal/', '/license/', '/dzhz', '/dzhz/legal', '/dzhz/license'])(
    '放行 %s',
    (pathname) => {
      expect(isDzhzPathBlocked(pathname)).toBe(false);
    }
  );

  test.each(['/folder/1', '/folder/1/', '/dashboard', '/settings', '/settings/ai', '/about', '/login', '/nope'])(
    '拦截 %s',
    (pathname) => {
      expect(isDzhzPathBlocked(pathname)).toBe(true);
    }
  );
});
