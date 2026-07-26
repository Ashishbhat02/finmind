/* ── DATA ── */
const STORAGE_KEY = 'finmind_v1';
let state = { expenses: [], budgets: { total: 0, food: 0, transport: 0, bills: 0, shopping: 0, health: 0, education: 0, fun: 0, other: 0 }, customCategories: [], currentMonth: new Date().getMonth(), currentYear: new Date().getFullYear() };

const CAT_LABELS = { food: 'Food', transport: 'Transport', bills: 'Bills', shopping: 'Shopping', health: 'Health', education: 'Education', fun: 'Fun', other: 'Other' };
const CAT_EMOJIS = { food: '🍽️', transport: '🚗', bills: '💡', shopping: '🛍️', health: '❤️', education: '📚', fun: '🎮', other: '•••' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let doughnutChart = null, barChart = null, activeFilter = 'all', activeFilterPage = 'all';

/* ── PERSIST ── */
function save() { state.customCategories = state.customCategories || []; localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) }
function ensureBudgetEntries() {
    const baseBudgets = { total: 0, food: 0, transport: 0, bills: 0, shopping: 0, health: 0, education: 0, fun: 0, other: 0 };
    state.budgets = { ...baseBudgets, ...(state.budgets || {}) };
    (state.customCategories || []).forEach(c => { if (state.budgets[c.key] === undefined) state.budgets[c.key] = 0; });
}
function getCategoryKeys() {
    const keys = ['food', 'transport', 'bills', 'shopping', 'health', 'education', 'fun', 'other'];
    (state.customCategories || []).forEach(c => { if (!keys.includes(c.key)) keys.push(c.key); });
    return keys;
}
function getCategoryLabel(cat) {
    if (CAT_LABELS[cat]) return CAT_LABELS[cat];
    const custom = (state.customCategories || []).find(c => c.key === cat);
    return custom ? custom.name : cat;
}
function getCategoryEmoji(cat) {
    if (CAT_EMOJIS[cat]) return CAT_EMOJIS[cat];
    const custom = (state.customCategories || []).find(c => c.key === cat);
    return custom ? custom.emoji : '🧾';
}
function getCategoryClass(cat, prefix = 'cat') {
    const hasDefined = Boolean(CAT_LABELS[cat] || (state.customCategories || []).find(c => c.key === cat));
    return hasDefined ? `${prefix}-${cat}` : `${prefix}-other`;
}
function slugifyCategory(name) {
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return slug || 'custom';
}
function load() {
    try {
        const d = localStorage.getItem(STORAGE_KEY);
        if (d) state = { ...state, ...JSON.parse(d) };
    } catch (e) { }
    state.expenses = state.expenses || [];
    state.customCategories = state.customCategories || [];
    ensureBudgetEntries();
}

/* ── BUILD CAT GRID ── */
function buildCatGrid() {
    const cats = getCategoryKeys();
    document.getElementById('catGrid').innerHTML = cats.map((c, i) => `
    <div class="cat-chip ${i === 0 ? 'sel' : ''}" data-cat="${c}" onclick="selectCat(this)">
      <span style="font-size:18px">${getCategoryEmoji(c)}</span>${getCategoryLabel(c)}
    </div>`).join('');
}

/* ── HELPERS ── */
function getGreeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }
function changeMonth(d) { state.currentMonth += d; if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++ } if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear-- } save(); render() }
function monthKey(y, m) { return `${y}-${String(m + 1).padStart(2, '0')}` }
function currentMonthExpenses() { const k = monthKey(state.currentYear, state.currentMonth); return state.expenses.filter(e => e.monthKey === k) }
function prevMonthExpenses() { let m = state.currentMonth - 1, y = state.currentYear; if (m < 0) { m = 11; y-- } return state.expenses.filter(e => e.monthKey === monthKey(y, m)) }
function fmt(n) { return '₹' + Math.round(n).toLocaleString('en-IN') }
function fmtDate(iso) { const d = new Date(iso + 'T00:00:00'); return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) }
function fmtDateFull(iso) { const d = new Date(iso + 'T00:00:00'); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() }

/* ── MODAL ── */
function openModal() {
    document.getElementById('modalOverlay').classList.add('open');
    document.getElementById('expName').value = '';
    document.getElementById('expAmount').value = '';
    document.getElementById('expDate').value = new Date().toISOString().split('T')[0];
    document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('sel'));
    document.querySelector('.cat-chip[data-cat="food"]').classList.add('sel');
    setTimeout(() => document.getElementById('expName').focus(), 50);
}
function closeModal() { document.getElementById('modalOverlay').classList.remove('open') }
function selectCat(el) { document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('sel')); el.classList.add('sel') }

