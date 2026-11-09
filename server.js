const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const config = require('./config');

let localConfig = {};
try {
  localConfig = require('./config.local');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const PORT = Number(process.env.PORT) || config.port || 3000;
const FOOD_IDS = ['sotteok', 'chillis', 'sausage'];
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/15v24MlB6YiU13tjwvIi6VqaHjilhXXoEyyvFgSvsVZI/export?format=csv&gid=0';
const dbPassword = process.env.DB_PASSWORD || localConfig.password || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function assertConfig() {
  const { account, menu, shopName, db } = config;
  if (!shopName || !account || !account.bank || !account.number || !account.holder) {
    throw new Error('config.js 의 가게 이름과 계좌 정보를 확인해 주세요.');
  }
  if (!db || !db.host || !db.user || !db.database || !db.port) {
    throw new Error('config.js 의 데이터베이스 접속 정보를 확인해 주세요.');
  }
  if (!dbPassword) {
    throw new Error('데이터베이스 비밀번호가 없습니다. config.local.js 의 password 또는 DB_PASSWORD를 설정해 주세요.');
  }
  if (!Array.isArray(menu) || menu.length !== FOOD_IDS.length) {
    throw new Error('config.js 메뉴는 소떡, 칠리, 소시지 세 개여야 합니다.');
  }
  const ids = new Set();
  for (const item of menu) {
    if (!FOOD_IDS.includes(item.id) || ids.has(item.id)) {
      throw new Error('config.js 메뉴 id는 sotteok, chillis, sausage 여야 합니다.');
    }
    if (!item.category || !item.name || !Number.isInteger(item.price) || item.price < 1) {
      throw new Error(`config.js 메뉴 "${item.name || item.id}" 설정을 확인해 주세요.`);
    }
    ids.add(item.id);
  }
}

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: dbPassword,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  timezone: '+09:00',
  dateStrings: true,
  ssl: { rejectUnauthorized: false },
});

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

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function toIso(value) {
  if (!value) return null;
  const text = String(value).replace(' ', 'T');
  return text.length === 19 ? `${text}+09:00` : text;
}

function statusOf(row) {
  if (Number(row.refund) === 1) return 'refunded';
  if (Number(row.received) === 1) return 'received';
  if (Number(row.confirmed_payment) === 1) return 'paid';
  return 'pending';
}

function toOrder(row) {
  const menuById = new Map(config.menu.map((item) => [item.id, item]));
  const items = FOOD_IDS.flatMap((id) => {
    const qty = Number(row[id]) || 0;
    if (qty < 1) return [];
    const menu = menuById.get(id);
    return [{ id, name: menu.name, price: menu.price, qty }];
  });
  const paymentMethod = row.payment_method;
  return {
    id: String(row.order_number),
    createdAt: toIso(row.created_at),
    customerName: row.name,
    memo: row.memo || '',
    items,
    total: Number(row.total),
    paymentMethod,
    status: statusOf(row),
    paidAt: toIso(row.confirmed_at),
    receivedAt: toIso(row.received_at),
    refundedAt: toIso(row.refunded_at),
    account: paymentMethod === 'transfer'
      ? {
        bank: config.account.bank,
        number: config.account.number,
        holder: config.account.holder,
      }
      : null,
  };
}

const ORDER_SELECT = `
  SELECT f.order_number, f.sotteok, f.chillis, f.sausage,
         o.name, o.memo, o.payment_method, o.total, o.created_at,
         s.awaiting_payment, s.confirmed_payment, s.received, s.refund,
         s.confirmed_at, s.received_at, s.refunded_at
  FROM food f
  JOIN \`order\` o ON o.order_number = f.order_number
  JOIN state s ON s.order_number = o.order_number
`;

function mapDbError(error) {
  if (error.status) return error;
  if (error.code === 'ER_DATA_TOO_LONG') return httpError(400, '이름 또는 메모가 너무 깁니다.');
  if (error.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD' || error.errno === 1265) {
    return httpError(400, '결제 방법은 현금 또는 계좌이체만 가능합니다.');
  }
  if (error.code === 'ER_CHECK_CONSTRAINT_VIOLATED' || error.errno === 3819) {
    return httpError(400, '주문 값이 데이터베이스 규칙에 맞지 않습니다.');
  }
  console.error(error);
  return httpError(500, '잠시 후 다시 시도해 주세요.');
}

async function listOrders() {
  const [rows] = await pool.execute(`${ORDER_SELECT} ORDER BY o.created_at DESC, f.order_number DESC`);
  return rows.map(toOrder);
}

async function getOrder(orderNumber) {
  const [rows] = await pool.execute(`${ORDER_SELECT} WHERE f.order_number = ?`, [orderNumber]);
  if (!rows.length) throw httpError(404, '주문을 찾을 수 없습니다.');
  return toOrder(rows[0]);
}

function orderNumberFromId(id) {
  if (!/^\d+$/.test(id)) throw httpError(404, '주문을 찾을 수 없습니다.');
  return Number(id);
}

