const REPOSITORY = 'https://github.com/wutop1an/active-etf-research';
const SITE = 'https://wutop1an.github.io/active-etf-research/';
const COUNTER_API = 'https://busuanzi.9420.ltd/api';
const IDENTITY_KEY = 'active-etf-research:counter-identity';
const OPT_OUT_KEY = 'active-etf-research:stats-disabled';
const STAR_CACHE_KEY = 'active-etf-research:github-counts';

export function counterKeys(href) {
  const url = new URL(href);
  const root = new URL(SITE);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) return null;
  const leaf = url.pathname.slice(root.pathname.length);
  if (leaf !== '' && leaf !== 'index.html' && !/^\d{6}\.html$/.test(leaf)) return null;
  return { project: SITE, page: SITE + (leaf || 'index.html') };
}

export function trackingMode({ href, disabled, doNotTrack, globalPrivacyControl }) {
  if (!counterKeys(href)) return 'local';
  if (disabled || doNotTrack === '1' || doNotTrack === 'yes' || globalPrivacyControl) return 'disabled';
  return new URL(href).searchParams.get('stats') === 'read' ? 'read' : 'count';
}

export function parseCounter(payload) {
  const data = payload?.data;
  if (payload?.success !== true || !Number.isSafeInteger(data?.page_pv) ||
      !Number.isSafeInteger(data?.page_uv) || data.page_pv < 0 || data.page_uv < 0) {
    throw new Error('Invalid counter data');
  }
  // The project root is a shared page key. Domain-wide site_* fields are deliberately ignored.
  return { views: data.page_pv, visitors: data.page_uv };
}

export class CounterClient {
  constructor({ fetcher, getIdentity = () => null, setIdentity = () => {}, timeout = 10000 }) {
    this.fetcher = fetcher;
    this.getIdentity = getIdentity;
    this.setIdentity = setIdentity;
    this.timeout = timeout;
    this.counted = false;
    this.controllers = new Set();
  }
  abort() {
    for (const controller of this.controllers) controller.abort();
  }
  async request(key, method) {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), this.timeout);
    const headers = { 'x-bsz-referer': key };
    const identity = this.getIdentity();
    if (identity) headers.Authorization = `Bearer ${identity}`;
    try {
      const response = await this.fetcher(COUNTER_API, {
        method, headers, signal: controller.signal, credentials: 'omit',
        cache: 'no-store', referrerPolicy: 'no-referrer'
      });
      if (!response.ok) throw new Error('Counter unavailable');
      const data = parseCounter(await response.json());
      const nextIdentity = response.headers.get('Set-Bsz-Identity');
      if (nextIdentity) this.setIdentity(nextIdentity);
      return data;
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }
  async read(keys) {
    return Promise.allSettled([this.request(keys.project, 'GET'), this.request(keys.page, 'GET')]);
  }
  async countOnce(keys) {
    if (this.counted) return this.read(keys);
    // Never retry a POST: a failed response may still have been counted by the service.
    this.counted = true;
    return Promise.allSettled([this.request(keys.project, 'POST'), this.request(keys.page, 'POST')]);
  }
}

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Browsing still works without storage. */ }
}

async function loadGitHubCounts() {
  const render = (data) => {
    if (!Number.isSafeInteger(data.stargazers_count) || data.stargazers_count < 0) return;
    document.querySelectorAll('[data-star-count]').forEach(node => {
      node.textContent = data.stargazers_count.toLocaleString('zh-CN');
      node.hidden = false;
    });
  };
  try {
    const cached = JSON.parse(storageGet(STAR_CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.saved < 600000) { render(cached.data); return; }
  } catch { /* A damaged cache must not prevent a fresh read. */ }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('https://api.github.com/repos/wutop1an/active-etf-research', {
      credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal
    });
    if (!response.ok) return;
    const data = await response.json();
    render(data);
    if (Number.isSafeInteger(data.stargazers_count)) {
      storageSet(STAR_CACHE_KEY, JSON.stringify({saved:Date.now(), data:{stargazers_count:data.stargazers_count}}));
    }
  } catch { /* Keep the working Star link; do not invent a zero count. */ }
  finally { clearTimeout(timer); }
}

