/**
 * farm/data.js — 데일리 농장의 숫자와 표. 기획은 docs/farm-plan.md (§ 번호) · docs/farm-GDD.xlsx.
 * 숫자를 바꿀 때는 여기만 고친다. 규칙(계산)은 engine.js.
 * 등급은 어디서나 0 일반 · 1 고급 · 2 희귀 · 3 전설.
 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const F = (root.DailyFarm = root.DailyFarm || {});

  const TIERS = ['일반', '고급', '희귀', '전설'];

  // §2 NP: 출석 · 데일리 결과
  const NP = { attend: 5, solved: 3, other: 2 };

  // §4 탐험: 1시간마다 굴림, 히든 1% → 아니면 분류 → 분류 안 아이템 → 개수
  const EXPLORE = {
    rollsPerHour: 3, // + 탐험 강화 단계
    capHours: 48,
    hidden: 0.01,
    cats: [
      { p: 0.6, items: [
        { kind: 'seed', tier: 0, p: 0.6, n: [3, 5] },
        { kind: 'seed', tier: 1, p: 0.3, n: [3, 5] },
        { kind: 'seed', tier: 2, p: 0.09, n: [2, 4] },
        { kind: 'seed', tier: 3, p: 0.01, n: [1, 2] },
      ] },
      { p: 0.35, items: [
        { kind: 'mat', p: 0.8, n: [3, 5] },
        { kind: 'mat2', p: 0.2, n: [2, 3] },
      ] },
      { p: 0.05, items: [{ kind: 'gear', p: 1, n: [1, 1] }] },
    ],
    hiddenItems: [{ kind: 'box', p: 0.5 }, { kind: 'relic', p: 0.5 }],
  };

  // §4 보물 상자: "보물 상자 ×2"만 1%, 나머지 19.8%씩
  const BOX = [
    { id: 'np100', p: 0.198, np: 100 },
    { id: 'np200', p: 0.198, np: 200 },
    { id: 'seed3', p: 0.198, seed: [0, 0, 0, 3] },
    { id: 'mat50', p: 0.198, mat2: 50 },
    { id: 'ticket10', p: 0.198, ticket: 10 },
    { id: 'box2', p: 0.01, box: 2 },
  ];

  // §5 농사: 8시간 성장, 밭 2칸에서 8칸까지
  const FIELD = { start: 2, growHours: 8 };
  /** 씨앗 등급(줄) → 작물 등급 확률 */
  const SEED_TO_CROP = [
    [0.7, 0.25, 0.05, 0],
    [0.3, 0.5, 0.2, 0],
    [0.05, 0.4, 0.5, 0.05],
    [0, 0, 0.5, 0.5],
  ];
  /** 작물 등급 → 기본 수확 개수 [최소, 최대] */
  const HARVEST = [[2, 3], [2, 3], [1, 2], [1, 1]];

  // §5 작물 55종 [id, 이름]. 등급 안에서는 모두 같은 확률
  const CROPS = [
    [['potato', '감자'], ['sweetpotato', '고구마'], ['carrot', '당근'], ['radish', '무'], ['onion', '양파'],
      ['scallion', '대파'], ['garlic', '마늘'], ['napa', '배추'], ['cabbage', '양배추'], ['lettuce', '상추'],
      ['spinach', '시금치'], ['cucumber', '오이'], ['zucchini', '애호박'], ['eggplant', '가지'], ['tomato', '토마토'],
      ['chili', '고추'], ['corn', '옥수수'], ['rice', '벼'], ['wheat', '밀'], ['soy', '콩']],
    [['strawberry', '딸기'], ['watermelon', '수박'], ['melon', '멜론'], ['orientalmelon', '참외'], ['grape', '포도'],
      ['blueberry', '블루베리'], ['cherry', '체리'], ['peach', '복숭아'], ['kiwi', '키위'], ['pineapple', '파인애플'],
      ['mango', '망고'], ['avocado', '아보카도'], ['asparagus', '아스파라거스'], ['broccoli', '브로콜리'], ['paprika', '파프리카'],
      ['kabocha', '단호박'], ['shiitake', '표고버섯'], ['ginger', '생강'], ['sesame', '참깨'], ['peanut', '땅콩']],
    [['ginseng', '인삼'], ['matsutake', '송이버섯'], ['truffle', '트러플'], ['saffron', '사프란'], ['vanilla', '바닐라'],
      ['cacao', '카카오'], ['coffee', '커피 체리'], ['wasabi', '와사비'], ['shinemuscat', '샤인머스캣'], ['dragonfruit', '용과']],
    [['goldapple', '황금 사과'], ['moonpeach', '달빛 복숭아'], ['starshroom', '별빛 버섯'], ['rainbowcorn', '무지개 옥수수'],
      ['flamechili', '불꽃 고추']],
  ].flatMap((list, tier) => list.map(([id, name]) => ({ id, name, tier })));

  // §6 품질 1~100: 평평한 끝까지 같은 확률, 그 위로 정규분포 꼬리. σ는 p(100)이 목표가 되게 engine이 맞춘다
  // colors = 화면 칸 바탕색 단계: 이 값 이상이면 빨강 · 주황 · 파랑 · 초록 (그 아래는 색 없음)
  const QUALITY = { flatEnd: 30, p100: 0.001, max: 100, colors: [95, 80, 60, 40] };

  // §7 · §8 제작 (강화 39단계). 단계마다 [자재, 고급 자재, 목표일, 설명]. 돈은 아래 CRAFT_MONEY로 계산
  const CRAFT = [
    { id: 'field', name: '밭', steps: [
      [8, 0, 1, '밭 3칸'], [15, 0, 1, '밭 4칸'], [25, 0, 2, '밭 5칸'], [40, 4, 4, '밭 6칸'], [57, 8, 6, '밭 7칸'], [75, 13, 10, '밭 8칸']] },
    { id: 'synth', name: '씨앗 합성기', steps: [[30, 5, 2, '아래 등급 씨앗 10개 → 윗등급 1개']] },
    { id: 'eff', name: '효율 증대', requires: 'synth', steps: [
      [35, 8, 5, '합성 9:1'], [45, 12, 7, '합성 8:1'], [60, 18, 12, '합성 7:1']] },
    { id: 'care', name: '정성스레', steps: [
      [30, 8, 3, '품질 8 이하면 한 번 다시 굴림'], [60, 17, 9, '품질 16 이하면 한 번 다시 굴림']] },
    { id: 'facility', name: '시설 강화', steps: [
      [10, 0, 1, '고급 씨앗 심기'], [40, 8, 3, '희귀 씨앗 심기'], [80, 18, 8, '전설 씨앗 심기']] },
    { id: 'reuse', name: '재사용', steps: [
      [8, 0, 1, '일반 · 고급 수확 때 씨앗 반환 10%'], [20, 3, 4, '반환 20%'], [32, 6, 6, '반환 30%'],
      [50, 11, 11, '희귀 수확 때 씨앗 반환 10%']] },
    { id: 'bounty', name: '풍작', steps: [
      [5, 0, 1, '일반 수확 50% 확률로 +1'], [7, 0, 1, '고급 수확 50% 확률로 +1'], [8, 0, 1, '풍작 1 → 100%'],
      [10, 0, 1, '희귀 수확 25% 확률로 +1'], [11, 2, 2, '풍작 2 → 100%'], [13, 3, 2, '일반 · 고급 수확 50% 확률로 +1'],
      [15, 3, 3, '풍작 4 → 50%'], [18, 4, 4, '일반 수확량 ×2, 확률 10%'], [21, 5, 5, '풍작 6 → 100%'],
      [24, 6, 7, '풍작 8 → 20%'], [28, 7, 7, '풍작 4 → 75%'], [32, 8, 11, '고급 수확량 ×1.5, 확률 10%'],
      [37, 8, 12, '일반 · 고급 수확 50% 확률로 +1 (따로)'], [43, 9, 13, '풍작 4 → 100%'], [50, 10, 14, '풍작 12 → 20%'],
      [58, 11, 14, '일반 · 고급 · 희귀 수확 50% 확률로 +1']] },
    { id: 'explore', name: '탐험 강화', steps: [[25, 5, 5, '탐험 1시간마다 4번'], [100, 20, 10, '탐험 1시간마다 5번']] },
    { id: 'equip', name: '장신구 착용', steps: [[20, 4, 6, '장신구 2개 착용'], [170, 33, 13, '장신구 3개 착용']] },
  ];
  /** 돈 = (자재 + 고급 자재 × mat2Weight) × 배수. 배수는 목표일이 [그날부터, 배수]의 가장 늦은 줄 */
  const CRAFT_MONEY = { mat2Weight: 5, mult: [[1, 0], [2, 10], [4, 20]] };
  for (const line of CRAFT) {
    line.steps = line.steps.map(([mat, mat2, day, desc]) => {
      const mult = CRAFT_MONEY.mult.filter(([from]) => day >= from).pop()[1];
      return { mat, mat2, money: (mat + mat2 * CRAFT_MONEY.mat2Weight) * mult, day, desc };
    });
  }

  /** 정성스레 단계 → 이 품질 이하면 한 번 다시 굴림 */
  const CARE = [8, 16];
  /** 재사용 단계(0~4) → 작물 등급별 심은 씨앗 반환 확률 */
  const REUSE = [[0, 0, 0, 0], [0.1, 0.1, 0, 0], [0.2, 0.2, 0, 0], [0.3, 0.3, 0, 0], [0.3, 0.3, 0.1, 0]];
  /**
   * 풍작: 단계(1~16)별로 켜지는 판정. p = { 단계: 확률 } 중 지금 단계 이하의 가장 높은 단계 값.
   * add = 확률로 +1 (더하기 먼저), mul = 확률로 수확량 ×x (소수는 확률 반올림)
   */
  const BOUNTY = {
    add: [
      { tiers: [0], p: { 1: 0.5, 3: 1 } },
      { tiers: [1], p: { 2: 0.5, 5: 1 } },
      { tiers: [2], p: { 4: 0.25, 7: 0.5, 11: 0.75, 14: 1 } },
      { tiers: [0, 1], p: { 6: 0.5, 9: 1 } },
      { tiers: [0, 1], p: { 13: 0.5 } },
      { tiers: [0, 1, 2], p: { 16: 0.5 } },
    ],
    mul: [
      { tiers: [0], x: 2, p: { 8: 0.1, 10: 0.2 } },
      { tiers: [1], x: 1.5, p: { 12: 0.1, 15: 0.2 } },
    ],
  };
  /** 씨앗 합성: 윗등급 1개 = 아래 등급 (base − 효율 증대 단계)개 */
  const SYNTH = { base: 10 };

  // §11 장신구. 수치는 % 단위 (보물 감각은 %p). range = 등급별 [최소, 최대], 전설은 고정
  const GEAR = {
    lines: [0.5, 0.4, 0.1], // 효과 0 · 1 · 2줄
    tiers: [0.6, 0.3, 0.09, 0.01],
    bag: 100, // 착용 중 포함
    equipBase: 1, // + 장신구 착용 단계
    looks: ['반지', '목걸이', '귀걸이', '팔찌', '별 브로치', '왕관', '부적', '리본', '메달', '하트'], // 모습: 얻을 때 무작위 (효과와 상관없음)
    opts: [
      { id: 'seedBag', name: '씨앗 주머니', desc: '탐험 씨앗 개수 +{v}%', step: 1, range: [[1, 10], [11, 20], [21, 25], [30, 30]] },
      { id: 'matBag', name: '자재 주머니', desc: '탐험 자재 개수 +{v}%', step: 1, range: [[1, 10], [11, 20], [21, 25], [30, 30]] },
      { id: 'treasure', name: '보물 감각', desc: '탐험 히든 확률 +{v}%p', step: 0.1, range: [[0.1, 0.3], [0.4, 0.6], [0.7, 0.8], [1, 1]] },
      { id: 'goodSeed', name: '좋은 씨앗', desc: '탐험 씨앗 {v}% 확률로 한 등급 위', step: 0.5, range: [[0.5, 2], [2.5, 4], [4.5, 5], [6, 6]] },
      { id: 'bounty', name: '풍년', desc: '수확 {v}% 확률로 +1개', step: 1, range: [[1, 10], [11, 20], [21, 25], [30, 30]] },
      { id: 'seedBack', name: '씨앗 되받기', desc: '수확 {v}% 확률로 씨앗 1개 반환', step: 1, range: [[1, 6], [7, 13], [14, 16], [20, 20]] },
      { id: 'mutation', name: '돌연변이', desc: '심을 때 {v}% 확률로 작물 등급 +1', step: 0.5, range: [[0.5, 2], [2.5, 4], [4.5, 5], [6, 6]] },
      { id: 'synthCrit', name: '합성 대성공', desc: '씨앗 합성 {v}% 확률로 2개', step: 1, range: [[1, 10], [11, 20], [21, 25], [30, 30]] },
      { id: 'hurry', name: '서두르기', desc: '수확 {v}% 확률로 즉시 완료권 1장', step: 1, range: [[1, 3], [4, 6], [7, 8], [10, 10]] },
    ],
  };

  // §12 분해
  const DISMANTLE = { seedSp: [1, 3, 15, 100], gearApBase: 1, gearApLine: [2, 5, 20, 50] };
  // 작물 가방: 하나씩 한 칸, 최대 size개. 넘치면 팔아서 줄인다 (작물 1개 값 = 등급별 돈, 임시로 씨앗 분해 SP와 같은 비율)
  const CROP_BAG = { size: 1000, price: [1, 3, 15, 100] };

  // §14 요리 · 별 · 판매 · 도감
  const COOK = {
    basePrice: [10, 30, 150, 1000],
    priceSpread: 0.1, // 원래 값 = 기본 가격 × (1 ± 0.1), 요리마다 시드로 고정
    starMult: [1, 5, 30, 200],
    penalty: [0, 5, 10, 15],
    step: 25, // k번째 룰렛 = 평균 품질 − 감점 − 25 × (k − 1)
    min: 5,
    max: 95,
    maxStars: 3,
    codex: [2, 4, 4, 2], // 시즌 도감 12개: 등급별 개수
  };

  // §15 상점. NP 상점 + AP · SP 상점(같은 리스트, SP = AP × spRatio, 매일 offers개씩)
  const SHOP = {
    boostHours: 8,
    boostMult: 2,
    np: [
      { id: 'boost', name: '탐험 부스트', desc: '8시간 동안 탐험 보상 ×2', price: 6, limit: 3 },
      { id: 'ticket', name: '농사 즉시 완료권', desc: '자라는 밭 한 칸을 바로 다 키움', price: 2, limit: 3 },
    ],
    spRatio: 10,
    offers: 2,
    apsp: [
      { id: 'mat', name: '자재 꾸러미', desc: '자재 ×20', ap: 6, limit: 3, give: { mat: 20 } },
      { id: 'mat2', name: '고급 자재 꾸러미', desc: '고급 자재 ×5', ap: 8, limit: 3, give: { mat2: 5 } },
      { id: 'tickets', name: '완료권 묶음', desc: '즉시 완료권 ×2', ap: 16, limit: 2, give: { ticket: 2 } },
      { id: 'seed1', name: '고급 씨앗 꾸러미', desc: '고급 씨앗 ×10', ap: 12, limit: 2, give: { seed: [0, 10, 0, 0] } },
      { id: 'seed2', name: '희귀 씨앗 꾸러미', desc: '희귀 씨앗 ×5', ap: 30, limit: 2, give: { seed: [0, 0, 5, 0] } },
      { id: 'gearBox', name: '장신구 상자', desc: '효과 1~2줄 장신구', ap: 20, limit: 2, gearLines: [0, 0.8, 0.2] },
      { id: 'gearBox2', name: '고급 장신구 상자', desc: '효과 2줄 장신구', ap: 40, limit: 1, gearLines: [0, 0, 1] },
    ],
  };

  // §13 요리 100개 [이름, '작물:개수 ...']. 1~40 일반 · 41~70 고급 · 71~90 희귀 · 91~100 전설 (등급 = 재료 중 가장 높은 작물 등급)
  const DISHES = [
    ['찐 감자', 'potato:3'],
    ['군고구마', 'sweetpotato:3'],
    ['쌀밥', 'rice:3'],
    ['군옥수수', 'corn:3'],
    ['식빵', 'wheat:3'],
    ['당근 주스', 'carrot:3'],
    ['감자전', 'potato:3 onion:1'],
    ['감자 수프', 'potato:2 onion:1 scallion:1'],
    ['감자 샐러드', 'potato:2 carrot:1 cucumber:1'],
    ['고구마빵', 'sweetpotato:2 wheat:2'], // 10
    ['잡채', 'sweetpotato:2 spinach:1 carrot:1'],
    ['배추김치', 'napa:3 chili:2 garlic:2'],
    ['깍두기', 'radish:3 chili:2 garlic:1'],
    ['오이소박이', 'cucumber:3 chili:1 scallion:1'],
    ['오이 냉국', 'cucumber:2 onion:1 chili:1'],
    ['뭇국', 'radish:2 scallion:1 garlic:1'],
    ['시금치나물', 'spinach:3 garlic:1'],
    ['상추 겉절이', 'lettuce:3 chili:1 scallion:1'],
    ['상추쌈밥', 'lettuce:2 rice:2 soy:1'],
    ['양배추 샐러드', 'cabbage:2 carrot:1 cucumber:1'], // 20
    ['양배추 롤', 'cabbage:3 rice:1 tomato:1'],
    ['가지볶음', 'eggplant:3 garlic:1'],
    ['라따뚜이', 'eggplant:1 zucchini:1 tomato:1'],
    ['애호박전', 'zucchini:2 wheat:1'],
    ['된장찌개', 'soy:2 potato:1 zucchini:1'],
    ['두부 부침', 'soy:3 scallion:1'],
    ['콩국수', 'soy:3 wheat:2 cucumber:1'],
    ['칼국수', 'wheat:3 zucchini:1 potato:1'],
    ['파전', 'wheat:2 scallion:3'],
    ['김치전', 'wheat:2 napa:2 chili:1'], // 30
    ['토마토 스튜', 'tomato:3 potato:1 onion:1'],
    ['토마토 파스타', 'wheat:2 tomato:2 garlic:1'],
    ['마늘빵', 'wheat:2 garlic:2'],
    ['옥수수 수프', 'corn:2 onion:1 wheat:1'],
    ['비빔밥', 'rice:2 spinach:1 carrot:1'],
    ['볶음밥', 'rice:2 carrot:1 onion:1'],
    ['인절미', 'rice:3 soy:2'],
    ['떡볶이', 'rice:2 chili:2 scallion:1'],
    ['배춧국', 'napa:2 soy:1 scallion:1'],
    ['당근 케이크', 'carrot:2 wheat:2'], // 40
    ['딸기잼', 'strawberry:3'],
    ['딸기 케이크', 'strawberry:2 wheat:2'],
    ['수박 주스', 'watermelon:3'],
    ['수박 화채', 'watermelon:2 orientalmelon:1 strawberry:1'],
    ['멜론 빙수', 'melon:2 soy:1'],
    ['참외 샐러드', 'orientalmelon:2 cucumber:1'],
    ['포도 주스', 'grape:3'],
    ['건포도빵', 'grape:2 wheat:2'],
    ['블루베리 머핀', 'blueberry:2 wheat:2'],
    ['체리 파이', 'cherry:3 wheat:2'], // 50
    ['복숭아 통조림', 'peach:3'],
    ['복숭아 타르트', 'peach:2 wheat:2'],
    ['과일 샐러드', 'kiwi:1 strawberry:1 blueberry:1'],
    ['파인애플 볶음밥', 'pineapple:2 rice:2 onion:1'],
    ['망고 찹쌀밥', 'mango:2 rice:2'],
    ['망고 스무디', 'mango:3'],
    ['과카몰리', 'avocado:2 tomato:1 onion:1'],
    ['아보카도 토스트', 'avocado:2 wheat:1'],
    ['아스파라거스 구이', 'asparagus:3 garlic:1'],
    ['브로콜리 수프', 'broccoli:2 potato:1 onion:1'], // 60
    ['브로콜리 깨무침', 'broccoli:2 sesame:1'],
    ['파프리카 볶음', 'paprika:2 onion:1 garlic:1'],
    ['월남쌈', 'paprika:1 lettuce:1 rice:1'],
    ['단호박죽', 'kabocha:3 rice:1'],
    ['버섯 전골', 'shiitake:2 napa:1 scallion:1'],
    ['표고버섯전', 'shiitake:2 wheat:1'],
    ['생강차', 'ginger:3'],
    ['깨강정', 'sesame:3 rice:1'],
    ['고구마 맛탕', 'sweetpotato:3 sesame:1'],
    ['땅콩 쿠키', 'peanut:2 wheat:2'], // 70
    ['인삼차', 'ginseng:2 ginger:1'],
    ['인삼 정과', 'ginseng:3'],
    ['송이 구이', 'matsutake:2'],
    ['송이 솥밥', 'matsutake:1 rice:3'],
    ['트러플 파스타', 'truffle:1 wheat:2 garlic:1'],
    ['트러플 리조또', 'truffle:1 rice:2 shiitake:1'],
    ['사프란 빠에야', 'saffron:1 rice:3 paprika:1'],
    ['사프란 빵', 'saffron:1 wheat:3'],
    ['바닐라 아이스크림', 'vanilla:2 soy:2'],
    ['바닐라 쿠키', 'vanilla:1 wheat:2'], // 80
    ['초콜릿', 'cacao:3'],
    ['딸기 초콜릿', 'cacao:1 strawberry:2'],
    ['커피', 'coffee:3'],
    ['모카', 'coffee:2 cacao:1'],
    ['와사비 소바', 'wasabi:1 wheat:2 scallion:1'],
    ['와사비 유부초밥', 'wasabi:1 rice:2 soy:2'],
    ['샤인머스캣 탕후루', 'shinemuscat:3'],
    ['샤인머스캣 타르트', 'shinemuscat:2 wheat:2'],
    ['용과 스무디', 'dragonfruit:2 mango:1'],
    ['용과 볼', 'dragonfruit:1 blueberry:1 kiwi:1'], // 90
    ['황금 사과잼', 'goldapple:2'],
    ['황금 사과 파이', 'goldapple:1 wheat:2 vanilla:1'],
    ['달빛 복숭아 넥타', 'moonpeach:2'],
    ['달빛 복숭아 빙수', 'moonpeach:1 peach:2 soy:1'],
    ['별빛 버섯 전골', 'starshroom:1 matsutake:1 shiitake:1'],
    ['별빛 버섯 리조또', 'starshroom:1 truffle:1 rice:2'],
    ['무지개 팝콘', 'rainbowcorn:2'],
    ['무지개 옥수수 수프', 'rainbowcorn:1 corn:2 onion:1'],
    ['불꽃 떡볶이', 'flamechili:1 rice:2 scallion:1'],
    ['불꽃 카레', 'flamechili:1 potato:2 carrot:1'], // 100
  ];

  const CROP_BY_ID = Object.fromEntries(CROPS.map((c) => [c.id, c]));
  const DISH_LIST = DISHES.map(([name, ings], i) => {
    const list = ings.split(' ').map((s) => { const [id, n] = s.split(':'); return [id, Number(n)]; });
    return { id: String(i + 1), name, ings: list, tier: Math.max(...list.map(([id]) => CROP_BY_ID[id].tier)) };
  });

  F.data = {
    TIERS, NP, EXPLORE, BOX, FIELD, SEED_TO_CROP, HARVEST, CROPS, CROP_BY_ID, QUALITY,
    CRAFT, CRAFT_MONEY, CARE, REUSE, BOUNTY, SYNTH, GEAR, DISMANTLE, CROP_BAG, COOK, SHOP,
    DISHES: DISH_LIST, DISH_BY_ID: Object.fromEntries(DISH_LIST.map((d) => [d.id, d])),
  };
})();
