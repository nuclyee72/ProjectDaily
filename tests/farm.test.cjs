// 데일리 농장 카드 (#farm) — 허브 위치 · NP · 탐험 · 심기/수확 · 제작 · 요리(재료 칸)/판매 · 도감 12칸 · 상점 · 가방(작물 하나씩 · 기타 · 장신구 칸) · 가방 넘침 · 도움말 · 시즌 넘김.
// 규칙 계산은 서브모듈 DailyFarmingGame/tests/engine.test.cjs가 보고, 여기선 화면에서 눌러서 그대로 되는지 본다. 시각은 page.clock, 난수는 고정.
const path = require('path');
const { chromium, startSite, check, finish, SHOTS } = require('./lib.cjs');

const NOW = new Date('2026-10-06T12:00:00+09:00');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const H = 3600000;

/** Math.random 고정 (mulberry32) — 화면 테스트도 매번 같은 결과 */
function fixRandom() {
  let a = 20261006;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 이것저것 다 있는 state (시즌 중반 플레이어) */
function richState(now) {
  const E = window.DailyFarm.engine;
  const s = E.newState('2026-10', now - 30 * 3600000);
  s.gift = true; // 시작 보상은 받은 셈 (개수를 정확히 보려고)
  Object.assign(s.built, { field: 6, synth: 1, eff: 2, care: 1, facility: 3, reuse: 2, bounty: 9, explore: 1, equip: 2 });
  s.plots = Array(8).fill(null);
  s.plots[0] = { seed: 0, crop: 'potato', plantedAt: now - 9 * 3600000, readyAt: now - 3600000 };
  s.plots[1] = { seed: 2, crop: 'truffle', plantedAt: now - 2 * 3600000, readyAt: now + 6 * 3600000 };
  s.plots[2] = { seed: 3, crop: 'goldapple', plantedAt: now - 5 * 3600000, readyAt: now + 3 * 3600000 };
  s.plots[5] = { seed: 1, crop: 'strawberry', plantedAt: now - 8.5 * 3600000, readyAt: now - 1800000 };
  Object.assign(s.inv, { seed: [120, 45, 12, 2], mat: 300, mat2: 60, ticket: 3, box: 2, relic: 1 });
  Object.assign(s, { money: 12345, sp: 800, ap: 90 });
  let q = 7;
  for (const c of window.DailyFarm.data.CROPS.slice(0, 30)) s.inv.crop[c.id] = Array.from({ length: 2 + (q % 9) }, () => (q = (q * 37 + 11) % 97) + 1);
  s.inv.food = { 1: [0, 1, 2, 3], 45: [1, 1], 91: [0] };
  for (let i = 0; i < 30; i++) E.rollGear(s, Math.random);
  E.equipGear(s, s.inv.gear[0].id);
  s.codex[E.codexDishes('2026-10')[0]] = 2;
  s.explore.boosts = [[now - 3600000, now + 5 * 3600000]];
  return s;
}

(async () => {
  const site = await startSite();
  const BASE = site.base;
  const b = await chromium.launch();
  const errors = [];
  async function open(seed, { size = [390, 844], hash = '#farm' } = {}) {
    const ctx = await b.newContext({ viewport: { width: size[0], height: size[1] } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await p.clock.install({ time: NOW });
    await p.addInitScript(fixRandom);
    if (seed) await p.addInitScript(seed);
    await p.goto(BASE + hash);
    await p.waitForTimeout(200);
    return { ctx, p };
  }
  const panelTitle = (p) => p.locator('#farm .farm-panel-title').textContent();
  const panelOpen = (p) => p.locator('#farm .farm-panel').isVisible();
  const tab = (p, id) => p.click(`#farm .farm-tab[data-tab="${id}"]`);
  const fits = (p) => p.locator('#farm .landing-card').evaluate((c) => {
    const body = c.querySelector('.farm-body'), panel = c.querySelector('.farm-panel');
    return c.scrollHeight <= c.clientHeight && body.scrollHeight <= body.clientHeight + 1 && (panel.hidden || panel.scrollHeight <= panel.clientHeight + 1);
  });
  const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `farm-${name}.png`) });

  // 1. 허브 위치 · 처음 상태 · NP
  {
    const { ctx, p } = await open(() => {
      const results = {};
      for (let d = 1; d <= 6; d++) results[`2026-10-0${d}`] = { status: d % 3 ? 'solved' : 'failed', attempt: 2 };
      results['2026-09-30'] = { status: 'solved', attempt: 1 };
      localStorage.setItem('trilateral:stats', JSON.stringify({ results }));
    }, { hash: '' });
    check(new URL(p.url()).hash === '#home', `첫 화면은 여전히 홈 (${new URL(p.url()).hash})`);
    const order = await p.locator('.hub-slide').evaluateAll((s) => s.map((e) => e.id));
    check(order[0] === 'farm' && order[1] === 'home' && order.length === 6, `슬라이드: 농장 · 홈 · 게임 넷 (${order.join(',')})`);
    await p.keyboard.press('ArrowLeft');
    await p.waitForTimeout(600);
    check(new URL(p.url()).hash === '#farm', '홈에서 왼쪽 = #farm');
    // 처음 열면 시즌 시작 보상: 즉시 완료권 ×10 · 일반 씨앗 ×10 · 고급 씨앗 ×5 (안내 창)
    const g0 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check((await panelTitle(p)) === '10월 시즌 시작' && await p.locator('#farm .farm-panel .farm-gift .farm-got-cell').count() === 3
      && g0.gift === true && g0.inv.ticket === 10 && JSON.stringify(g0.inv.seed) === '[10,5,0,0]', `처음 열면 시작 보상 (완료권 ${g0.inv.ticket} · 씨앗 ${g0.inv.seed})`);
    await shot(p, 'start-gift');
    await p.keyboard.press('Escape');
    const np = await p.textContent('#farm .farm-coin[data-cur="np"] .farm-coin-n');
    check(np === '21', `NP: 출석 1일 5 + 성공 4 × 3 + 실패 2 × 2 = 21, 9월 기록은 빠짐 (${np})`);
    await p.click('#farm .farm-coin[data-cur="np"]');
    check((await panelTitle(p)).trim() === '내역' && await p.locator('#farm .farm-panel-title img.farm-cur').count() === 1 && (await p.locator('#farm .farm-np-row').count()) === 6, 'NP를 누르면 내역 (제목의 NP는 아이콘)');
    await p.keyboard.press('Escape');
    check(!(await panelOpen(p)), 'Esc로 판 닫기');
    check(await p.locator('#farm .farm-plot').count() === 8 && await p.locator('#farm .farm-plot.is-locked').count() === 6, '밭 8칸 중 처음엔 2칸만 (6칸 잠김)');
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check(saved.season === '2026-10' && saved.attendance.includes('2026-10-06'), '저장: 시즌 2026-10 · 오늘 출석');
    await shot(p, 'start');
    await ctx.close();
  }

  // 2. 탐험 · 심기 · 수확 (처음 상태에서 시간을 보내며)
  {
    const { ctx, p } = await open(null);
    await p.keyboard.press('Escape'); // 시작 보상 안내 닫기
    await p.reload();
    await p.waitForTimeout(300);
    const g1 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check(!(await panelOpen(p)) && g1.inv.ticket === 10, '시작 보상은 시즌에 한 번 (다시 열어도 안 줌)');
    await tab(p, 'explore');
    check(await p.locator('#farm .farm-claim').isDisabled(), '탐험: 막 시작하면 받을 게 없음');
    await p.clock.fastForward(3 * H + 40 * 60000);
    await p.waitForTimeout(1100);
    const label = await p.textContent('#farm .farm-claim');
    check(label === '받기 · 9번', `3시간 40분 뒤 9번 (${label})`);
    await p.click('#farm .farm-claim');
    check((await panelTitle(p)) === '탐험 3시간 · 9번' && (await p.locator('#farm .farm-got-cell').count()) > 0, '받기 → 얻은 것 판');
    await shot(p, 'got');
    await p.click('#farm .farm-panel .landing-btn');
    const seeds = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).inv.seed[0]);
    check(seeds > 0, `일반 씨앗을 얻음 (${seeds}개)`);
    await tab(p, 'farm');
    await p.click('#farm .farm-plot[data-plot="0"]');
    check((await panelTitle(p)) === '1번 칸에 심기', '빈 칸 → 심기 판');
    check(await p.locator('#farm .farm-panel .farm-item').nth(1).locator('.farm-btn').first().isDisabled(), '시설 강화 전엔 고급 씨앗 못 심음');
    await p.locator('#farm .farm-panel .farm-item').first().locator('.farm-btn').first().click();
    check(await p.locator('#farm .farm-plot[data-plot="0"] .farm-plant').count() === 1, '심으면 칸에 새싹');
    const left = await p.textContent('#farm .farm-plot[data-plot="0"] .farm-plot-label');
    check(left === '8:00', `남은 시간 8:00 (${left})`);
    await p.clock.fastForward(8 * H - 60000);
    await p.waitForTimeout(1100);
    check(!(await p.locator('#farm .farm-plot[data-plot="0"]').evaluate((e) => e.classList.contains('is-ready'))), '7시간 59분 → 아직');
    await p.clock.fastForward(61000);
    await p.waitForTimeout(1100);
    check(await p.locator('#farm .farm-plot[data-plot="0"]').evaluate((e) => e.classList.contains('is-ready')), '8시간 → 다 큼 (수확!)');
    await shot(p, 'ready');
    await p.click('#farm .farm-plot[data-plot="0"]');
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check(st.plots[0] === null && Object.values(st.inv.crop).flat().length >= 2, `수확 → 작물 ${Object.values(st.inv.crop).flat().length}개 (토스트: ${await p.textContent('#farm .farm-toast')})`);
    await ctx.close();
  }

  // 3. 시즌 중반 state: 모든 탭 · 판 (그림 · 넘침 확인)
  {
    const { ctx, p } = await open(null);
    await p.evaluate(`localStorage.setItem('daily-farm:state', JSON.stringify((${richState.toString()})(Date.now())))`);
    await p.reload();
    await p.waitForTimeout(300);
    check(await p.locator('#farm .farm-plot.is-ready').count() === 2 && await p.locator('#farm .farm-plot.is-locked').count() === 0, '밭 8칸 · 다 큰 칸 2');
    await shot(p, 'tab-farm');
    // 도움말: 탭마다 흩어져 있던 설명은 ? 하나에
    check(await p.locator('#farm .farm-body .farm-hint').count() === 0, '농장 탭에 설명 글 없음 (도움말로 옮김)');
    await p.click('#farm .farm-help-btn');
    check((await panelTitle(p)) === '도움말 · 농장' && await p.locator('#farm .farm-help-nav button').count() === 8, '? → 도움말 (지금 탭 쪽부터, 8쪽)');
    await p.locator('#farm .farm-help-nav button', { hasText: '가방' }).click();
    check((await panelTitle(p)) === '도움말 · 가방' && (await p.locator('#farm .farm-help li').count()) >= 3, '도움말 쪽 넘기기');
    await p.keyboard.press('Escape');
    // 자라는 칸: 창 없이 칸 위에 완료권 쓰기 버튼만 (무슨 작물인지는 안 보임)
    await p.click('#farm .farm-plot[data-plot="1"]');
    const pop = p.locator('#farm .farm-plot-pop');
    check(!(await panelOpen(p)) && await pop.count() === 1 && (await pop.textContent()) === '완료권 쓰기' && !(await p.textContent('#farm .farm-body')).includes('트러플')
      && await p.locator('#farm .farm-plot[data-plot="1"] img[src]').count() === 2,
      '자라는 칸 → 창 없이 완료권 쓰기 버튼만, 작물 이름 · 그림 안 보임');
    await p.click('#farm .farm-plot[data-plot="1"]');
    check(await pop.count() === 0, '한 번 더 누르면 버튼이 사라짐');
    await p.click('#farm .farm-plot[data-plot="2"]');
    await p.click('#farm .farm-body', { position: { x: 10, y: 360 } });
    check(await pop.count() === 0, '다른 곳을 눌러도 사라짐');
    await p.click('#farm .farm-plot[data-plot="1"]');
    await shot(p, 'plot-ticket');
    await pop.click();
    const t = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check(t.plots[1] === null && t.inv.ticket === 2 && t.inv.crop.truffle?.length >= 1, '완료권 쓰기 → 바로 수확 (완료권 3 → 2)');
    await p.click('#farm .farm-row .farm-btn');
    check(await p.locator('#farm .farm-plot.is-ready').count() === 0, '모두 수확');

    for (const id of ['explore', 'craft', 'cook', 'codex', 'shop']) {
      await tab(p, id);
      await shot(p, 'tab-' + id);
      check(await fits(p), `${id} 탭: 카드 안에 들어감`);
      check(await p.locator('#farm .farm-body .farm-hint').count() <= (id === 'shop' ? 1 : 0), `${id} 탭: 설명 글 없음`);
    }
    // 제작
    await tab(p, 'craft');
    const before = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).built.care);
    check((await p.textContent('#farm .farm-craft[data-line="care"] .farm-btn')) === '제작', '제작 버튼 글자 = 제작');
    await p.click('#farm .farm-craft[data-line="care"] .farm-btn');
    const after = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check(after.built.care === before + 1 && after.money === 12345 - 2900, `정성스레 2 만들기 → 돈 2,900 빠짐 (${after.money})`);
    await p.click('#farm .farm-seg button[data-seg="synth"]');
    await shot(p, 'tab-craft-synth');
    await p.click('#farm .farm-item[data-synth="0"] .farm-btn');
    check((await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).inv.seed[0])) === 120 - 8, '합성: 효율 증대 2 → 일반 씨앗 8개 → 고급 1개');
    // 요리: 재료 개수만큼 칸 (감자 수프 = 감자 2 · 양파 1 · 대파 1 → 4칸), 품질 높은 것부터 채워 둠, 칸을 눌러 바꿈
    await tab(p, 'cook');
    const tierColors = await p.locator('#farm .farm-body .farm-seg .farm-tier-word').evaluateAll((ws) => ws.map((w) => `${w.textContent}:${getComputedStyle(w).color}`));
    check(tierColors.length === 4 && new Set(tierColors.map((x) => x.split(':')[1])).size === 4, `등급 글자에 색 (${tierColors.join(' · ')})`);
    await p.locator('#farm .farm-body .farm-page-btn').last().click();
    await p.click('#farm .farm-dish[data-dish="8"]');
    await shot(p, 'panel-cook');
    check(await fits(p), '요리 판: 카드 안에 들어감');
    const cookSlots = p.locator('#farm .farm-cook-slot');
    const potatoes = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).inv.crop.potato.slice().sort((a, b) => b - a));
    check(await cookSlots.count() === 4 && (await cookSlots.nth(0).locator('.farm-q').textContent()) === String(potatoes[0]) && (await cookSlots.nth(1).locator('.farm-q').textContent()) === String(potatoes[1]),
      `재료 4칸, 처음엔 품질 높은 감자 ${potatoes[0]} · ${potatoes[1]}`);
    await cookSlots.nth(1).click();
    check(await p.locator('#farm .farm-pick .farm-slot').count() === potatoes.length - 1, '칸을 누르면 그 작물이 하나씩 (다른 칸에 넣은 건 빼고)');
    const low = potatoes[potatoes.length - 1];
    await p.locator('#farm .farm-pick .farm-slot').last().click();
    check((await cookSlots.nth(1).locator('.farm-q').textContent()) === String(low), `고른 재료가 칸에 보임 (품질 ${low})`);
    await shot(p, 'panel-cook-pick');
    await p.locator('#farm .farm-pick .farm-slot.is-on').click();
    check(await cookSlots.nth(1).evaluate((e) => e.classList.contains('is-empty')) && await p.locator('#farm .farm-panel .landing-btn', { hasText: '요리하기' }).isDisabled(),
      '고른 걸 다시 누르면 칸이 비고 요리하기 꺼짐');
    await p.locator('#farm .farm-pick .farm-slot').last().click();
    await p.locator('#farm .farm-panel .landing-btn', { hasText: '요리하기' }).click();
    const stars = await p.locator('#farm .farm-result').getAttribute('data-stars');
    const potLeft = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).inv.crop.potato || []);
    check(stars !== null && potLeft.length === potatoes.length - 2 && potLeft.filter((q) => q === low).length === potatoes.filter((q) => q === low).length - 1,
      `요리 → 별 ${stars}개, 고른 감자(${potatoes[0]} · ${low})가 빠짐`);
    check(!(await p.textContent('#farm .farm-result strong')).includes('성') && (await p.textContent('#farm .farm-stars')).length === 3, '결과는 3성 대신 별 세 개');
    // 완성 창: 결과는 가운데, 버튼은 맨 아래 반반 (가방에 두기 | 팔기)
    const lay = await p.locator('#farm .farm-panel').evaluate((pn) => {
      const r = (s) => pn.querySelector(s).getBoundingClientRect();
      const [keep, sell] = [...pn.querySelectorAll('.farm-result-actions button')].map((x) => x.getBoundingClientRect());
      return { gap: Math.round(pn.getBoundingClientRect().bottom - keep.bottom), same: Math.abs(keep.width - sell.width) < 1 && Math.abs(keep.top - sell.top) < 1,
        keep: pn.querySelector('.farm-result-actions button').textContent, mid: Math.round((r('.farm-result').top + r('.farm-result').bottom) / 2 - r('.farm-panel-head').bottom) };
    });
    check(lay.same && lay.keep === '가방에 두기' && lay.gap <= 16, `완성 창 버튼: 맨 아래 같은 크기 두 개 (${JSON.stringify(lay)})`);
    await shot(p, 'panel-cook-result');
    const m0 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).money);
    await p.locator('#farm .farm-panel button', { hasText: '팔기' }).click();
    const m1 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).money);
    check(m1 > m0, `팔기 → 돈 ${m0} → ${m1}`);
    // 도감
    await tab(p, 'codex');
    check((await p.locator('#farm .farm-codex-cell').count()) === 12 && (await p.textContent('#farm .farm-codex-sum')).includes('/12'), '도감 12칸');
    const codexStars = await p.locator('#farm .farm-codex-cell .farm-starline').first().textContent();
    check(codexStars === '★★☆', `도감 기록은 별로 (${codexStars})`);
    // 상점
    await tab(p, 'shop');
    await p.click('#farm .farm-shop-item[data-item="ticket"] .farm-btn');
    const t2 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check(t2.inv.ticket === 3 && t2.spent === 2, 'NP 상점: 완료권 2 NP → +1장');
    await p.click('#farm .farm-seg button[data-seg="ap"]');
    await shot(p, 'tab-shop-ap');
    // 가방
    await p.click('#farm .farm-bag');
    for (const s of ['crop', 'item', 'food', 'gear', 'misc']) {
      await p.click(`#farm .farm-panel .farm-seg button[data-seg="${s}"]`);
      await shot(p, 'bag-' + s);
      check(await fits(p), `가방 ${s}: 카드 안에 들어감`);
    }
    // 작물: 하나씩 한 칸 (한 줄 6칸), 오른쪽 아래 품질. 골라서 판매
    await p.click('#farm .farm-panel .farm-seg button[data-seg="crop"]');
    const st0 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    const total = Object.values(st0.inv.crop).flat().length;
    const cells = p.locator('#farm .farm-panel .farm-slot');
    const cols = await cells.evaluateAll((cs) => new Set(cs.map((c) => Math.round(c.getBoundingClientRect().left))).size);
    const q0 = await cells.first().locator('.farm-q').textContent();
    check(cols === 6 && (await cells.count()) === total && Number(q0) >= 1 && Number(q0) <= 100, `작물 ${total}개가 하나씩 · 한 줄 6칸 · 칸마다 품질 숫자 (${q0})`);
    // 스크롤: 목록 칸만 위아래로 넘어가고, 고르거나 팔아도 스크롤 위치가 그대로
    const grid = p.locator('#farm .farm-panel .farm-slots.farm-scroll');
    const sc0 = await grid.evaluate((g) => { g.scrollTop = 400; return { top: g.scrollTop, more: g.scrollHeight > g.clientHeight }; });
    await p.mouse.move(195, 420);
    await p.mouse.wheel(0, 200);
    await p.waitForTimeout(200);
    const sc1 = await grid.evaluate((g) => g.scrollTop);
    check(sc0.more && sc0.top === 400 && sc1 > 400 && await fits(p), `가방 목록은 스크롤 (휠 400 → ${sc1}), 카드 · 판은 그대로`);
    await grid.evaluate((g) => { g.scrollTop = 0; });
    check((await p.textContent('#farm .farm-sell-info')) === `${total} / 1,000`, '작물 개수 / 1,000');
    const grades = await cells.evaluateAll((cs) => cs.map((c) => [Number(c.querySelector('.farm-q').textContent), c.dataset.grade || '', getComputedStyle(c.querySelector('.farm-q')).backgroundColor, getComputedStyle(c).backgroundColor]));
    const want = (q) => (q >= 95 ? '4' : q >= 80 ? '3' : q >= 60 ? '2' : q >= 40 ? '1' : '');
    const shown = [...new Set(grades.map((x) => x[1]))];
    const badgeOf = (g) => grades.find((x) => x[1] === g)[2];
    const vivid = { 4: 'rgb(229, 57, 53)', 3: 'rgb(245, 124, 0)', 2: 'rgb(30, 136, 229)', 1: 'rgb(46, 157, 67)' };
    check(grades.every(([q, g]) => g === want(q)) && shown.length >= 4 && shown.every((g) => !g || badgeOf(g) === vivid[g]) && new Set(grades.map((x) => x[3])).size === 1,
      `품질 색: 숫자 바탕 95 빨강 · 80 주황 · 60 파랑 · 40 초록, 칸 바탕은 그대로 (${shown.map((g) => `${g || '-'}=${badgeOf(g)}`).join(' | ')})`);
    for (const i of [0, 1, 2]) await cells.nth(i).click();
    await p.locator('#farm .farm-sellbar .farm-btn', { hasText: '판매' }).click();
    const st1 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check(Object.values(st1.inv.crop).flat().length === total - 3 && st1.money > st0.money, `작물 3개 판매 → 돈 ${st0.money} → ${st1.money}`);
    check(await p.locator('#farm .farm-toast img.farm-cur').count() === 1 && !(await p.textContent('#farm .farm-toast')).includes('돈'), `판매 알림의 돈은 아이콘 (${await p.textContent('#farm .farm-toast')})`);
    // 기타: 보물 상자 · 고대 유물 · 즉시 완료권
    await p.click('#farm .farm-panel .farm-seg button[data-seg="misc"]');
    check(await p.locator('#farm .farm-panel .farm-item[data-misc]').count() === 3, '기타: 보물 상자 · 고대 유물 · 즉시 완료권');
    await p.click('#farm .farm-item[data-misc="box"] .farm-btn');
    check((await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).inv.box)) === st1.inv.box - 1 || /보물 상자 ×2/.test(await p.textContent('#farm .farm-toast')),
      `기타에서 보물 상자 열기 (${await p.textContent('#farm .farm-toast')})`);
    const tk = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('daily-farm:state')); return { t: s.inv.ticket, grow: s.plots.findIndex((x) => x && x.readyAt > Date.now()) }; });
    await p.click('#farm .farm-item[data-misc="ticket"] .farm-btn');
    await p.click(`#farm .farm-panel .farm-item[data-plot="${tk.grow}"] .farm-btn`);
    const tk2 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check(tk2.inv.ticket === tk.t - 1 && tk2.plots[tk.grow] === null, `기타 › 즉시 완료권 쓰기 → ${tk.grow + 1}번 칸 바로 수확`);
    // 장신구: 맨 윗줄 착용 칸 3개 (열린 칸 = 기본 1 + 장신구 착용 단계). 칸을 눌러 착용 · 교체 · 해제
    await p.click('#farm .farm-panel .farm-seg button[data-seg="gear"]');
    const slotN = await p.evaluate(() => 1 + JSON.parse(localStorage.getItem('daily-farm:state')).built.equip);
    check(await p.locator('#farm .farm-equip-slot').count() === 3 && await p.locator('#farm .farm-equip-slot.is-locked').count() === 3 - slotN, `착용 칸 3개 · 안 연 칸은 자물쇠 (열린 칸 ${slotN})`);
    await p.click('#farm .farm-equip-slot[data-slot="1"]');
    await p.locator('#farm .farm-panel .farm-gear').first().locator('.farm-btn', { hasText: '착용' }).click();
    const eq1 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).equip);
    check(eq1.length === 2, `빈 칸을 눌러 착용 (${eq1.join(',')})`);
    await p.click('#farm .farm-equip-slot[data-slot="0"]');
    await p.locator('#farm .farm-panel .farm-gear').first().locator('.farm-btn', { hasText: '교체' }).click();
    const eq2 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).equip);
    check(eq2.length === 2 && eq2[0] !== eq1[0] && eq2[1] === eq1[1], `찬 칸을 눌러 교체 (${eq1.join(',')} → ${eq2.join(',')})`);
    await p.click('#farm .farm-equip-slot[data-slot="0"]');
    await p.locator('#farm .farm-slotbar .farm-btn', { hasText: '해제' }).click();
    const eq3 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).equip);
    check(same(eq3, [null, eq2[1]]), `칸을 눌러 해제 — 2번 칸은 그대로 (${JSON.stringify(eq3)})`);
    await shot(p, 'bag-gear-slots');
    await p.click('#farm .farm-equip-slot[data-slot="0"]');
    await p.locator('#farm .farm-panel .farm-gear').first().locator('.farm-btn', { hasText: '착용' }).click();
    const ap0 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).ap);
    await p.locator('#farm .farm-panel .farm-gear').nth(2).locator('.farm-btn', { hasText: '분해' }).click();
    const ap1 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).ap);
    check(ap1 > ap0, `장신구 분해 → AP ${ap0} → ${ap1}`);
    check(await p.locator('#farm .farm-panel .farm-gear').first().locator('.farm-btn', { hasText: '분해' }).isDisabled(), '착용 중인 장신구는 분해 버튼 꺼짐');
    await p.click('#farm .farm-panel .farm-seg button[data-seg="item"]');
    const sp0 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).sp);
    await p.locator('#farm .farm-panel .farm-item[data-seed="3"] .farm-btn', { hasText: '분해' }).click();
    check((await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).sp)) === sp0 + 100, '전설 씨앗 분해 → SP +100');
    await ctx.close();
  }

  // 4. 가방 넘침: 장신구 103개 · 작물 1,005개 → 그 칸을 펼친 가방이 닫히지 않음 (새로고침해도 다시). 가방에서 분해 · 판매로 줄이면 닫기가 돌아옴
  {
    const { ctx, p } = await open(null);
    await p.evaluate(() => {
      const E = window.DailyFarm.engine;
      const s = E.newState('2026-10', Date.now());
      s.gift = true;
      for (let i = 0; i < 103; i++) E.rollGear(s, Math.random);
      localStorage.setItem('daily-farm:state', JSON.stringify(s));
    });
    await p.reload();
    await p.waitForTimeout(300);
    const alert = () => p.textContent('#farm .farm-panel .farm-alert');
    check((await panelTitle(p)) === '가방이 넘쳤어요' && (await alert()).includes('장신구가 3개') && await p.locator('#farm .farm-panel .farm-seg button[data-seg="gear"].active').count() === 1,
      `103개면 장신구 칸을 펼친 가방 (${await alert()})`);
    check(await p.locator('#farm .farm-panel-close').count() === 0, '닫기 버튼 없음');
    await p.keyboard.press('Escape');
    check(await panelOpen(p), 'Esc로도 안 닫힘');
    check(await p.locator('#farm .farm-equip-slot.is-locked').count() === 2 && await p.locator('#farm .farm-equip-slot.is-locked img').count() === 2,
      '장신구 착용을 안 만들면 칸 2개가 회색 + 자물쇠');
    await p.click('#farm .farm-equip-slot[data-slot="2"]');
    check(await p.locator('#farm .farm-slotbar').count() === 0, '자물쇠 칸은 고를 수 없음');
    await shot(p, 'overflow');
    await p.click('#farm .farm-panel .farm-seg button[data-seg="crop"]');
    await p.click('#farm .farm-panel .farm-seg button[data-seg="gear"]');
    check(await p.locator('#farm .farm-panel-close').count() === 0, '가방 안에서 다른 칸을 봐도 닫기 없음');
    const dis = () => p.locator('#farm .farm-panel .farm-gear').first().locator('.farm-btn', { hasText: '분해' }).click();
    await dis();
    await dis();
    check(await p.locator('#farm .farm-panel-close').count() === 0, '2개만 분해하면 아직 못 닫음');
    await dis();
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check(await panelOpen(p) && (await panelTitle(p)) === '가방' && await p.locator('#farm .farm-panel-close').count() === 1 && st.inv.gear.length === 100 && st.ap > 0,
      `가방에서 3개 분해 → 100개, 닫기가 돌아옴 (AP ${st.ap})`);
    await p.keyboard.press('Escape');
    check(!(await panelOpen(p)), '정리하면 Esc로 닫힘');
    // 작물 1,005개 → 낮은 것부터 보여 주고, 5개를 팔면 닫힘
    await p.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('daily-farm:state'));
      s.inv.crop = { potato: Array.from({ length: 1000 }, (_, i) => (i % 100) + 1), goldapple: [90, 91, 92, 93, 94] };
      localStorage.setItem('daily-farm:state', JSON.stringify(s));
    });
    await p.reload();
    await p.waitForTimeout(300);
    check((await panelTitle(p)) === '가방이 넘쳤어요' && (await alert()).includes('작물이 5개'), `작물 1,005개 → 작물 칸을 펼친 가방 (${await alert()})`);
    const first = p.locator('#farm .farm-panel .farm-slot').first();
    check((await first.getAttribute('data-crop')) === 'potato' && (await first.locator('.farm-q').textContent()) === '1' && await p.locator('#farm .farm-sellbar .farm-toggle.is-on').count() === 1,
      '넘치면 낮은 순 (일반 · 품질 1부터)');
    await shot(p, 'overflow-crop');
    for (let i = 0; i < 4; i++) await p.locator('#farm .farm-panel .farm-slot').nth(i).click();
    await p.locator('#farm .farm-sellbar .farm-btn', { hasText: '판매' }).click();
    check(await p.locator('#farm .farm-panel-close').count() === 0, '4개 팔면 아직');
    await p.locator('#farm .farm-sellbar .farm-btn', { hasText: '낮은 1개' }).click();
    check(await p.locator('#farm .farm-panel .farm-slot.is-on').count() === 1, '넘친 만큼 낮은 것 고르기 (낮은 1개)');
    await p.locator('#farm .farm-sellbar .farm-btn', { hasText: '판매' }).click();
    const sc = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check(Object.values(sc.inv.crop).flat().length === 1000 && sc.inv.crop.goldapple.length === 5 && sc.money === 5 && await p.locator('#farm .farm-panel-close').count() === 1,
      `5개 팔면 1,000개 · 닫기가 돌아옴 (감자 1개 1돈 × 5 = ${sc.money})`);
    await ctx.close();
  }

  // 5. 시즌 넘김: 9월 state → 10월에 열면 history + 새 state + 안내
  {
    const { ctx, p } = await open(null);
    await p.evaluate(() => {
      const E = window.DailyFarm.engine;
      const s = E.newState('2026-09', Date.now() - 10 * 86400000);
      s.codex = { 3: 2, 50: 3, 77: 1 };
      s.money = 999;
      localStorage.setItem('daily-farm:state', JSON.stringify(s));
    });
    await p.reload();
    await p.waitForTimeout(300);
    const st = await p.evaluate(() => ({ s: JSON.parse(localStorage.getItem('daily-farm:state')), h: JSON.parse(localStorage.getItem('daily-farm:history')) }));
    check(st.s.season === '2026-10' && st.s.money === 0 && JSON.stringify(st.h) === JSON.stringify([{ season: '2026-09', done: 3, stars: 6, total: 12 }]), `시즌 넘김: history ${JSON.stringify(st.h)} · 새 시즌`);
    check((await panelTitle(p)) === '9월 시즌 끝' && await p.locator('#farm .farm-panel .farm-gift .farm-got-cell').count() === 3 && st.s.inv.ticket === 10,
      '새 시즌 첫 진입 → 지난 시즌 결과 + 새 시즌 시작 보상');
    await shot(p, 'season');
    const badge = await p.textContent('#home .home-farm');
    check(badge === '🌾 9월 도감 3/12 · ★6' &&await p.locator('#home .home-farm').isVisible(), `홈 프로필에 지난 시즌 도감 배지 (${badge})`);
    await ctx.close();
  }

  // 6. 깨진 저장값 → 새 state
  {
    const { ctx, p } = await open(() => { localStorage.setItem('daily-farm:state', '{"v":1,"season":'); });
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check(st.season === '2026-10' && st.plots.length === 2, '깨진 저장값이면 새로 시작');
    await ctx.close();
  }

  // 7. 다크 모드: 농장 색 토큰이 바뀜 (밝은 알림 · 어두운 품질 바탕 · 도트에 옅은 테두리 빛)
  {
    const look = async (dark) => {
      const { ctx, p } = await open(dark ? () => localStorage.setItem('daily-dark-mode', '1') : null);
      const r = await p.locator('#farm .farm-card').evaluate((c) => {
        const cs = getComputedStyle(c);
        return { toast: getComputedStyle(c.querySelector('.farm-toast')).backgroundColor, q: cs.getPropertyValue('--farm-q-bg').trim(),
          sprite: getComputedStyle(c.querySelector('.farm-tab img')).filter, ground: getComputedStyle(c.querySelector('.farm-ground')).filter };
      });
      await shot(p, dark ? 'dark' : 'light');
      await ctx.close();
      return r;
    };
    const light = await look(false), dark = await look(true);
    check(light.toast !== dark.toast && light.q !== dark.q && light.sprite === 'none' && dark.sprite.startsWith('drop-shadow') && dark.ground === 'none',
      `다크 모드 색 (알림 ${light.toast} → ${dark.toast}, 도트 ${dark.sprite.slice(0, 20)}…, 땅 타일은 그대로)`);
  }

  check(errors.length === 0, `콘솔/페이지 에러 없음 ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
  await b.close();
  site.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