/* ── SAVE EXPENSE ── */
function saveExpense() {
    const name = document.getElementById('expName').value.trim();
    const amount = parseFloat(document.getElementById('expAmount').value);
    const date = document.getElementById('expDate').value;
    const catEl = document.querySelector('.cat-chip.sel');
    const cat = catEl ? catEl.dataset.cat : 'other';
    if (!name) { shake('expName'); return }
    if (!amount || amount <= 0) { shake('expAmount'); return }
    if (!date) { shake('expDate'); return }
    const d = new Date(date + 'T00:00:00');
    state.expenses.unshift({ id: Date.now(), name, amount, date, cat, monthKey: monthKey(d.getFullYear(), d.getMonth()) });
    save(); closeModal(); render(); showToast('Expense saved');
}
function shake(id) {
    const el = document.getElementById(id);
    el.style.borderColor = 'var(--danger)'; el.style.boxShadow = '0 0 0 3px rgba(192,57,43,.15)';
    setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = '' }, 1200); el.focus();
}

/* ── DELETE ── */
let pendingDeleteId = null;
function deleteExpense(id) { pendingDeleteId = id; document.getElementById('confirmOverlay').classList.add('open') }
function closeConfirm() { pendingDeleteId = null; document.getElementById('confirmOverlay').classList.remove('open') }
function confirmDelete() {
    if (pendingDeleteId !== null) { state.expenses = state.expenses.filter(e => e.id !== pendingDeleteId); pendingDeleteId = null; save(); render(); showToast('Expense deleted') }
    document.getElementById('confirmOverlay').classList.remove('open');
}

/* ── TOAST ── */
function showToast(msg) {
    const t = document.getElementById('toast');
    document.getElementById('toastMsg').textContent = msg;
    t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200);
}

/* ── SIDEBAR ── */
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('sidebarOverlay').classList.toggle('open') }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebarOverlay').classList.remove('open') }

/* ── PAGES ── */
function showPage(name, navEl) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + name).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    if (navEl) navEl.classList.add('active');
    else document.querySelectorAll('.nav-item').forEach(n => { if (n.textContent.trim().toLowerCase().includes(name)) n.classList.add('active') });
    setBottomNav(name); closeSidebar();
    if (name === 'analytics') renderCharts();
    if (name === 'budgets') renderBudgetPage();
    if (name === 'expenses') renderExpensesPage();
}
function setBottomNav(page) {
    document.querySelectorAll('.bnav-item').forEach(b => b.classList.remove('active'));
    const el = document.getElementById('bn-' + page); if (el) el.classList.add('active');
}

/* ── FILTERS ── */
function filterExpenses(cat, el) { activeFilter = cat; document.querySelectorAll('#filterTabs .ftab').forEach(t => t.classList.remove('active')); el.classList.add('active'); renderExpenseTable() }
function filterExpensesPage(cat, el) { activeFilterPage = cat; el.closest('.filter-tabs').querySelectorAll('.ftab').forEach(t => t.classList.remove('active')); el.classList.add('active'); renderExpensesPage() }

/* ── EXPENSE ROW ── */
function expRowHTML(e) {
    const catClass = getCategoryClass(e.cat);
    return `<div class="et-row">
    <div class="et-icon ${catClass}" style="font-size:14px">${getCategoryEmoji(e.cat)}</div>
    <div class="et-name" title="${e.name}">${e.name}</div>
    <div class="et-cat"><span class="cat-pill ${catClass}">${getCategoryLabel(e.cat)}</span></div>
    <div class="et-date">${fmtDateFull(e.date)}</div>
    <div class="et-amt">${fmt(e.amount)}</div>
    <div class="et-del" onclick="deleteExpense(${e.id})">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
    </div>
  </div>`;
}

/* ── RENDER TABLE ── */
function renderExpenseTable() {
    const body = document.getElementById('expenseTableBody');
    let exps = currentMonthExpenses();
    if (activeFilter !== 'all') exps = exps.filter(e => e.cat === activeFilter);
    if (!exps.length) { body.innerHTML = `<div class="empty-state"><div class="empty-icon">💰</div><div class="empty-title">No expenses yet</div><div class="empty-sub">Tap "Add expense" to log your first one</div></div>`; return }
    body.innerHTML = exps.map(expRowHTML).join('');
}

