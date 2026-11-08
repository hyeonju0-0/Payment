const won = (value) => `${new Intl.NumberFormat('ko-KR').format(value)}원`;

const state = {
  menu: [],
  category: '전체',
  cart: readCart(),
  submitting: false,
  watching: null,
  renderedStatus: '',
  pollTimer: 0,
};

const els = {
  categories: document.getElementById('categories'),
  menu: document.getElementById('menu'),
  cart: document.getElementById('cart'),
  cartItems: document.getElementById('cartItems'),
  cartCount: document.getElementById('cartCount'),
  total: document.getElementById('total'),
  pay: document.getElementById('pay'),
  name: document.getElementById('customerName'),
  memo: document.getElementById('memo'),
  formError: document.getElementById('formError'),
  fab: document.getElementById('cartFab'),
  fabCount: document.getElementById('fabCount'),
  fabTotal: document.getElementById('fabTotal'),
  backdrop: document.getElementById('sheetBackdrop'),
  modal: document.getElementById('modal'),
  receiptOrder: document.getElementById('receiptOrder'),
  receiptMeta: document.getElementById('receiptMeta'),
  receiptItems: document.getElementById('receiptItems'),
  accountBank: document.getElementById('accountBank'),
  accountNumber: document.getElementById('accountNumber'),
  accountHolder: document.getElementById('accountHolder'),
  receiptTotal: document.getElementById('receiptTotal'),
  copyStatus: document.getElementById('copyStatus'),
  copyAccount: document.getElementById('copyAccount'),
  choice: document.getElementById('choiceModal'),
  choiceError: document.getElementById('choiceError'),
  chooseCash: document.getElementById('chooseCash'),
  chooseTransfer: document.getElementById('chooseTransfer'),
  waitView: document.getElementById('waitView'),
  paidView: document.getElementById('paidView'),
  waitKicker: document.getElementById('waitKicker'),
  waitDetail: document.getElementById('waitDetail'),
  paidDetail: document.getElementById('paidDetail'),
  paidKicker: document.getElementById('paidKicker'),
  paidTitle: document.getElementById('paidTitle'),
  accountBlock: document.getElementById('accountBlock'),
  amountLabel: document.getElementById('amountLabel'),
  receiptTitle: document.getElementById('receiptTitle'),
};

const mobileQuery = window.matchMedia('(max-width: 900px)');