async function createOrder(body) {
  const customerName = cleanText(body.customerName, 45);
  const memo = cleanText(body.memo, 100);
  const paymentMethod = body.paymentMethod;
  if (paymentMethod !== 'cash' && paymentMethod !== 'transfer') {
    throw httpError(400, '결제 방법을 선택해 주세요.');
  }
  if (!customerName) throw httpError(400, '주문자 이름을 입력해 주세요.');
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw httpError(400, '장바구니가 비어 있습니다.');
  }

  const menuById = new Map(config.menu.map((item) => [item.id, item]));
  const qty = { sotteok: 0, chillis: 0, sausage: 0 };
  for (const raw of body.items) {
    const id = String(raw?.id ?? '');
    const count = raw?.qty;
    const menu = menuById.get(id);
    if (!menu || !Number.isInteger(count) || count < 1 || count > 99) {
      throw httpError(400, '장바구니 수량이 올바르지 않습니다.');
    }
    qty[id] += count;
    if (qty[id] > 99) throw httpError(400, '한 메뉴는 99개까지 주문할 수 있습니다.');
  }

  const items = FOOD_IDS.filter((id) => qty[id] > 0).map((id) => {
    const menu = menuById.get(id);
    return { price: menu.price, qty: qty[id] };
  });
  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [food] = await connection.execute(
      'INSERT INTO food (sotteok, chillis, sausage) VALUES (?, ?, ?)',
      [qty.sotteok, qty.chillis, qty.sausage],
    );
    const orderNumber = food.insertId;
    await connection.execute(
      'INSERT INTO `order` (order_number, name, memo, payment_method, total) VALUES (?, ?, ?, ?, ?)',
      [orderNumber, customerName, memo || null, paymentMethod, total],
    );
    await connection.execute('INSERT INTO state (order_number) VALUES (?)', [orderNumber]);
    await connection.commit();
    return orderNumber;
  } catch (error) {
    await connection.rollback();
    throw mapDbError(error);
  } finally {
    connection.release();
  }
}

