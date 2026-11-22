import { envStr } from './env.js';

/**
 * FlashDuty 状态页：把探针发现的故障同步成「状态页事件」，让组件变红 / 恢复变绿。
 *
 * 为什么需要这个：FlashDuty 的状态页组件**没有**「自动关联告警」的字段（组件只有
 * name/description/section/order/hide_*，路由只能选频道）。组件状态只能由状态页事件
 * 驱动，所以这里直接调它的 API。集成 key 只能推告警，写状态页必须用 App Key。
 *
 * 权限：App Key 只需勾「状态页」写权限。配置见 docs/DEPLOY.md §4.2.8。
 */
const API_BASE = 'https://api.flashcat.cloud';

// 探针 id → 状态页组件 id（来自 GET /status-page/info）。
// 换页面/组件时改这里，或用 FLASHDUTY_STATUS_COMPONENTS 传 JSON 覆盖：
//   {"site":"01...","api":"01..."}
const DEFAULT_COMPONENTS = {
  site: '01M81CGK3EH63ZT2AJZRBCWXZ7',
  dzhz: '01M81CGK3EX561VCX88JDE7AE1',
  api: '01M81CGK3EXSFE2AABXX83XH3X',
  download: '01M81CGK3EJEJ92ST1REVMMZ2Z',
  app_update: '01M81CGK3EC2T6H2M5WMZV5BV0',
};

export function statusPageConfig() {
  const appKey = envStr('FLASHDUTY_APP_KEY');
  const pageId = Number(envStr('FLASHDUTY_STATUS_PAGE_ID'));
  if (!appKey || !Number.isFinite(pageId) || pageId <= 0) return null;
  return { appKey, pageId };
}

export function isStatusPageEnabled() {
  return statusPageConfig() !== null;
}

/** 探针 id 对应的组件 id；没有映射返回 null（该目标就不联动状态页）。 */
export function componentIdFor(targetId) {
  const override = envStr('FLASHDUTY_STATUS_COMPONENTS');
  if (override) {
    try {
      const parsed = JSON.parse(override);
      if (parsed && typeof parsed === 'object' && parsed[targetId]) return String(parsed[targetId]);
    } catch {
      // 覆盖值写错就当没有，走默认映射（别让一次配置失误拖垮探针）。
    }
  }
  return DEFAULT_COMPONENTS[targetId] || null;
}

/** 新建故障事件：组件置为 full_outage。 */
export function buildIncidentCreate({ pageId, componentId, name, detail, nowSec }) {
  return {
    page_id: pageId,
    type: 'incident',
    title: `仲英学辅 · ${name}不可用`,
    // 顶层 description 是必填的（只放在 updates[].description 里会 400）。
    description: `自动检测到异常：${detail}`,
    status: 'investigating',
    start_at_seconds: nowSec,
    updates: [
      {
        status: 'investigating',
        description: `自动检测到异常：${detail}`,
        component_changes: [{ component_id: componentId, status: 'full_outage' }],
      },
    ],
  };
}

/** 追加一条「已恢复」时间线：组件回到 operational，事件关闭。 */
export function buildIncidentResolve({ pageId, changeId, componentId, detail }) {
  return {
    page_id: pageId,
    change_id: changeId,
    status: 'resolved',
    description: `已恢复：${detail}`,
    component_changes: [{ component_id: componentId, status: 'operational' }],
  };
}

async function postJson(path, body) {
  const cfg = statusPageConfig();
  if (!cfg) throw new Error('状态页未配置（FLASHDUTY_APP_KEY / FLASHDUTY_STATUS_PAGE_ID）');
  const res = await fetch(`${API_BASE}${path}?app_key=${encodeURIComponent(cfg.appKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Fd-App-Key': cfg.appKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** 发布故障事件，返回 change_id（后续恢复要用）。 */
export async function createIncident(args) {
  const data = await postJson('/status-page/change/create', buildIncidentCreate(args));
  return data?.change_id ?? data?.data?.change_id ?? null;
}

/** 关闭故障事件：组件恢复 + 事件 resolved。 */
export async function resolveIncident(args) {
  return postJson('/status-page/change/timeline/create', buildIncidentResolve(args));
}
