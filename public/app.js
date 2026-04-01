/* global fetch, document */
'use strict';

const PAGE_SIZE = 20;
let currentPage = 1;
let totalLeads  = 0;
let currentId   = null;

// ── Stats ─────────────────────────────────────────────────────────────────────

async function loadStats() {
  try {
    const stats = await fetchJSON('/api/stats');
    document.getElementById('statTotal').textContent = stats.totalLeads ?? 0;
    document.getElementById('statHigh').textContent  = stats.highUrgency ?? 0;
    document.getElementById('statAvg').textContent   = (stats.avgScore ?? 0).toFixed(1);
    renderMiniBar('barSource', stats.bySource ?? {});
    renderMiniBar('barPain',   stats.byPainCategory ?? {});
  } catch {
    // stats optional
  }
}

function renderMiniBar(containerId, data) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const max = Math.max(...Object.values(data), 1);
  container.innerHTML = Object.entries(data)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([key, cnt]) => `
      <div class="bar-row">
        <span class="key" title="${key}">${key}</span>
        <span class="track"><span class="fill" style="width:${Math.round((cnt / max) * 100)}%"></span></span>
        <span class="count">${cnt}</span>
      </div>`)
    .join('');
}

// ── Leads ─────────────────────────────────────────────────────────────────────

function buildQuery(page) {
  const p = new URLSearchParams();
  const source   = document.getElementById('filterSource').value;
  const urgency  = document.getElementById('filterUrgency').value;
  const minScore = document.getElementById('filterMinScore').value;
  const unreplied = document.getElementById('filterUnreplied').checked;

  if (source)    p.set('source',   source);
  if (urgency)   p.set('urgency',  urgency);
  if (minScore)  p.set('minScore', minScore);
  if (unreplied) p.set('unrepliedOnly', 'true');
  p.set('page',     String(page));
  p.set('pageSize', String(PAGE_SIZE));
  return p.toString();
}

async function loadLeads(page = 1) {
  currentPage = page;
  const qs = buildQuery(page);
  const { leads, total } = await fetchJSON(`/api/leads?${qs}`);
  totalLeads = total;

  const list = document.getElementById('leadList');
  const pag  = document.getElementById('pagination');

  if (!leads || leads.length === 0) {
    list.innerHTML = '<div class="empty">No leads match your filters.</div>';
    pag.style.display = 'none';
    return;
  }

  list.innerHTML = leads.map(lead => renderCard(lead)).join('');

  // Attach click handlers
  list.querySelectorAll('.lead-card').forEach(card => {
    card.addEventListener('click', () => openModal(card.dataset.id));
  });

  // Pagination
  const totalPages = Math.ceil(total / PAGE_SIZE);
  document.getElementById('pageInfo').textContent = `Page ${page} / ${totalPages}`;
  document.getElementById('prevPage').disabled = page <= 1;
  document.getElementById('nextPage').disabled = page >= totalPages;
  pag.style.display = totalPages > 1 ? 'flex' : 'none';
}

