import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIncidentCreate,
  buildIncidentResolve,
  componentIdFor,
  isStatusPageEnabled,
  statusPageConfig,
} from '../src/statusPage.js';

// 状态页联动：探针 id → 组件 id、事件 payload 的形状。
// 真正的 HTTP 调用在 backend/scripts/status-probe.mjs，靠线上演习验证。
const prevMap = process.env.FLASHDUTY_STATUS_COMPONENTS;

afterEach(() => {
  if (prevMap === undefined) delete process.env.FLASHDUTY_STATUS_COMPONENTS;
  else process.env.FLASHDUTY_STATUS_COMPONENTS = prevMap;
});

describe('statusPage', () => {
  test('没配 App Key / 页面 ID 时视为未启用', () => {
    const prevKey = process.env.FLASHDUTY_APP_KEY;
    const prevPage = process.env.FLASHDUTY_STATUS_PAGE_ID;
    delete process.env.FLASHDUTY_APP_KEY;
    delete process.env.FLASHDUTY_STATUS_PAGE_ID;
    try {
      assert.equal(isStatusPageEnabled(), false);
      assert.equal(statusPageConfig(), null);
    } finally {
      if (prevKey !== undefined) process.env.FLASHDUTY_APP_KEY = prevKey;
      if (prevPage !== undefined) process.env.FLASHDUTY_STATUS_PAGE_ID = prevPage;
    }
  });

  test('5 个探针 id 都有默认组件映射，未知 id 返回 null', () => {
    for (const id of ['site', 'dzhz', 'api', 'download', 'app_update']) {
      assert.match(componentIdFor(id), /^01M81CGK/);
    }
    assert.equal(componentIdFor('nope'), null);
  });

  test('FLASHDUTY_STATUS_COMPONENTS 可以覆盖映射（写坏时回退默认）', () => {
    process.env.FLASHDUTY_STATUS_COMPONENTS = JSON.stringify({ site: 'custom-site-id' });
    assert.equal(componentIdFor('site'), 'custom-site-id');
    assert.match(componentIdFor('api'), /^01M81CGK/);

    process.env.FLASHDUTY_STATUS_COMPONENTS = '{not json';
    assert.match(componentIdFor('site'), /^01M81CGK/);
  });

  test('故障事件：incident + investigating + 组件 full_outage', () => {
    const body = buildIncidentCreate({
      pageId: 123,
      componentId: 'cmp-1',
      name: '资料下载',
      detail: 'HTTP 503',
      nowSec: 1700000000,
    });
    assert.equal(body.page_id, 123);
    assert.equal(body.type, 'incident');
    assert.equal(body.status, 'investigating');
    assert.equal(body.start_at_seconds, 1700000000);
    assert.match(body.title, /资料下载不可用/);
    assert.match(body.updates[0].description, /HTTP 503/);
    assert.deepEqual(body.updates[0].component_changes, [
      { component_id: 'cmp-1', status: 'full_outage' },
    ]);
  });

  test('恢复事件：resolved + 组件回到 operational', () => {
    const body = buildIncidentResolve({
      pageId: 123,
      changeId: 456,
      componentId: 'cmp-1',
      detail: 'HTTP 200',
    });
    assert.equal(body.change_id, 456);
    assert.equal(body.status, 'resolved');
    assert.match(body.description, /已恢复/);
    assert.deepEqual(body.component_changes, [{ component_id: 'cmp-1', status: 'operational' }]);
  });
});
