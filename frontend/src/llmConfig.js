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

// 持久化配置：trim 后写入 localStorage。
export const saveLlmCfg = (cfg) => {
  const next = {
    apiKey: cfg.apiKey.trim(),
    baseUrl: cfg.baseUrl.trim(),
    model: cfg.model.trim(),
  };
  storageSet(LLM_KEY, JSON.stringify(next));
  return next;
};

// 清空配置（恢复默认）：移除存储项。
export const clearLlmCfg = () => {
  storageRemove(LLM_KEY);
};