/* ── RENDER EXPENSES PAGE ── */
function renderExpensesPage() {
    const body = document.getElementById('expensesPageBody');
    let exps = currentMonthExpenses();
    if (activeFilterPage !== 'all') exps = exps.filter(e => e.cat === activeFilterPage);
    document.getElementById('expPageSub').textContent = `${MONTHS[state.currentMonth]} ${state.currentYear} — ${exps.length} transaction${exps.length !== 1 ? 's' : ''}`;
    if (!exps.length) { body.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">No expenses found</div><div class="empty-sub">Nothing logged for this filter yet</div></div>`; return }
    body.innerHTML = exps.map(expRowHTML).join('');
}

/* ── RENDER TIMELINE ── */
function renderTimeline() {
    const el = document.getElementById('timeline');
    const exps = currentMonthExpenses();
    if (!exps.length) { el.innerHTML = '<div class="tl-empty">No expenses this month yet</div>'; return }
    const byDay = {};
    exps.forEach(e => { if (!byDay[e.date]) byDay[e.date] = { items: [], total: 0 }; byDay[e.date].items.push(e); byDay[e.date].total += e.amount });
    const sorted = Object.keys(byDay).sort((a, b) => b.localeCompare(a)).slice(0, 6);
    el.innerHTML = sorted.map(d => `
    <div class="tl-row">
      <div class="tl-date">${fmtDate(d)}</div>
      <div class="tl-chips">${byDay[d].items.slice(0, 3).map(e => `<span class="tl-chip cat-${e.cat}">${e.name.split(' ')[0]}</span>`).join('')}${byDay[d].items.length > 3 ? `<span class="tl-chip" style="background:var(--bg);color:var(--text-2)">+${byDay[d].items.length - 3}</span>` : ''}</div>
      <div class="tl-amt">${fmt(byDay[d].total)}</div>
    </div>`).join('');
}

/* ── RENDER CAT BARS ── */
function renderCatBars() {
    const el = document.getElementById('catBudgetBars');
    const exps = currentMonthExpenses();
    if (!exps.length) { el.innerHTML = '<div class="tl-empty">Add expenses to see category breakdown</div>'; return }
    const totals = {};
    exps.forEach(e => { totals[e.cat] = (totals[e.cat] || 0) + e.amount });
    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    el.innerHTML = sorted.map(([cat, total]) => {
        const limit = state.budgets[cat] || 0;
        const pct = limit ? Math.min(100, Math.round((total / limit) * 100)) : 0;
        const warn = limit && pct >= 85;
        const over = limit && total > limit;
        const overStyle = over ? 'background:var(--danger)' : '';
        return `<div class="cp-row">
      <div class="cp-top">
        <div class="cp-name">${getCategoryEmoji(cat)} ${getCategoryLabel(cat)}</div>
        <div class="cp-info">${fmt(total)}${limit ? ` / ${fmt(limit)}` : ''}</div>
      </div>
      <div class="cp-track"><div class="cp-fill ${getCategoryClass(cat, 'fill')}" style="width:${limit ? pct : 100}%;${overStyle}"></div></div>
      ${over ? `<div class="cp-warn">⚠️ Over budget!</div>` : ''}
      ${warn && !over ? `<div class="cp-warn">⚠️ Almost at limit</div>` : ''}
    </div>`;
    }).join('');
}

/* ── RENDER STATS ── */
function renderStats() {
    const exps = currentMonthExpenses();
    const prevExps = prevMonthExpenses();
    const total = exps.reduce((s, e) => s + e.amount, 0);
    const prevTotal = prevExps.reduce((s, e) => s + e.amount, 0);
    const budget = state.budgets.total || 0;
    const remaining = budget ? budget - total : null;
    const days = exps.length ? new Set(exps.map(e => e.date)).size : 1;
    const daily = exps.length ? total / days : 0;

    document.getElementById('statSpent').textContent = fmt(total);
    document.getElementById('statDaily').textContent = fmt(daily);
    document.getElementById('statTransactions').textContent = exps.length + ' transaction' + (exps.length !== 1 ? 's' : '');

    if (remaining !== null) {
        document.getElementById('statRemaining').textContent = fmt(Math.max(0, remaining));
        document.getElementById('statRemaining').className = 'stat-value ' + (remaining < 0 ? 'red' : 'green');
        document.getElementById('statRemainingTrend').textContent = remaining < 0 ? 'Budget exceeded!' : Math.round((remaining / budget) * 100) + '% of budget left';
        const pct = Math.min(100, Math.round((total / budget) * 100));
        const fill = document.getElementById('budgetFillBar');
        fill.style.width = pct + '%';
        fill.className = 'budget-fill' + (pct >= 100 ? ' danger' : pct >= 85 ? ' warn' : '');
        document.getElementById('budgetPctLabel').textContent = pct + '%';
        document.getElementById('budgetPctLabel').style.color = pct >= 100 ? 'var(--danger)' : pct >= 85 ? 'var(--warn)' : 'var(--green-dark)';
    } else {
        document.getElementById('statRemaining').textContent = '—';
        document.getElementById('statRemainingTrend').textContent = 'Set a budget to track';
        document.getElementById('budgetFillBar').style.width = '0%';
        document.getElementById('budgetPctLabel').textContent = '—';
    }
    document.getElementById('setupBanner').style.display = budget ? 'none' : 'flex';

    const trendEl = document.getElementById('statTrend');
    const trendTxt = document.getElementById('statTrendText');
    if (prevTotal > 0) {
        const diff = total - prevTotal;
        trendTxt.textContent = (diff >= 0 ? '+' : '') + fmt(diff) + ' vs last month';
        trendEl.className = 'stat-trend ' + (diff > 0 ? 'up' : 'good');
    } else {
        trendTxt.textContent = 'No data last month';
        trendEl.className = 'stat-trend';
    }
}

/* ── CHARTS ── */
function renderCharts() {
    const exps = currentMonthExpenses();
    const catTotals = {}, dayTotals = {};
    exps.forEach(e => {
        catTotals[e.cat] = (catTotals[e.cat] || 0) + e.amount;
        const d = new Date(e.date + 'T00:00:00').getDate();
        dayTotals[d] = (dayTotals[d] || 0) + e.amount;
    });
    const catColors = { food: '#1D9E75', transport: '#378ADD', bills: '#7F77DD', shopping: '#D85A30', health: '#D4537E', education: '#639922', fun: '#BA7517', other: '#888780' };
    const isDark = window.matchMedia('(prefers-color-scheme:dark)').matches;
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const textColor = isDark ? '#8EA89A' : '#555E59';

    if (doughnutChart) doughnutChart.destroy();
    const dCtx = document.getElementById('doughnutChart').getContext('2d');
    const cats = Object.keys(catTotals);
    if (cats.length) {
        doughnutChart = new Chart(dCtx, {
            type: 'doughnut',
            data: { labels: cats.map(c => getCategoryLabel(c)), datasets: [{ data: cats.map(c => catTotals[c]), backgroundColor: cats.map(c => catColors[c] || '#888780'), borderWidth: 2, borderColor: isDark ? '#1A2220' : '#fff', hoverOffset: 4 }] },
            options: { cutout: '62%', responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 11 }, color: textColor, boxWidth: 12, padding: 10 } } } }
        });
    } else {
        dCtx.font = '13px system-ui'; dCtx.fillStyle = textColor; dCtx.textAlign = 'center';
        dCtx.fillText('No data this month', dCtx.canvas.width / 2, dCtx.canvas.height / 2);
    }

    if (barChart) barChart.destroy();
    const bCtx = document.getElementById('barChart').getContext('2d');
    const daysInMonth = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
    const labels = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    barChart = new Chart(bCtx, {
        type: 'bar',
        data: { labels, datasets: [{ data: labels.map(d => dayTotals[d] || 0), backgroundColor: '#1D9E75', borderRadius: 4, hoverBackgroundColor: '#0F6E56' }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 }, maxTicksLimit: 10 } }, y: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 }, callback: v => '₹' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v) } } } }
    });

    const insEl = document.getElementById('insightsContent');
    if (!exps.length) { insEl.innerHTML = 'Add expenses to see insights.'; return }
    const total = exps.reduce((s, e) => s + e.amount, 0);
    const topCat = cats.sort((a, b) => catTotals[b] - catTotals[a])[0];
    const topPct = Math.round((catTotals[topCat] / total) * 100);
    const daysIn = new Set(exps.map(e => e.date)).size;
    insEl.innerHTML = `<p style="margin-bottom:8px">• Your biggest category is <strong>${getCategoryLabel(topCat)}</strong> at ${fmt(catTotals[topCat])} (${topPct}% of total).</p>
    <p style="margin-bottom:8px">• Daily average: <strong>${fmt(Math.round(total / daysIn))}</strong> across ${daysIn} days.</p>
    <p>• Total <strong>${exps.length}</strong> transactions worth <strong>${fmt(total)}</strong> this month.</p>`;
}

