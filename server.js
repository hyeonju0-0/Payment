const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const DATA_FILE = path.resolve(__dirname, 'data', 'orders.json');
const PORT = Number(process.env.PORT) || config.port || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function assertConfig() {
  const { account, menu, shopName } = config;
  if (!shopName || !account || !account.bank || !account.number || !account.holder) {
    throw new Error('config.js 의 가게 이름과 계좌 정보를 확인해 주세요.');
  }
  if (!Array.isArray(menu) || menu.length === 0) {
    throw new Error('config.js 에 메뉴를 하나 이상 넣어 주세요.');
  }
  const ids = new Set();
  for (const item of menu) {
    if (!item.id || !/^[\w-]+$/.test(item.id) || ids.has(item.id)) {
      throw new Error('config.js 메뉴 id 가 비어 있거나 중복되었습니다.');
    }
    if (!item.category || !item.name || !Number.isInteger(item.price) || item.price < 1) {
      throw new Error(`config.js 메뉴 "${item.name || item.id}" 설정을 확인해 주세요.`);
    }
    ids.add(item.id);
  }
}

function readOrders() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function writeOrders(orders) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2), 'utf8');
}

let chain = Promise.resolve();
function withOrders(work) {
  const run = chain.then(() => work(readOrders()));
  chain = run.then(() => undefined, () => undefined);
  return run;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(httpError(413, '요청이 너무 큽니다.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(httpError(400, '요청 형식이 올바르지 않습니다.'));
      }
    });
    req.on('error', () => reject(httpError(400, '요청을 읽지 못했습니다.')));
  });
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function seoulDateId(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return parts.replaceAll('-', '');
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function createOrder(orders, body) {
  const customerName = cleanText(body.customerName, 30);
  const memo = cleanText(body.memo, 80);
  const paymentMethod = body.paymentMethod;
  if (paymentMethod !== 'cash' && paymentMethod !== 'transfer') {
    throw httpError(400, '결제 방법을 선택해 주세요.');
  }
  if (!customerName) throw httpError(400, '주문자 이름을 입력해 주세요.');
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw httpError(400, '장바구니가 비어 있습니다.');
  }
  if (body.items.length > 30) throw httpError(400, '한 번에 주문할 수 있는 메뉴는 30종까지입니다.');

  const menuById = new Map(config.menu.map((item) => [item.id, item]));
  const merged = new Map();
  for (const raw of body.items) {
    const id = String(raw?.id ?? '');
    const qty = raw?.qty;
    const menu = menuById.get(id);
    if (!menu || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      throw httpError(400, '장바구니 수량이 올바르지 않습니다.');
    }
    merged.set(id, (merged.get(id) || 0) + qty);
  }

  const items = [];
  for (const [id, qty] of merged) {
    if (qty > 99) throw httpError(400, '한 메뉴는 99개까지 주문할 수 있습니다.');
    const menu = menuById.get(id);
    items.push({ id, name: menu.name, price: menu.price, qty });
  }

  const day = seoulDateId();
  const prefix = `OD-${day}-`;
  const seq = orders.filter((order) => order.id.startsWith(prefix)).length + 1;
  const order = {
    id: prefix + String(seq).padStart(4, '0'),
    createdAt: new Date().toISOString(),
    customerName,
    memo,
    items,
    total: items.reduce((sum, item) => sum + item.price * item.qty, 0),
    paymentMethod,
    source: body.source === 'admin' ? 'admin' : 'customer',
    status: 'pending',
    paidAt: null,
    refundedAt: null,
    account: paymentMethod === 'transfer'
      ? {
        bank: config.account.bank,
        number: config.account.number,
        holder: config.account.holder,
      }
      : null,
  };
  orders.push(order);
  writeOrders(orders);
  return order;
}

function findOrder(orders, id) {
  const order = orders.find((item) => item.id === id);
  if (!order) throw httpError(404, '주문을 찾을 수 없습니다.');
  return order;
}

function markPaid(orders, id) {
  const order = findOrder(orders, id);
  if (order.status === 'refunded') throw httpError(409, '환불된 주문은 입금 완료로 바꿀 수 없습니다.');
  if (order.status === 'paid') throw httpError(409, '이미 입금 완료 상태입니다.');
  order.status = 'paid';
  order.paidAt = new Date().toISOString();
  writeOrders(orders);
  return order;
}

function refundOrder(orders, id) {
  const order = findOrder(orders, id);
  if (order.status === 'refunded') throw httpError(409, '이미 환불 상태입니다.');
  order.status = 'refunded';
  order.refundedAt = new Date().toISOString();
  writeOrders(orders);
  return order;
}

function resolveStatic(pathname) {
  let filePath = null;
  if (pathname === '/' || pathname === '/index.html') filePath = path.join(PUBLIC_DIR, 'index.html');
  else if (pathname === '/admin' || pathname === '/admin.html') filePath = path.join(PUBLIC_DIR, 'admin.html');
  else {
    if (pathname.includes('\0') || pathname.includes('..')) return null;
    const relative = pathname.replace(/^\/+/, '');
    filePath = path.resolve(PUBLIC_DIR, relative);
    if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) return null;
  }
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  return filePath;
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': body.length,
  });
  res.end(body);
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/meta') {
    send(res, 200, { shopName: config.shopName, tagline: config.tagline });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/menu') {
    send(res, 200, config.menu);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/orders') {
    const orders = readOrders().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    send(res, 200, orders);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/orders') {
    const body = await readBody(req);
    const order = await withOrders((orders) => createOrder(orders, body));
    send(res, 201, order);
    return;
  }
  const orderMatch = pathname.match(/^\/api\/orders\/(OD-\d{8}-\d{4})$/);
  if (req.method === 'GET' && orderMatch) {
    const order = readOrders().find((item) => item.id === orderMatch[1]);
    if (!order) {
      send(res, 404, { error: '주문을 찾을 수 없습니다.' });
      return;
    }
    send(res, 200, order);
    return;
  }
  const paidMatch = pathname.match(/^\/api\/orders\/(OD-\d{8}-\d{4})\/paid$/);
  if (req.method === 'POST' && paidMatch) {
    const order = await withOrders((orders) => markPaid(orders, paidMatch[1]));
    send(res, 200, order);
    return;
  }
  const refundMatch = pathname.match(/^\/api\/orders\/(OD-\d{8}-\d{4})\/refund$/);
  if (req.method === 'POST' && refundMatch) {
    const order = await withOrders((orders) => refundOrder(orders, refundMatch[1]));
    send(res, 200, order);
    return;
  }
  send(res, 404, { error: '요청한 주소를 찾을 수 없습니다.' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, { error: '지원하지 않는 요청입니다.' });
      return;
    }
    const filePath = resolveStatic(pathname);
    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('페이지를 찾을 수 없습니다.');
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end();
      return;
    }
    serveStatic(res, filePath);
  } catch (error) {
    if (res.headersSent) return;
    const status = error.status || 500;
    send(res, status, { error: status === 500 ? '잠시 후 다시 시도해 주세요.' : error.message });
  }
});

assertConfig();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`주문 화면  http://127.0.0.1:${PORT}`);
  console.log(`관리자 화면  http://127.0.0.1:${PORT}/admin`);
});
