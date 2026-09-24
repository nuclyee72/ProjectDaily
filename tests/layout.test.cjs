// 허브 카드의 메인·모든 하위 화면이 여러 화면 크기에서 카드 폭 그대로 · 스크롤 없이 들어가는지 (6줄 달 기준)
const path = require('path');
const { chromium, startSite, check, finish, SHOTS } = require('./lib.cjs');
const SIZES = [[320, 480], [375, 548], [360, 640], [390, 664], [393, 700], [412, 780], [390, 844], [1280, 720], [1280, 600]];
const VIEWS = [['메인', null], ['지난 퍼즐', null], ['자유 연습', null], ['통계', '달력'], ['통계', '분포']];
(async () => {
  const site = await startSite();
  const BASE = site.base;
  const b = await chromium.launch();
  let bad = 0, worst = {};
  for (const [w, h] of SIZES) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.clock.setFixedTime(new Date('2027-01-15T12:00:00+09:00'));
    await p.goto(BASE);
    for (const slug of ['sudoku', 'trilateral', 'wordship']) {
      await p.evaluate((s) => { location.hash = s; }, slug);
      await p.evaluate((s) => document.getElementById(s).scrollIntoView({ behavior: 'instant', inline: 'start' }), slug);
      const card = p.locator(`#${slug} .landing-card`);
      const w0 = await card.evaluate((e) => e.getBoundingClientRect().width);
      for (const [btn, pane] of VIEWS) {
        const opener = p.locator(`#${slug} .landing-stack:not([hidden]) :is(.landing-btn,.landing-mini-btn)`, { hasText: btn });
        if (btn === '자유 연습' && slug === 'sudoku') continue; // 스도쿠는 바로 게임으로
        if (btn !== '메인') await opener.evaluate((e) => e.click());
        if (pane) { await p.locator(`#${slug} .stats-seg button`, { hasText: pane }).evaluate((e) => e.click()); }
        await p.waitForTimeout(150);
        const r = await card.evaluate((c) => {
          const cr = c.getBoundingClientRect(); const slide = c.parentElement;
          const dots = document.getElementById('hub-dots').getBoundingClientRect();
          return { w: cr.width, h: Math.round(cr.height), scroll: c.scrollHeight - c.clientHeight, slide: slide.scrollHeight - slide.clientHeight, top: Math.round(cr.top), gap: Math.round(dots.top - cr.bottom) };
        });
        const ok = Math.abs(r.w - w0) < 0.5 && r.scroll <= 0 && r.slide <= 0 && r.top >= 0 && r.gap >= 0;
        const key = `${btn}${pane ? '/' + pane : ''}`;
        if (!ok) { bad++; console.log(`FAIL ${w}x${h} ${slug} ${key}: 폭 ${Math.round(w0)}→${Math.round(r.w)} 높이 ${r.h} 위 ${r.top} 점까지 ${r.gap}`); }
        worst[key] = Math.max(worst[key] ?? 0, r.h);
        if (w === 390 && h === 844) await p.screenshot({ path: path.join(SHOTS, `view-${slug}-${key.replace('/', '-')}.png`) });
        if (btn !== '메인') await p.locator(`#${slug} .hub-back`).evaluate((e) => e.click());
      }
    }
    if (errs.length) { bad++; console.log(`에러 ${w}x${h}: ${errs.join(' | ')}`); }
    await ctx.close();
  }
  await b.close(); site.close();
  console.log('최대 높이(px):', JSON.stringify(worst));
  check(bad === 0, `모든 화면 · ${SIZES.length}가지 크기에서 카드 폭 그대로 · 스크롤 없음`);
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
