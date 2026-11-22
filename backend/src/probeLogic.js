// 状态探针的纯逻辑（不碰网络/文件），便于单测。
//
// 探针本体在 backend/scripts/status-probe.mjs：定时检查几个地址，把**状态变化**推给
// FlashDuty 的「标准告警事件」。这里只负责两件纯函数：
//   1. 根据检查结果拼事件（Critical / Ok）
//   2. 判断心跳是否到期（给「无事件检测」用）

/** 一次检查的结果：ok 表示这次算健康，detail 是给人看的原因（HTTP 状态码/异常名）。 */
export function buildEvent(target, { ok, detail }) {
  const base = {
    alert_key: `zyxf-probe-${target.id}`,
    title_rule: ok ? `仲英学辅 · ${target.name}恢复` : `仲英学辅 · ${target.name}不可用`,
    description: `${target.url} → ${detail}`,
    labels: {
      service: 'zyxf',
      component: target.id,
      url: target.url,
      check: target.method || 'GET',
    },
  };
  return ok ? { ...base, event_status: 'Ok' } : { ...base, event_status: 'Critical' };
}

/**
 * 只在「状态发生变化」时推事件：
 * - 第一次运行（prev 为 undefined）只记录，不推——否则上线瞬间会刷出四条假告警；
 * - 状态没变不推，避免每分钟重复刷同一个告警。
 */
export function shouldPush(prev, ok) {
  return prev !== undefined && prev !== ok;
}

/** 心跳是否到期。minutes <= 0 表示关闭心跳。 */
export function isHeartbeatDue(lastHeartbeatMs, nowMs, minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return false;
  return nowMs - (lastHeartbeatMs || 0) >= minutes * 60 * 1000;
}

/** 心跳事件：让 FlashDuty 的「无事件检测」知道探针还活着。 */
export function buildHeartbeatEvent() {
  return {
    event_status: 'Info',
    alert_key: 'zyxf-probe-heartbeat',
    title_rule: '仲英学辅 · 探针心跳',
    description: '探针存活（用于无事件检测，收到即说明服务器与出网正常）',
    labels: { service: 'zyxf', component: 'probe', check: 'heartbeat' },
  };
}
