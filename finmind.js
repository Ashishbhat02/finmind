/* ── SUPABASE CONFIG ── */
/* Credentials come from config.js (generated at build time from Netlify's
   environment variables) so they never live directly in this file or in git. */
const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null;
let authMode = 'signin'; // 'signin' | 'signup'

/* ── DATA ── */
let state = { expenses: [], budgets: { total: 0, food: 0, transport: 0, bills: 0, shopping: 0, health: 0, education: 0, fun: 0, other: 0 }, customCategories: [], categoryOverrides: {}, hiddenCategories: [], currentMonth: new Date().getMonth(), currentYear: new Date().getFullYear() };

const CAT_LABELS = { food: 'Food', transport: 'Transport', bills: 'Bills', shopping: 'Shopping', health: 'Health', education: 'Education', fun: 'Fun', other: 'Other' };
const CAT_EMOJIS = { food: '🍽️', transport: '🚗', bills: '💡', shopping: '🛍️', health: '❤️', education: '📚', fun: '🎮', other: '•••' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let doughnutChart = null, barChart = null, activeFilter = 'all', activeFilterPage = 'all';

/* ── CLOUD SYNC ── */
function ensureBudgetEntries() {
    if (!Array.isArray(state.budgets.topups)) state.budgets.topups = [];
    const baseBudgets = { total: 0, food: 0, transport: 0, bills: 0, shopping: 0, health: 0, education: 0, fun: 0, other: 0 };
    state.budgets = { ...baseBudgets, ...(state.budgets || {}) };
    (state.customCategories || []).forEach(c => { if (state.budgets[c.key] === undefined) state.budgets[c.key] = 0; });
}
function currentMonthKey() {
    return monthKey(state.currentYear, state.currentMonth);
}
function getMonthTopups(mKey = null) {
    const k = mKey || currentMonthKey();
    return (state.budgets && Array.isArray(state.budgets.topups)) ? state.budgets.topups.filter(t => t.monthKey === k) : [];
}
function getMonthTopupTotal(mKey = null) {
    const topups = getMonthTopups(mKey);
    return topups.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
}
function getTotalBudgetForMonth(mKey = null) {
    const base = Number(state.budgets.total) || 0;
    const extra = getMonthTopupTotal(mKey);
    return base + extra;
}
async function loadCloudData() {
    const [{ data: expenses, error: expErr }, { data: settingsRow, error: setErr }] = await Promise.all([
        sb.from('expenses').select('*').order('date', { ascending: false }),
        sb.from('settings').select('*').eq('user_id', currentUser.id).maybeSingle()
    ]);
    if (expErr) { console.error(expErr); showToast('Could not load expenses'); }
    if (setErr) { console.error(setErr); }

    state.expenses = (expenses || []).map(e => ({ id: Number(e.id), name: e.name, amount: Number(e.amount), date: e.date, cat: e.cat, monthKey: e.month_key }));

    if (settingsRow) {
        state.budgets = { ...state.budgets, ...(settingsRow.budgets || {}) };
        state.customCategories = settingsRow.custom_categories || [];
        state.categoryOverrides = settingsRow.category_overrides || {};
        state.hiddenCategories = settingsRow.hidden_categories || [];
    } else {
        state.customCategories = [];
        state.categoryOverrides = {};
        state.hiddenCategories = [];
        await sb.from('settings').insert({ user_id: currentUser.id, budgets: state.budgets, custom_categories: [] });
    }
    ensureBudgetEntries();
    buildCatGrid();
    render();
}
async function syncSettings() {
    const { error } = await sb.from('settings').upsert({ user_id: currentUser.id, budgets: state.budgets, custom_categories: state.customCategories, category_overrides: state.categoryOverrides, hidden_categories: state.hiddenCategories, updated_at: new Date().toISOString() });
    if (error) { console.error(error); showToast('Could not save settings'); }
}

/* ── AUTH ── */
function toggleAuthMode() {
    authMode = authMode === 'signin' ? 'signup' : 'signin';
    document.getElementById('authTitle').textContent = authMode === 'signin' ? 'Welcome back' : 'Create your account';
    document.getElementById('authSub').textContent = authMode === 'signin' ? 'Sign in to your FinMind account' : 'Start tracking your budget';
    document.getElementById('authSubmitBtn').textContent = authMode === 'signin' ? 'Sign in' : 'Create account';
    document.getElementById('authSwitchText').innerHTML = authMode === 'signin'
        ? `Don't have an account? <span onclick="toggleAuthMode()">Create one</span>`
        : `Already have an account? <span onclick="toggleAuthMode()">Sign in</span>`;
    document.getElementById('authError').style.display = 'none';
}
async function handleAuthSubmit() {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const errEl = document.getElementById('authError');
    errEl.style.display = 'none';
    if (!email || !password) { errEl.textContent = 'Enter both email and password.'; errEl.style.display = 'block'; return }
    const btn = document.getElementById('authSubmitBtn');
    btn.disabled = true; btn.textContent = 'Please wait…';
    try {
        const result = authMode === 'signin'
            ? await sb.auth.signInWithPassword({ email, password })
            : await sb.auth.signUp({ email, password });
        if (result.error) throw result.error;
        if (authMode === 'signup' && !result.data.session) {
            errEl.style.color = 'var(--green-dark)'; errEl.style.background = 'var(--green-light)';
            errEl.textContent = 'Account created! Check your email to confirm, then sign in.';
            errEl.style.display = 'block';
            authMode = 'signup'; toggleAuthMode(); // flips back to signin labels
            btn.disabled = false; btn.textContent = 'Sign in';
            return;
        }
        await onLoggedIn(result.data.session.user);
    } catch (e) {
        errEl.style.color = 'var(--danger)'; errEl.style.background = 'var(--danger-bg)';
        errEl.textContent = e.message || 'Something went wrong. Please try again.';
        errEl.style.display = 'block';
    }
    btn.disabled = false; btn.textContent = authMode === 'signin' ? 'Sign in' : 'Create account';
}
async function onLoggedIn(user) {
    currentUser = user;
    document.getElementById('authOverlay').classList.remove('open');
    document.getElementById('userEmailLabel').textContent = user.email;
    document.getElementById('userEmailLabel').title = user.email;
    await loadCloudData();
}
async function signOut() {
    await sb.auth.signOut();
    currentUser = null;
    state.expenses = []; state.customCategories = []; state.categoryOverrides = {}; state.hiddenCategories = [];
    ensureBudgetEntries();
    document.getElementById('authOverlay').classList.add('open');
}
function getCategoryKeys() {
    const keys = ['food', 'transport', 'bills', 'shopping', 'health', 'education', 'fun', 'other'].filter(k => !(state.hiddenCategories || []).includes(k));
    (state.customCategories || []).forEach(c => { if (!keys.includes(c.key)) keys.push(c.key); });
    return keys;
}
function getCategoryLabel(cat) {
    const override = (state.categoryOverrides || {})[cat];
    if (override && override.name) return override.name;
    if (CAT_LABELS[cat]) return CAT_LABELS[cat];
    const custom = (state.customCategories || []).find(c => c.key === cat);
    return custom ? custom.name : cat;
}
function getCategoryEmoji(cat) {
    const override = (state.categoryOverrides || {})[cat];
    if (override && override.emoji) return override.emoji;
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
function changeMonth(d) { state.currentMonth += d; if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++ } if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear-- } render() }
function monthKey(y, m) { return `${y}-${String(m + 1).padStart(2, '0')}` }
function currentMonthExpenses() { const k = monthKey(state.currentYear, state.currentMonth); return state.expenses.filter(e => e.monthKey === k) }
function prevMonthExpenses() { let m = state.currentMonth - 1, y = state.currentYear; if (m < 0) { m = 11; y-- } return state.expenses.filter(e => e.monthKey === monthKey(y, m)) }
function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }
function fmt(n) { return '₹' + Math.round(n).toLocaleString('en-IN') }
function fmtDate(iso) { const d = new Date(iso + 'T00:00:00'); return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) }
function fmtDateFull(iso) { const d = new Date(iso + 'T00:00:00'); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() }

