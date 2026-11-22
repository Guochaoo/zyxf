#!/usr/bin/env node
// 状态探针：定期检查「网站 / 接口 / 下载 / 岱宗盒子」，状态变化时推 FlashDuty。
//
// 由 systemd timer 每分钟跑一次（deploy/zyxf-probe.timer），单次执行完就退出：
//   - 只在**状态变化**时推事件（Critical / Ok），不重复刷告警；
//   - 每隔 PROBE_HEARTBEAT_MINUTES 分钟推一条心跳，配合 FlashDuty 的「无事件检测」，
//     服务器整个挂掉（探针也不跑了）时能由「长时间没有事件」触发告警。
//
// 为什么探针放在服务器上：它要同时覆盖「接口 500」「OSS 下载挂了」这类源站问题；
// 而「服务器整机挂了」这种探针自己也停的情况，交给 FlashDuty 的无事件检测兜底。
//
// 配置（写在 /opt/zyxf/.env）：
//   FLASHDUTY_INTEGRATION_KEY   必填，没有就静默跳过（本地开发不推）
//   PROBE_DOWNLOAD_URL          可选，下载探针用的文件地址
//   PROBE_HEARTBEAT_MINUTES     可选，默认 5；设 0 关闭心跳
//   PROBE_TIMEOUT_MS            可选，默认 8000

import fs from 'node:fs';
import path from 'node:path';
import { envStr } from '../src/env.js';
import { buildEvent, buildHeartbeatEvent, isHeartbeatDue, shouldPush } from '../src/probeLogic.js';

const INTEGRATION_KEY = envStr('FLASHDUTY_INTEGRATION_KEY');
const PUSH_URL = 'https://api.flashcat.cloud/event/push/alert/standard';
const TIMEOUT_MS = Number(envStr('PROBE_TIMEOUT_MS') || 8000);
const HEARTBEAT_MINUTES = Number(envStr('PROBE_HEARTBEAT_MINUTES') || 5);
const STATE_FILE =
  envStr('PROBE_STATE_FILE') || path.join(process.cwd(), '.probe-state.json');

const TARGETS = [
  {
    id: 'site',
    name: '资料库网站',
    url: 'https://zyxf.top/',
    method: 'HEAD',
  },
  {
    id: 'api',
    name: '资料库接口',
    url: 'https://zyxf.top/api/health',
    method: 'GET',
    bodyIncludes: '"ok":true',
  },
  {
    id: 'download',
    name: '文件下载',
    url:
      envStr('PROBE_DOWNLOAD_URL') ||
      'https://oss.zyxf.top/zyxf/ACM/DP.pptx',
    method: 'HEAD',
  },
  {
    id: 'dzhz',
    name: '岱宗盒子',
    url: 'https://dzhz.zyxf.top/',
    method: 'HEAD',
  },
];

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

async function check(target) {
  try {
    const res = await fetch(target.url, {
      method: target.method || 'GET',
      // 别让探针自己跟 301：HEAD 拿到 3xx 说明链路是通的，但我们的目标都是 200。
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'zyxf-status-probe/1' },
    });
    let ok = res.ok;
    let detail = `HTTP ${res.status}`;
    if (ok && target.bodyIncludes) {
      const body = await res.text();
      if (!body.includes(target.bodyIncludes)) {
        ok = false;
        detail = `HTTP ${res.status}，正文缺少 ${target.bodyIncludes}`;
      }
    }
    return { ok, detail };
  } catch (e) {
    const detail = e?.name === 'TimeoutError' ? `超时（>${TIMEOUT_MS}ms）` : e?.message || String(e);
    return { ok: false, detail };
  }
}

async function push(event) {
  const res = await fetch(`${PUSH_URL}?integration_key=${encodeURIComponent(INTEGRATION_KEY)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
  return text;
}

async function main() {
  if (!INTEGRATION_KEY) {
    console.log('[probe] 未配置 FLASHDUTY_INTEGRATION_KEY，跳过');
    return;
  }

  const state = loadState();
  const targetsState = state.targets || {};
  let changed = false;

  for (const target of TARGETS) {
    const result = await check(target);
    const prev = targetsState[target.id]?.ok;
    const prevDetail = targetsState[target.id]?.detail;

    // 状态没变：只刷新 detail，方便排障，不推事件。
    if (prev === result.ok) {
      targetsState[target.id] = { ok: result.ok, detail: result.detail, at: Date.now() };
      continue;
    }

    const isFirstRun = prev === undefined;
    targetsState[target.id] = { ok: result.ok, detail: result.detail, at: Date.now() };
    changed = changed || !isFirstRun;

    if (!shouldPush(prev, result.ok)) {
      console.log(`[probe] 首次记录 ${target.id}=${result.ok ? 'ok' : 'down'}（${result.detail}），不推事件`);
      continue;
    }

    const event = buildEvent(target, result);
    try {
      await push(event);
      console.log(`[probe] 推送 ${event.event_status} ${target.id}：${result.detail}`);
    } catch (e) {
      console.error(`[probe] 推送失败 ${target.id}: ${e.message}`);
    }
  }

  if (isHeartbeatDue(state.lastHeartbeat, Date.now(), HEARTBEAT_MINUTES)) {
    try {
      await push(buildHeartbeatEvent());
      state.lastHeartbeat = Date.now();
      changed = true;
      console.log('[probe] 心跳已推送');
    } catch (e) {
      console.error(`[probe] 心跳推送失败: ${e.message}`);
    }
  }

  state.targets = targetsState;
  if (changed || !fs.existsSync(STATE_FILE)) saveState(state);
}

main().catch((e) => {
  // 探针自身出错不要变成「服务 failed」：写日志，退出码仍然 0。
  console.error('[probe] 未捕获异常:', e?.message || e);
});
