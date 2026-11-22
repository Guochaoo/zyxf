import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEvent,
  buildHeartbeatEvent,
  isHeartbeatDue,
  shouldPush,
} from '../src/probeLogic.js';

// 探针的纯逻辑：事件怎么拼、什么时候才该推。
// 线上行为（HTTP 检查 + 推送）在 backend/scripts/status-probe.mjs。
const target = {
  id: 'download',
  name: '文件下载',
  url: 'https://oss.zyxf.top/zyxf/ACM/DP.pptx',
  method: 'HEAD',
};

describe('probeLogic', () => {
  test('失败事件是 Critical，带组件标签与检查地址', () => {
    const e = buildEvent(target, { ok: false, detail: 'HTTP 503' });
    assert.equal(e.event_status, 'Critical');
    assert.equal(e.alert_key, 'zyxf-probe-download');
    assert.match(e.title_rule, /文件下载不可用/);
    assert.match(e.description, /HTTP 503/);
    assert.deepEqual(e.labels, {
      service: 'zyxf',
      component: 'download',
      url: target.url,
      check: 'HEAD',
    });
  });

  test('恢复事件是 Ok，alert_key 与失败事件一致（靠它合并）', () => {
    const down = buildEvent(target, { ok: false, detail: 'timeout' });
    const up = buildEvent(target, { ok: true, detail: 'HTTP 200' });
    assert.equal(up.event_status, 'Ok');
    assert.equal(up.alert_key, down.alert_key);
    assert.match(up.title_rule, /恢复/);
  });

  test('只在状态变化时推送；首次记录不推', () => {
    assert.equal(shouldPush(undefined, false), false); // 首次运行，别刷四条假告警
    assert.equal(shouldPush(undefined, true), false);
    assert.equal(shouldPush(true, true), false); // 一直健康
    assert.equal(shouldPush(false, false), false); // 一直故障，不重复刷
    assert.equal(shouldPush(true, false), true); // 变故障
    assert.equal(shouldPush(false, true), true); // 恢复
  });

  test('心跳：关闭时永不触发，到期才触发', () => {
    const now = 1_800_000_000_000;
    assert.equal(isHeartbeatDue(now - 3600_000, now, 0), false);
    assert.equal(isHeartbeatDue(now - 60_000, now, 5), false);
    assert.equal(isHeartbeatDue(now - 5 * 60_000, now, 5), true);
    assert.equal(isHeartbeatDue(undefined, now, 5), true); // 第一次跑就要有心跳
  });

  test('心跳事件是 Info，且用固定 alert_key', () => {
    const e = buildHeartbeatEvent();
    assert.equal(e.event_status, 'Info');
    assert.equal(e.alert_key, 'zyxf-probe-heartbeat');
    assert.equal(e.labels.component, 'probe');
  });
});
