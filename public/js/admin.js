const won = (value) => `${new Intl.NumberFormat('ko-KR').format(value)}원`;

const state = {
  orders: [],
  menu: [],
  filter: 'all',
  query: '',
  confirmId: null,
  confirmAction: null,
  busy: false,
  signature: '',
  draft: [],
  draftKey: 1,
  addMethod: '',
  adding: false,
};

const els = {
  orders: document.getElementById('orders'),
  error: document.getElementById('adminError'),
  search: document.getElementById('search'),
  statPending: document.getElementById('statPending'),
  statPaid: document.getElementById('statPaid'),
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
  if (order.status === 'refunded') return { className: 'refund', label: '환불' };
  return { className: 'wait', label: '입금 대기' };
}

function renderStats() {
  const pending = state.orders.filter((order) => order.status === 'pending');
  els.statPending.textContent = String(pending.length);
  els.statPaid.textContent = String(state.orders.filter((order) => order.status === 'paid').length);
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
    const confirmLabel = state.confirmAction === 'paid' ? '입금 확정' : '환불 확정';
    const confirmText = state.confirmAction === 'paid'
      ? '입금을 확인했습니까? 주문 화면에 완료 메시지가 표시됩니다.'
      : '이 주문을 환불 상태로 바꿀까요?';
    const action = confirming
      ? `<div class="confirm-box">
          <p>${confirmText}</p>
          <div class="confirm-actions">
            <button type="button" class="btn ghost compact" data-cancel-action>돌아가기</button>
            <button type="button" class="btn ${state.confirmAction === 'paid' ? 'primary' : 'danger'} compact" data-confirm-id="${esc(order.id)}" ${state.busy ? 'disabled' : ''}>${state.busy ? '변경 중' : confirmLabel}</button>
          </div>
        </div>`
      : `<div class="order-actions">
          ${order.status === 'pending' ? `<button type="button" class="btn primary compact" data-ask-paid="${esc(order.id)}">입금 완료</button>` : ''}
          ${order.status !== 'refunded' ? `<button type="button" class="btn ghost compact" data-ask-refund="${esc(order.id)}">환불 상태로 변경</button>` : ''}
        </div>`;
    const account = order.account
      ? `<p class="order-account">${esc(order.account.bank)} ${esc(order.account.number)} · ${esc(order.account.holder)}</p>`
      : '';
    const stamp = order.status === 'paid'
      ? `<p class="order-account">입금 완료 ${esc(formatWhen(order.paidAt))}</p>`
      : order.status === 'refunded'
        ? `<p class="order-account">환불 처리 ${esc(formatWhen(order.refundedAt))}</p>`
        : '';
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

async function load() {
  try {
    const response = await fetch('/api/orders', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '주문을 불러오지 못했습니다.');
    const signature = JSON.stringify(data);
    if (signature === state.signature) return;
    state.signature = signature;
    state.orders = data;
    if (state.confirmId) {
      const current = data.find((order) => order.id === state.confirmId);
      const stale = !current
        || (state.confirmAction === 'paid' && current.status !== 'pending')
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
  }
}

function showAddError(message) {
  els.addError.hidden = !message;
  els.addError.textContent = message || '';
}

function renderDraft() {
  const options = state.menu.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · ${won(item.price)}</option>`).join('');
  els.addLines.innerHTML = state.draft.map((line) => `
    <div class="line-edit">
      <select data-draft-menu="${line.key}" aria-label="메뉴">
        <option value="">메뉴 선택</option>
        ${options}
      </select>
      <input data-draft-qty="${line.key}" type="number" min="1" max="99" value="${line.qty}" aria-label="수량">
      <button type="button" class="text-btn" data-draft-remove="${line.key}">삭제</button>
    </div>
  `).join('');
  state.draft.forEach((line) => {
    const select = els.addLines.querySelector(`[data-draft-menu="${line.key}"]`);
    if (select) select.value = line.id;
  });
  document.getElementById('addCash').classList.toggle('selected', state.addMethod === 'cash');
  document.getElementById('addTransfer').classList.toggle('selected', state.addMethod === 'transfer');
}

function openComposer() {
  if (state.draft.length === 0) {
    state.draft = [{ key: state.draftKey++, id: '', qty: 1 }];
  }
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
  state.draft.forEach((line) => {
    const select = els.addLines.querySelector(`[data-draft-menu="${line.key}"]`);
    const qtyInput = els.addLines.querySelector(`[data-draft-qty="${line.key}"]`);
    if (select) line.id = select.value;
    if (qtyInput) {
      const qty = Number(qtyInput.value);
      line.qty = Number.isInteger(qty) && qty >= 1 ? Math.min(99, qty) : 1;
    }
  });
  const customerName = els.addName.value.trim();
  const items = state.draft
    .filter((line) => line.id)
    .map((line) => ({ id: line.id, qty: line.qty }));
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
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName,
        memo: els.addMemo.value,
        paymentMethod: state.addMethod,
        source: 'admin',
        items,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '주문을 추가하지 못했습니다.');
    els.addName.value = '';
    els.addMemo.value = '';
    state.addMethod = '';
    state.draft = [{ key: state.draftKey++, id: '', qty: 1 }];
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
  state.busy = true;
  renderOrders();
  try {
    const response = await fetch(`/api/orders/${id}/${action === 'paid' ? 'paid' : 'refund'}`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '상태를 바꾸지 못했습니다.');
    state.confirmId = null;
    state.confirmAction = null;
    const index = state.orders.findIndex((order) => order.id === id);
    if (index >= 0) state.orders[index] = data;
    state.signature = JSON.stringify(state.orders);
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

els.addLines.addEventListener('change', (event) => {
  const menuSelect = event.target.closest('[data-draft-menu]');
  const qtyInput = event.target.closest('[data-draft-qty]');
  if (menuSelect) {
    const line = state.draft.find((item) => String(item.key) === menuSelect.dataset.draftMenu);
    if (line) line.id = menuSelect.value;
  }
  if (qtyInput) {
    const line = state.draft.find((item) => String(item.key) === qtyInput.dataset.draftQty);
    const qty = Number(qtyInput.value);
    if (line) line.qty = Number.isInteger(qty) ? Math.min(99, Math.max(1, qty)) : 1;
  }
});
els.addLines.addEventListener('click', (event) => {
  const remove = event.target.closest('[data-draft-remove]');
  if (!remove) return;
  state.draft = state.draft.filter((item) => String(item.key) !== remove.dataset.draftRemove);
  if (state.draft.length === 0) state.draft = [{ key: state.draftKey++, id: '', qty: 1 }];
  renderDraft();
});
document.getElementById('addLine').addEventListener('click', () => {
  state.draft.push({ key: state.draftKey++, id: '', qty: 1 });
  renderDraft();
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
window.setInterval(() => {
  if (state.confirmId || state.busy || document.hidden) return;
  load();
}, 5000);

fetch('/api/menu')
  .then((response) => response.ok ? response.json() : [])
  .then((menu) => {
    state.menu = Array.isArray(menu) ? menu : [];
    if (!els.composer.hidden) renderDraft();
  })
  .catch(() => {});

fetch('/api/meta')
  .then((response) => response.ok ? response.json() : null)
  .then((meta) => {
    if (!meta?.shopName) return;
    document.title = `${meta.shopName} 주문 관리`;
    document.querySelectorAll('.brand-name').forEach((node) => { node.textContent = meta.shopName; });
    const seal = document.querySelector('.seal');
    if (seal) seal.textContent = meta.shopName.slice(0, 1);
  })
  .catch(() => {});

load();
