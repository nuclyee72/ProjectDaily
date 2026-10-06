/**
 * farm/farm.js — 허브 맨 왼쪽 데일리 농장 카드 (#farm). 규칙은 engine.js, 숫자는 data.js, 그림은 sprites.js.
 * index.html이 공용 함수를 넘겨 DailyFarm.build(ctx)로 만든다 (home.js와 같은 방식).
 * 카드 자체는 스크롤하지 않는다: 탭의 긴 목록은 쪽(‹ ›)으로 나누고, 가방 · 결과 · 고르기 · 도움말은 카드를 덮는 판으로 띄운다.
 * 가방 목록과 요리 재료 고르기만 판 안에서 세로로 스크롤한다 (.farm-scroll, 다시 그려도 위치 유지).
 * 자원(NP · SP · AP · 돈)은 글 대신 아이콘: 글에 {np} {sp} {ap} {money}로 쓰면 rich()가 아이콘으로 바꾼다.
 * 등급 글자(일반 · 고급 · 희귀 · 전설)도 rich()가 등급 색으로 칠한다 ("고급 자재" · "고급 장신구 상자"처럼 이름의 일부는 빼고).
 * 설명 글은 화면에 흩어 두지 않고 머리의 ? (도움말 판) 하나에 모은다.
 * 저장: daily-farm:state (이번 시즌) · daily-farm:history (지난 시즌 도감 기록, 초기화 안 됨).
 */
