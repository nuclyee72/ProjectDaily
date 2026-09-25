// 허브 ↔ 게임 전체 흐름: 메인 · 스와이프 · 딥링크 · 지난 퍼즐 · 통계 · 다크 모드 · 뒤로가기 · 직접 접속 · 아침 6시 갱신
const path = require('path');
const { chromium, startSite, check, finish, SHOTS } = require('./lib.cjs');

(async () => {
  const site = await startSite();
  const BASE = site.base;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('wordship:seen-help', '1'); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const visible = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && !e.hidden && e.offsetParent !== null; }, sel);

  // 1. 허브
  await page.goto(BASE);
  check((await page.locator('.hub-slide').count()) === 3, '허브: 게임 카드 3장');
  check((await page.locator('.daily-card-status').allTextContents()).every((t) => t === '플레이 전'), '허브: 상태 배지 모두 "플레이 전"');
  await page.screenshot({ path: path.join(SHOTS, '1-hub-mobile.png') });

  // 2. 스와이프(가로 스크롤) → 두 번째 게임
  await page.evaluate(() => document.getElementById('hub-track').scrollTo({ left: innerWidth, behavior: 'instant' }));
  await page.waitForTimeout(300);
  check(new URL(page.url()).hash === '#trilateral', `스와이프 후 주소 #trilateral (${new URL(page.url()).hash})`);
  await page.screenshot({ path: path.join(SHOTS, '2-hub-swiped.png') });

  // 3. 삼각관계 스탠다드 → 게임 화면 → 메인 화면 = 허브
  await page.locator('#trilateral a.daily-card').first().click();
  await page.waitForURL(/DailyTrilateral\/$/);
  await page.waitForFunction(() => !document.getElementById('game-screen').classList.contains('hidden'));
  check(!page.url().includes('open='), '게임: 주소에서 ?open 제거됨');
  check(await visible('#game-screen'), '삼각관계: 딥링크로 바로 게임 화면');
  await page.screenshot({ path: path.join(SHOTS, '3-trilateral-game.png') });
  await page.click('#btn-go-landing');
  await page.waitForURL(/\/ProjectDaily\/#trilateral$/);
  await page.waitForTimeout(200);
  check(await page.evaluate(() => Math.round(document.getElementById('hub-track').scrollLeft / innerWidth)) === 1, '메인 화면 → 허브의 삼각관계 카드로 복귀');
  check(await page.locator('#trilateral .daily-card-status').first().textContent().then((t) => t === '진행 중'), '허브: 삼각관계 스탠다드 "진행 중" 반영');
  // 휴대폰 "뒤로"가 방금 나온 게임으로 되돌아가지 않아야 함
  await page.goBack().catch(() => {});
  check(!page.url().includes('DailyTrilateral'), `허브로 돌아온 뒤 뒤로가기 → 게임으로 안 돌아감 (${page.url()})`);

  // 4. 스도쿠 익스텐디드 → 확인창 → 허브
  await page.goto(BASE + '#sudoku');
  await page.locator('#sudoku a.daily-card').nth(1).click();
  await page.waitForURL(/DailySudoku\/$/);
  await page.waitForFunction(() => !document.getElementById('game-screen').classList.contains('hidden'), null, { timeout: 15000 });
  check(true, '스도쿠 익스텐디드: 게임 화면');
  await page.screenshot({ path: path.join(SHOTS, '4-sudoku-game.png') });
  await page.evaluate(() => document.getElementById('btn-go-landing').click());
  await page.click('#confirm-ok');
  await page.waitForURL(/\/ProjectDaily\/#sudoku$/);
  check(true, '스도쿠: 메인 화면 확인 → 허브 #sudoku');
  const sudokuBadge = await page.locator('#sudoku .daily-card-status').nth(1).textContent();
  check(sudokuBadge === '플레이 전', `허브: 스도쿠는 시작 전이면 '플레이 전' (게임 랜딩과 같음) (${sudokuBadge})`);

  // 5. 지난 퍼즐 — 허브 카드 안에서 달력 → 날짜 골라 플레이 → 게임에서 그 퍼즐 → 메인 화면 = 허브
  for (const [slug, dir, modeLabel] of [['sudoku', 'DailySudoku', '익스텐디드'], ['trilateral', 'DailyTrilateral', '익스텐디드'], ['wordship', 'DailyWordship', '사자성어']]) {
    await page.goto(BASE + '#' + slug);
    const card = page.locator(`#${slug} .landing-card`);
    const w0 = await card.evaluate((e) => e.getBoundingClientRect().width);
    await page.locator(`#${slug} .landing-btn`, { hasText: '지난 퍼즐' }).click();
    check(new URL(page.url()).pathname.endsWith('/ProjectDaily/') && await page.locator(`#${slug} .archive-stack`).isVisible()
      && await page.locator(`#${slug} .daily-card-status`).first().isHidden(), `${slug}: 지난 퍼즐 → 페이지 이동 없이 같은 카드 안에 달력`);
    check(Math.abs(await card.evaluate((e) => e.getBoundingClientRect().width) - w0) < 0.5, `${slug}: 카드 가로 폭 그대로 (${Math.round(w0)}px)`);
    check((await page.locator(`#${slug} .hub-back`).textContent()) === '‹ 뒤로', `${slug}: 카드 왼쪽 위 "‹ 뒤로"`);
    if (slug === 'wordship') await page.screenshot({ path: path.join(SHOTS, '5-hub-archive.png') });
    await page.locator(`#${slug} .hub-back`).click();
    check(await page.locator(`#${slug} .daily-card-status`).first().isVisible(), `${slug}: ‹ 뒤로 → 카드 메인으로`);
    await page.locator(`#${slug} .landing-btn`, { hasText: '지난 퍼즐' }).click();
    check(await page.locator(`#${slug} .archive-play`).isDisabled(), `${slug}: 날짜 고르기 전엔 플레이 비활성`);
    await page.locator(`#${slug} .archive-stack .mode-tab`, { hasText: modeLabel }).click();
    const pick = page.locator(`#${slug} .cal-cell--pickable`).last();
    const day = await pick.locator('.cal-day').textContent();
    await pick.click();
    await page.locator(`#${slug} .archive-play`).click();
    await page.waitForURL(new RegExp(`${dir}/$`));
    await page.waitForFunction(() => !document.getElementById('game-screen').classList.contains('hidden'), null, { timeout: 15000 });
    check(!page.url().includes('archive='), `${slug}: ${modeLabel} ${day}일 지난 퍼즐 바로 시작 (주소 정리됨)`);
    if (slug === 'wordship') await page.screenshot({ path: path.join(SHOTS, '5-wordship-archive-game.png') });
    await page.evaluate(() => document.getElementById('btn-go-landing').click());
    if (slug === 'sudoku') await page.click('#confirm-ok').catch(() => {});
    await page.waitForURL(new RegExp(`/ProjectDaily/#${slug}$`));
    check(true, `${slug}: 지난 퍼즐 게임 → 메인 화면 → 허브`);
  }

  // 6. 워드십 사자성어 → 게임 → 메인 화면 → 허브
  await page.locator('#wordship a.daily-card').nth(2).click(); // 스탠다드 · 익스텐디드 · 사자성어
  await page.waitForURL(/DailyWordship\/$/);
  await page.waitForFunction(() => !document.getElementById('game-screen').classList.contains('hidden'), null, { timeout: 15000 });
  await page.screenshot({ path: path.join(SHOTS, '6-wordship-game.png') });
  await page.click('#btn-go-landing');
  await page.waitForURL(/\/ProjectDaily\/#wordship$/);
  check(true, '워드십 사자성어: 게임 → 메인 화면 → 허브');

  // 7. 통계만 열기 → 닫으면 허브
  await page.goto(BASE + '#sudoku');
  await page.locator('#sudoku .landing-mini-btn', { hasText: '통계' }).click();
  check(new URL(page.url()).pathname.endsWith('/ProjectDaily/') && await page.locator('#sudoku .stats-stack').isVisible(), '스도쿠: 통계 → 카드 안에서 열림');
  await page.locator('#sudoku .hub-back').click();
  check(await page.locator('#sudoku .daily-card-status').first().isVisible(), '통계 ‹ 뒤로 → 카드 메인');

  // 8. 다크 모드 — 허브에서 켜면 게임도 다크
  await page.locator('#sudoku .landing-mini-btn', { hasText: '다크 모드' }).click();
  await page.screenshot({ path: path.join(SHOTS, '8-hub-dark.png') });
  await page.goto(BASE + 'DailyTrilateral/');
  check(await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark', '허브 다크 모드 → 게임에도 적용');
  await page.click('#btn-landing-dark');
  await page.goto(BASE + 'DailyWordship/');
  check(await page.evaluate(() => document.documentElement.getAttribute('data-theme')) !== 'dark', '게임에서 다크 모드 끄면 다른 게임도 꺼짐');
  await page.goto(BASE);
  check(await page.evaluate(() => document.documentElement.getAttribute('data-theme')) !== 'dark', '게임에서 다크 모드 끄면 허브도 꺼짐');

  // 9. 새 탭에서 게임 주소로 직접 접속
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx2.addInitScript(() => { try { localStorage.setItem('wordship:seen-help', '1'); } catch {} });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  // 워드십은 메인 화면이 허브 카드 하나 — 게임 주소로 바로 오면 허브 #wordship
  await p2.goto(BASE + 'DailyWordship/');
  await p2.waitForURL(/\/ProjectDaily\/#wordship$/);
  check(await p2.locator('#wordship .daily-card-status').first().isVisible(), '워드십 직접 접속 → 허브 #wordship 카드');
  const extDesc = p2.locator('#wordship .daily-card-desc').nth(1);
  await p2.waitForFunction((e) => !e.textContent.startsWith('매일'), await extDesc.elementHandle(), { timeout: 5000 }).catch(() => {});
  check(/ · /.test(await extDesc.textContent()) && !(await extDesc.textContent()).startsWith('매일'), `허브 익스텐디드 카드 = 오늘의 기믹 (${await extDesc.textContent()})`);
  await p2.locator('#wordship a.daily-card').first().click();
  await p2.waitForFunction(() => !document.getElementById('game-screen').classList.contains('hidden'), null, { timeout: 15000 });
  await p2.reload();
  await p2.waitForURL(/\/ProjectDaily\/#wordship$/);
  check(true, '워드십 게임에서 새로고침 → 허브 (진행은 저장돼 카드에서 이어 하기)');
  // 스도쿠·삼각관계는 지금처럼 게임 자체 랜딩, "‹ 뒤로" 링크
  await p2.goto(BASE + 'DailyTrilateral/');
  check(await p2.evaluate(() => !document.getElementById('landing-screen').classList.contains('hidden')), '직접 접속: 게임 랜딩 표시');
  check(await p2.getAttribute('.hub-back', 'href') === '/ProjectDaily/#trilateral', '직접 접속: ‹ 뒤로 링크 = /ProjectDaily/#trilateral');
  check((await p2.textContent('.hub-back')) === '‹ 뒤로' && (await p2.locator('#archive-back').count()) === 0, '게임: "‹ 전체 게임" → "‹ 뒤로", 원래 뒤로 버튼 삭제');
  await p2.click('#btn-archive');
  check((await p2.locator('.landing-card').evaluate((e) => e.getBoundingClientRect().width)) === 340, '게임 지난 퍼즐: 카드 폭 340 그대로');
  await p2.screenshot({ path: path.join(SHOTS, '9-direct-archive.png') });
  await p2.reload();
  await p2.screenshot({ path: path.join(SHOTS, '9-direct-landing.png') });
  await p2.click('#btn-daily-play');
  await p2.waitForFunction(() => !document.getElementById('game-screen').classList.contains('hidden'), null, { timeout: 15000 });
  await p2.click('#btn-go-landing');
  await p2.waitForTimeout(300);
  check(p2.url().endsWith('/DailyTrilateral/') && await p2.evaluate(() => !document.getElementById('landing-screen').classList.contains('hidden')), '직접 접속: 메인 화면 = 게임 랜딩 (기존 동작 유지)');
  await p2.click('.hub-back');
  await p2.waitForURL(/\/ProjectDaily\/#trilateral$/);
  check(true, '‹ 뒤로 → 허브 #trilateral');

  // 10. 데스크톱 화면
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p3 = await ctx3.newPage();
  await p3.goto(BASE);
  await p3.screenshot({ path: path.join(SHOTS, '10-hub-desktop.png') });
  await p3.keyboard.press('ArrowRight');
  await p3.waitForTimeout(600);
  check(new URL(p3.url()).hash === '#trilateral', '데스크톱: → 키로 다음 게임');
  await p3.click('#hub-next');
  await p3.waitForTimeout(600);
  check(new URL(p3.url()).hash === '#wordship', '데스크톱: › 버튼으로 다음 게임');

  // 11. 소개 · 개인정보처리방침 — 허브 푸터 링크 → 글 페이지 (좁은 화면 가로 넘침 없음 · 다크 모드 공유) → 돌아가기
  const ctxP = await browser.newContext({ viewport: { width: 320, height: 568 } });
  await ctxP.addInitScript(() => { try { localStorage.setItem('daily-dark-mode', '1'); } catch {} });
  const pp = await ctxP.newPage();
  pp.on('pageerror', (e) => errors.push(e.message));
  for (const [text, file] of [['소개', 'about.html'], ['개인정보처리방침', 'privacy.html']]) {
    await pp.goto(BASE);
    await pp.locator('#sudoku .landing-footer a', { hasText: text }).click();
    await pp.waitForURL((u) => u.pathname.endsWith(`/ProjectDaily/${file}`));
    const r = await pp.evaluate(() => ({
      h1: !!document.querySelector('.page-card h1'),
      styled: getComputedStyle(document.querySelector('.page-card')).borderRadius !== '0px',
      wide: document.documentElement.scrollWidth > innerWidth,
      dark: document.documentElement.dataset.theme === 'dark',
    }));
    check(r.h1 && r.styled && !r.wide && r.dark, `허브 푸터 → ${text} (${JSON.stringify(r)})`);
    await pp.screenshot({ path: path.join(SHOTS, `11-${file.replace('.html', '')}.png`), fullPage: true });
    await pp.click('.page-back');
    await pp.waitForURL((u) => u.pathname.endsWith('/ProjectDaily/'));
  }
  await ctxP.close();

  // 아침 6시(KST) 리셋 — 허브를 켜 둔 채 넘어가도 날짜가 바뀜
  const ctxR = await browser.newContext();
  const pr = await ctxR.newPage();
  await pr.clock.install({ time: new Date('2026-09-25T05:59:50+09:00') });
  await pr.goto(BASE);
  const d0 = await pr.locator('#sudoku .landing-date').textContent();
  await pr.clock.runFor(15000);
  const d1 = await pr.locator('#sudoku .landing-date').textContent();
  check(d0 === '2026-09-24' && d1 === '2026-09-25', `아침 6시 지나면 허브 날짜 자동 갱신 (${d0} → ${d1})`);
  await ctxR.close();

  check(errors.length === 0, `콘솔/페이지 에러 없음 ${errors.length ? JSON.stringify(errors) : ''}`);
  await browser.close();
  site.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