function readCart() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem('ondam-cart') || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persistCart() {
  try {
    sessionStorage.setItem('ondam-cart', JSON.stringify(state.cart));
  } catch {
    // 저장을 막아 둔 브라우저에서도 이번 화면의 장바구니는 유지됩니다.
  }
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function cartLines() {
  return state.menu
    .filter((item) => state.cart[item.id] > 0)
    .map((item) => ({ ...item, qty: state.cart[item.id] }));
}

function cartCount() {
  return cartLines().reduce((sum, item) => sum + item.qty, 0);
}

function cartTotal() {
  return cartLines().reduce((sum, item) => sum + item.price * item.qty, 0);
}

function setQty(id, qty) {
  if (!state.menu.some((item) => item.id === id)) return;
  if (qty <= 0) delete state.cart[id];
  else state.cart[id] = Math.min(99, qty);
  persistCart();
  render();
}

function showError(message) {
  els.formError.hidden = !message;
  els.formError.textContent = message || '';
}

function setCartOpen(open) {
  els.cart.classList.toggle('open', open);
  els.backdrop.hidden = !open;
  syncLock();
  if (open) els.name.focus();
}

function syncLock() {
  const cartOpen = els.cart.classList.contains('open') && mobileQuery.matches;
  const choiceOpen = !els.choice.hidden;
  document.body.classList.toggle('lock', cartOpen || choiceOpen || !els.modal.hidden);
}

function renderCategories() {
  const categories = ['전체', ...new Set(state.menu.map((item) => item.category))];
  els.categories.innerHTML = categories.map((category) => `
    <button type="button" class="chip${category === state.category ? ' active' : ''}" data-cat="${esc(category)}" aria-pressed="${category === state.category}">
      ${esc(category)}
    </button>
  `).join('');
}

function renderMenu() {
  const visible = state.menu.filter((item) => state.category === '전체' || item.category === state.category);
  if (visible.length === 0) {
    els.menu.innerHTML = '<p class="empty">보여줄 메뉴가 없습니다.</p>';
    return;
  }
  els.menu.innerHTML = visible.map((item) => {
    const qty = state.cart[item.id] || 0;
    return `
      <article class="card" data-category="${esc(item.category)}">
        <h2>${esc(item.name)}</h2>
        <p>${esc(item.description || '')}</p>
        <div class="card-row">
          <span class="price">${won(item.price)}</span>
          <button type="button" class="add${qty ? ' is-in' : ''}" data-add="${esc(item.id)}">${qty ? `담김 ${qty}` : '담기'}</button>
        </div>
      </article>
    `;
  }).join('');
}

function renderCart() {
  const lines = cartLines();
  const count = cartCount();
  els.cartCount.textContent = String(count);
  els.fabCount.textContent = String(count);
  els.total.textContent = won(cartTotal());
  els.fabTotal.textContent = won(cartTotal());
  els.fab.classList.toggle('has-items', count > 0);
  els.pay.disabled = count === 0 || state.submitting;
  els.pay.textContent = state.submitting ? '접수 중' : '결제하기';
  if (lines.length === 0) {
    els.cartItems.innerHTML = '<p class="empty">메뉴를 먼저 골라 주세요.</p>';
    return;
  }
  els.cartItems.innerHTML = lines.map((item) => `
    <div class="line">
      <div class="line-main">
        <strong>${esc(item.name)}</strong>
        <span>${won(item.price)}</span>
      </div>
      <div class="line-actions">
        <div class="stepper">
          <button type="button" class="qty-btn" data-dec="${esc(item.id)}" aria-label="${esc(item.name)} 수량 줄이기">−</button>
          <span class="qty-value">${item.qty}</span>
          <button type="button" class="qty-btn" data-inc="${esc(item.id)}" aria-label="${esc(item.name)} 수량 늘리기">+</button>
        </div>
        <b>${won(item.price * item.qty)}</b>
        <button type="button" class="text-btn" data-remove="${esc(item.id)}">삭제</button>
      </div>
    </div>
  `).join('');
}

function render() {
  renderCategories();
  renderMenu();
  renderCart();
}

function methodLabel(method) {
  return method === 'cash' ? '현금' : '계좌이체';
}

function renderReceipt(order) {
  const statusKey = `${order.id}:${order.status}`;
  if (state.renderedStatus === statusKey && !els.modal.hidden) return;
  state.renderedStatus = statusKey;
  const paid = order.status === 'paid';
  const received = order.status === 'received';
  const refunded = order.status === 'refunded';
  const settled = paid || received || refunded;
  const transfer = order.paymentMethod !== 'cash' && order.account;
  els.waitView.hidden = settled;
  els.paidView.hidden = !settled;
  els.accountBlock.hidden = !transfer || settled;
  if (received) {
    els.paidKicker.textContent = '수령 완료';
    els.paidTitle.textContent = '수령이 완료되었습니다';
    els.paidDetail.textContent = `${order.customerName} 님의 주문을 전달했습니다.`;
  } else if (paid) {
    els.paidKicker.textContent = '입금 완료';
    els.paidTitle.textContent = '입금이 완료되었습니다';
    els.paidDetail.textContent = `${order.customerName} 님의 ${methodLabel(order.paymentMethod)} 결제가 확인되었습니다.`;
  } else if (refunded) {
    els.paidKicker.textContent = '환불';
    els.paidTitle.textContent = '환불된 주문입니다';
    els.paidDetail.textContent = '이 주문은 환불 상태로 변경되었습니다.';
  } else if (transfer) {
    els.waitKicker.textContent = '주문이 접수되었습니다';
    els.receiptTitle.textContent = '입금 계좌';
    els.waitDetail.textContent = '계좌로 입금해 주세요. 관리자가 입금을 확인하면 이 화면에 완료 메시지가 나타납니다.';
  } else {
    els.waitKicker.textContent = '주문이 접수되었습니다';
    els.receiptTitle.textContent = '현금 결제';
    els.waitDetail.textContent = '현금으로 접수되었습니다. 확인되면 이 화면에 입금 완료 메시지가 나타납니다.';
  }
  els.receiptOrder.textContent = `${order.id} · ${order.customerName} · ${methodLabel(order.paymentMethod)}`;
  els.receiptMeta.innerHTML = order.memo ? `<dt>요청</dt><dd>${esc(order.memo)}</dd>` : '';
  els.receiptItems.innerHTML = order.items.map((item) => `
    <li><span>${esc(item.name)} × ${item.qty}</span><span>${won(item.price * item.qty)}</span></li>
  `).join('');
  els.amountLabel.textContent = transfer && !settled ? '입금액' : '결제 금액';
  els.receiptTotal.textContent = won(order.total);
  if (transfer && !settled) {
    els.accountBank.textContent = order.account.bank;
    els.accountNumber.textContent = order.account.number;
    els.accountHolder.textContent = `예금주 ${order.account.holder}`;
    els.copyStatus.textContent = '';
    els.copyStatus.classList.remove('is-error');
    els.copyAccount.textContent = '계좌번호 복사';
    els.copyAccount.dataset.number = order.account.number;
  }
  els.modal.hidden = false;
  els.modal.querySelector('.receipt').setAttribute('aria-labelledby', settled ? 'paidTitle' : 'receiptTitle');
  syncLock();
  if (settled) els.paidTitle.focus();
  else if (transfer) els.copyAccount.focus();
}

function stopWatch() {
  window.clearInterval(state.pollTimer);
  state.pollTimer = 0;
  state.watching = null;
  state.renderedStatus = '';
  try { sessionStorage.removeItem('ondam-watch'); } catch { /* 무시 */ }
  if (location.search) history.replaceState({}, '', '/');
}

function watchOrder(order) {
  state.watching = order;
  try { sessionStorage.setItem('ondam-watch', order.id); } catch { /* 무시 */ }
  history.replaceState({}, '', `/?order=${encodeURIComponent(order.id)}`);
  renderReceipt(order);
  window.clearInterval(state.pollTimer);
  state.pollTimer = window.setInterval(refreshWatch, 2000);
}

async function refreshWatch() {
  if (!state.watching) return;
  try {
    const response = await fetch(`/api/orders/${state.watching.id}`, { cache: 'no-store' });
    if (!response.ok) return;
    const order = await response.json();
    const changed = order.status !== state.watching.status;
    state.watching = order;
    if (!changed) return;
    renderReceipt(order);
  } catch {
    // 다음 확인에서 다시 시도합니다.
  }
}

function closeReceipt() {
  const finished = state.watching && state.watching.status !== 'pending';
  els.modal.hidden = true;
  syncLock();
  if (finished) stopWatch();
  els.pay.focus();
}

function openChoice() {
  const lines = cartLines();
  if (lines.length === 0) {
    showError('장바구니에 메뉴를 담아 주세요.');
    return;
  }
  if (!els.name.value.trim()) {
    showError('주문자 이름을 입력해 주세요.');
    els.name.focus();
    return;
  }
  showError('');
  els.choiceError.hidden = true;
  els.choice.hidden = false;
  syncLock();
  els.chooseTransfer.focus();
}

function closeChoice() {
  if (state.submitting) return;
  els.choice.hidden = true;
  syncLock();
  els.pay.focus();
}

function copyWithSelection(number) {
  const area = document.createElement('textarea');
  area.value = number;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.fontSize = '16px';
  document.body.appendChild(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, area.value.length);
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  if (copied) return true;

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(els.accountNumber);
  selection.removeAllRanges();
  selection.addRange(range);
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

async function copyAccount() {
  const number = els.copyAccount.dataset.number || els.accountNumber.textContent;
  let copied = copyWithSelection(number);
  if (!copied && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(number);
      copied = true;
    } catch {
      copied = false;
    }
  }
  if (!copied) {
    els.copyStatus.classList.add('is-error');
    els.copyAccount.textContent = '계좌번호 복사';
    els.copyStatus.textContent = '복사하지 못했습니다. 계좌번호를 직접 선택해 주세요.';
    return;
  }
  window.getSelection()?.removeAllRanges();
  els.copyStatus.classList.remove('is-error');
  els.copyAccount.textContent = '복사했습니다';
  els.copyStatus.textContent = `${number} 를 복사했습니다.`;
  window.setTimeout(() => {
    if (!els.modal.hidden) els.copyAccount.textContent = '계좌번호 복사';
  }, 1800);
}

async function submitOrder(paymentMethod) {
  if (state.submitting) return;
  const lines = cartLines();
  const customerName = els.name.value.trim();
  if (lines.length === 0 || !customerName) {
    closeChoice();
    openChoice();
    return;
  }
  state.submitting = true;
  els.chooseCash.disabled = true;
  els.chooseTransfer.disabled = true;
  els.choiceError.hidden = true;
  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName,
        memo: els.memo.value,
        paymentMethod,
        items: lines.map((item) => ({ id: item.id, qty: item.qty })),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '주문을 접수하지 못했습니다.');
    state.cart = {};
    persistCart();
    els.memo.value = '';
    setCartOpen(false);
    els.choice.hidden = true;
    render();
    watchOrder(data);
  } catch (error) {
    els.choiceError.hidden = false;
    els.choiceError.textContent = error.message || '주문을 접수하지 못했습니다.';
  } finally {
    state.submitting = false;
    els.chooseCash.disabled = false;
    els.chooseTransfer.disabled = false;
    renderCart();
  }
}