function setupCommunity() {
  document.querySelectorAll('[data-feedback]').forEach(link => {
    const page = counterKeys(location.href)?.page || SITE;
    const params = new URLSearchParams({
      template:'feedback.md', title:`[反馈] ${document.title.split(' · ')[0]}`,
      body:`对应页面：${page}\n\n问题或建议：\n\n\n如果涉及数据更正，请附公开来源和日期：\n`
    });
    link.href = `${REPOSITORY}/issues/new?${params}`;
  });
  loadGitHubCounts();

  const footer = document.querySelector('#traffic-stats');
  if (!footer) return;
  const status = footer.querySelector('[data-stats-status]');
  const toggle = footer.querySelector('[data-stats-toggle]');
  const refresh = footer.querySelector('[data-stats-refresh]');
  const projectViews = footer.querySelector('[data-project-views]');
  const projectVisitors = footer.querySelector('[data-project-visitors]');
  const pageViews = footer.querySelector('[data-page-views]');
  const keys = counterKeys(location.href);
  let optedOut = storageGet(OPT_OUT_KEY) === '1';
  let identity = storageGet(IDENTITY_KEY);
  let version = 0;
  let busy = false;
  let pendingRead = false;
  const client = new CounterClient({
    fetcher: (...args) => fetch(...args),
    getIdentity: () => identity,
    setIdentity: value => { identity = value; storageSet(IDENTITY_KEY, value); }
  });
  const mode = () => trackingMode({href:location.href, disabled:optedOut,
    doNotTrack:navigator.doNotTrack, globalPrivacyControl:navigator.globalPrivacyControl});
  const format = value => value.toLocaleString('zh-CN');
  const clear = () => { [projectViews, projectVisitors, pageViews].forEach(node => {node.textContent='—';}); };
  function controls() {
    const state = mode();
    toggle.textContent = optedOut ? '开启访问统计' : '关闭访问统计';
    toggle.setAttribute('aria-pressed', String(!optedOut && state !== 'disabled'));
    toggle.hidden = state === 'local';
    const privacySignal = navigator.doNotTrack === '1' || navigator.doNotTrack === 'yes' || navigator.globalPrivacyControl;
    toggle.disabled = Boolean(privacySignal);
    refresh.hidden = state === 'disabled' || state === 'local';
    refresh.disabled = busy;
    if (state === 'local') status.textContent = '本地预览不计数。';
    if (state === 'disabled') status.textContent = privacySignal ? '已遵从浏览器隐私设置，访问统计已关闭。' : '本浏览器已关闭访问统计。';
  }
  async function update(increment) {
    const currentMode = mode();
    controls();
    if (busy || !keys || currentMode === 'local' || currentMode === 'disabled') return;
    busy = true;
    controls();
    const currentVersion = version;
    status.textContent = '正在读取访问统计…';
    try {
      const results = increment && currentMode === 'count' ? await client.countOnce(keys) : await client.read(keys);
      if (currentVersion !== version) return;
      const [project, page] = results;
      projectViews.textContent = project.status === 'fulfilled' ? format(project.value.views) : '暂不可用';
      projectVisitors.textContent = project.status === 'fulfilled' ? format(project.value.visitors) : '暂不可用';
      pageViews.textContent = page.status === 'fulfilled' ? format(page.value.views) : '暂不可用';
      const failed = results.some(result => result.status === 'rejected');
      status.textContent = failed ? '部分统计暂不可用；可以刷新读数，阅读不受影响。' :
        currentMode === 'read' ? '验收模式：只读取统计，本次不计数。' : '从2026-10-21启用时累计 · 切换页面或重新加载会增加浏览次数。';
    } finally {
      busy = false;
      controls();
      if (pendingRead) {
        pendingRead = false;
        update(false);
      }
    }
  }
  refresh.addEventListener('click', () => update(false));
  toggle.addEventListener('click', () => {
    optedOut = !optedOut;
    storageSet(OPT_OUT_KEY, optedOut ? '1' : '0');
    version++;
    client.abort();
    pendingRead = false;
    clear();
    controls();
    if (!optedOut) {
      // Re-enabling only reads the totals; it does not create a second view for this page.
      if (busy) pendingRead = true;
      else update(false);
    }
  });
  controls();
  if (document.visibilityState === 'visible') update(true);
  else {
    const visible = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', visible);
      update(true);
    };
    document.addEventListener('visibilitychange', visible);
  }
}

if (typeof document !== 'undefined') setupCommunity();
