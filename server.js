const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
const SAUCE_NAMES = ['케첩', '머스타드', '치킨소스'];
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/15v24MlB6YiU13tjwvIi6VqaHjilhXXoEyyvFgSvsVZI/export?format=csv&gid=0';

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

function compactText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function splitSauceMemo(value) {
  let text = String(value || '').replace(/\r\n/g, '\n').trim();
  let department = '';
  const departmentMatch = text.match(/^학과:\s*([^\n]+)(?:\n([\s\S]*))?$/);
  if (departmentMatch) {
    department = departmentMatch[1].trim();
    text = (departmentMatch[2] || '').trim();
  }
  const match = text.match(/^소스:\s*([^\n]+)(?:\n([\s\S]*))?$/);
  if (!match) return { department, sauces: [], memo: text };
  const sauces = match[1].split(',').map((item) => item.trim()).filter(Boolean);
  if (sauces.length === 0 || sauces.some((item) => !SAUCE_NAMES.includes(item))) {
    return { department, sauces: [], memo: text };
  }
  return { department, sauces, memo: (match[2] || '').trim() };
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
  const departmentColumn = header.indexOf('학과');
  return rows.slice(1).reverse().flatMap((row) => {
    const customerName = String(row[name] || '').trim();
    const id = String(row[number] || '').trim();
    if (!customerName && !id) return [];
    const recorded = splitSauceMemo(row[memo]);
    const departmentCell = departmentColumn >= 0 ? String(row[departmentColumn] || '').trim() : '';
    return [{
      createdAt: sheetTime(row[time]),
      id,
      customerName,
      memo: recorded.memo,
      department: departmentCell || recorded.department,
      sauces: recorded.sauces,
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

function toCustomerOrder(order) {
  const menuById = new Map(config.menu.map((item) => [item.id, item]));
  const items = FOOD_IDS.flatMap((id) => {
    const qty = Number(order[id]) || 0;
    if (qty < 1) return [];
    const menu = menuById.get(id);
    return [{ name: menu.name, qty, price: menu.price }];
  });
  return {
    id: order.id,
    createdAt: order.createdAt,
    customerName: order.customerName,
    department: order.department || '',
    sauces: order.sauces || [],
    memo: order.memo || '',
    paymentMethod: order.paymentMethod,
    status: order.status,
    items,
    total: items.reduce((sum, item) => sum + item.price * item.qty, 0),
  };
}

async function handleApi(req, res, pathname, url) {
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
  if (req.method === 'GET' && pathname === '/api/my-orders') {
    const name = compactText(url.searchParams.get('name'), 45);
    const department = compactText(url.searchParams.get('department'), 45);
    if (!name) {
      send(res, 400, { error: '이름을 입력해 주세요.' });
      return;
    }
    const { orders } = await readSheetOrders();
    const mine = orders.filter((order) => {
      if (compactText(order.customerName, 45) !== name) return false;
      if (!department) return true;
      return compactText(order.department, 45) === department;
    });
    send(res, 200, { ok: true, orders: mine.map(toCustomerOrder) });
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
      await handleApi(req, res, pathname, url);
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
server.listen(PORT, '127.0.0.1', () => {
  console.log(`주문 화면  http://127.0.0.1:${PORT}`);
  console.log(`관리자 화면  http://127.0.0.1:${PORT}/admin`);
});
