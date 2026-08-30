// 阿里云邮件推送（DirectMail）客户端。参照 llm.js 的外部服务调用模式：
// env 配置 + isMailEnabled() 函数导出（便于测试注入）+ 失败抛结构化错误。
// 三个 DM_* 变量齐全才启用；缺失时注册发码路由返回 503，不影响其他功能。

import RPCClient from '@alicloud/pop-core';
import { envStr } from './env.js';

const DM_ACCESS_KEY_ID = envStr('DM_ACCESS_KEY_ID');
const DM_ACCESS_KEY_SECRET = envStr('DM_ACCESS_KEY_SECRET');
const DM_ACCOUNT_NAME = envStr('DM_ACCOUNT_NAME'); // 发信地址，如 no-reply@zyxf.top
const DM_FROM_ALIAS = envStr('DM_FROM_ALIAS') || '仲英学辅';

export function isMailEnabled() {
  return Boolean(DM_ACCESS_KEY_ID && DM_ACCESS_KEY_SECRET && DM_ACCOUNT_NAME);
}

let client = null;
function getClient() {
  if (!client) {
    client = new RPCClient({
      accessKeyId: DM_ACCESS_KEY_ID,
      accessKeySecret: DM_ACCESS_KEY_SECRET,
      endpoint: 'https://dm.aliyuncs.com',
      apiVersion: '2015-11-23',
    });
  }
  return client;
}

function buildCodeMailHtml(code) {
  return [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',\'PingFang SC\',\'Microsoft YaHei\',sans-serif;max-width:420px;margin:0 auto;padding:32px 24px;color:#171717;">',
    '<h2 style="margin:0 0 16px;font-size:18px;font-weight:600;">仲英学辅资料库</h2>',
    '<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#525252;">你正在注册仲英学辅资料库账号，验证码为：</p>',
    `<div style="font-size:32px;font-weight:600;letter-spacing:8px;padding:16px 0;">${code}</div>`,
    '<p style="margin:0;font-size:12px;color:#a3a3a3;">验证码 10 分钟内有效，请勿泄露给他人。若非本人操作，请忽略本邮件。</p>',
    '</div>',
  ].join('\n');
}

// 发送注册验证码邮件。网络/API 失败抛 err.status=502 的结构化错误，
// 由路由的 serviceError 统一记日志并响应，不向上游泄漏内部细节。
export async function sendVerificationCode(email, code) {
  try {
    await getClient().request(
      'SingleSendMail',
      {
        AccountName: DM_ACCOUNT_NAME,
        FromAlias: DM_FROM_ALIAS,
        AddressType: 1,
        ReplyToAddress: false,
        ToAddress: email,
        Subject: '仲英学辅注册验证码',
        HtmlBody: buildCodeMailHtml(code),
      },
      { timeout: 10000 }
    );
  } catch (e) {
    const err = new Error(`邮件发送失败: ${String(e?.code || e?.message || e).slice(0, 200)}`);
    err.status = 502;
    throw err;
  }
}
