const won = (value) => `${new Intl.NumberFormat('ko-KR').format(value)}원`;
const SHEET_URL = 'https://script.google.com/macros/s/AKfycbyEO1bsy0nk00PT0qv0OnDfA4zqntMzKe9tABqsscA6dFjfLg8CmMRviteoXwhcqoRU/exec';

const state = {
  orders: [],
  menu: [],
  filter: 'all',
  query: '',
  confirmId: null,
  confirmAction: null,
  busy: false,
  signature: '',
  qty: {},
  addMethod: '',
  adding: false,
  loading: false,
  refreshQueued: false,
  account: null,
};

const els = {
  orders: document.getElementById('orders'),
  error: document.getElementById('adminError'),
  search: document.getElementById('search'),
  statPending: document.getElementById('statPending'),
  statPaid: document.getElementById('statPaid'),
  statReceived: document.getElementById('statReceived'),
  statRefunded: document.getElementById('statRefunded'),
  statAmount: document.getElementById('statAmount'),
  composer: document.getElementById('composer'),
  addLines: document.getElementById('addLines'),
  addError: document.getElementById('addError'),
  addName: document.getElementById('addName'),
  addMemo: document.getElementById('addMemo'),
  addSubmit: document.getElementById('addSubmit'),
};

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function formatWhen(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

function showError(message) {
  els.error.hidden = !message;
  els.error.textContent = message || '';
}

function visibleOrders() {
  const query = state.query.trim().toLowerCase();
  return state.orders.filter((order) => {
    if (state.filter !== 'all' && order.status !== state.filter) return false;
    if (!query) return true;
    return order.customerName.toLowerCase().includes(query) || order.id.toLowerCase().includes(query);
  });
}

function methodLabel(order) {
  return order.paymentMethod === 'cash' ? '현금' : '계좌이체';
}

function statusView(order) {
  if (order.status === 'paid') return { className: 'paid', label: '입금 완료' };
  if (order.status === 'received') return { className: 'received', label: '수령 완료' };
  if (order.status === 'refunded') return { className: 'refund', label: '환불' };
  return { className: 'wait', label: '입금 대기' };
}

function confirmCopy(action) {
  if (action === 'paid') {
    return {
      label: '입금 확정',
      text: '입금을 확인했습니까? 주문 화면에 완료 메시지가 표시됩니다.',
      kind: 'primary',
    };
  }
  if (action === 'received') {
    return {
      label: '수령 확정',
      text: '손님에게 전달했습니까? 주문 화면에 수령 완료가 표시됩니다.',
      kind: 'primary',
    };
  }
  return {
    label: '환불 확정',
    text: '이 주문을 환불 상태로 바꿀까요?',
    kind: 'danger',
  };
}

function renderStats() {
  const pending = state.orders.filter((order) => order.status === 'pending');
  els.statPending.textContent = String(pending.length);
  els.statPaid.textContent = String(state.orders.filter((order) => order.status === 'paid').length);
  els.statReceived.textContent = String(state.orders.filter((order) => order.status === 'received').length);
  els.statRefunded.textContent = String(state.orders.filter((order) => order.status === 'refunded').length);
  els.statAmount.textContent = won(pending.reduce((sum, order) => sum + order.total, 0));
}

function renderFilters() {
  document.querySelectorAll('[data-filter]').forEach((button) => {
    const active = button.dataset.filter === state.filter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function renderOrders() {
  const orders = visibleOrders();
  if (state.orders.length === 0) {
    els.orders.innerHTML = '<p class="empty">아직 주문이 없습니다. 주문 화면에서 결제하기를 누르면 여기에 나타납니다.</p>';
    return;
  }
  if (orders.length === 0) {
    els.orders.innerHTML = '<p class="empty">조건에 맞는 주문이 없습니다.</p>';
    return;
  }
  els.orders.innerHTML = orders.map((order) => {
    const view = statusView(order);
    const confirming = state.confirmId === order.id;
    const items = order.items.map((item) => `
      <li><span>${esc(item.name)} × ${item.qty}</span><span>${won(item.price * item.qty)}</span></li>
    `).join('');
    const confirm = confirmCopy(state.confirmAction);
    const action = confirming
      ? `<div class="confirm-box">
          <p>${confirm.text}</p>
          <div class="confirm-actions">
            <button type="button" class="btn ghost compact" data-cancel-action>돌아가기</button>
            <button type="button" class="btn ${confirm.kind} compact" data-confirm-id="${esc(order.id)}" ${state.busy ? 'disabled' : ''}>${state.busy ? '변경 중' : confirm.label}</button>
          </div>
        </div>`
      : `<div class="order-actions">
          ${order.status === 'pending' ? `<button type="button" class="btn primary compact" data-ask-paid="${esc(order.id)}">입금 완료</button>` : ''}
          ${order.status === 'paid' ? `<button type="button" class="btn primary compact" data-ask-received="${esc(order.id)}">수령 완료</button>` : ''}
          ${order.status !== 'refunded' ? `<button type="button" class="btn ghost compact" data-ask-refund="${esc(order.id)}">환불 상태로 변경</button>` : ''}
        </div>`;
    const account = order.account
      ? `<p class="order-account">${esc(order.account.bank)} ${esc(order.account.number)} · ${esc(order.account.holder)}</p>`
      : '';
    const stamp = [
      order.paidAt ? `입금 완료 ${esc(formatWhen(order.paidAt))}` : '',
      order.receivedAt ? `수령 완료 ${esc(formatWhen(order.receivedAt))}` : '',
      order.status === 'refunded' ? `환불 처리 ${esc(formatWhen(order.refundedAt))}` : '',
    ].filter(Boolean).map((line) => `<p class="order-account">${line}</p>`).join('');
    return `
      <article class="order">
        <div class="order-top">
          <div>
            <h2>${esc(order.customerName)}</h2>
            <p class="order-id">${esc(order.id)} · ${methodLabel(order)}${order.source === 'admin' ? ' · 관리자 등록' : ''}</p>
          </div>
          <span class="pill ${view.className}">${view.label}</span>
        </div>
        <time datetime="${esc(order.createdAt)}">${esc(formatWhen(order.createdAt))}</time>
        <ul>${items}</ul>
        ${order.memo ? `<p class="memo">${esc(order.memo)}</p>` : ''}
        ${account}
        <div class="order-total"><span>합계</span><strong>${won(order.total)}</strong></div>
        ${stamp}
        ${action}
      </article>
    `;
  }).join('');
}

function render() {
  renderStats();
  renderFilters();
  renderOrders();
}

function sheetListMessage() {
  return '스프레드시트 목록을 아직 받지 못했습니다. Apps Script의 doGet이 주문 목록을 돌려주도록 저장한 뒤, 배포를 새 버전으로 올려 주세요.';
}

async function readSheet(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(sheetListMessage());
  }
}

async function postSheet(payload) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(SHEET_URL, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (response.type === 'opaqueredirect' || response.status === 0 || response.status === 302) {
      return { ok: true };
    }
    const data = await readSheet(response);
    if (!response.ok || data.ok === false) throw new Error(data.error || '요청을 처리하지 못했습니다.');
    return data;
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('스프레드시트 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.');
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function toSheetOrder(row) {
  const menuById = new Map(state.menu.map((item) => [item.id, item]));
  const items = ['sotteok', 'chillis', 'sausage'].flatMap((id) => {
    const qty = Number(row[id]) || 0;
    if (qty < 1) return [];
    const menu = menuById.get(id);
    return [{ id, name: menu ? menu.name : id, price: menu ? menu.price : 0, qty }];
  });
  const paymentMethod = row.paymentMethod === 'cash' ? 'cash' : 'transfer';
  return {
    id: String(row.id),
    createdAt: row.createdAt,
    customerName: row.customerName,
    memo: row.memo || '',
    items,
    total: Number(row.total) || items.reduce((sum, item) => sum + item.price * item.qty, 0),
    paymentMethod,
    status: row.status || 'pending',
    account: paymentMethod === 'transfer' ? state.account : null,
  };
}

async function load() {
  const refreshButton = document.getElementById('refresh');
  if (state.loading) {
    state.refreshQueued = true;
    return;
  }
  state.loading = true;
  if (refreshButton) refreshButton.textContent = '불러오는 중';
  try {
    const response = await fetch(`/api/sheet-orders?t=${Date.now()}`, { cache: 'no-store' });
    const data = await readSheet(response);
    if (!response.ok || data.ok === false || !Array.isArray(data.orders)) {
      throw new Error(data.error || sheetListMessage());
    }
    const signature = JSON.stringify(data);
    if (signature === state.signature) return;
    state.signature = signature;
    state.orders = data.orders.map(toSheetOrder);
    if (state.confirmId) {
      const current = data.orders.find((order) => order.id === state.confirmId);
      const stale = !current
        || (state.confirmAction === 'paid' && current.status !== 'pending')
        || (state.confirmAction === 'received' && current.status !== 'paid')
        || (state.confirmAction === 'refund' && current.status === 'refunded');
      if (stale) {
        state.confirmId = null;
        state.confirmAction = null;
      }
    }
    showError('');
    render();
  } catch (error) {
    showError(error.message || '주문을 불러오지 못했습니다.');
    if (state.orders.length === 0) {
      els.orders.innerHTML = `<p class="empty">${esc(error.message || sheetListMessage())}</p>`;
    }
  } finally {
    state.loading = false;
    if (refreshButton) refreshButton.textContent = '새로고침';
    if (state.refreshQueued) {
      state.refreshQueued = false;
      load();
    }
  }
}

function showAddError(message) {
  els.addError.hidden = !message;
  els.addError.textContent = message || '';
}

function readQty() {
  els.addLines.querySelectorAll('[data-menu-qty]').forEach((input) => {
    const qty = Number(input.value);
    state.qty[input.dataset.menuQty] = Number.isInteger(qty) ? Math.min(99, Math.max(0, qty)) : 0;
  });
}

function renderDraft() {
  readQty();
  if (state.menu.length === 0) {
    els.addLines.innerHTML = '<p class="empty">메뉴를 불러오지 못했습니다.</p>';
  } else {
    els.addLines.innerHTML = state.menu.map((item) => `
      <label class="line-edit">
        <span>${esc(item.name)} · ${won(item.price)}</span>
        <input data-menu-qty="${esc(item.id)}" type="number" min="0" max="99" value="${state.qty[item.id] || 0}" aria-label="${esc(item.name)} 수량">
      </label>
    `).join('');
  }
  document.getElementById('addCash').classList.toggle('selected', state.addMethod === 'cash');
  document.getElementById('addTransfer').classList.toggle('selected', state.addMethod === 'transfer');
}

function openComposer() {
  els.composer.hidden = false;
  renderDraft();
  els.addName.focus();
}

function closeComposer() {
  els.composer.hidden = true;
  showAddError('');
}

async function submitComposer() {
  if (state.adding) return;
  readQty();
  const customerName = els.addName.value.trim();
  const items = state.menu
    .filter((item) => state.qty[item.id] > 0)
    .map((item) => ({ id: item.id, qty: state.qty[item.id] }));
  if (!customerName) {
    showAddError('주문자 이름을 입력해 주세요.');
    els.addName.focus();
    return;
  }
  if (!state.addMethod) {
    showAddError('결제 방법을 선택해 주세요.');
    return;
  }
  if (items.length === 0) {
    showAddError('메뉴를 하나 이상 선택해 주세요.');
    return;
  }
  state.adding = true;
  els.addSubmit.disabled = true;
  showAddError('');
  try {
    const data = await postSheet({
      customerName,
      memo: els.addMemo.value,
      paymentMethod: state.addMethod,
      items,
    });
    if (data.ok === false) throw new Error(data.error || '주문을 추가하지 못했습니다.');
    els.addName.value = '';
    els.addMemo.value = '';
    state.addMethod = '';
    state.qty = {};
    closeComposer();
    state.signature = '';
    await load();
    data.id && document.getElementById('orders')?.querySelector('article')?.scrollIntoView({ block: 'nearest' });
  } catch (error) {
    showAddError(error.message || '주문을 추가하지 못했습니다.');
  } finally {
    state.adding = false;
    els.addSubmit.disabled = false;
  }
}

async function applyStatus(id) {
  const action = state.confirmAction;
  const expected = action === 'refund' ? 'refunded' : action;
  state.busy = true;
  renderOrders();
  try {
    await postSheet({ action: 'status', id, status: expected });
    state.confirmId = null;
    state.confirmAction = null;
    state.signature = '';
    await load();
    const updated = state.orders.find((order) => order.id === String(id));
    if (!updated || updated.status !== expected) {
      throw new Error('스프레드시트의 상태가 바뀌지 않았습니다. 주문번호가 시트의 주문번호와 같은지 확인해 주세요.');
    }
    showError('');
    render();
  } catch (error) {
    showError(error.message || '상태를 바꾸지 못했습니다.');
    renderOrders();
  } finally {
    state.busy = false;
    renderOrders();
  }
}

document.body.addEventListener('click', (event) => {
  const filter = event.target.closest('[data-filter]');
  const askPaid = event.target.closest('[data-ask-paid]');
  const askReceived = event.target.closest('[data-ask-received]');
  const askRefund = event.target.closest('[data-ask-refund]');
  const cancel = event.target.closest('[data-cancel-action]');
  const confirm = event.target.closest('[data-confirm-id]');
  const method = event.target.closest('[data-add-method]');
  if (filter) {
    state.filter = filter.dataset.filter;
    render();
  }
  if (askPaid) {
    state.confirmId = askPaid.dataset.askPaid;
    state.confirmAction = 'paid';
    showError('');
    renderOrders();
  }
  if (askReceived) {
    state.confirmId = askReceived.dataset.askReceived;
    state.confirmAction = 'received';
    showError('');
    renderOrders();
  }
  if (askRefund) {
    state.confirmId = askRefund.dataset.askRefund;
    state.confirmAction = 'refund';
    showError('');
    renderOrders();
  }
  if (cancel) {
    state.confirmId = null;
    state.confirmAction = null;
    renderOrders();
  }
  if (confirm && !state.busy) applyStatus(confirm.dataset.confirmId);
  if (method) {
    state.addMethod = method.dataset.addMethod;
    showAddError('');
    renderDraft();
  }
});

document.getElementById('toggleComposer').addEventListener('click', () => {
  if (els.composer.hidden) openComposer();
  else closeComposer();
});
document.getElementById('addCancel').addEventListener('click', closeComposer);
els.addSubmit.addEventListener('click', submitComposer);

els.search.addEventListener('input', () => {
  state.query = els.search.value;
  renderOrders();
});
document.getElementById('refresh').addEventListener('click', load);

async function loadMenu() {
  for (const url of ['menu.json', '/api/menu']) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const menu = await response.json();
      if (!Array.isArray(menu) || menu.length === 0) continue;
      state.menu = menu;
      if (!els.composer.hidden) renderDraft();
      return;
    } catch {
      // 다음 주소에서 다시 시도합니다.
    }
  }
  if (!els.composer.hidden) renderDraft();
}

function beginAdmin() {
  loadMenu();
  fetch('meta.json')
    .then((response) => response.ok ? response.json() : null)
    .then((meta) => {
      if (meta?.account?.bank && meta.account.number && meta.account.holder) state.account = meta.account;
      if (!meta?.shopName) return;
      document.title = `${meta.shopName} 주문 관리`;
      document.querySelectorAll('.brand-name').forEach((node) => { node.textContent = meta.shopName; });
      const seal = document.querySelector('.seal');
      if (seal) seal.textContent = meta.shopName.slice(0, 1);
    })
    .catch(() => {});
  load();
  window.setInterval(() => {
    if (state.confirmId || state.busy || state.loading || document.hidden) return;
    load();
  }, 15000);
}

const adminLock = document.getElementById('adminLock');
const adminMain = document.getElementById('adminMain');
const adminPinInput = document.getElementById('adminPin');
const adminLockError = document.getElementById('adminLockError');

document.getElementById('adminLockForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const pin = adminPinInput.value.trim();
  if (!/^\d{4}$/.test(pin)) {
    adminLockError.hidden = false;
    adminLockError.textContent = '숫자 4자리를 입력해 주세요.';
    adminPinInput.focus();
    return;
  }
  adminLockError.hidden = true;
  try {
    const response = await fetch('/api/admin/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    const text = await response.text();
    let data = {};
    try { data = JSON.parse(text); } catch { data = null; }
    if (!data) {
      throw new Error('비밀번호 확인은 이 컴퓨터에서 서버를 켠 뒤 http://127.0.0.1:3000/admin 에서 할 수 있습니다.');
    }
    if (!response.ok || !data.ok) {
      throw new Error(data.error || '비밀번호가 맞지 않습니다.');
    }
    adminLock.hidden = true;
    adminMain.hidden = false;
    beginAdmin();
  } catch (error) {
    adminLockError.hidden = false;
    adminLockError.textContent = error.message || '비밀번호가 맞지 않습니다.';
    adminPinInput.select();
  }
});

adminPinInput.focus();
