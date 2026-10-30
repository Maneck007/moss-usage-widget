'use strict';
// 隐藏用量页的捕获 preload：在页面脚本运行前钩住 fetch/XHR，
// 把 claude.ai API 中与用量相关的响应原文记录到 window.__mossCaps。
// 仅在本工具创建的隐藏窗口中加载（contextIsolation 关闭，直接钩主世界）。
try {
  const caps = [];
  window.__mossCaps = caps;
  const MATCH = /\/api\/.*(usage|rate.?limit|quota)/i;

  const of = window.fetch;
  if (of) {
    window.fetch = async function (...args) {
      const res = await of.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || String(args[0]);
        if (MATCH.test(url)) {
          res.clone().text().then(t => {
            caps.push({ url, body: String(t).slice(0, 60000) });
          }).catch(() => { });
        }
      } catch { }
      return res;
    };
  }

  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) {
    this.__mossUrl = u;
    return XO.call(this, m, u, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...a) {
    this.addEventListener('load', () => {
      try {
        const url = String(this.__mossUrl || '');
        if (MATCH.test(url)) {
          caps.push({ url, body: String(this.responseText || '').slice(0, 60000) });
        }
      } catch { }
    });
    return XS.apply(this, a);
  };
} catch (e) {
  try { window.__mossPreloadErr = String(e); } catch { }
}