/* ── MODAL ── */
let editingExpenseId = null;
function openModal(id) {
    editingExpenseId = (id !== undefined && id !== null) ? id : null;
    const existing = editingExpenseId !== null ? state.expenses.find(e => e.id === editingExpenseId) : null;

    document.getElementById('modalTitle').textContent = existing ? 'Edit expense' : 'Add new expense';
    document.getElementById('saveBtnText').textContent = existing ? 'Save changes' : 'Save expense';

    document.getElementById('modalOverlay').classList.add('open');
    document.getElementById('expName').value = existing ? existing.name : '';
    document.getElementById('expAmount').value = existing ? existing.amount : '';
    document.getElementById('expDate').value = existing ? existing.date : new Date().toISOString().split('T')[0];
    document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('sel'));
    const catToSelect = existing ? existing.cat : getCategoryKeys()[0];
    const chip = document.querySelector(`.cat-chip[data-cat="${catToSelect}"]`) || document.querySelector('.cat-chip');
    if (chip) chip.classList.add('sel');
    setTimeout(() => document.getElementById('expName').focus(), 50);
}
function editExpense(id) { openModal(id) }
function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); editingExpenseId = null }
function selectCat(el) { document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('sel')); el.classList.add('sel') }

/* ── SAVE EXPENSE (handles both add and edit, writes to Supabase) ── */
async function saveExpense() {
    const name = document.getElementById('expName').value.trim();
    const amount = parseFloat(document.getElementById('expAmount').value);
    const date = document.getElementById('expDate').value;
    const catEl = document.querySelector('.cat-chip.sel');
    const cat = catEl ? catEl.dataset.cat : 'other';
    if (!name) { shake('expName'); return }
    if (!amount || amount <= 0) { shake('expAmount'); return }
    if (!date) { shake('expDate'); return }

    const d = new Date(date + 'T00:00:00');
    const mKey = monthKey(d.getFullYear(), d.getMonth());
    const payload = { name, amount, date, cat, month_key: mKey };

    const saveBtn = document.querySelector('.btn-save');
    saveBtn.disabled = true;

    if (editingExpenseId !== null) {
        const { data, error } = await sb.from('expenses').update(payload).eq('id', editingExpenseId).select().single();
        saveBtn.disabled = false;
        if (error) { console.error(error); showToast('Could not save changes'); return }
        const idx = state.expenses.findIndex(e => e.id === editingExpenseId);
        if (idx > -1) state.expenses[idx] = { id: Number(data.id), name: data.name, amount: Number(data.amount), date: data.date, cat: data.cat, monthKey: data.month_key };
        editingExpenseId = null;
        closeModal(); render(); showToast('Expense updated');
    } else {
        const { data, error } = await sb.from('expenses').insert({ ...payload, user_id: currentUser.id }).select().single();
        saveBtn.disabled = false;
        if (error) { console.error(error); showToast('Could not save expense'); return }
        state.expenses.unshift({ id: Number(data.id), name: data.name, amount: Number(data.amount), date: data.date, cat: data.cat, monthKey: data.month_key });
        closeModal(); render(); showToast('Expense saved');
    }
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
async function confirmDelete() {
    if (pendingDeleteId !== null) {
        const idToDelete = pendingDeleteId;
        pendingDeleteId = null;
        const { error } = await sb.from('expenses').delete().eq('id', idToDelete);
        if (error) { console.error(error); showToast('Could not delete expense') }
        else { state.expenses = state.expenses.filter(e => e.id !== idToDelete); render(); showToast('Expense deleted') }
    }
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
function renderCatFilterTabs(containerId, activeCat, handlerName) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const cats = getCategoryKeys();
    el.innerHTML = `<div class="ftab${activeCat === 'all' ? ' active' : ''}" onclick="${handlerName}('all',this)">All</div>` +
        cats.map(c => `<div class="ftab${activeCat === c ? ' active' : ''}" onclick="${handlerName}('${c}',this)">${getCategoryLabel(c)}</div>`).join('');
}

/* ── SECTION DATE FILTER (dashboard + expenses page lists) ── */
let dashDateMode = 'current', dashDateDate = null, dashDateMonth = null;
let pageDateMode = 'current', pageDateDate = null, pageDateMonth = null;
function dateFilterState(scope) {
    return scope === 'dash'
        ? { mode: dashDateMode, date: dashDateDate, month: dashDateMonth }
        : { mode: pageDateMode, date: pageDateDate, month: pageDateMonth };
}
function setDateFilterState(scope, mode, date, month) {
    if (scope === 'dash') { dashDateMode = mode; dashDateDate = date; dashDateMonth = month; }
    else { pageDateMode = mode; pageDateDate = date; pageDateMonth = month; }
}
function filteredExpensesByDate(scope) {
    const { mode, date, month } = dateFilterState(scope);
    if (mode === 'all') return state.expenses;
    if (mode === 'date' && date) return state.expenses.filter(e => e.date === date);
    if (mode === 'month' && month) return state.expenses.filter(e => e.monthKey === month);
    return currentMonthExpenses();
}
function dateFilterLabel(scope) {
    const { mode, date, month } = dateFilterState(scope);
    if (mode === 'all') return 'All time';
    if (mode === 'date' && date) return fmtDateFull(date);
    if (mode === 'month' && month) { const [y, m] = month.split('-'); return `${MONTHS[parseInt(m, 10) - 1]} ${y}`; }
    return `${MONTHS[state.currentMonth]} ${state.currentYear}`;
}
function updateDateFilterLabels() {
    const dashLabel = document.getElementById('dashDateFilterLabel');
    if (dashLabel) dashLabel.textContent = dateFilterLabel('dash');
    const pageLabel = document.getElementById('pageDateFilterLabel');
    if (pageLabel) pageLabel.textContent = dateFilterLabel('page');
}
function toggleDateFilterMenu(scope) {
    const menu = document.getElementById(scope + 'DateFilterMenu');
    const trigger = document.getElementById(scope + 'DateFilterTrigger');
    if (!menu) return;
    const willOpen = !menu.classList.contains('open');
    document.querySelectorAll('.date-filter-menu.open').forEach(m => m.classList.remove('open'));
    document.querySelectorAll('.date-filter-trigger.open').forEach(t => t.classList.remove('open'));
    if (willOpen) { menu.classList.add('open'); if (trigger) trigger.classList.add('open'); }
}
function chooseDateFilter(scope, mode) {
    if (mode === 'date') {
        document.getElementById(scope + 'DatePickerWrap').style.display = 'block';
        document.getElementById(scope + 'MonthPickerWrap').style.display = 'none';
        const input = document.getElementById(scope + 'DatePickerInput');
        input.value = dateFilterState(scope).date || new Date().toISOString().split('T')[0];
        input.focus();
        return;
    }
    if (mode === 'month') {
        document.getElementById(scope + 'MonthPickerWrap').style.display = 'block';
        document.getElementById(scope + 'DatePickerWrap').style.display = 'none';
        const input = document.getElementById(scope + 'MonthPickerInput');
        input.value = dateFilterState(scope).month || monthKey(state.currentYear, state.currentMonth);
        input.focus();
        return;
    }
    document.getElementById(scope + 'DatePickerWrap').style.display = 'none';
    document.getElementById(scope + 'MonthPickerWrap').style.display = 'none';
    setDateFilterState(scope, mode, null, null);
    applyDateFilter(scope);
}
function applyDatePickerChange(scope) {
    const val = document.getElementById(scope + 'DatePickerInput').value;
    if (!val) return;
    setDateFilterState(scope, 'date', val, null);
    applyDateFilter(scope);
}
function applyMonthPickerChange(scope) {
    const val = document.getElementById(scope + 'MonthPickerInput').value;
    if (!val) return;
    setDateFilterState(scope, 'month', null, val);
    applyDateFilter(scope);
}
function applyDateFilter(scope) {
    updateDateFilterLabels();
    const menu = document.getElementById(scope + 'DateFilterMenu');
    const trigger = document.getElementById(scope + 'DateFilterTrigger');
    if (menu) menu.classList.remove('open');
    if (trigger) trigger.classList.remove('open');
    if (scope === 'dash') renderExpenseTable(); else renderExpensesPage();
}
document.addEventListener('click', e => {
    document.querySelectorAll('.date-filter-menu.open').forEach(menu => {
        const wrap = menu.closest('.date-filter-wrap');
        if (wrap && !wrap.contains(e.target)) {
            menu.classList.remove('open');
            const trigger = wrap.querySelector('.date-filter-trigger');
            if (trigger) trigger.classList.remove('open');
        }
    });
});

/* ── EXPENSE ROW ── */
function expRowHTML(e) {
    const catClass = getCategoryClass(e.cat);
    return `<div class="et-row">
       <div class="et-icon ${catClass}" style="font-size:14px">${getCategoryEmoji(e.cat)}</div>
       <div class="et-name" title="${e.name}">${e.name}<span class="et-date-mobile">${fmtDate(e.date)}</span></div>
       <div class="et-cat"><span class="cat-pill ${catClass}">${getCategoryLabel(e.cat)}</span></div>
       <div class="et-date">${fmtDateFull(e.date)}</div>
       <div class="et-amt">${fmt(e.amount)}</div>
       <div class="et-edit" onclick="editExpense(${e.id})" title="Edit">
         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
       </div>
       <div class="et-del" onclick="deleteExpense(${e.id})" title="Delete">
         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
       </div>
     </div>`;
}

/* ── RENDER TABLE ── */
function renderExpenseTable() {
    const body = document.getElementById('expenseTableBody');
    renderCatFilterTabs('filterTabs', activeFilter, 'filterExpenses');
    let exps = filteredExpensesByDate('dash');
    if (activeFilter !== 'all') exps = exps.filter(e => e.cat === activeFilter);
    updateDateFilterLabels();
    if (!exps.length) { body.innerHTML = `<div class="empty-state"><div class="empty-icon">💰</div><div class="empty-title">No expenses yet</div><div class="empty-sub">Tap "Add expense" to log your first one</div></div>`; return }
    body.innerHTML = exps.map(expRowHTML).join('');
}

/* ── RENDER EXPENSES PAGE ── */
function renderExpensesPage() {
    const body = document.getElementById('expensesPageBody');
    renderCatFilterTabs('filterTabsPage', activeFilterPage, 'filterExpensesPage');
    let exps = filteredExpensesByDate('page');
    if (activeFilterPage !== 'all') exps = exps.filter(e => e.cat === activeFilterPage);
    updateDateFilterLabels();
    document.getElementById('expPageSub').textContent = `${dateFilterLabel('page')} — ${exps.length} transaction${exps.length !== 1 ? 's' : ''}`;
    if (!exps.length) { body.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">No expenses found</div><div class="empty-sub">Nothing logged for this filter yet</div></div>`; return }
    body.innerHTML = exps.map(expRowHTML).join('');
}

/* ── RENDER TIMELINE ── */
let expandedTimelineDays = new Set();
function toggleTimelineDay(d) {
    if (expandedTimelineDays.has(d)) expandedTimelineDays.delete(d); else expandedTimelineDays.add(d);
    renderTimeline();
}
function renderTimeline() {
    const el = document.getElementById('timeline');
    const exps = currentMonthExpenses();
    if (!exps.length) { el.innerHTML = '<div class="tl-empty">No expenses this month yet</div>'; return }
    const byDay = {};
    exps.forEach(e => { if (!byDay[e.date]) byDay[e.date] = { items: [], total: 0 }; byDay[e.date].items.push(e); byDay[e.date].total += e.amount });
    const sorted = Object.keys(byDay).sort((a, b) => b.localeCompare(a)).slice(0, 6);
    el.innerHTML = sorted.map(d => {
        const items = byDay[d].items;
        const expanded = expandedTimelineDays.has(d);
        const shown = expanded ? items : items.slice(0, 3);
        const chipsHTML = shown.map(e => `<span class="tl-chip cat-${e.cat}">${e.name.split(' ')[0]}</span>`).join('');
        const moreHTML = items.length > 3
            ? (expanded
                ? `<span class="tl-chip tl-chip-toggle" onclick="toggleTimelineDay('${d}')">− less</span>`
                : `<span class="tl-chip tl-chip-toggle" onclick="toggleTimelineDay('${d}')">+${items.length - 3}</span>`)
            : '';
        return `
       <div class="tl-row${expanded ? ' tl-row-expanded' : ''}">
         <div class="tl-date">${fmtDate(d)}</div>
         <div class="tl-chips">${chipsHTML}${moreHTML}</div>
         <div class="tl-amt">${fmt(byDay[d].total)}</div>
       </div>`;
    }).join('');
}

/* ── RENDER CAT BARS ── */
let catBarsExpanded = false;
const CAT_BAR_VISIBLE = 4;
function toggleCatBars() { catBarsExpanded = !catBarsExpanded; renderCatBars(); }
function renderCatBars() {
    const el = document.getElementById('catBudgetBars');
    const exps = currentMonthExpenses();
    const totals = {};
    exps.forEach(e => { totals[e.cat] = (totals[e.cat] || 0) + e.amount });
    const sorted = getCategoryKeys().sort((a, b) => {
        const ta = totals[a] || 0, tb = totals[b] || 0;
        if (tb !== ta) return tb - ta;
        const ba = state.budgets[a] || 0, bb = state.budgets[b] || 0;
        if (bb !== ba) return bb - ba;
        return getCategoryLabel(a).localeCompare(getCategoryLabel(b));
    });
    const visible = catBarsExpanded ? sorted : sorted.slice(0, CAT_BAR_VISIBLE);
    const rowsHTML = visible.map(cat => {
        const total = totals[cat] || 0;
        const limit = state.budgets[cat] || 0;
        const pct = limit ? Math.min(100, Math.round((total / limit) * 100)) : 0;
        const warn = limit && pct >= 85;
        const over = limit && total > limit;
        const overStyle = over ? 'background:var(--danger)' : '';
        const infoText = limit ? `${fmt(total)} / ${fmt(limit)}` : (total > 0 ? fmt(total) : 'No limit set');
        return `<div class="cp-row">
         <div class="cp-top">
           <div class="cp-name">${getCategoryEmoji(cat)} ${getCategoryLabel(cat)}</div>
           <div class="cp-info">${infoText}</div>
         </div>
         <div class="cp-track"><div class="cp-fill ${getCategoryClass(cat, 'fill')}" style="width:${limit ? pct : (total > 0 ? 100 : 0)}%;${overStyle}"></div></div>
         ${over ? `<div class="cp-warn">⚠️ Over budget!</div>` : ''}
         ${warn && !over ? `<div class="cp-warn">⚠️ Almost at limit</div>` : ''}
       </div>`;
    }).join('');
    const moreHTML = sorted.length > CAT_BAR_VISIBLE
        ? `<div class="cp-more" onclick="toggleCatBars()">${catBarsExpanded ? '− Show less' : `+ ${sorted.length - CAT_BAR_VISIBLE} more categories`}</div>`
        : '';
    el.innerHTML = rowsHTML + moreHTML;
}

/* ── RENDER STATS ── */
function renderStats() {
    const exps = currentMonthExpenses();
    const prevExps = prevMonthExpenses();
    const total = exps.reduce((s, e) => s + e.amount, 0);
    const prevTotal = prevExps.reduce((s, e) => s + e.amount, 0);
    const curMKey = currentMonthKey();
    const baseBudget = Number(state.budgets.total) || 0;
    const extraAdded = getMonthTopupTotal(curMKey);
    const budget = baseBudget + extraAdded;
    const remaining = budget ? budget - total : null;
    const days = exps.length ? new Set(exps.map(e => e.date)).size : 1;
    const daily = exps.length ? total / days : 0;

    document.getElementById('bsBase').textContent = fmt(baseBudget);
    document.getElementById('bsExtra').textContent = (extraAdded > 0 ? '+' : '') + fmt(extraAdded);
    document.getElementById('bsTotal').textContent = fmt(budget);
    document.getElementById('statSpent').textContent = fmt(total);
    document.getElementById('statDaily').textContent = fmt(daily);
    document.getElementById('statTransactions').textContent = exps.length + ' transaction' + (exps.length !== 1 ? 's' : '');

    const breakdownEl = document.getElementById('statBudgetBreakdown');
    if (breakdownEl) {
        if (extraAdded > 0) {
            breakdownEl.style.display = 'flex';
            breakdownEl.innerHTML = `<span class="stat-pill">Base: ${fmt(baseBudget)}</span><span class="stat-pill green">+Extra: ${fmt(extraAdded)}</span><span class="stat-pill">Total: ${fmt(budget)}</span>`;
        } else {
            breakdownEl.style.display = 'none';
        }
    }

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
    const isDark = isDarkMode();
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
let editingCategoryKey = null;
function renderBudgetPage() {
    const baseBudget = Number(state.budgets.total) || 0;
    document.getElementById('totalBudgetInput').value = baseBudget || '';

    // Extra budget for active month & live preview
    const curMKey = currentMonthKey();
    const topups = getMonthTopups(curMKey);
    const extraAdded = topups.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const totalMonthlyBudget = baseBudget + extraAdded;

    const titleEl = document.getElementById('topupSectionTitle');
    if (titleEl) {
        titleEl.textContent = `Extra budget for ${MONTHS[state.currentMonth]} ${state.currentYear}`;
    }

    // Update Preview Box
    const prevBase = document.getElementById('ebPreviewBase');
    const prevExtra = document.getElementById('ebPreviewExtra');
    const prevTotal = document.getElementById('ebPreviewTotal');
    if (prevBase) prevBase.textContent = fmt(baseBudget);
    if (prevExtra) prevExtra.textContent = (extraAdded > 0 ? '+' : '') + fmt(extraAdded);
    if (prevTotal) prevTotal.textContent = fmt(totalMonthlyBudget);

    // Render topup items list
    const listEl = document.getElementById('topupList');
    if (listEl) {
        if (!topups.length) {
            listEl.innerHTML = `<div class="topup-empty">No extra budget added for ${MONTHS[state.currentMonth]} ${state.currentYear} yet. Click "+ Add extra budget" above to add more.</div>`;
        } else {
            listEl.innerHTML = topups.map(t => `
               <div class="topup-row">
                 <div class="topup-info">
                   <span class="topup-amt">+${fmt(t.amount)}</span>
                   <span class="topup-reason" title="${escapeHTML(t.reason || 'Extra budget')}">${escapeHTML(t.reason || 'Extra budget')}</span>
                 </div>
                 <div class="topup-date">${fmtDate(t.date)}</div>
                 <div class="topup-del" onclick="deleteTopup('${t.id}')" title="Remove extra budget">
                   <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                 </div>
               </div>`).join('');
        }
    }

    // Per-category inputs
    const cats = getCategoryKeys();
    document.getElementById('categoryBudgetInputs').innerHTML = cats.map(c => {
        if (editingCategoryKey === c && c !== 'other') {
            return `
       <div class="budget-field-edit">
         <div class="budget-field-edit-title">Editing "${getCategoryLabel(c)}"</div>
         <div class="budget-field-edit-row">
           <input type="text" id="editCatEmoji_${c}" value="${getCategoryEmoji(c)}" maxlength="4" class="cat-emoji-input">
           <input type="text" id="editCatName_${c}" value="${getCategoryLabel(c)}" placeholder="Category name" autocomplete="off">
         </div>
         <div class="budget-field-edit-actions">
           <button onclick="saveCategoryEdit('${c}')" class="cat-edit-save">Save</button>
           <button onclick="cancelCategoryEdit()" class="cat-edit-cancel">Cancel</button>
         </div>
       </div>`;
        }
        return `
       <div class="budget-field">
         <label><span style="font-size:15px">${getCategoryEmoji(c)}</span> ${getCategoryLabel(c)}</label>
         <input type="number" id="budget_${c}" value="${state.budgets[c] || ''}" placeholder="No limit" min="0">${c !== 'other' ? `
         <span class="cat-icon-btn" onclick="editCategory('${c}')" title="Edit category">✏️</span>
         <span class="cat-icon-btn cat-icon-btn-danger" onclick="deleteCategory('${c}')" title="Delete category">🗑️</span>` : ''}
       </div>`;
    }).join('') + `
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

/* ── EXTRA BUDGET HANDLERS ── */
function openTopupModal() {
    document.getElementById('topupAmount').value = '';
    document.getElementById('topupReason').value = '';
    const sub = document.getElementById('topupModalSub');
    if (sub) {
        sub.textContent = `Will be added to your total budget for ${MONTHS[state.currentMonth]} ${state.currentYear}`;
    }
    document.getElementById('topupModalOverlay').classList.add('open');
    setTimeout(() => document.getElementById('topupAmount').focus(), 50);
}
function closeTopupModal() {
    document.getElementById('topupModalOverlay').classList.remove('open');
}
async function saveTopup() {
    const amount = parseFloat(document.getElementById('topupAmount').value);
    const reason = document.getElementById('topupReason').value.trim();
    if (!amount || amount <= 0) { shake('topupAmount'); return; }

    if (!Array.isArray(state.budgets.topups)) state.budgets.topups = [];
    const mKey = currentMonthKey();
    const newTopup = {
        id: 'top_' + Date.now(),
        monthKey: mKey,
        amount,
        reason: reason || 'Extra budget addition',
        date: new Date().toISOString().split('T')[0]
    };
    state.budgets.topups.push(newTopup);
    closeTopupModal();
    await syncSettings();
    render();
    showToast(`Added ${fmt(amount)} extra budget!`);
}
async function deleteTopup(id) {
    if (!state.budgets.topups) return;
    state.budgets.topups = state.budgets.topups.filter(t => t.id !== id);
    await syncSettings();
    render();
    showToast('Extra budget removed');
}
function editCategory(key) { editingCategoryKey = key; renderBudgetPage(); }
function cancelCategoryEdit() { editingCategoryKey = null; renderBudgetPage(); }
async function saveCategoryEdit(key) {
    const emoji = document.getElementById('editCatEmoji_' + key).value.trim() || '🧾';
    const name = document.getElementById('editCatName_' + key).value.trim();
    if (!name) { showToast('Enter a category name'); return }
    const custom = (state.customCategories || []).find(c => c.key === key);
    if (custom) {
        custom.name = name; custom.emoji = emoji;
    } else {
        state.categoryOverrides = state.categoryOverrides || {};
        state.categoryOverrides[key] = { name, emoji };
    }
    editingCategoryKey = null;
    await syncSettings(); renderBudgetPage(); render(); showToast('Category updated');
}

/* ── DELETE CATEGORY (default or custom) ── */
let categoryPendingDelete = null;
function deleteCategory(key) {
    categoryPendingDelete = key;
    const label = getCategoryLabel(key);
    const count = state.expenses.filter(e => e.cat === key).length;
    document.getElementById('catDeleteTitle').textContent = `Delete "${label}"?`;
    const moveBtn = document.getElementById('catDeleteMoveBtn');
    const permBtn = document.getElementById('catDeletePermBtn');
    if (count > 0) {
        document.getElementById('catDeleteSub').textContent = `${count} expense${count !== 1 ? 's' : ''} ${count !== 1 ? 'are' : 'is'} logged under this category. Choose what to do with ${count !== 1 ? 'them' : 'it'}.`;
        moveBtn.style.display = '';
        moveBtn.textContent = `Move to "Other"`;
        permBtn.textContent = `Delete expense${count !== 1 ? 's' : ''} too`;
    } else {
        document.getElementById('catDeleteSub').textContent = 'This cannot be undone.';
        moveBtn.style.display = 'none';
        permBtn.textContent = 'Delete category';
    }
    document.getElementById('catDeleteOverlay').classList.add('open');
}
function closeCatDeleteOverlay() { categoryPendingDelete = null; document.getElementById('catDeleteOverlay').classList.remove('open'); }
async function resolveCategoryDelete(mode) {
    const key = categoryPendingDelete;
    if (!key) return;
    closeCatDeleteOverlay();
    if (mode === 'move') {
        const { error } = await sb.from('expenses').update({ cat: 'other' }).eq('cat', key);
        if (error) { console.error(error); showToast('Could not reassign expenses'); return }
        state.expenses.forEach(e => { if (e.cat === key) e.cat = 'other' });
    } else if (mode === 'delete') {
        const { error } = await sb.from('expenses').delete().eq('cat', key);
        if (error) { console.error(error); showToast('Could not delete expenses'); return }
        state.expenses = state.expenses.filter(e => e.cat !== key);
    }
    const isCustom = (state.customCategories || []).some(c => c.key === key);
    if (isCustom) {
        state.customCategories = state.customCategories.filter(c => c.key !== key);
        delete state.budgets[key];
    } else {
        state.hiddenCategories = state.hiddenCategories || [];
        if (!state.hiddenCategories.includes(key)) state.hiddenCategories.push(key);
    }
    if (state.categoryOverrides) delete state.categoryOverrides[key];
    editingCategoryKey = null;
    await syncSettings(); renderBudgetPage(); render(); showToast('Category deleted');
}
async function addCustomCategoryBudget() {
    const name = document.getElementById('customCategoryName').value.trim();
    const limit = parseFloat(document.getElementById('customCategoryBudget').value);
    if (!name) { showToast('Enter a category name'); return }
    const key = slugifyCategory(name);
    const exists = getCategoryKeys().includes(key);
    if (exists) { showToast('This category already exists'); return }
    state.customCategories.push({ key, name, emoji: '🧾' });
    state.budgets[key] = limit > 0 ? limit : 0;
    await syncSettings(); renderBudgetPage(); render(); showToast('Custom category added');
}
async function saveTotalBudget() {
    const v = parseFloat(document.getElementById('totalBudgetInput').value);
    state.budgets.total = v > 0 ? v : 0;
    await syncSettings(); render(); showToast('Total budget saved');
}
async function saveCategoryBudgets() {
    getCategoryKeys().forEach(c => {
        const v = parseFloat(document.getElementById('budget_' + c).value);
        state.budgets[c] = v > 0 ? v : 0;
    });
    await syncSettings(); render(); showToast('Category budgets saved');
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
    const dd = document.getElementById('monthDropdown');
    if (dd && dd.classList.contains('open')) buildMonthDropdown();
}

/* ── MOBILE MONTH DROPDOWN ── */
function buildMonthDropdownOptions() {
    const opts = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
        let mo = now.getMonth() - i, yr = now.getFullYear();
        while (mo < 0) { mo += 12; yr-- }
        opts.push({ m: mo, y: yr });
    }
    if (!opts.some(o => o.m === state.currentMonth && o.y === state.currentYear)) opts.push({ m: state.currentMonth, y: state.currentYear });
    opts.sort((a, b) => (b.y - a.y) || (b.m - a.m));
    return opts;
}
function buildMonthDropdown() {
    const dd = document.getElementById('monthDropdown');
    if (!dd) return;
    const opts = buildMonthDropdownOptions();
    dd.innerHTML = opts.map(o => {
        const sel = o.m === state.currentMonth && o.y === state.currentYear;
        return `<div class="month-dd-item${sel ? ' sel' : ''}" onclick="jumpToMonth(${o.y},${o.m})">${MONTHS[o.m]} ${o.y}</div>`;
    }).join('');
}
function toggleMonthDropdown() {
    const dd = document.getElementById('monthDropdown');
    const trigger = document.getElementById('greetingDateTrigger');
    if (!dd) return;
    const willOpen = !dd.classList.contains('open');
    if (willOpen) buildMonthDropdown();
    dd.classList.toggle('open', willOpen);
    if (trigger) trigger.classList.toggle('open', willOpen);
}
function jumpToMonth(y, m) {
    state.currentYear = y; state.currentMonth = m;
    const dd = document.getElementById('monthDropdown');
    const trigger = document.getElementById('greetingDateTrigger');
    if (dd) dd.classList.remove('open');
    if (trigger) trigger.classList.remove('open');
    render();
}
document.addEventListener('click', e => {
    const dd = document.getElementById('monthDropdown');
    const trigger = document.getElementById('greetingDateTrigger');
    if (dd && dd.classList.contains('open') && !dd.contains(e.target) && trigger && !trigger.contains(e.target)) {
        dd.classList.remove('open');
        trigger.classList.remove('open');
    }
});

/* ── EXPORT ── */
function exportCSV() {
    const exps = currentMonthExpenses();
    if (!exps.length) { showToast('No expenses to export'); return }
    const blob = new Blob(['Name,Category,Amount (₹),Date\n' + exps.map(e => `"${e.name}","${getCategoryLabel(e.cat)}",${e.amount},"${fmtDateFull(e.date)}"`).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `FinMind_${MONTHS[state.currentMonth]}_${state.currentYear}.csv`; a.click();
    showToast('CSV exported');
}

/* ── THEME (auto light/dark + manual toggle) ── */
const THEME_KEY = 'finmind_theme'; // 'light' | 'dark' | absent = auto (follows OS)
const SUN_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
const MOON_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

function isDarkMode() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
    return window.matchMedia('(prefers-color-scheme:dark)').matches; // auto
}
function updateThemeIcon() {
    const dark = isDarkMode();
    const icon = dark ? SUN_ICON : MOON_ICON; // icon shown = action you'll trigger next tap
    const s = document.getElementById('themeToggleSidebar');
    const t = document.getElementById('themeToggleTopbar');
    if (s) s.innerHTML = icon;
    if (t) t.innerHTML = icon;
}
function applyTheme(theme) {
    // theme: 'light' | 'dark' | null (null = auto, removes override)
    if (theme) document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
    updateThemeIcon();
    if (document.getElementById('page-analytics').classList.contains('active')) renderCharts();
}
function toggleTheme() {
    const next = isDarkMode() ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    showToast(next === 'dark' ? 'Dark mode on' : 'Light mode on');
}
function initTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    applyTheme(stored || null);
    // If user hasn't manually chosen, keep following OS changes live
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change', () => {
            if (!localStorage.getItem(THEME_KEY)) applyTheme(null);
        });
    }
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
    if (e.key === 'Escape') {
        closeModal();
        closeTopupModal();
    }
    if (e.key === 'Enter') {
        if (document.getElementById('modalOverlay').classList.contains('open')) saveExpense();
        else if (document.getElementById('topupModalOverlay').classList.contains('open')) saveTopup();
    }
});

/* ── MAIN RENDER ── */
function render() {
    renderHeader(); renderStats(); renderCatBars(); renderTimeline(); renderExpenseTable();
    if (document.getElementById('page-analytics').classList.contains('active')) renderCharts();
    if (document.getElementById('page-expenses').classList.contains('active')) renderExpensesPage();
    if (document.getElementById('page-budgets').classList.contains('active')) renderBudgetPage();
}

/* ── INIT ── */
async function initApp() {
    initTheme();
    const { data: { session } } = await sb.auth.getSession();
    if (session && session.user) {
        await onLoggedIn(session.user);
    } else {
        document.getElementById('authOverlay').classList.add('open');
    }
    sb.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') document.getElementById('authOverlay').classList.add('open');
    });
}
initApp();