function renderCard(lead) {
  const scoreClass = lead.score >= 7 ? 'score-high' : lead.score >= 4 ? 'score-medium' : 'score-low';
  const title      = escHtml(lead.title || lead.text.slice(0, 80) + '…');
  const text       = escHtml(lead.text.slice(0, 250));
  const relTime    = relativeTime(lead.scanned_at);

  return `<div class="lead-card" data-id="${lead.id}">
    <div class="top">
      <span class="badge ${lead.urgency}">${lead.urgency}</span>
      <span class="badge source">${lead.source}</span>
      <span class="badge source" style="margin-left:0">${lead.pain_category.replace(/_/g,' ')}</span>
      <span class="score-pill ${scoreClass}" title="Score ${lead.score}/10">${lead.score}</span>
    </div>
    <div class="lead-title">${title}</div>
    <div class="lead-text">${text}</div>
    <div class="lead-meta">
      <span>@${escHtml(lead.author)}</span>
      <span>${relTime}</span>
      ${lead.replied_at ? '<span style="color:var(--low)">✓ replied</span>' : ''}
    </div>
  </div>`;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

async function openModal(id) {
  currentId = id;
  const lead = await fetchJSON(`/api/leads/${id}`);

  const scoreClass = lead.score >= 7 ? 'score-high' : lead.score >= 4 ? 'score-medium' : 'score-low';

  document.getElementById('modalBadges').innerHTML = `
    <span class="badge ${lead.urgency}">${lead.urgency}</span>
    <span class="badge source">${lead.source}</span>
    <span class="score-pill ${scoreClass}">${lead.score}</span>`;

  document.getElementById('modalTitle').textContent = lead.title || lead.text.slice(0, 80);
  document.getElementById('modalText').textContent  = lead.text;

  const linkEl  = document.getElementById('modalLink');
  linkEl.href   = lead.url;
  linkEl.textContent = lead.url;

  document.getElementById('modalReply').value = lead.draft_reply || '';
  document.getElementById('modalOverlay').classList.add('open');
}

document.getElementById('modalClose').addEventListener('click', () => {
  document.getElementById('modalOverlay').classList.remove('open');
});

document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modalOverlay')) {
    document.getElementById('modalOverlay').classList.remove('open');
  }
});

document.getElementById('modalSave').addEventListener('click', async () => {
  if (!currentId) return;
  const reply = document.getElementById('modalReply').value.trim();
  if (!reply) return;
  await fetchJSON(`/api/leads/${currentId}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reply }),
  });
  document.getElementById('modalOverlay').classList.remove('open');
  loadLeads(currentPage);
});

// ── Scan button ───────────────────────────────────────────────────────────────

document.getElementById('scanBtn').addEventListener('click', async () => {
  const btn        = document.getElementById('scanBtn');
  const status     = document.getElementById('scanStatus');
  const statusText = document.getElementById('scanStatusText');

  btn.disabled = true;
  btn.textContent = 'Scanning…';
  status.classList.add('visible');
  statusText.textContent = 'Starting…';

  // Open SSE stream BEFORE triggering the scan so no events are missed
  const es = new EventSource('/api/scan/events');

  const finish = () => {
    es.close();
    btn.disabled = false;
    btn.textContent = 'Run Scan';
    status.classList.remove('visible');
  };

  es.onmessage = async (e) => {
    let event;
    try { event = JSON.parse(e.data); } catch { return; }

    if (event.type === 'progress') {
      statusText.textContent = `${event.scraper} (${event.count} leads)`;
      await loadStats();
      await loadLeads(1);
    } else if (event.type === 'done') {
      statusText.textContent = `Done — ${event.total} leads`;
      await loadStats();
      await loadLeads(1);
      finish();
    } else if (event.type === 'error') {
      statusText.textContent = `Scan error — ${event.message || 'unknown error'}`;
      setTimeout(finish, 3000);
    }
  };

  es.onerror = () => {
    statusText.textContent = 'Connection lost — please refresh';
    setTimeout(finish, 3000);
  };

  try {
    await fetchJSON('/api/scan', { method: 'POST' });
  } catch {
    finish();
  }
});

// ── Filter listeners ──────────────────────────────────────────────────────────

['filterSource','filterUrgency','filterMinScore','filterUnreplied'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => loadLeads(1));
});

document.getElementById('prevPage').addEventListener('click', () => loadLeads(currentPage - 1));
document.getElementById('nextPage').addEventListener('click', () => loadLeads(currentPage + 1));

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function relativeTime(isoStr) {
  if (!isoStr) return '';
  const ms   = Date.now() - new Date(isoStr).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60)   return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)   return `${mins}m ago`;
  const hrs  = Math.floor(mins / 60);
  if (hrs < 24)    return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Init ──────────────────────────────────────────────────────────────────────

loadStats();
loadLeads(1);
