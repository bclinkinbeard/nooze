const STORAGE_KEY = 'nooze.v1';

const SOURCES = [
  {
    id: 'simon',
    label: 'Simon Willison',
    siteUrl: 'https://simonwillison.net/',
    feeds: ['https://simonwillison.net/atom/everything/'],
  },
  {
    id: 'steipete',
    label: '@steipete',
    siteUrl: 'https://x.com/steipete',
    feeds: [
      'https://nitter.net/steipete/rss',
      'https://nitter.poast.org/steipete/rss',
      'https://nitter.privacydev.net/steipete/rss',
    ],
  },
  {
    id: 'karpathy',
    label: '@karpathy',
    siteUrl: 'https://x.com/karpathy',
    feeds: [
      'https://nitter.net/karpathy/rss',
      'https://nitter.poast.org/karpathy/rss',
      'https://nitter.privacydev.net/karpathy/rss',
    ],
  },
];

const state = {
  items: [],
  selected: new Set(SOURCES.map((source) => source.id)),
  daysBack: 30,
  lastSyncAt: null,
};

const sourceControls = document.querySelector('#source-controls');
const feedEl = document.querySelector('#feed');
const refreshBtn = document.querySelector('#refresh-btn');
const daysBackInput = document.querySelector('#days-back');
const statusEl = document.querySelector('#status');
const lastSyncEl = document.querySelector('#last-sync');
const itemTemplate = document.querySelector('#feed-item-template');

init();

async function init() {
  restoreState();
  buildSourceControls();
  renderFeed();
  updateLastSyncLabel();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  refreshBtn.addEventListener('click', () => refreshContent(true));
  daysBackInput.addEventListener('change', () => {
    state.daysBack = normalizeDaysBack(daysBackInput.value);
    persistState();
    renderFeed();
  });

  refreshContent(false);
}

function buildSourceControls() {
  sourceControls.replaceChildren();
  for (const source of SOURCES) {
    const wrapper = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.selected.has(source.id);
    cb.addEventListener('change', () => {
      if (cb.checked) {
        state.selected.add(source.id);
      } else {
        state.selected.delete(source.id);
      }
      persistState();
      renderFeed();
    });
    wrapper.append(cb, document.createTextNode(` ${source.label}`));
    sourceControls.append(wrapper);
  }
}

async function refreshContent(isManual) {
  setStatus(isManual ? 'Refreshing…' : 'Checking for fresh content…');
  const fetched = [];

  for (const source of SOURCES) {
    const items = await fetchSourceItems(source);
    fetched.push(...items);
  }

  if (fetched.length) {
    state.items = mergeItems(state.items, fetched);
    state.lastSyncAt = new Date().toISOString();
    persistState();
    renderFeed();
    updateLastSyncLabel();
    setStatus(`Loaded ${fetched.length} new/updated items.`);
  } else {
    setStatus('No new items found (or feeds unavailable). Showing cached content.');
  }
}

async function fetchSourceItems(source) {
  for (const feedUrl of source.feeds) {
    for (const url of buildFetchCandidates(feedUrl)) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const xml = await res.text();
        const parsed = parseFeed(xml, source);
        if (parsed.length) return parsed;
      } catch {
        // best effort
      }
    }
  }
  return [];
}

function buildFetchCandidates(feedUrl) {
  const encoded = encodeURIComponent(feedUrl);
  return [
    feedUrl,
    `https://api.allorigins.win/raw?url=${encoded}`,
    `https://r.jina.ai/http://${feedUrl.replace(/^https?:\/\//, '')}`,
  ];
}

function parseFeed(xml, source) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) return [];

  const entries = [...doc.querySelectorAll('entry')];
  const items = [...doc.querySelectorAll('item')];
  const nodes = entries.length ? entries : items;

  return nodes
    .map((node) => {
      const title = getNodeText(node, ['title']) || '(Untitled)';
      const publishedText =
        getNodeText(node, ['published', 'updated', 'pubDate', 'dc\\:date']) ||
        new Date().toISOString();
      const link =
        node.querySelector('link[rel="alternate"]')?.getAttribute('href') ||
        node.querySelector('link')?.getAttribute('href') ||
        getNodeText(node, ['link']) ||
        source.siteUrl;
      const contentRaw =
        getNodeText(node, ['content', 'content\\:encoded', 'description', 'summary']) ||
        '';

      return {
        id: `${source.id}:${link}`,
        sourceId: source.id,
        sourceLabel: source.label,
        title: stripHtml(title),
        link,
        publishedAt: parseDate(publishedText),
        content: stripHtml(contentRaw).slice(0, 2800),
      };
    })
    .filter((item) => item.link);
}

function getNodeText(node, selectors) {
  for (const selector of selectors) {
    const el = node.querySelector(selector);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return '';
}

function parseDate(value) {
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? new Date().toISOString() : new Date(ts).toISOString();
}

function stripHtml(input) {
  const temp = document.createElement('div');
  temp.innerHTML = input;
  return (temp.textContent || '').replace(/\s+/g, ' ').trim();
}

function mergeItems(existing, incoming) {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }

  return [...byId.values()].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
}

function renderFeed() {
  const cutoff = Date.now() - state.daysBack * 24 * 60 * 60 * 1000;
  const visible = state.items.filter((item) => {
    if (!state.selected.has(item.sourceId)) return false;
    return Date.parse(item.publishedAt) >= cutoff;
  });

  feedEl.replaceChildren();

  if (!visible.length) {
    const empty = document.createElement('li');
    empty.className = 'feed-item';
    empty.textContent = 'No items match your current filters yet.';
    feedEl.append(empty);
    return;
  }

  for (const item of visible) {
    const fragment = itemTemplate.content.cloneNode(true);
    const link = fragment.querySelector('a');
    const meta = fragment.querySelector('.meta');
    const content = fragment.querySelector('.content');

    link.textContent = item.title;
    link.href = item.link;
    meta.textContent = `${item.sourceLabel} • ${new Date(item.publishedAt).toLocaleString()}`;
    content.textContent = item.content || 'No in-app preview text available.';

    feedEl.append(fragment);
  }
}

function normalizeDaysBack(value) {
  const number = Number.parseInt(String(value), 10);
  return Number.isFinite(number) ? Math.max(1, Math.min(365, number)) : 30;
}

function restoreState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.items)) state.items = parsed.items;
    if (Array.isArray(parsed.selected)) state.selected = new Set(parsed.selected);
    state.daysBack = normalizeDaysBack(parsed.daysBack ?? 30);
    state.lastSyncAt = parsed.lastSyncAt || null;
  } catch {
    // ignore invalid cache
  }

  daysBackInput.value = String(state.daysBack);
}

function persistState() {
  const payload = {
    items: state.items,
    selected: [...state.selected],
    daysBack: state.daysBack,
    lastSyncAt: state.lastSyncAt,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function updateLastSyncLabel() {
  lastSyncEl.textContent = state.lastSyncAt
    ? `Last sync: ${new Date(state.lastSyncAt).toLocaleString()}`
    : 'Last sync: never';
}

function setStatus(message) {
  statusEl.textContent = message;
}