function onClick(event) {
  const add = event.target.closest('[data-add]');
  const inc = event.target.closest('[data-inc]');
  const dec = event.target.closest('[data-dec]');
  const remove = event.target.closest('[data-remove]');
  const category = event.target.closest('[data-cat]');
  if (add) setQty(add.dataset.add, (state.cart[add.dataset.add] || 0) + 1);
  if (inc) setQty(inc.dataset.inc, (state.cart[inc.dataset.inc] || 0) + 1);
  if (dec) setQty(dec.dataset.dec, (state.cart[dec.dataset.dec] || 0) - 1);
  if (remove) setQty(remove.dataset.remove, 0);
  if (category) {
    state.category = category.dataset.cat;
    render();
  }
}

async function init() {
  try {
    const savedName = sessionStorage.getItem('ondam-name');
    if (savedName) els.name.value = savedName;
  } catch {
    // 이름 복원 실패는 입력만 비워 둡니다.
  }
  els.name.addEventListener('input', () => {
    showError('');
    try { sessionStorage.setItem('ondam-name', els.name.value); } catch { /* 무시 */ }
  });
  els.memo.addEventListener('input', () => showError(''));
  els.pay.addEventListener('click', openChoice);
  els.name.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') openChoice();
  });
  els.chooseCash.addEventListener('click', () => submitOrder('cash'));
  els.chooseTransfer.addEventListener('click', () => submitOrder('transfer'));
  document.getElementById('closeChoice').addEventListener('click', closeChoice);
  els.choice.querySelector('[data-close-choice]').addEventListener('click', closeChoice);
  els.fab.addEventListener('click', () => setCartOpen(true));
  document.getElementById('cartClose').addEventListener('click', () => setCartOpen(false));
  els.backdrop.addEventListener('click', () => setCartOpen(false));
  document.getElementById('copyAccount').addEventListener('click', copyAccount);
  document.getElementById('closeModal').addEventListener('click', closeReceipt);
  els.modal.querySelector('[data-close-modal]').addEventListener('click', closeReceipt);
  document.body.addEventListener('click', onClick);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!els.choice.hidden) closeChoice();
    else if (!els.modal.hidden) closeReceipt();
    else setCartOpen(false);
  });
  mobileQuery.addEventListener('change', syncLock);

  try {
    const [metaRes, menuRes] = await Promise.all([fetch('meta.json'), fetch('menu.json')]);
    if (!menuRes.ok) throw new Error('메뉴를 불러오지 못했습니다.');
    const meta = metaRes.ok ? await metaRes.json() : null;
    if (meta?.shopName) {
      document.title = `${meta.shopName} 주문`;
      document.querySelectorAll('.brand-name').forEach((node) => { node.textContent = meta.shopName; });
      const seal = document.querySelector('.seal');
      if (seal) seal.textContent = meta.shopName.slice(0, 1);
    }
    if (meta?.tagline) {
      document.querySelectorAll('.brand-sub').forEach((node) => { node.textContent = meta.tagline; });
    }
    state.menu = await menuRes.json();
    for (const id of Object.keys(state.cart)) {
      const qty = state.cart[id];
      if (!state.menu.some((item) => item.id === id) || !Number.isInteger(qty) || qty < 1) delete state.cart[id];
    }
    render();
    const requested = new URLSearchParams(location.search).get('order');
    let saved = '';
    try { saved = sessionStorage.getItem('ondam-watch') || ''; } catch { saved = ''; }
    const orderId = requested || saved;
    if (/^\d+$/.test(orderId)) {
      const response = await fetch(`/api/orders/${orderId}`, { cache: 'no-store' });
      if (response.ok) watchOrder(await response.json());
    }
  } catch (error) {
    els.menu.innerHTML = `<p class="empty">${esc(error.message || '메뉴를 불러오지 못했습니다.')}</p>`;
  }
}

init();