/* ── BUDGET PAGE ── */
function renderBudgetPage() {
    document.getElementById('totalBudgetInput').value = state.budgets.total || '';
    const cats = getCategoryKeys();
    document.getElementById('categoryBudgetInputs').innerHTML = cats.map(c => `
    <div class="budget-field">
      <label><span style="font-size:15px">${getCategoryEmoji(c)}</span> ${getCategoryLabel(c)}</label>
      <input type="number" id="budget_${c}" value="${state.budgets[c] || ''}" placeholder="No limit" min="0">
    </div>`).join('') + `
    <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
      <div class="card-title" style="margin-bottom:10px">Add custom category limit</div>
      <div class="budget-field">
        <label>Category name</label>
        <input type="text" id="customCategoryName" placeholder="e.g. Gym" autocomplete="off">
      </div>
      <div class="budget-field">
        <label>Limit (₹)</label>
        <input type="number" id="customCategoryBudget" placeholder="e.g. 3000" min="0">
      </div>
      <button onclick="addCustomCategoryBudget()" style="width:100%;padding:10px 16px;background:var(--green);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Add category</button>
    </div>`;
}
function addCustomCategoryBudget() {
    const name = document.getElementById('customCategoryName').value.trim();
    const limit = parseFloat(document.getElementById('customCategoryBudget').value);
    if (!name) { showToast('Enter a category name'); return }
    const key = slugifyCategory(name);
    const exists = getCategoryKeys().includes(key);
    if (exists) { showToast('This category already exists'); return }
    state.customCategories.push({ key, name, emoji: '🧾' });
    state.budgets[key] = limit > 0 ? limit : 0;
    save(); renderBudgetPage(); render(); showToast('Custom category added');
}
function saveTotalBudget() {
    const v = parseFloat(document.getElementById('totalBudgetInput').value);
    state.budgets.total = v > 0 ? v : 0; save(); render(); showToast('Total budget saved');
}
function saveCategoryBudgets() {
    getCategoryKeys().forEach(c => {
        const v = parseFloat(document.getElementById('budget_' + c).value);
        state.budgets[c] = v > 0 ? v : 0;
    });
    save(); render(); showToast('Category budgets saved');
}

