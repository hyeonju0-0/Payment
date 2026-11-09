// 가게 이름, 입금 계좌, 메뉴는 이 파일만 수정하면 됩니다.
// 메뉴 id는 sotteok, chillis, sausage 로 유지합니다.
module.exports = {
  port: 3000,
  shopName: '전기 맞은 문방구',
  tagline: '소프트웨어',
  account: {
    bank: '카카오뱅크',
    number: '3333-12-3456789',
    holder: '온담식당',
  },
  menu: [
    { id: 'sotteok', category: '메뉴', name: '소떡', description: '꼬치에 구운 소시지와 떡', price: 3000 },
    { id: 'chillis', category: '메뉴', name: '칠리', description: '매콤한 칠리 소스', price: 3000 },
    { id: 'sausage', category: '메뉴', name: '소시지', description: '구운 소시지', price: 3000 },
  ],
};
