// 가게 이름, 입금 계좌, 메뉴는 이 파일만 수정하면 됩니다.
// 메뉴 id는 green.food 열 이름과 같아야 합니다.
module.exports = {
  port: 3000,
  shopName: '전기 맞은 문방구',
  tagline: '오늘의 한 끼',
  db: {
    host: '155.230.235.248',
    port: 32065,
    user: 'green02',
    database: 'green',
  },
  account: {
    bank: '카카오뱅크',
    number: '3333-12-3456789',
    holder: '온담식당',
  },
  menu: [
    { id: 'sotteok', category: '메뉴', name: '소떡', description: '꼬치에 구운 소시지와 떡', price: 4000 },
    { id: 'chillis', category: '메뉴', name: '칠리', description: '매콤한 칠리 소스', price: 4500 },
    { id: 'sausage', category: '메뉴', name: '소시지', description: '구운 소시지', price: 3500 },
  ],
};
