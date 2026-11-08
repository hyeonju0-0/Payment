// 가게 이름, 입금 계좌, 메뉴는 이 파일만 수정하면 됩니다.
module.exports = {
  port: 3000,
  shopName: '온담',
  tagline: '오늘의 한 끼',
  account: {
    bank: '카카오뱅크',
    number: '3333-12-3456789',
    holder: '온담식당',
  },
  menu: [
    { id: 'doenjang', category: '식사', name: '된장찌개 정식', description: '보리밥, 계란후라이, 계절 나물', price: 9000 },
    { id: 'kimchi-jjigae', category: '식사', name: '김치찌개 정식', description: '돼지고기 김치찌개와 공기밥', price: 9500 },
    { id: 'jeyuk', category: '식사', name: '제육볶음 정식', description: '매콤한 제육, 상추, 밥', price: 11000 },
    { id: 'bibim', category: '식사', name: '비빔밥', description: '고추장 양념과 나물', price: 10000 },
    { id: 'gyeran', category: '사이드', name: '계란찜', description: '부드럽고 뜨겁게 쪄 냅니다', price: 3000 },
    { id: 'rice', category: '사이드', name: '공기밥', description: '따뜻한 쌀밥 한 공기', price: 1000 },
    { id: 'kimchi', category: '사이드', name: '배추김치', description: '오늘 꺼낸 포기김치', price: 2000 },
    { id: 'sikhye', category: '음료', name: '식혜', description: '밥알이 떠 있는 전통 식혜', price: 2500 },
    { id: 'sujeong', category: '음료', name: '수정과', description: '계피와 곶감 향', price: 2500 },
    { id: 'cola', category: '음료', name: '콜라', description: '시원한 캔 콜라', price: 2000 },
  ],
};