async function changeStatus(orderNumber, action) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT awaiting_payment, confirmed_payment, received, refund FROM state WHERE order_number = ? FOR UPDATE',
      [orderNumber],
    );
    if (!rows.length) throw httpError(404, '주문을 찾을 수 없습니다.');
    const status = statusOf(rows[0]);
    if (action === 'paid') {
      if (status === 'refunded') throw httpError(409, '환불된 주문은 입금 완료로 바꿀 수 없습니다.');
      if (status === 'received') throw httpError(409, '수령 완료된 주문은 입금 완료로 바꿀 수 없습니다.');
      if (status === 'paid') throw httpError(409, '이미 입금 완료 상태입니다.');
      await connection.execute(
        `UPDATE state
         SET awaiting_payment = 0, confirmed_payment = 1, received = 0, refund = 0, confirmed_at = NOW()
         WHERE order_number = ?`,
        [orderNumber],
      );
    } else if (action === 'received') {
      if (status === 'refunded') throw httpError(409, '환불된 주문은 수령 완료로 바꿀 수 없습니다.');
      if (status === 'pending') throw httpError(409, '입금 완료 후에 수령 완료로 바꿀 수 있습니다.');
      if (status === 'received') throw httpError(409, '이미 수령 완료 상태입니다.');
      await connection.execute(
        `UPDATE state
         SET awaiting_payment = 0, confirmed_payment = 0, received = 1, refund = 0, received_at = NOW()
         WHERE order_number = ?`,
        [orderNumber],
      );
    } else {
      if (status === 'refunded') throw httpError(409, '이미 환불 상태입니다.');
      await connection.execute(
        `UPDATE state
         SET awaiting_payment = 0, confirmed_payment = 0, received = 0, refund = 1, refunded_at = NOW()
         WHERE order_number = ?`,
        [orderNumber],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw mapDbError(error);
  } finally {
    connection.release();
  }
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

function adminPinMatches(pin) {
  const expected = String(localConfig.adminPin || '');
  const given = String(pin || '');
  if (!/^\d{4}$/.test(expected) || !/^\d{4}$/.test(given)) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function sheetTime(value) {
  const match = String(value).match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s*(오전|오후)\s*(\d{1,2}):(\d{2}):(\d{2})/);
  if (!match) return String(value || '');
  let hour = Number(match[5]);
  if (match[4] === '오후' && hour < 12) hour += 12;
  if (match[4] === '오전' && hour === 12) hour = 0;
  const pad = (number) => String(number).padStart(2, '0');
  return `${match[1]}-${pad(match[2])}-${pad(match[3])}T${pad(hour)}:${match[6]}:${match[7]}+09:00`;
}

function sheetStatus(label) {
  const text = String(label || '');
  if (text.includes('환불')) return 'refunded';
  if (text.includes('수령')) return 'received';
  if (text.includes('완료')) return 'paid';
  return 'pending';
}

function ordersFromCsv(csv) {
  const rows = parseCsv(csv).filter((row) => row.some((cell) => String(cell).trim() !== ''));
  if (rows.length === 0) return [];
  const header = rows[0].map((cell) => cell.trim());
  const column = (name) => {
    const index = header.indexOf(name);
    if (index < 0) throw httpError(502, `시트에 ${name} 열이 없습니다.`);
    return index;
  };
  const time = column('시간');
  const number = column('주문번호');
  const name = column('이름');
  const memo = column('요청사항');
  const method = column('결제방법');
  const sotteok = column('소떡소떡');
  const chillis = column('칠리스');
  const sausage = column('소시지');
  const total = column('합계');
  const status = column('상태');
  return rows.slice(1).reverse().flatMap((row) => {
    const customerName = String(row[name] || '').trim();
    const id = String(row[number] || '').trim();
    if (!customerName && !id) return [];
    return [{
      createdAt: sheetTime(row[time]),
      id,
      customerName,
      memo: String(row[memo] || '').trim(),
      paymentMethod: String(row[method] || '').includes('현금') ? 'cash' : 'transfer',
      sotteok: Number(row[sotteok]) || 0,
      chillis: Number(row[chillis]) || 0,
      sausage: Number(row[sausage]) || 0,
      total: Number(row[total]) || 0,
      status: sheetStatus(row[status]),
    }];
  });
}

async function readSheetOrders() {
  const response = await fetch(SHEET_CSV_URL, { redirect: 'follow' });
  if (!response.ok) throw httpError(502, '스프레드시트를 읽지 못했습니다.');
  const orders = ordersFromCsv(await response.text());
  return { ok: true, orders };
}

async function handleApi(req, res, pathname) {
  if (req.method === 'POST' && pathname === '/api/admin/unlock') {
    if (!/^\d{4}$/.test(String(localConfig.adminPin || ''))) {
      send(res, 500, { error: '관리자 비밀번호가 설정되어 있지 않습니다. config.local.js 의 adminPin에 숫자 4자리를 넣어 주세요.' });
      return;
    }
    const body = await readBody(req);
    if (!adminPinMatches(body.pin)) {
      send(res, 401, { error: '비밀번호가 맞지 않습니다.' });
      return;
    }
    send(res, 200, { ok: true });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/sheet-orders') {
    send(res, 200, await readSheetOrders());
    return;
  }
  if (req.method === 'GET' && pathname === '/api/meta') {
    send(res, 200, { shopName: config.shopName, tagline: config.tagline });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/menu') {
    send(res, 200, config.menu);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/orders') {
    send(res, 200, await listOrders());
    return;
  }
  if (req.method === 'POST' && pathname === '/api/orders') {
    const body = await readBody(req);
    const orderNumber = await createOrder(body);
    send(res, 201, await getOrder(orderNumber));
    return;
  }
  const orderMatch = pathname.match(/^\/api\/orders\/(\d+)$/);
  if (req.method === 'GET' && orderMatch) {
    send(res, 200, await getOrder(orderNumberFromId(orderMatch[1])));
    return;
  }
  const paidMatch = pathname.match(/^\/api\/orders\/(\d+)\/paid$/);
  if (req.method === 'POST' && paidMatch) {
    const orderNumber = orderNumberFromId(paidMatch[1]);
    await changeStatus(orderNumber, 'paid');
    send(res, 200, await getOrder(orderNumber));
    return;
  }
  const receivedMatch = pathname.match(/^\/api\/orders\/(\d+)\/received$/);
  if (req.method === 'POST' && receivedMatch) {
    const orderNumber = orderNumberFromId(receivedMatch[1]);
    await changeStatus(orderNumber, 'received');
    send(res, 200, await getOrder(orderNumber));
    return;
  }
  const refundMatch = pathname.match(/^\/api\/orders\/(\d+)\/refund$/);
  if (req.method === 'POST' && refundMatch) {
    const orderNumber = orderNumberFromId(refundMatch[1]);
    await changeStatus(orderNumber, 'refund');
    send(res, 200, await getOrder(orderNumber));
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
    if (status === 500) console.error(error);
    send(res, status, { error: status === 500 ? '잠시 후 다시 시도해 주세요.' : error.message });
  }
});

function writePublicData() {
  fs.writeFileSync(path.join(PUBLIC_DIR, 'menu.json'), JSON.stringify(config.menu));
  fs.writeFileSync(path.join(PUBLIC_DIR, 'meta.json'), JSON.stringify({
    shopName: config.shopName,
    tagline: config.tagline,
    account: {
      bank: config.account.bank,
      number: config.account.number,
      holder: config.account.holder,
    },
  }));
}

assertConfig();
writePublicData();
pool.query('SELECT 1').then(() => {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`주문 화면  http://127.0.0.1:${PORT}`);
    console.log(`관리자 화면  http://127.0.0.1:${PORT}/admin`);
  });
}).catch((error) => {
  console.error('데이터베이스에 연결하지 못했습니다.');
  console.error(error.message);
  process.exit(1);
});