(function () {
  const STATE_KEY = 'daily-farm:state';
  const HISTORY_KEY = 'daily-farm:history';
  const TABS = [['farm', '농장', 'tab:farm'], ['explore', '탐험', 'tab:explore'], ['craft', '제작', 'tab:craft'],
    ['cook', '요리', 'tab:cook'], ['codex', '도감', 'tab:codex'], ['shop', '상점', 'tab:shop']];
  const BAG_SEGS = [['crop', '작물'], ['item', '씨앗·자재'], ['food', '음식'], ['gear', '장신구'], ['misc', '기타']];
  const CURRENCIES = [['np', 'NP'], ['sp', 'SP'], ['ap', 'AP'], ['money', '돈']];
  const BOX_TEXT = { np100: '100{np}', np200: '200{np}', seed3: '전설 씨앗 ×3', mat50: '고급 자재 ×50', ticket10: '즉시 완료권 ×10', box2: '보물 상자 ×2' };

  const fmtNum = (n) => (n < 10000 ? n.toLocaleString('ko-KR') : `${(n / 10000).toFixed(n < 100000 ? 1 : 0).replace(/\.0$/, '')}만`);
  /** 남은 시간: 1시간 넘으면 h:mm, 아니면 n분 */
  function fmtLeft(ms) {
    const m = Math.max(1, Math.ceil(ms / 60000));
    return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : `${m}분`;
  }
  const fmtHM = (ms) => { const m = Math.floor(ms / 60000); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
  const stars = (n, max = 3) => '★'.repeat(n) + '☆'.repeat(max - n);

  function build(ctx) {
    const { GAMES, todayStr, untilNextReset, readJSON, el, button } = ctx;
    const { data: D, engine: E, sprites: S } = window.DailyFarm;
    const TIER = D.TIERS;
    const EQUIP_MAX = D.GEAR.equipBase + D.CRAFT.find((l) => l.id === 'equip').steps.length;
    const rng = Math.random;
    const img = (name, cls) => { const i = S.img(name); if (cls) i.classList.add(...cls.split(' ')); return i; };
    /** 글 → 노드 목록: {np} {sp} {ap} {money}는 자원 아이콘, 등급 글자는 등급 색 */
    const CUR_NAME = Object.fromEntries(CURRENCIES);
    function curIcon(k) { const i = img('cur:' + k, 'farm-cur'); i.alt = CUR_NAME[k]; i.title = CUR_NAME[k]; return i; }
    const RICH = /\{(np|sp|ap|money)\}|(일반|고급|희귀|전설)(?! 자재| 장신구)/g;
    function rich(text) {
      const s = String(text), out = [];
      let last = 0;
      for (const m of s.matchAll(RICH)) {
        if (m.index > last) out.push(s.slice(last, m.index));
        if (m[1]) out.push(curIcon(m[1]));
        else { const w = el('span', 'farm-tier-word', m[2]); w.dataset.tier = TIER.indexOf(m[2]); out.push(w); }
        last = m.index + m[0].length;
      }
      if (last < s.length) out.push(s.slice(last));
      return out;
    }
    const rel = (tag, cls, text) => { const e = el(tag, cls); e.append(...rich(text)); return e; };
    /** 등급 테두리 색은 CSS(--farm-tier-n)가 정한다 — 다크 모드에서 색을 바꿀 수 있게 */
    const tiered = (e, t) => { if (t >= 0) e.dataset.tier = t; return e; };

    // ── 저장 ──
    let state = null;
    let history = [];
    let earnedCache = null;
    function save() {
      try {
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      } catch { /* 저장이 막혀도 화면은 이번 방문 동안 그대로 */ }
    }
    /** 시즌 넘김 · 출석 — 처음 열 때와 refresh 때마다 */
    function sync() {
      const today = todayStr();
      if (!state) {
        const saved = readJSON(STATE_KEY);
        const h = readJSON(HISTORY_KEY);
        history = Array.isArray(h) ? h : [];
        state = E.isValidState(saved) ? saved : null;
      }
      const r = E.rollSeason(state, today, Date.now());
      state = r.state;
      if (r.ended) {
        history.push(r.ended);
        openNotice(r.ended);
      }
      E.markAttendance(state, today);
      earnedCache = null;
      save();
    }
    const resultMaps = () => GAMES.flatMap((g) => g.modes.map(([m]) => readJSON(g.statsKey(m))?.results || {}));
    const earned = () => (earnedCache ||= E.npEarned(state, resultMaps(), todayStr()));
    const npNow = () => E.npBalance(state, earned());
    /** 예전 시즌 기록엔 도감 개수가 없다 (그땐 6개) */
    const codexTotal = (h) => h.total || 6;

    // ── 뼈대 ──
    const slide = el('section', 'hub-slide');
    slide.id = 'farm';
    slide.setAttribute('aria-label', '데일리 농장');
    const card = el('div', 'landing-card farm-card');

    const head = el('div', 'farm-head');
    const title = el('h1', 'farm-title', '데일리 농장');
    const seasonEl = el('span', 'farm-season');
    const helpBtn = button('farm-help-btn', '?');
    helpBtn.setAttribute('aria-label', '도움말');
    helpBtn.addEventListener('click', () => { ui.page.help = Math.max(0, TABS.findIndex(([id]) => id === ui.tab)); openPanel('help', helpPanel); });
    const bagBtn = button('farm-bag');
    bagBtn.setAttribute('aria-label', '가방');
    bagBtn.append(img('icon:bag'));
    bagBtn.addEventListener('click', () => openBag());
    head.append(title, seasonEl, helpBtn, bagBtn);

    const wallet = el('div', 'farm-wallet');
    const coinN = {};
    for (const [k, label] of CURRENCIES) {
      const c = k === 'np' ? button('farm-coin') : el('span', 'farm-coin');
      c.dataset.cur = k;
      c.title = label;
      coinN[k] = el('span', 'farm-coin-n', '0');
      c.append(img('cur:' + k), coinN[k]);
      wallet.append(c);
    }
    wallet.firstChild.setAttribute('aria-label', 'NP 내역');
    wallet.firstChild.addEventListener('click', () => openPanel('np', npPanel));

    const tabsEl = el('nav', 'farm-tabs');
    tabsEl.setAttribute('aria-label', '농장 메뉴');
    const tabBtns = {};
    for (const [id, label, icon] of TABS) {
      const b = button('farm-tab');
      b.dataset.tab = id;
      b.append(img(icon), el('span', null, label));
      b.addEventListener('click', () => { ui.tab = id; ui.ticketPlot = null; renderBody(); paintTabs(); });
      tabBtns[id] = b;
      tabsEl.append(b);
    }
    const body = el('div', 'farm-body');
    body.addEventListener('click', (e) => {
      if (ui.ticketPlot != null && !e.target.closest('.farm-plot-cell')) { ui.ticketPlot = null; renderBody(); }
    });
    const toastEl = el('p', 'farm-toast');
    const panel = el('div', 'farm-panel');
    panel.hidden = true;
    card.append(head, wallet, tabsEl, body, toastEl, panel);
    slide.append(card);

    const ui = { tab: 'farm', craftSeg: 'build', shopSeg: 'np', bagSeg: 'crop', cookTier: 0, cookReady: false, cropAsc: false, gearSlot: null, ticketPick: false, ticketPlot: null, page: {}, scroll: {} };
    const rows = (name) => Number(getComputedStyle(card).getPropertyValue('--farm-' + name)) || 4;
    const pageOf = (key, total, per) => {
      const pages = Math.max(1, Math.ceil(total / per));
      ui.page[key] = Math.min(Math.max(0, ui.page[key] || 0), pages - 1);
      return [ui.page[key], pages];
    };
    function pager(key, page, pages, redraw) {
      const p = el('div', 'farm-pager');
      if (pages <= 1) return p;
      const prev = button('farm-page-btn', '‹');
      const next = button('farm-page-btn', '›');
      prev.setAttribute('aria-label', '이전 쪽');
      next.setAttribute('aria-label', '다음 쪽');
      prev.disabled = page === 0;
      next.disabled = page >= pages - 1;
      prev.addEventListener('click', () => { ui.page[key] = page - 1; redraw(); });
      next.addEventListener('click', () => { ui.page[key] = page + 1; redraw(); });
      p.append(prev, el('span', 'farm-page-n', `${page + 1} / ${pages}`), next);
      return p;
    }
    function seg(items, cur, onPick) {
      const s = el('div', 'stats-seg farm-seg');
      for (const [id, label, aria] of items) {
        const b = button(cur === id ? 'active' : null);
        b.append(...rich(label));
        if (aria) b.setAttribute('aria-label', aria);
        b.dataset.seg = id;
        b.addEventListener('click', () => onPick(id));
        s.append(b);
      }
      return s;
    }
    const btn = (label, onClick, disabled = false, cls = 'farm-btn') => {
      const b = button(cls);
      b.append(...rich(label));
      b.disabled = disabled;
      b.addEventListener('click', onClick);
      return b;
    };
    /** 그림 + 개수 한 덩어리 */
    function count(icon, n, label) {
      const s = el('span', 'farm-count');
      s.title = label;
      s.append(img(icon), el('span', null, fmtNum(n)));
      return s;
    }
    /** 별: 채운 별(금색) + 빈 별 — "3성" 대신 ★★★ */
    function starLine(n) {
      const s = el('span', 'farm-starline');
      s.setAttribute('aria-label', `별 ${n}개`);
      s.append(el('b', null, '★'.repeat(n)), '☆'.repeat(3 - n));
      return s;
    }
    /** 품질 색 단계: 95 이상 4(빨강) · 80 3(주황) · 60 2(파랑) · 40 1(초록) · 그 아래 0 (색 없음) */
    const qGrade = (q) => { const i = D.QUALITY.colors.findIndex((min) => q >= min); return i < 0 ? 0 : D.QUALITY.colors.length - i; };
    const graded = (e, q) => { const g = qGrade(q); if (g) e.dataset.grade = g; return e; };
    /** 작물 한 개 칸: 그림 + 오른쪽 아래 품질 숫자, 바탕은 품질 색 */
    function cropCell(id, q, on, onClick) {
      const crop = D.CROP_BY_ID[id];
      const c = graded(tiered(button('farm-slot' + (on ? ' is-on' : '')), crop.tier), q);
      c.dataset.crop = id;
      c.title = `${crop.name} · 품질 ${q}`;
      c.setAttribute('aria-label', c.title);
      c.setAttribute('aria-pressed', String(on));
      c.append(img('crop:' + id), el('span', 'farm-q', String(q)));
      c.addEventListener('click', onClick);
      return c;
    }
    /** 판 안 세로 스크롤 목록. key가 같으면 다시 그려도 스크롤 위치를 이어 간다 */
    function scrollBox(cls, key) {
      const box = el('div', cls + ' farm-scroll');
      box.dataset.key = key;
      return box;
    }
    function toast(text) {
      toastEl.replaceChildren(...rich(text));
      toastEl.classList.add('is-on');
      clearTimeout(toastEl._t);
      toastEl._t = setTimeout(() => toastEl.classList.remove('is-on'), 2800);
    }
    /** 바꾼 뒤: 저장 · 다시 그리기 · 가방 넘침 확인 */
    function commit() {
      save();
      render();
      checkOverflow();
    }

    // ── 판 (카드를 덮는 작은 화면) ──
    let panelName = null;
    let panelDraw = null;
    let panelForced = false;
    function openPanel(name, draw, forced = false) {
      panelName = name;
      panelDraw = draw;
      panelForced = forced;
      panel.hidden = false;
      drawPanel();
    }
    function drawPanel() {
      if (!panelName) return;
      const old = panel.querySelector('.farm-scroll');
      if (old) ui.scroll[old.dataset.key] = old.scrollTop;
      const [titleText, ...content] = panelDraw();
      const top = el('div', 'farm-panel-head');
      top.append(rel('h2', 'farm-panel-title', titleText));
      if (!panelForced) {
        const x = button('farm-panel-close', '✕');
        x.setAttribute('aria-label', '닫기');
        x.addEventListener('click', closePanel);
        top.append(x);
      }
      panel.replaceChildren(top, ...content);
      const box = panel.querySelector('.farm-scroll');
      if (box && ui.scroll[box.dataset.key] != null) box.scrollTop = ui.scroll[box.dataset.key];
    }
    function closePanel() {
      if (panelForced && overflowKind()) return;
      panelName = null;
      panelForced = false;
      panel.hidden = true;
      panel.replaceChildren();
      render();
      checkOverflow();
    }
    /** 가방이 넘쳤으면 그 칸을 펼친 가방을 닫을 수 없게 띄운다 (줄이면 닫힘 버튼이 돌아온다) */
    const overflowKind = () => (E.gearOverflow(state) > 0 ? 'gear' : E.cropOverflow(state) > 0 ? 'crop' : null);
    function checkOverflow() {
      const kind = overflowKind();
      if (!kind || (panelName === 'bag' && panelForced)) return;
      resetBag(kind);
      if (kind === 'crop') { ui.cropAsc = true; ui.page.bagCrop = 0; } // 넘치면 싼 것(낮은 등급 · 품질)부터
      openPanel('bag', bagPanel, true);
    }

    // ── 머리 ──
    function paintHead() {
      const today = todayStr();
      const left = E.daysLeft(today);
      const word = el('span', 'farm-season-word', ' 시즌');
      seasonEl.replaceChildren(`${Number(state.season.slice(5))}월`, word, ` · ${left ? `D-${left}` : 'D-DAY'}`);
      seasonEl.classList.toggle('is-ending', left <= 1);
      coinN.np.textContent = fmtNum(npNow());
      coinN.sp.textContent = fmtNum(state.sp);
      coinN.ap.textContent = fmtNum(state.ap);
      coinN.money.textContent = fmtNum(state.money);
    }
    function paintTabs() {
      for (const [id, b] of Object.entries(tabBtns)) b.setAttribute('aria-current', String(id === ui.tab));
    }

    // ── 농장 ──
    let farmSig = '';
    const farmLabels = [];
    /** 밭 한 칸 (+ 자라는 칸을 눌렀으면 그 위에 완료권 쓰기 버튼) */
    function plotView(i, now) {
      const unlocked = i < E.plotCount(state);
      const plot = unlocked ? state.plots[i] : null;
      const cell = el('div', 'farm-plot-cell');
      const b = button('farm-plot');
      b.dataset.plot = i;
      b.append(img(unlocked ? 'tile:tilled' : 'tile:locked', 'farm-ground'));
      let label;
      if (!unlocked) {
        b.classList.add('is-locked');
        b.append(img('icon:lock', 'farm-lock'));
        label = '잠김';
      } else if (!plot) {
        b.classList.add('is-empty');
        label = '심기';
      } else {
        const stage = E.growthStage(plot, now);
        b.append(img(stage === 3 ? 'ready:' + plot.crop : 'grow:' + stage, stage === 3 ? 'farm-plant is-ready' : 'farm-plant'));
        if (stage === 3) { b.classList.add('is-ready'); label = '수확!'; } else label = fmtLeft(plot.readyAt - now);
      }
      const lab = el('span', 'farm-plot-label', label);
      farmLabels[i] = lab;
      b.append(lab);
      b.addEventListener('click', () => onPlot(i));
      cell.append(b);
      if (ui.ticketPlot === i && plot && now < plot.readyAt) {
        b.classList.add('is-picked');
        const has = state.inv.ticket > 0;
        const pop = btn(has ? '완료권 쓰기' : '완료권 없음', () => {
          ui.ticketPlot = null;
          if (E.useTicket(state, i, Date.now())) harvestOne(i); else renderBody();
        }, !has, 'farm-plot-pop');
        pop.prepend(img('item:ticket'));
        pop.dataset.col = i % 4;
        pop.title = `즉시 완료권 ${state.inv.ticket}장`;
        cell.append(pop);
      }
      return cell;
    }
    const farmSignature = (now) => state.plots.map((p) => (p ? `${p.crop}${E.growthStage(p, now)}` : '-')).join() + E.plotCount(state);
    function farmTab() {
      const now = Date.now();
      farmSig = farmSignature(now);
      const left = E.daysLeft(todayStr());
      const parts = [];
      if (left <= 1) parts.push(el('p', 'farm-alert', `${left ? '내일' : '오늘'}이 시즌 마지막 날 · 시즌이 끝나면 전부 초기화돼요 (도감 기록만 남아요)`));
      const grid = el('div', 'farm-plots');
      for (let i = 0; i < 8; i++) grid.append(plotView(i, now));
      const row = el('div', 'farm-row');
      const ready = state.plots.some((p) => p && now >= p.readyAt);
      row.append(count('item:ticket', state.inv.ticket, '즉시 완료권'), btn('모두 수확', harvestAll, !ready));
      parts.push(grid, row);
      return parts;
    }
    function onPlot(i) {
      const now = Date.now();
      if (i >= E.plotCount(state)) { toast('제작 › 밭을 만들면 칸이 늘어요'); return; }
      const plot = state.plots[i];
      if (!plot) { openPanel('plant', () => plantPanel(i)); return; }
      if (now >= plot.readyAt) { ui.ticketPlot = null; harvestOne(i); return; }
      ui.ticketPlot = ui.ticketPlot === i ? null : i;
      renderBody();
    }
    function harvestOne(i) {
      const r = E.harvest(state, i, Date.now(), rng);
      if (!r) return;
      const extra = [r.seedBack ? `씨앗 +${r.seedBack}` : '', r.ticket ? '완료권 +1' : ''].filter(Boolean).join(' · ');
      toast(`${D.CROP_BY_ID[r.crop].name} ×${r.qualities.length} · 품질 ${r.qualities.join(' ')}${extra ? ' · ' + extra : ''}`);
      commit();
    }
    function harvestAll() {
      const now = Date.now();
      let n = 0, items = 0;
      state.plots.forEach((p, i) => {
        if (p && now >= p.readyAt) { const r = E.harvest(state, i, now, rng); n++; items += r.qualities.length; }
      });
      if (n) toast(`${n}칸 수확 · 작물 ${items}개`);
      commit();
    }
    function plantPanel(i) {
      const list = el('div', 'farm-list');
      const empty = () => state.plots.map((p, k) => (k < E.plotCount(state) && !p ? k : -1)).filter((k) => k >= 0);
      for (let t = 0; t < 4; t++) {
        const have = state.inv.seed[t];
        const ok = E.canPlantTier(state, t);
        const row = el('div', 'farm-item');
        row.append(img('seed:' + t, 'farm-icon'));
        const txt = el('div', 'farm-item-text');
        txt.append(rel('strong', null, `${TIER[t]} 씨앗`), el('span', null, ok ? `${fmtNum(have)}개` : `시설 강화 ${t} 필요`));
        row.append(txt);
        const plant = (cells) => {
          const now = Date.now();
          let n = 0;
          for (const k of cells) if (state.inv.seed[t] > 0 && E.plant(state, k, t, now, rng)) n++;
          if (n) toast(`${TIER[t]} 씨앗 ${n}칸 심음`);
          closePanel();
          commit();
        };
        const many = Math.min(have, empty().length);
        row.append(btn('심기', () => plant([i]), !ok || !have), btn(`빈 칸 모두${many > 1 ? ` ${many}` : ''}`, () => plant(empty()), !ok || many < 2));
        list.append(row);
      }
      return [`${i + 1}번 칸에 심기`, list];
    }

    // ── 탐험 ──
    let exploreSig = '';
    const exploreRefs = {};
    function boostEnd(now) {
      const live = state.explore.boosts.filter(([, b]) => b > now);
      return live.length ? Math.max(...live.map(([, b]) => b)) : 0;
    }
    function exploreTab() {
      const now = Date.now();
      const p = E.explorePending(state, now);
      exploreSig = String(p.rolls);
      const scene = el('div', 'farm-scene');
      const walker = el('div', 'farm-walker');
      for (let f = 0; f < 3; f++) walker.append(img('char:' + f, 'farm-walk-frame'));
      scene.append(walker);
      const bar = el('div', 'farm-bar');
      const fill = el('span', 'farm-bar-fill');
      fill.style.width = `${(p.accMs / (D.EXPLORE.capHours * 3600000)) * 100}%`;
      bar.append(fill);
      const time = el('p', 'farm-explore-time');
      const boost = el('p', 'farm-explore-boost');
      exploreRefs.fill = fill;
      exploreRefs.time = time;
      exploreRefs.boost = boost;
      paintExplore(now);
      const claim = btn(p.rolls ? `받기 · ${p.rolls}번` : '받기', claimExplore, !p.rolls, 'landing-btn primary-btn farm-wide');
      claim.classList.add('farm-claim');
      const boxes = el('div', 'farm-row');
      boxes.append(
        count('item:box', state.inv.box, '보물 상자'), btn('열기', openBoxOne, state.inv.box < 1),
        count('item:relic', state.inv.relic, '고대 유물'), btn('열기', openRelicOne, state.inv.relic < 1),
      );
      return [scene, bar, time, boost, claim, boxes];
    }
    function paintExplore(now) {
      const p = E.explorePending(state, now);
      exploreRefs.fill.style.width = `${(p.accMs / (D.EXPLORE.capHours * 3600000)) * 100}%`;
      exploreRefs.time.textContent = `쌓인 시간 ${fmtHM(p.accMs)} / ${D.EXPLORE.capHours}:00${p.capped ? ' · 가득 참' : ''}`;
      const end = boostEnd(now);
      exploreRefs.boost.textContent = end ? `부스트 ×${D.SHOP.boostMult} · ${fmtLeft(end - now)} 남음` : '';
    }
    function claimExplore() {
      const r = E.claimExplore(state, Date.now(), rng);
      save();
      render();
      openPanel('got', () => gotPanel(r));
    }
    function gotPanel(r) {
      const grid = el('div', 'farm-got');
      const cell = (icon, n, label, hidden) => {
        const c = el('div', 'farm-got-cell' + (hidden ? ' is-hidden' : ''));
        c.title = label;
        c.append(img(icon, 'farm-icon'), el('strong', null, `×${fmtNum(n)}`), rel('span', null, label));
        grid.append(c);
      };
      r.got.seed.forEach((n, t) => { if (n) cell('seed:' + t, n, `${TIER[t]} 씨앗`); });
      if (r.got.mat) cell('item:mat', r.got.mat, '자재');
      if (r.got.mat2) cell('item:mat2', r.got.mat2, '고급 자재');
      if (r.got.gear.length) cell('item:gear', r.got.gear.length, '장신구');
      if (r.got.box) cell('item:box', r.got.box, '보물 상자', true);
      if (r.got.relic) cell('item:relic', r.got.relic, '고대 유물', true);
      if (!grid.children.length) grid.append(el('p', 'farm-hint', '아직 쌓인 시간이 없어요.'));
      return [`탐험 ${r.hours}시간 · ${r.rolls}번`, grid, btn('확인', closePanel, false, 'landing-btn primary-btn farm-wide')];
    }
    function openBoxOne() {
      const id = E.openBox(state, rng);
      if (id) toast(`보물 상자 → ${BOX_TEXT[id]}`);
      earnedCache = null;
      commit();
    }
    function openRelicOne() {
      const g = E.openRelic(state, rng);
      if (g) toast(`고대 유물 → ${gearName(g)} · ${g.lines.map(lineText).join(' · ')}`);
      commit();
    }

    // ── 제작 ──
    function costView(st) {
      const c = el('span', 'farm-cost');
      const part = (icon, need, have, label) => {
        if (!need) return;
        const s = el('span', have < need ? 'is-short' : null);
        s.title = label;
        s.append(img(icon), fmtNum(need));
        c.append(s);
      };
      part('item:mat', st.mat, state.inv.mat, '자재');
      part('item:mat2', st.mat2, state.inv.mat2, '고급 자재');
      part('cur:money', st.money, state.money, '돈');
      return c;
    }
    function craftTab() {
      const parts = [seg([['build', '강화'], ['synth', '씨앗 합성']], ui.craftSeg, (s) => { ui.craftSeg = s; renderBody(); })];
      const have = el('div', 'farm-row farm-have');
      have.append(count('item:mat', state.inv.mat, '자재'), count('item:mat2', state.inv.mat2, '고급 자재'), count('cur:money', state.money, '돈'));
      parts.push(have);
      if (ui.craftSeg === 'build') {
        const per = rows('rows');
        // 아직 만들 게 있는 줄 먼저, 다 만든 줄은 뒤로
        const lines = [...D.CRAFT].sort((a, b) => !E.nextStep(state, a.id) - !E.nextStep(state, b.id));
        const [page, pages] = pageOf('craft', lines.length, per);
        const list = el('div', 'farm-list');
        for (const line of lines.slice(page * per, page * per + per)) {
          const lv = state.built[line.id];
          const st = E.nextStep(state, line.id);
          const can = E.canCraft(state, line.id);
          const row = el('div', 'farm-item farm-craft');
          row.dataset.line = line.id;
          const txt = el('div', 'farm-item-text');
          txt.append(el('strong', null, `${line.name} ${lv}/${line.steps.length}`),
            rel('span', null, st ? st.desc : '다 만들었어요'));
          row.append(txt);
          if (st) {
            const side = el('div', 'farm-craft-side');
            side.append(costView(st), btn(can === 'requires' ? '합성기 먼저' : '제작', () => {
              if (E.craft(state, line.id)) toast(`${line.name} ${state.built[line.id]} 완성`);
              commit();
            }, can !== 'ok'));
            row.append(side);
          }
          list.append(row);
        }
        parts.push(list, pager('craft', page, pages, renderBody));
      } else if (!state.built.synth) {
        parts.push(el('p', 'farm-hint farm-empty', '강화 › 씨앗 합성기를 먼저 만들어요.'));
      } else {
        const k = E.synthRatio(state);
        const list = el('div', 'farm-list');
        for (let t = 0; t < 3; t++) {
          const have = state.inv.seed[t];
          const max = Math.floor(have / k);
          const row = el('div', 'farm-item');
          row.dataset.synth = t;
          row.append(img('seed:' + t, 'farm-icon'));
          const txt = el('div', 'farm-item-text');
          txt.append(rel('strong', null, `${TIER[t]} → ${TIER[t + 1]}`), el('span', null, `${k}개 → 1개 · 가진 것 ${fmtNum(have)}`));
          row.append(txt);
          const go = (times) => { const out = E.synthesize(state, t, times, rng); if (out) toast(`${TIER[t + 1]} 씨앗 +${out}`); commit(); };
          row.append(btn('1번', () => go(1), max < 1), btn(`최대${max > 1 ? ` ${max}` : ''}`, () => go(max), max < 2));
          list.append(row);
        }
        parts.push(list);
      }
      return parts;
    }

    // ── 요리 ──
    function ingView(dish) {
      const s = el('span', 'farm-ings');
      for (const [id, n] of dish.ings) {
        const have = (state.inv.crop[id] || []).length;
        const i = el('span', have >= n ? null : 'is-short');
        i.title = `${D.CROP_BY_ID[id].name} ${have}/${n}`;
        i.append(img('crop:' + id), `${have}/${n}`);
        s.append(i);
      }
      return s;
    }
    function cookTab() {
      const tierSeg = seg(TIER.map((t, i) => [i, t]), ui.cookTier, (t) => { ui.cookTier = t; ui.page.cook = 0; renderBody(); });
      const toggle = button('farm-toggle' + (ui.cookReady ? ' is-on' : ''), '재료 있는 것만');
      toggle.setAttribute('aria-pressed', String(ui.cookReady));
      toggle.addEventListener('click', () => { ui.cookReady = !ui.cookReady; ui.page.cook = 0; renderBody(); });
      const codex = E.codexDishes(state.season);
      const all = D.DISHES.filter((d) => d.tier === ui.cookTier && (!ui.cookReady || E.bestPicks(state, d.id)));
      const per = rows('rows');
      const [page, pages] = pageOf('cook', all.length, per);
      const list = el('div', 'farm-list');
      for (const dish of all.slice(page * per, page * per + per)) {
        const row = button('farm-item farm-dish');
        row.dataset.dish = dish.id;
        row.append(tiered(img('dish:' + dish.id, 'farm-icon'), dish.tier));
        const txt = el('div', 'farm-item-text');
        const name = el('strong', null, dish.name);
        if (codex.includes(dish.id)) name.append(el('span', 'farm-badge', '도감'));
        txt.append(name, ingView(dish));
        row.append(txt);
        row.addEventListener('click', () => openCook(dish.id));
        list.append(row);
      }
      if (!all.length) list.append(el('p', 'farm-hint farm-empty', '재료가 다 있는 요리가 없어요.'));
      const top = el('div', 'farm-row');
      top.append(tierSeg, toggle);
      return [top, list, pager('cook', page, pages, renderBody)];
    }
    /**
     * 요리 판: 재료 개수만큼 칸(□□□□)이 있고, 칸을 누르면 아래에 그 작물이 하나씩 (품질 순) 나와 골라 넣는다.
     * 처음엔 품질이 높은 것부터 채워 둔다.
     */
    function openCook(dishId) {
      const dish = D.DISH_BY_ID[dishId];
      const slots = dish.ings.flatMap(([id, n]) => Array.from({ length: n }, () => ({ id, idx: null })));
      const fillBest = () => {
        for (const [id] of dish.ings) {
          const order = (state.inv.crop[id] || []).map((q, i) => [q, i]).sort((a, b) => b[0] - a[0]);
          slots.filter((s) => s.id === id).forEach((s, k) => { s.idx = order[k] ? order[k][1] : null; });
        }
      };
      fillBest();
      let active = Math.max(0, slots.findIndex((s) => s.idx == null));
      let result = null;
      ui.scroll = {};
      openPanel('cook', () => {
        if (result) return cookResult(dish, result);
        const slotRow = el('div', 'farm-cook-slots');
        slots.forEach((s, k) => {
          const have = state.inv.crop[s.id] || [];
          const crop = D.CROP_BY_ID[s.id];
          const b = tiered(button('farm-slot farm-cook-slot' + (k === active ? ' is-active' : '') + (s.idx == null ? ' is-empty' : '')), crop.tier);
          b.dataset.slot = k;
          b.title = `${crop.name} · ${s.idx == null ? '비어 있음' : '품질 ' + have[s.idx]}`;
          b.setAttribute('aria-label', `${k + 1}번째 재료 ${b.title}`);
          b.append(img('crop:' + s.id));
          if (s.idx != null) graded(b, have[s.idx]).append(el('span', 'farm-q', String(have[s.idx])));
          b.addEventListener('click', () => { active = k; drawPanel(); });
          slotRow.append(b);
        });
        // 고르기: 지금 칸의 작물. 다른 칸에 이미 넣은 건 빼고 품질 높은 순
        const cur = slots[active];
        const crop = D.CROP_BY_ID[cur.id];
        const have = state.inv.crop[cur.id] || [];
        const used = new Set(slots.filter((s, k) => k !== active && s.id === cur.id && s.idx != null).map((s) => s.idx));
        const items = have.map((q, i) => [q, i]).filter(([, i]) => !used.has(i)).sort((a, b) => b[0] - a[0]);
        const grid = scrollBox('farm-slots farm-pick', 'cook:' + cur.id);
        for (const [q, i] of items) {
          grid.append(cropCell(cur.id, q, cur.idx === i, () => {
            if (cur.idx === i) cur.idx = null;
            else {
              cur.idx = i;
              const next = [...slots.keys()].map((k) => (active + k) % slots.length).find((k) => slots[k].idx == null);
              if (next != null) active = next;
            }
            drawPanel();
          }));
        }
        if (!items.length) grid.append(el('p', 'farm-hint farm-empty', `가방에 ${crop.name} 없음`));
        const pickHead = el('div', 'farm-row farm-pick-head');
        pickHead.append(el('span', 'farm-pick-name', `${active + 1}번째 재료 · ${crop.name}`),
          btn('최고 품질로', () => { fillBest(); drawPanel(); }));
        const ready = slots.every((s) => s.idx != null);
        const qs = slots.filter((s) => s.idx != null).map((s) => state.inv.crop[s.id][s.idx]);
        const avg = qs.length ? qs.reduce((a, b) => a + b, 0) / qs.length : 0;
        const ch = E.starChances(avg, dish.tier);
        const odds = el('p', 'farm-odds', ready ? `평균 품질 ${avg.toFixed(1)} · 별 확률 ${ch.map((c) => Math.round(c * 100) + '%').join(' → ')}` : `재료 칸 ${slots.filter((s) => s.idx == null).length}개가 비었어요`);
        const go = btn('요리하기', () => {
          const sel = {};
          for (const s of slots) (sel[s.id] ||= []).push(s.idx);
          result = E.cook(state, dishId, sel, rng);
          save();
          render();
          drawPanel();
        }, !ready, 'landing-btn primary-btn farm-wide');
        const headRow = el('div', 'farm-cook-head');
        headRow.append(tiered(img('dish:' + dishId, 'farm-icon'), dish.tier), rel('span', null, `${TIER[dish.tier]} 요리 · 원래 값 ${fmtNum(E.dishPrice(dishId))}{money}`));
        return [dish.name, headRow, slotRow, pickHead, grid, odds, go];
      });
      function cookResult(d, r) {
        const box = el('div', 'farm-result');
        box.dataset.stars = r.stars;
        const starEl = el('div', 'farm-stars');
        starEl.setAttribute('aria-label', `별 ${r.stars}개`);
        for (let k = 0; k < 3; k++) {
          const s = el('span', 'farm-star' + (k < r.stars ? ' is-on' : ''), k < r.stars ? '★' : '☆');
          s.style.animationDelay = `${k * 0.35}s`;
          starEl.append(s);
        }
        box.append(tiered(img('dish:' + d.id, 'farm-icon-lg'), d.tier), starEl, el('strong', null, d.name), rel('span', 'farm-result-sub', `${TIER[d.tier]} 요리`));
        const parts = [`${d.name} 완성`, box];
        const submit = E.canSubmit(state, d.id, r.stars);
        if (submit) {
          const c = btn('도감 제출 ', () => { E.submitCodex(state, d.id, r.stars); toast(`도감 등록 · ${d.name} ${stars(r.stars)}`); closePanel(); commit(); }, false, 'landing-btn primary-btn farm-wide');
          c.append(starLine(r.stars));
          parts.push(c);
        }
        const actions = el('div', 'farm-result-actions');
        actions.append(
          btn('가방에 두기', closePanel, false, 'landing-btn farm-half'),
          btn(`팔기 +${fmtNum(E.foodValue(d.id, r.stars))}{money}`, () => { E.sellFood(state, d.id, r.stars); closePanel(); commit(); }, false, 'landing-btn farm-half' + (submit ? '' : ' primary-btn')),
        );
        parts.push(actions);
        return parts;
      }
    }

    // ── 도감 ──
    function codexTab() {
      const ids = E.codexDishes(state.season);
      const sum = E.codexSummary(state);
      const top = el('p', 'farm-codex-sum', `${Number(state.season.slice(5))}월 도감 ${sum.done}/${ids.length} · ★${sum.stars}`);
      const grid = el('div', 'farm-codex');
      for (const id of ids) {
        const d = D.DISH_BY_ID[id];
        const cellEl = el('div', 'farm-codex-cell');
        cellEl.dataset.dish = id;
        const got = state.codex[id];
        cellEl.title = `${d.name} · ${TIER[d.tier]} 요리 · ${got == null ? '미등록' : stars(got)}`;
        cellEl.append(tiered(img('dish:' + id, 'farm-icon'), d.tier), el('strong', null, d.name));
        // 셋째 줄: 더 높은 별로 낼 수 있으면 제출 버튼, 아니면 지금 기록
        const best = Math.max(-1, ...(state.inv.food[id] || []));
        if (best >= 0 && E.canSubmit(state, id, best)) {
          const b = btn('제출 ', () => { E.submitCodex(state, id, best); toast(`도감 등록 · ${d.name} ${stars(best)}`); commit(); });
          b.append(starLine(best));
          cellEl.append(b);
        } else cellEl.append(got == null ? el('span', 'farm-codex-none', '미등록') : starLine(got));
        grid.append(cellEl);
      }
      const parts = [top, grid];
      const past = history.slice(-3).reverse().map((h) => `${Number(h.season.slice(5))}월 ${h.done}/${codexTotal(h)} ★${h.stars}`).join(' · ');
      if (past) parts.push(el('p', 'farm-hint farm-codex-past', `지난 시즌: ${past}`));
      return parts;
    }

    // ── 상점 ──
    const SHOP_ICON = { boost: 'icon:boost', ticket: 'item:ticket', mat: 'item:mat', mat2: 'item:mat2', tickets: 'item:ticket', seed1: 'seed:1', seed2: 'seed:2', gearBox: 'item:gear', gearBox2: 'item:gear' };
    function shopTab() {
      const today = todayStr();
      const cur = ui.shopSeg;
      const parts = [seg([['np', '{np}', 'NP 상점'], ['ap', '{ap}', 'AP 상점'], ['sp', '{sp}', 'SP 상점']], cur, (s) => { ui.shopSeg = s; renderBody(); })];
      const bal = cur === 'np' ? npNow() : state[cur];
      const balRow = el('div', 'farm-row');
      balRow.append(count('cur:' + cur, bal, CUR_NAME[cur]), el('span', 'farm-hint', `새 상품까지 ${untilNextReset().slice(0, 5)}`));
      parts.push(balRow);
      const items = cur === 'np' ? D.SHOP.np : E.shopOffers(today)[cur].map((id) => D.SHOP.apsp.find((x) => x.id === id));
      const list = el('div', 'farm-list');
      for (const it of items) {
        const price = cur === 'np' ? it.price : E.shopPrice(it, cur);
        const key = `${cur}:${it.id}`;
        const left = it.limit - E.boughtToday(state, key, today);
        const row = el('div', 'farm-item farm-shop-item');
        row.dataset.item = it.id;
        row.append(img(SHOP_ICON[it.id], 'farm-icon'));
        const txt = el('div', 'farm-item-text');
        txt.append(rel('strong', null, it.name), rel('span', null, `${it.desc} · 오늘 ${left}/${it.limit}`));
        row.append(txt);
        row.append(btn(`${fmtNum(price)}{${cur}}`, () => {
          const r = cur === 'np' ? E.buyNp(state, it.id, today, npNow(), Date.now()) : E.buyShop(state, cur, it.id, today, rng);
          if (r === 'ok') toast(`${it.name} 샀어요`);
          commit();
        }, left < 1 || bal < price));
        list.append(row);
      }
      parts.push(list);
      return parts;
    }

    // ── 판들 ──
    function npPanel() {
      const e = earned();
      const list = el('div', 'farm-list farm-np');
      const line = (label, val) => { const r = el('div', 'farm-np-row'); r.append(el('span', null, label), el('strong', null, val)); list.append(r); };
      line(`출석 ${e.attend}일`, `+${e.attend * D.NP.attend}`);
      line(`데일리 성공 ${e.solved}`, `+${e.solved * D.NP.solved}`);
      line(`데일리 실패 ${e.other}`, `+${e.other * D.NP.other}`);
      line('보물 상자', `+${state.bonus}`);
      line('상점에서 씀', `−${state.spent}`);
      line('지금', fmtNum(npNow()));
      return ['{np} 내역', list];
    }

    /** 도움말: 화면에 흩어져 있던 설명을 한곳에. 처음엔 지금 탭의 쪽을 연다 */
    function helpPages() {
      const k = E.synthRatio(state);
      return [
        ['농장', [
          `빈 칸을 눌러 씨앗을 심고, 다 크면 눌러 수확해요. ${D.FIELD.growHours}시간이면 다 커요.`,
          '씨앗 등급이 높을수록 좋은 작물이 나와요. 무엇이 자랄지는 심는 순간 정해져요.',
          '자라는 칸을 누르면 즉시 완료권으로 바로 다 키울 수 있어요 (가방 › 기타에서도).',
          `밭은 제작 › 밭으로 늘려요 (${D.FIELD.start}칸 → 8칸).`,
        ]],
        ['탐험', [
          `1시간마다 ${E.rollsPerHour(state)}번 찾아요. 최대 ${D.EXPLORE.capHours}시간까지 쌓여요.`,
          '씨앗 · 자재 · 장신구를 찾고, 가끔 보물 상자나 고대 유물(반짝이는 칸)이 나와요.',
          `탐험 부스트({np} 상점)를 켜면 ${D.SHOP.boostHours}시간 동안 보상 ×${D.SHOP.boostMult}.`,
        ]],
        ['제작', [
          '강화는 자재 · 고급 자재 · {money}으로 만들어요. 아직 만들 게 있는 줄이 위에 와요.',
          `씨앗 합성: 아래 등급 씨앗 ${k}개 → 윗등급 1개. 효율 증대를 만들면 ${D.SYNTH.base - 1} · ${D.SYNTH.base - 2} · ${D.SYNTH.base - 3}개로 줄어요.`,
        ]],
        ['요리', [
          '요리를 고르면 재료 개수만큼 칸이 나와요. 칸을 눌러 가방의 작물을 하나씩 골라 넣어요.',
          '처음엔 품질이 높은 작물부터 채워져 있어요. 오른쪽 아래 숫자가 품질이에요.',
          '재료 품질 평균이 높을수록 별이 잘 붙어요 (최대 ★★★).',
        ]],
        ['도감', [
          `시즌마다 요리 ${D.COOK.codex.reduce((a, b) => a + b, 0)}개 (${TIER.map((t, i) => `${t} ${D.COOK.codex[i]}`).join(' · ')}).`,
          '요리를 제출하면 등록돼요 (가방에서 빠져요). 별이 더 높으면 갱신.',
          '도감 기록은 시즌이 끝나도 남아요 (홈 프로필 배지).',
        ]],
        ['상점', [
          '상점은 매일 06:00에 바뀌어요.',
          `{np} 출석 ${D.NP.attend} · 데일리 성공 ${D.NP.solved} · 실패 ${D.NP.other} (이번 시즌 기록에서 계산) + 보물 상자.`,
          `{sp}는 씨앗, {ap}는 장신구를 분해해서 모아요 (가방). {ap} · {sp} 상점은 같은 상품에서 매일 ${D.SHOP.offers}개씩.`,
        ]],
        ['가방', [
          `작물은 하나씩 한 칸, 오른쪽 아래 숫자가 품질(1~100)이에요. 최대 ${fmtNum(D.CROP_BAG.size)}개.`,
          `칸 바탕색은 품질: ${D.QUALITY.colors.map((min, i) => `${min} 이상 ${['빨강', '주황', '파랑', '초록'][i]}`).join(' · ')}.`,
          '작물 칸을 눌러 고르고 판매({money}) · 씨앗은 분해({sp}) · 음식은 판매({money}). 목록은 위아래로 스크롤해요.',
          `장신구는 착용 포함 ${D.GEAR.bag}개. 맨 윗줄 칸을 눌러 착용 · 교체 · 해제해요. 같은 옵션은 더해져요.`,
          '잠근 장신구와 착용 중인 장신구는 분해할 수 없어요. 가방이 넘치면 줄일 때까지 가방이 닫히지 않아요.',
        ]],
        ['시즌', [
          '한 달이 한 시즌이에요. D-1부터 끝난다고 알려 줘요.',
          '시즌이 끝나면 밭 · 가방 · 강화 · 화폐가 처음부터 시작하고, 도감 기록만 남아요.',
        ]],
      ];
    }
    function helpPanel() {
      const pages = helpPages();
      const [page] = pageOf('help', pages.length, 1);
      const nav = el('div', 'farm-help-nav');
      pages.forEach(([name], i) => {
        const b = button(i === page ? 'is-on' : null, name);
        b.setAttribute('aria-pressed', String(i === page));
        b.addEventListener('click', () => { ui.page.help = i; drawPanel(); });
        nav.append(b);
      });
      const list = el('ul', 'farm-help');
      for (const t of pages[page][1]) list.append(rel('li', null, t));
      return [`도움말 · ${pages[page][0]}`, nav, list];
    }

    // ── 가방 ──
    const cropSel = new Set(); // 판매로 고른 작물 'id:인덱스'
    function resetBag(seg) {
      if (seg) ui.bagSeg = seg;
      ui.gearSlot = null;
      ui.ticketPick = false;
      ui.scroll = {};
      cropSel.clear();
    }
    function openBag() {
      resetBag();
      openPanel('bag', bagPanel, !!overflowKind());
    }
    function bagPanel() {
      const over = overflowKind();
      if (panelForced && !over) { panelForced = false; toast('가방 정리 끝'); }
      const forced = panelForced;
      const parts = [seg(BAG_SEGS, ui.bagSeg, (s) => { resetBag(s); drawPanel(); })];
      if (forced) {
        parts.push(el('p', 'farm-alert', over === 'gear'
          ? `장신구가 ${E.gearOverflow(state)}개 넘쳤어요 · 분해해서 ${D.GEAR.bag}개 이하로`
          : `작물이 ${fmtNum(E.cropOverflow(state))}개 넘쳤어요 · 팔아서 ${fmtNum(D.CROP_BAG.size)}개 이하로`));
      }
      if (ui.bagSeg === 'crop') parts.push(...cropBag());
      else if (ui.bagSeg === 'item') parts.push(...seedBag());
      else if (ui.bagSeg === 'food') parts.push(...foodBag());
      else if (ui.bagSeg === 'gear') parts.push(...gearBag());
      else parts.push(...miscBag());
      return [forced ? '가방이 넘쳤어요' : '가방', ...parts];
    }
    /** 작물 하나씩: 등급 높은 것 → 작물 순서 → 품질 높은 것 (낮은 순이면 거꾸로) */
    function cropItems() {
      const out = [];
      for (const c of [...D.CROPS].sort((a, b) => b.tier - a.tier)) {
        const qs = state.inv.crop[c.id];
        if (qs) qs.map((q, i) => [c.id, i, q]).sort((a, b) => b[2] - a[2]).forEach((x) => out.push(x));
      }
      return ui.cropAsc ? out.reverse() : out;
    }
    /** 작물: 전부 한 칸씩 (스크롤). 칸을 누르면 고르기만 바뀌고 다시 그리지 않는다 */
    function cropBag() {
      const items = cropItems();
      const over = panelForced ? E.cropOverflow(state) : 0;
      const grid = scrollBox('farm-slots', `crop:${ui.cropAsc}`);
      const setOn = (c, on) => { c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', String(on)); };
      for (const [id, i, q] of items) {
        const key = `${id}:${i}`;
        const c = cropCell(id, q, cropSel.has(key), () => {
          const on = !cropSel.has(key);
          if (on) cropSel.add(key); else cropSel.delete(key);
          setOn(c, on);
          paint();
        });
        c.dataset.key = key;
        grid.append(c);
      }
      if (!items.length) grid.append(el('p', 'farm-hint farm-empty', '작물이 없어요. 밭에서 수확해요.'));
      const info = el('span', 'farm-sell-info');
      const sort = button('farm-toggle' + (ui.cropAsc ? ' is-on' : ''), '낮은 순');
      sort.setAttribute('aria-pressed', String(ui.cropAsc));
      sort.title = '낮은 등급 · 품질부터 보기';
      sort.addEventListener('click', () => { ui.cropAsc = !ui.cropAsc; drawPanel(); });
      // 넘쳤을 때: 싼 것(등급 · 품질 낮은 것)부터 넘친 만큼 한 번에 고르기
      const pickLow = btn(`낮은 ${fmtNum(over)}개`, () => {
        const low = [...items].sort((a, b) => E.cropPrice(a[0]) - E.cropPrice(b[0]) || a[2] - b[2]).slice(0, over);
        for (const [id, i] of low) cropSel.add(`${id}:${i}`);
        for (const c of grid.children) if (c.dataset.key) setOn(c, cropSel.has(c.dataset.key));
        paint();
      });
      const clear = btn('해제', () => {
        cropSel.clear();
        for (const c of grid.querySelectorAll('.farm-slot.is-on')) setOn(c, false);
        paint();
      });
      const sell = btn('판매', () => {
        const picks = {};
        for (const k of cropSel) { const [id, i] = k.split(':'); (picks[id] ||= []).push(Number(i)); }
        const n = cropSel.size;
        const money = E.sellCrops(state, picks);
        cropSel.clear();
        if (money) toast(`작물 ${n}개 팔았어요 +${fmtNum(money)}{money}`);
        commit();
        drawPanel();
      });
      function paint() {
        const value = [...cropSel].reduce((v, k) => v + E.cropPrice(k.split(':')[0]), 0);
        info.replaceChildren(...rich(cropSel.size ? `${fmtNum(cropSel.size)}개 · +${fmtNum(value)}{money}` : `${fmtNum(items.length)} / ${fmtNum(D.CROP_BAG.size)}`));
        sell.disabled = !cropSel.size;
        clear.hidden = !cropSel.size;
        pickLow.hidden = !over || cropSel.size > 0;
      }
      paint();
      const bar = el('div', 'farm-row farm-sellbar');
      bar.append(info, sort, pickLow, clear, sell);
      return [grid, bar];
    }
    function seedBag() {
      const list = el('div', 'farm-list');
      for (let t = 0; t < 4; t++) {
        const have = state.inv.seed[t];
        const row = el('div', 'farm-item');
        row.dataset.seed = t;
        row.append(img('seed:' + t, 'farm-icon'));
        const txt = el('div', 'farm-item-text');
        txt.append(rel('strong', null, `${TIER[t]} 씨앗 ${fmtNum(have)}`), rel('span', null, `분해하면 1개 ${D.DISMANTLE.seedSp[t]}{sp}`));
        row.append(txt);
        const sell = (n) => { const sp = E.dismantleSeeds(state, t, n); if (sp) toast(`${TIER[t]} 씨앗 분해 +${fmtNum(sp)}{sp}`); commit(); drawPanel(); };
        row.append(btn('분해', () => sell(1), !have), btn('전부', () => sell(have), have < 2));
        list.append(row);
      }
      const mats = el('div', 'farm-row');
      mats.append(count('item:mat', state.inv.mat, '자재'), count('item:mat2', state.inv.mat2, '고급 자재'));
      return [list, mats];
    }
    function foodBag() {
      const list = [];
      for (const [id, arr] of Object.entries(state.inv.food)) {
        for (let st = 3; st >= 0; st--) { const n = arr.filter((x) => x === st).length; if (n) list.push([id, st, n]); }
      }
      list.sort((a, b) => E.foodValue(b[0], b[1]) - E.foodValue(a[0], a[1]));
      const box = scrollBox('farm-list', 'food');
      for (const [id, st, n] of list) {
        const row = el('div', 'farm-item');
        row.dataset.food = `${id}:${st}`;
        row.append(tiered(img('dish:' + id, 'farm-icon'), D.DISH_BY_ID[id].tier));
        const txt = el('div', 'farm-item-text');
        const name = el('strong', null, `${D.DISH_BY_ID[id].name} `);
        name.append(starLine(st));
        txt.append(name, rel('span', null, `×${n} · 1개 ${fmtNum(E.foodValue(id, st))}{money}`));
        row.append(txt);
        const sell = (k) => { let v = 0; for (let j = 0; j < k; j++) v += E.sellFood(state, id, st); toast(`팔았어요 +${fmtNum(v)}{money}`); commit(); drawPanel(); };
        row.append(btn('판매', () => sell(1)), btn('전부', () => sell(n), n < 2));
        box.append(row);
      }
      if (!list.length) box.append(el('p', 'farm-hint farm-empty', '음식이 없어요. 요리에서 만들어요.'));
      return [box];
    }
    function lineText(l) {
      const o = E.OPT_BY_ID[l.opt];
      return `${o.name} +${l.v}${l.opt === 'treasure' ? '%p' : '%'}`;
    }
    const gearName = (g) => D.GEAR.looks[E.gearLook(g)];
    const linesText = (g) => (g.lines.length ? g.lines.map(lineText).join(' · ') : '효과 없음');
    const topTier = (g) => Math.max(-1, ...g.lines.map((l) => l.tier));
    function gearIcon(g, cls) {
      const look = E.gearLook(g);
      return tiered(img(look ? 'gear:' + look : 'item:gear', cls), topTier(g));
    }
    /**
     * 장신구: 맨 윗줄 착용 칸 3개 (만들지 않은 칸은 회색 + 자물쇠). 칸을 누르면 아래 목록에서 골라 착용 · 교체, 또는 해제.
     * 칸을 고르지 않았을 때 목록은 잠금 · 분해.
     */
    function gearBag() {
      const slots = E.equipSlots(state);
      const byId = (id) => state.inv.gear.find((g) => g.id === id);
      if (ui.gearSlot != null && ui.gearSlot >= slots) ui.gearSlot = null;
      const equipRow = el('div', 'farm-equip');
      for (let i = 0; i < EQUIP_MAX; i++) {
        const g = byId(state.equip[i]) || null;
        const b = button('farm-equip-slot');
        b.dataset.slot = i;
        if (i >= slots) {
          b.classList.add('is-locked');
          b.setAttribute('aria-label', `${i + 1}번 칸 잠김`);
          b.append(img('icon:lock', 'farm-equip-icon'), el('span', null, '잠김'));
          b.addEventListener('click', () => toast('제작 › 장신구 착용을 만들면 칸이 늘어요'));
        } else {
          if (g) tiered(b, topTier(g)).append(gearIcon(g, 'farm-equip-icon'), el('span', null, gearName(g)));
          else { b.classList.add('is-empty'); b.append(el('span', 'farm-equip-plus', '+'), el('span', null, '비어 있음')); }
          b.title = g ? `${gearName(g)} · ${linesText(g)}` : '비어 있음';
          b.setAttribute('aria-label', `${i + 1}번 칸 · ${b.title}`);
          b.setAttribute('aria-pressed', String(ui.gearSlot === i));
          if (ui.gearSlot === i) b.classList.add('is-on');
          b.addEventListener('click', () => { ui.gearSlot = ui.gearSlot === i ? null : i; drawPanel(); });
        }
        equipRow.append(b);
      }
      const picking = ui.gearSlot != null;
      const inSlot = picking ? byId(state.equip[ui.gearSlot]) || null : null;
      let info;
      if (picking) {
        info = el('div', 'farm-row farm-slotbar');
        info.append(el('span', 'farm-slotbar-text', `${ui.gearSlot + 1}번 칸 · ${inSlot ? linesText(inSlot) : '끼울 장신구를 골라요'}`));
        if (inSlot) info.append(btn('해제', () => { E.unequipGear(state, inSlot.id); toast(`${gearName(inSlot)} 해제`); ui.gearSlot = null; commit(); drawPanel(); }));
        info.append(btn('취소', () => { ui.gearSlot = null; drawPanel(); }));
      } else info = el('p', 'farm-hint farm-gear-info', `착용 ${E.equipCount(state)}/${slots} · 가방 ${state.inv.gear.length}/${D.GEAR.bag}`);

      const list = state.inv.gear
        .filter((g) => !picking || !state.equip.includes(g.id))
        .sort((a, b) => (state.equip.includes(b.id) - state.equip.includes(a.id)) || topTier(b) - topTier(a) || b.lines.length - a.lines.length);
      const box = scrollBox('farm-list', picking ? 'gear:pick' : 'gear');
      for (const g of list) {
        const row = el('div', 'farm-item farm-gear');
        row.dataset.gear = g.id;
        const worn = state.equip.includes(g.id);
        row.append(gearIcon(g, 'farm-icon'));
        const txt = el('div', 'farm-item-text');
        const name = el('strong', null, linesText(g));
        if (worn) name.prepend(el('span', 'farm-badge farm-badge-worn', `착용 ${state.equip.indexOf(g.id) + 1}`));
        txt.append(name, rel('span', null, `${gearName(g)} · ${g.lines.map((l) => TIER[l.tier]).join(' · ') || '—'} · 분해 ${E.gearAp(g)}{ap}`));
        row.append(txt);
        if (picking) {
          row.append(btn(inSlot ? '교체' : '착용', () => {
            if (E.equipGear(state, g.id, ui.gearSlot)) toast(`${gearName(g)} ${inSlot ? '교체' : '착용'}`);
            ui.gearSlot = null;
            commit();
            drawPanel();
          }));
        } else {
          row.append(
            btn(g.lock ? '🔒' : '🔓', () => { E.toggleLock(state, g.id); commit(); drawPanel(); }, false, 'farm-btn farm-lock-btn'),
            btn('분해', () => { const ap = E.dismantleGear(state, [g.id]); toast(`분해 +${ap}{ap}`); commit(); drawPanel(); }, !E.canDismantle(state, g)),
          );
        }
        box.append(row);
      }
      if (!list.length) box.append(el('p', 'farm-hint farm-empty', picking ? '끼울 수 있는 장신구가 없어요.' : '장신구가 없어요. 탐험에서 찾아요.'));
      return [equipRow, info, box];
    }
    /** 기타: 보물 상자 · 고대 유물 · 즉시 완료권처럼 쓰는 아이템 */
    function miscBag() {
      const now = Date.now();
      const growing = state.plots.map((p, i) => [p, i]).filter(([p]) => p && now < p.readyAt);
      if (ui.ticketPick) {
        const top = el('div', 'farm-row');
        top.append(btn('‹ 기타', () => { ui.ticketPick = false; drawPanel(); }), count('item:ticket', state.inv.ticket, '즉시 완료권'));
        const list = scrollBox('farm-list', 'ticket');
        for (const [p, i] of growing) {
          const row = el('div', 'farm-item');
          row.dataset.plot = i;
          row.append(img('grow:' + E.growthStage(p, now), 'farm-icon')); // 무슨 작물인지는 다 클 때까지 비밀
          const txt = el('div', 'farm-item-text');
          txt.append(el('strong', null, `${i + 1}번 칸`), el('span', null, `${fmtLeft(p.readyAt - now)} 남음`));
          row.append(txt, btn('쓰기', () => {
            if (E.useTicket(state, i, Date.now())) harvestOne(i);
            if (state.inv.ticket < 1) ui.ticketPick = false;
            drawPanel();
          }, state.inv.ticket < 1));
          list.append(row);
        }
        if (!growing.length) list.append(el('p', 'farm-hint farm-empty', '자라는 밭이 없어요.'));
        return [top, list];
      }
      const list = el('div', 'farm-list');
      const item = (id, icon, name, n, desc, label, onClick, disabled) => {
        const row = el('div', 'farm-item');
        row.dataset.misc = id;
        row.append(img(icon, 'farm-icon'));
        const txt = el('div', 'farm-item-text');
        txt.append(el('strong', null, `${name} ${fmtNum(n)}`), rel('span', null, desc));
        row.append(txt, btn(label, onClick, disabled));
        list.append(row);
      };
      item('box', 'item:box', '보물 상자', state.inv.box, '{np} · 전설 씨앗 · 고급 자재 · 완료권', '열기', () => { openBoxOne(); drawPanel(); }, state.inv.box < 1);
      item('relic', 'item:relic', '고대 유물', state.inv.relic, '전설 효과가 붙은 장신구', '열기', () => { openRelicOne(); drawPanel(); }, state.inv.relic < 1);
      item('ticket', 'item:ticket', '즉시 완료권', state.inv.ticket, growing.length ? `자라는 밭 ${growing.length}칸 · 바로 다 키움` : '자라는 밭이 없어요',
        '쓰기', () => { ui.ticketPick = true; drawPanel(); }, state.inv.ticket < 1 || !growing.length);
      return [list];
    }

    function openNotice(ended) {
      queueMicrotask(() => openPanel('notice', () => [
        `${Number(ended.season.slice(5))}월 시즌 끝`,
        el('p', 'farm-notice', `도감 ${ended.done}/${codexTotal(ended)} · ★${ended.stars}`),
        el('p', 'farm-hint', '새 시즌이 시작됐어요. 밭 · 가방 · 강화는 처음부터, 도감 기록은 남아요.'),
        btn('시작하기', closePanel, false, 'landing-btn primary-btn farm-wide'),
      ]));
    }

    // ── 그리기 ──
    const TAB_VIEW = { farm: farmTab, explore: exploreTab, craft: craftTab, cook: cookTab, codex: codexTab, shop: shopTab };
    function renderBody() {
      body.dataset.tab = ui.tab;
      body.replaceChildren(...TAB_VIEW[ui.tab]());
    }
    function render() {
      paintHead();
      paintTabs();
      renderBody();
    }
    function refresh() {
      sync();
      render();
      if (panelName) drawPanel();
      checkOverflow();
    }

    // 1초마다 — 농장 카드가 보일 때만. 모양이 바뀔 때만 다시 그리고, 아니면 글자만 고친다 (누르는 중인 버튼을 갈아 끼우지 않게)
    let visible = false;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); }, { threshold: 0.5 }).observe(slide);
    } else visible = true;
    setInterval(() => {
      if (!visible || document.hidden || !state) return;
      const now = Date.now();
      if (ui.tab === 'farm') {
        if (farmSignature(now) !== farmSig) renderBody();
        else state.plots.forEach((p, i) => { if (p && farmLabels[i] && now < p.readyAt) farmLabels[i].textContent = fmtLeft(p.readyAt - now); });
      } else if (ui.tab === 'explore') {
        if (String(E.explorePending(state, now).rolls) !== exploreSig) renderBody();
        else paintExplore(now);
      }
    }, 1000);

    return {
      slide,
      refresh,
      show(name) { if (name === 'main' && panelName) closePanel(); },
      current: () => panelName || 'main',
    };
  }

  window.DailyFarm.build = build;
})();
