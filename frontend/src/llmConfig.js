import { storageGet, storageSet, storageRemove } from './ui.js';

// 浏览器侧 LLM 配置（ChatComposer 与 SettingsModal 共用同一份存储）。
export const LLM_KEY = 'zyxf_llm';

// 读取并清洗存储的配置：存储值损坏/非对象/字段非字符串时逐项回退空串，
// 始终返回完整的 { apiKey, baseUrl, model } 结构。
export const loadLlmCfg = () => {
  let raw = null;
  try {
    raw = JSON.parse(storageGet(LLM_KEY) ?? 'null');
  } catch {
    /* 存储值损坏时按未配置处理 */
  }
  if (raw && typeof raw === 'object') {
    return {
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
      model: typeof raw.model === 'string' ? raw.model : '',
    };
  }
  return { apiKey: '', baseUrl: '', model: '' };
};

// ---- 变更广播 ----
// BUG-58：设置弹窗与常驻右栏共用这份存储但各持 state 副本，写入后必须通知，否则聊天
// 仍按「挂载时读到的旧配置」发送。统一在两个写入点广播，消费方用 subscribeLlmCfg 订阅。
const CHANGE_EVENT = 'llm-config-changed';

function notifyChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** 订阅浏览器侧配置变更，返回取消订阅函数（可直接作为 useEffect 的清理函数）。 */
export function subscribeLlmCfg(listener) {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

// 持久化配置：trim 后写入 localStorage。
export const saveLlmCfg = (cfg) => {
  const next = {
    apiKey: cfg.apiKey.trim(),
    baseUrl: cfg.baseUrl.trim(),
    model: cfg.model.trim(),
  };
  storageSet(LLM_KEY, JSON.stringify(next));
  notifyChange();
  return next;
};

// 清空配置（恢复默认）：移除存储项。
export const clearLlmCfg = () => {
  storageRemove(LLM_KEY);
  notifyChange();
};