/* ── HEADER ── */
function renderHeader() {
    document.getElementById('greetingText').textContent = getGreeting();
    const m = MONTHS[state.currentMonth];
    const today = new Date();
    const daysInMonth = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
    const dayOfMonth = today.getMonth() === state.currentMonth && today.getFullYear() === state.currentYear ? today.getDate() : daysInMonth;
    const remaining = daysInMonth - dayOfMonth;
    document.getElementById('greetingSubText').textContent = `${m} ${state.currentYear} — ${remaining > 0 ? remaining + ' days remaining' : 'month complete'}`;
    document.getElementById('analyticsSubText').textContent = `${m} ${state.currentYear}`;
    document.getElementById('monthLabel').textContent = `${m} ${state.currentYear}`;
}

/* ── EXPORT ── */
function exportCSV() {
    const exps = currentMonthExpenses();
    if (!exps.length) { showToast('No expenses to export'); return }
    const blob = new Blob(['Name,Category,Amount (₹),Date\n' + exps.map(e => `"${e.name}","${CAT_LABELS[e.cat]}",${e.amount},"${fmtDateFull(e.date)}"`).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `FinMind_${MONTHS[state.currentMonth]}_${state.currentYear}.csv`; a.click();
    showToast('CSV exported');
}

/* ── PWA ── */
if ('serviceWorker' in navigator) { window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { })) }
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; document.getElementById('installBanner').style.display = 'flex' });
window.addEventListener('appinstalled', () => { document.getElementById('installBanner').style.display = 'none'; showToast('FinMind installed!') });
function installApp() { if (!deferredPrompt) return; deferredPrompt.prompt(); deferredPrompt.userChoice.then(() => { deferredPrompt = null; document.getElementById('installBanner').style.display = 'none' }) }
function dismissInstall() { document.getElementById('installBanner').style.display = 'none' }
window.addEventListener('DOMContentLoaded', () => { const p = new URLSearchParams(window.location.search); if (p.get('action') === 'add') setTimeout(openModal, 400) });

/* ── KEYBOARD ── */
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && document.getElementById('modalOverlay').classList.contains('open')) saveExpense();
});

/* ── MAIN RENDER ── */
function render() {
    renderHeader(); renderStats(); renderCatBars(); renderTimeline(); renderExpenseTable();
    if (document.getElementById('page-analytics').classList.contains('active')) renderCharts();
    if (document.getElementById('page-expenses').classList.contains('active')) renderExpensesPage();
    if (document.getElementById('page-budgets').classList.contains('active')) renderBudgetPage();
}

/* ── INIT ── */
load();
buildCatGrid();
render();
