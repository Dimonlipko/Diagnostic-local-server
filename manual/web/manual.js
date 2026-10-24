/* Leaf ECU manual — interactive layer (no dependencies). */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const DATA = JSON.parse($('#lecu-data').textContent);
  const UIS = DATA.ui;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const escH = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── theme ───────────────────────────────────────────────────────────────
  const themeBtn = $('.theme-btn');
  if (themeBtn) themeBtn.addEventListener('click', () => {
    const root = document.documentElement;
    const cur = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    store.set('lecu-theme', next);
  });

  // ── keep the reading position when switching language ────────────────
  // Headings and figures carry the same ids in both languages; the position is
  // stored as "anchor + fraction of the way to the next anchor".
  const topOffset = () => ($('.topbar') ? $('.topbar').offsetHeight : 0) + 12;
  const posAnchors = () => $$('.article h2[id], .article h3[id], .article h4[id], .article figure.fig[id]');
  const absTop = (el) => el.getBoundingClientRect().top + window.scrollY;
  function readingPos() {
    const list = posAnchors();
    const y = window.scrollY + topOffset();
    let i = -1;
    for (let k = 0; k < list.length; k++) { if (absTop(list[k]) <= y + 1) i = k; else break; }
    if (i < 0) return { id: '', frac: list.length ? window.scrollY / Math.max(1, absTop(list[0]) - topOffset()) : 0 };
    const t0 = absTop(list[i]);
    const t1 = list[i + 1] ? absTop(list[i + 1]) : document.documentElement.scrollHeight;
    return { id: list[i].id, frac: Math.min(1, Math.max(0, (y - t0) / Math.max(1, t1 - t0))) };
  }
  function restorePos(pos) {
    const list = posAnchors();
    if (!pos.id) { window.scrollTo(0, list.length ? pos.frac * Math.max(0, absTop(list[0]) - topOffset()) : 0); return; }
    const i = list.findIndex((el) => el.id === pos.id);
    if (i < 0) return;
    const t0 = absTop(list[i]);
    const t1 = list[i + 1] ? absTop(list[i + 1]) : document.documentElement.scrollHeight;
    window.scrollTo(0, t0 + pos.frac * (t1 - t0) - topOffset());
  }
  $$('.seg a[data-lang]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const pos = readingPos();
    store.set('lecu-pos', JSON.stringify({ ...pos, at: Date.now() }));
    try { sessionStorage.setItem('lecu-pos', JSON.stringify({ ...pos, at: Date.now() })); } catch (err) { /* ignore */ }
    location.href = a.getAttribute('href');
  }));
  (() => {
    let raw = null;
    try { raw = sessionStorage.getItem('lecu-pos'); sessionStorage.removeItem('lecu-pos'); } catch (err) { /* ignore */ }
    if (!raw) { raw = store.get('lecu-pos'); }
    store.set('lecu-pos', '');
    if (!raw) return;
    let pos;
    try { pos = JSON.parse(raw); } catch (err) { return; }
    if (!pos || Date.now() - pos.at > 20000 || location.hash) return;
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    // keep re-applying while fonts/images settle, until the reader scrolls on their own
    let active = true;
    const stop = () => { active = false; };
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((ev) => window.addEventListener(ev, stop, { once: true, passive: true }));
    // the browser's own scroll anchoring would fight the re-application while the layout settles
    const rootStyle = document.documentElement.style;
    rootStyle.overflowAnchor = 'none';
    setTimeout(() => { rootStyle.overflowAnchor = ''; }, 3200);
    const apply = () => { if (active) restorePos(pos); };
    apply();
    requestAnimationFrame(apply);
    if (document.fonts) document.fonts.ready.then(apply);
    window.addEventListener('load', apply, { once: true });
    const art = $('.article');
    if (window.ResizeObserver && art) {
      const ro = new ResizeObserver(apply);
      ro.observe(art);
      setTimeout(() => { ro.disconnect(); active = false; }, 3000);
    }
    if (pos.id) history.replaceState(null, '', '#' + pos.id);
  })();

  // ── mobile nav ──────────────────────────────────────────────────────────
  const menuBtn = $('.menu-btn');
  if (menuBtn) menuBtn.addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $$('.toc a').forEach((a) => a.addEventListener('click', () => document.body.classList.remove('nav-open')));

  // ── TOC scrollspy ───────────────────────────────────────────────────────
  const tocLinks = new Map($$('.toc a').map((a) => [a.getAttribute('href').slice(1), a]));
  const heads = $$('.article h2[id], .article h3[id]').filter((h) => tocLinks.has(h.id));
  let activeId = null;
  function spy() {
    const y = window.scrollY + 120;
    let cur = heads[0];
    for (const h of heads) { if (h.getBoundingClientRect().top + window.scrollY <= y) cur = h; else break; }
    if (!cur || cur.id === activeId) return;
    activeId = cur.id;
    $$('.toc a.active').forEach((a) => a.classList.remove('active'));
    $$('.toc li.open').forEach((li) => li.classList.remove('open'));
    const a = tocLinks.get(cur.id);
    a.classList.add('active');
    const top = a.closest('.toc > ol > li');
    if (top) {
      top.classList.add('open');
      top.querySelector(':scope > a').classList.add('active');
    }
    const sb = $('.sidebar');
    const r = a.getBoundingClientRect(), sr = sb.getBoundingClientRect();
    if (r.top < sr.top + 40 || r.bottom > sr.bottom - 40) sb.scrollTop += r.top - sr.top - sr.height / 3;
  }
  let spyRaf = 0;
  window.addEventListener('scroll', () => { cancelAnimationFrame(spyRaf); spyRaf = requestAnimationFrame(spy); }, { passive: true });
  spy();

  // ── search ──────────────────────────────────────────────────────────────
  const sInput = $('.search input'), sRes = $('.search-results');
  const index = DATA.search.map((e) => ({ ...e, lt: e.t.toLowerCase(), lx: e.x.toLowerCase() }));
  for (const [id, p] of Object.entries(DATA.ecu)) index.push({ id: 'pin-' + id, t: `${id} — ${p.s}`, x: p.f, lt: (id + ' ' + p.s).toLowerCase(), lx: p.f.toLowerCase(), pin: true });
  let sel = -1;
  function runSearch() {
    const q = sInput.value.trim().toLowerCase();
    if (q.length < 2) { sRes.classList.remove('open'); return; }
    const words = q.split(/\s+/);
    const hits = [];
    for (const e of index) {
      let score = 0, ok = true;
      for (const w of words) {
        const inT = e.lt.includes(w), inX = e.lx.includes(w);
        if (!inT && !inX) { ok = false; break; }
        score += inT ? 10 : 1;
      }
      if (ok) hits.push([score + (e.pin && /x[12]-/.test(q) ? 20 : 0), e]);
    }
    hits.sort((a, b) => b[0] - a[0]);
    const mark = (s) => { let o = escH(s); for (const w of words) o = o.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`); return o; };
    const snip = (e) => {
      const w = words[0]; const i = e.lx.indexOf(w);
      if (i < 0) return e.x.slice(0, 110);
      const s = Math.max(0, i - 40);
      return (s ? '…' : '') + e.x.slice(s, s + 120) + '…';
    };
    sRes.innerHTML = hits.length ? hits.slice(0, 12).map(([, e], i) => `<a href="#${e.id}" data-i="${i}">${mark(e.t)}<small>${mark(snip(e))}</small></a>`).join('') : `<a>${escH(UIS.noResults)}</a>`;
    sel = -1;
    sRes.classList.add('open');
  }
  if (sInput) {
    sInput.addEventListener('input', runSearch);
    sInput.addEventListener('focus', runSearch);
    sInput.addEventListener('keydown', (e) => {
      const items = $$('a[href]', sRes);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
        items.forEach((a, i) => a.classList.toggle('sel', i === sel));
      } else if (e.key === 'Enter') {
        const a = items[sel >= 0 ? sel : 0];
        if (a) { location.hash = a.getAttribute('href'); sRes.classList.remove('open'); sInput.blur(); }
      } else if (e.key === 'Escape') { sRes.classList.remove('open'); sInput.blur(); }
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.search')) sRes.classList.remove('open'); });
    sRes.addEventListener('click', () => sRes.classList.remove('open'));
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); sInput.focus(); }
    });
  }

  // ── connector face helpers ──────────────────────────────────────────────
  const splitCav = (pin) => String(pin).split(',').map((s) => s.trim()).filter(Boolean);
  // Face + cavities that show a diagram pin ('ECU.X1-A3' → ecu-x1/A3, 'INV.46,48,42' → inv-gen2/[46,48,42]).
  function faceFor(ref, meta) {
    const i = ref.indexOf('.');
    const part = ref.slice(0, i), pin = ref.slice(i + 1);
    const pm = meta.pins[ref];
    if (pm && pm.ecu && /^X[12]-/.test(pin)) return { face: 'ecu-' + pin.slice(0, 2).toLowerCase(), cavs: [pin.slice(3)], part };
    const f = meta.parts[part] && meta.parts[part].face;
    return f && DATA.faces[f] ? { face: f, cavs: splitCav(pin), part } : null;
  }
  function facesOfPart(part, meta) {
    const out = [];
    for (const ref of Object.keys(meta.pins)) {
      if (!ref.startsWith(part + '.')) continue;
      const ff = faceFor(ref, meta);
      if (ff && !out.includes(ff.face)) out.push(ff.face);
    }
    const f = meta.parts[part] && meta.parts[part].face;
    if (!out.length && f && DATA.faces[f]) out.push(f);
    return out;
  }
  function cavMap(part, face, meta) {
    const m = {};
    for (const ref of Object.keys(meta.pins)) {
      if (!ref.startsWith(part + '.')) continue;
      const ff = faceFor(ref, meta);
      if (ff && ff.face === face) for (const c of ff.cavs) m[c] = ref;
    }
    return m;
  }
  function faceNode(faceId, sel, cls, mark) {
    const tpl = document.getElementById('tpl-face-' + faceId);
    if (!tpl) return null;
    const svg = tpl.content.firstElementChild.cloneNode(true);
    for (const c of mark || []) { const g = svg.querySelector(`[data-cav="${CSS.escape(c)}"]`); if (g) g.classList.add('in-diag'); }
    for (const c of [].concat(sel || [])) {
      const g = svg.querySelector(`[data-cav="${CSS.escape(c)}"]`);
      if (g) { g.classList.add('hl'); if (cls) g.classList.add('w-' + cls); }
    }
    return svg;
  }
  const naturalCmp = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });

  // ── diagram controller + inspector card ─────────────────────────────────
  // host: { canvas } → floating card next to the click; { side } → panel in the full-screen viewer.
  function Diagram(svg, meta, host, legend) {
    const nets = {}, pins = {}, parts = {};
    $$('.net', svg).forEach((g) => { nets[g.dataset.net] = g; });
    $$('.pin', svg).forEach((g) => { (pins[g.dataset.pin] = pins[g.dataset.pin] || []).push(g); });
    $$('.part, .part-over', svg).forEach((g) => { (parts[g.dataset.part] = parts[g.dataset.part] || []).push(g); });
    let locked = null, added = [], anchor = null;
    let card = host.side || null;

    function clear() {
      svg.classList.remove('has-hl');
      $$('.hl, .hl-part, .hl-peek', svg).forEach((e) => e.classList.remove('hl', 'hl-part', 'hl-peek'));
      for (const [el, c] of added) { if (c) el.classList.remove(c); else el.style.removeProperty('--wc'); }
      added = [];
      if (legend) $$('.lg-item.on', legend).forEach((b) => b.classList.remove('on'));
    }
    function lightPin(ref, cls, color) {
      for (const el of pins[ref] || []) {
        el.classList.add('hl');
        if (cls) { el.classList.add('w-' + cls); added.push([el, 'w-' + cls]); }
        if (color) { el.style.setProperty('--wc', color); added.push([el, null]); }
      }
      for (const el of parts[ref.slice(0, ref.indexOf('.'))] || []) el.classList.add('hl-part');
    }
    function show(netIds, focusPins, focusPart) {
      clear();
      if (!netIds.length && !(focusPins && focusPins.length) && !focusPart) return;
      svg.classList.add('has-hl');
      for (const id of netIds) {
        const n = meta.nets[id];
        if (!n) continue;
        if (nets[id]) nets[id].classList.add('hl');
        for (const p of n.pins) lightPin(p, n.cls, n.color);
      }
      for (const p of focusPins || []) { const nn = meta.pins[p] && meta.pins[p].net ? meta.nets[meta.pins[p].net] : null; lightPin(p, nn ? nn.cls : null, nn ? nn.color : null); }
      if (focusPart) for (const el of parts[focusPart] || []) el.classList.add('hl-part');
    }
    const partNets = (part) => [...new Set(Object.entries(meta.pins).filter(([r, p]) => p.part === part && p.net).map(([, p]) => p.net))];
    const partTitle = (part) => (meta.parts[part] ? meta.parts[part].title : part);

    // ── card rendering
    function ensureCard() {
      if (card) return card;
      card = document.createElement('div');
      card.className = 'inspector float';
      card.setAttribute('role', 'dialog');
      host.canvas.appendChild(card);
      card.addEventListener('click', onCardClick);
      card.addEventListener('pointerover', onCardHover);
      card.addEventListener('pointerout', (e) => { if (!card.contains(e.relatedTarget)) peek(null); });
      return card;
    }
    if (card) {
      card.addEventListener('click', onCardClick);
      card.addEventListener('pointerover', onCardHover);
      card.addEventListener('pointerout', (e) => { if (!card.contains(e.relatedTarget)) peek(null); });
    }
    const head = (kicker, title, sw, color) => `<div class="ic-head">${sw ? `<span class="sw w-${sw}"${color ? ` style="--wc:${escH(color)}"` : ''}></span>` : ''}<div class="ic-titles"><div class="ic-kicker">${escH(kicker)}</div><div class="ic-title">${escH(title)}</div></div><button type="button" class="ic-x" aria-label="${escH(UIS.close)}">×</button></div>`;

    function netHTML(netId, focus) {
      const n = meta.nets[netId];
      let h = head(`${DATA.cls[n.cls] || ''}${n.gauge ? ' · ' + n.gauge : ''}`, n.name, n.cls, n.color);
      if (n.desc) h += `<div class="ic-desc">${escH(n.desc)}</div>`;
      h += `<div class="ic-sub">${escH(UIS.connections)}</div><div class="ic-conns">`;
      for (const ref of n.pins) {
        const p = meta.pins[ref];
        const ff = faceFor(ref, meta);
        h += `<button type="button" class="ic-conn${ref === focus ? ' on' : ''}" data-pin="${escH(ref)}"><b>${escH(p.pin)}</b><span><em>${escH(partTitle(p.part))}</em>${p.label ? `<small>${escH(p.label)}</small>` : ''}</span>${ff ? `<i class="ic-go" title="${escH(UIS.showConnector)}">${ICON_CONN}</i>` : ''}</button>`;
      }
      return h + '</div>';
    }
    function faceHTML(part, faceId, selRef) {
      const fd = DATA.faces[faceId];
      const cm = cavMap(part, faceId, meta);
      const faces = facesOfPart(part, meta);
      const ff = selRef ? faceFor(selRef, meta) : null;
      const selCavs = ff && ff.face === faceId ? ff.cavs : [];
      const selNet = selRef && meta.pins[selRef] ? meta.pins[selRef].net : null;
      const selCls = selNet ? meta.nets[selNet].cls : (selCavs[0] && fd.pins[selCavs[0]] ? fd.pins[selCavs[0]].cls : null);
      const selColor = selNet ? meta.nets[selNet].color : (selCavs[0] && fd.pins[selCavs[0]] ? fd.pins[selCavs[0]].color : null);
      let h = head(partTitle(part) !== fd.title ? partTitle(part) : '', fd.title, null);
      if (faces.length > 1) h += `<div class="ic-tabs">${faces.map((f) => `<button type="button" data-face="${escH(f)}" class="${f === faceId ? 'on' : ''}">${escH(DATA.faces[f].short || f.replace(/^ecu-/, '').toUpperCase())}</button>`).join('')}</div>`;
      h += `<div class="ic-face" data-face="${escH(faceId)}" data-part="${escH(part)}"></div>`;
      if (selCavs.length) {
        const lbl = fd.pins[selCavs[0]] ? fd.pins[selCavs[0]].label : (meta.pins[selRef] && meta.pins[selRef].label) || '';
        h += `<div class="ic-sel">${selCls ? `<span class="sw w-${selCls}"${selColor ? ` style="--wc:${escH(selColor)}"` : ''}></span>` : ''}<b>${escH(UIS.pin)} ${escH(selCavs.join(', '))}</b><span>${escH(lbl)}</span>` +
          (selNet ? `<button type="button" class="ic-net" data-net="${escH(selNet)}">${escH(meta.nets[selNet].name)} →</button>` : '') + '</div>';
      }
      const ids = Object.keys(fd.pins).sort(fd.order ? (a, b) => fd.order.indexOf(a) - fd.order.indexOf(b) : naturalCmp);
      const rows = ids.map((c) => {
        const p = fd.pins[c];
        const ref = cm[c];
        return `<tr data-cav="${escH(c)}"${ref ? ` data-pin="${escH(ref)}"` : ''} class="${ref ? 'in-diag' : ''}${selCavs.includes(c) ? ' sel' : ''}"><td class="pin">${escH(c)}</td><td class="c">${p.cls ? `<span class="sw w-${p.cls}"${p.color ? ` style="--wc:${escH(p.color)}"` : ''}></span>` : ''}</td><td>${escH(p.label)}</td></tr>`;
      }).join('');
      if (rows) h += `<div class="ic-table"><table><tbody>${rows}</tbody></table></div>`;
      if (fd.view) h += `<div class="ic-view">${escH(fd.view)}</div>`;
      return { h, faceId, selCavs, selCls, marks: Object.keys(cm) };
    }
    function pinOnlyHTML(ref) {
      const p = meta.pins[ref];
      return head(partTitle(p.part), `${UIS.pin} ${p.pin}`, null) + (p.label ? `<div class="ic-desc">${escH(p.label)}</div>` : '');
    }
    function clsHTML(cls) {
      const ids = Object.keys(meta.nets).filter((k) => meta.nets[k].cls === cls);
      return head(UIS.circuits, DATA.cls[cls], cls) + `<div class="ic-conns">${ids.map((id) => `<button type="button" class="ic-conn" data-net="${escH(id)}"><b><span class="sw w-${cls}"></span></b><span><em>${escH(meta.nets[id].name)}</em></span></button>`).join('')}</div>`;
    }
    function render(sel) {
      if (!sel) { if (card) { card.innerHTML = ''; card.classList.remove('open'); } return; }
      const c = ensureCard();
      let html = '', face = null;
      if (sel.cls) html = clsHTML(sel.cls);
      else if (sel.face) { face = faceHTML(sel.part, sel.face, sel.pin); html = face.h; }
      else if (sel.net) html = netHTML(sel.net, sel.pin);
      else if (sel.pin) html = pinOnlyHTML(sel.pin);
      c.innerHTML = html;
      if (face) {
        const node = faceNode(face.faceId, face.selCavs, face.selCls, face.marks);
        if (node) $('.ic-face', c).appendChild(node);
        const tr = $('tr.sel', c);
        if (tr) requestAnimationFrame(() => { const t = $('.ic-table', c); t.scrollTop = tr.offsetTop - t.clientHeight / 2 + tr.offsetHeight / 2; });
      }
      c.classList.add('open');
      if (host.canvas) place(c);
    }
    function place(c) {
      const cv = host.canvas;
      if (window.innerWidth < 700) { c.classList.add('sheet'); c.style.left = c.style.top = c.style.width = c.style.maxHeight = ''; return; }
      c.classList.remove('sheet');
      const cw = cv.clientWidth, ch = cv.clientHeight;
      const w = Math.min(410, cw - 24);
      c.style.width = w + 'px';
      c.style.maxHeight = Math.max(260, ch - 16) + 'px';
      const h = c.offsetHeight;
      // dock to the canvas edge opposite the click, so the clicked spot stays visible
      const a = anchor || { x: 0, y: 20 };
      const x = a.x < cw / 2 ? cw - w - 10 : 10;
      const y = Math.max(8, Math.min(a.y - 90, ch - h - 8));
      c.style.left = x + 'px';
      c.style.top = Math.max(8, y) + 'px';
    }

    // ── selection
    function select(sel, at) {
      if (at !== undefined) anchor = at;
      locked = sel;
      if (!sel) { clear(); render(null); return; }
      if (sel.cls) {
        show(Object.keys(meta.nets).filter((k) => meta.nets[k].cls === sel.cls));
        if (legend) $$(`.lg-item[data-cls="${sel.cls}"]`, legend).forEach((b) => b.classList.add('on'));
      } else if (sel.face && !sel.pin) show(partNets(sel.part), [], sel.part);
      else show(sel.net ? [sel.net] : [], sel.pin ? [sel.pin] : []);
      render(sel);
    }
    function selectPin(ref, at) {
      const p = meta.pins[ref];
      const ff = faceFor(ref, meta);
      if (ff) select({ part: ff.part, face: ff.face, pin: ref, net: p.net }, at);
      else select({ net: p.net, pin: ref }, at);
    }
    function peek(ref) {
      $$('.hl-peek', svg).forEach((e) => e.classList.remove('hl-peek'));
      if (ref) for (const el of pins[ref] || []) el.classList.add('hl-peek');
    }

    const pointIn = (e) => {
      if (!host.canvas) return undefined;
      const r = host.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const targetOf = (el) => {
      const pin = el.closest('.pin');
      if (pin && meta.pins[pin.dataset.pin]) return { pin: pin.dataset.pin, net: meta.pins[pin.dataset.pin].net };
      const net = el.closest('.net');
      if (net) return { net: net.dataset.net };
      const part = el.closest('.part, .part-over');
      if (part && !part.classList.contains('group') && meta.parts[part.dataset.part]) return { part: part.dataset.part };
      return null;
    };
    svg.addEventListener('pointerover', (e) => {
      if (locked || e.pointerType === 'touch') return;
      const tg = targetOf(e.target);
      if (!tg) { clear(); return; }
      if (tg.part) { show(partNets(tg.part), [], tg.part); return; }
      show(tg.net ? [tg.net] : [], tg.pin ? [tg.pin] : []);
    });
    svg.addEventListener('pointerleave', () => { if (!locked) clear(); });
    svg.addEventListener('click', (e) => {
      if (svg.dataset.dragged === '1') return;
      const tg = targetOf(e.target);
      const at = pointIn(e);
      if (!tg) { select(null); return; }
      if (tg.pin) {
        if (locked && locked.pin === tg.pin) { select(null); return; }
        selectPin(tg.pin, at);
      } else if (tg.net) {
        if (locked && !locked.face && locked.net === tg.net && !locked.pin) { select(null); return; }
        select({ net: tg.net }, at);
      } else if (tg.part) {
        const faces = facesOfPart(tg.part, meta);
        if (locked && locked.part === tg.part && !locked.pin) { select(null); return; }
        if (faces.length) select({ part: tg.part, face: faces[0] }, at);
        else { show(partNets(tg.part), [], tg.part); locked = { part: tg.part }; render(null); }
      }
    });
    if (host.canvas) host.canvas.addEventListener('click', (e) => {
      if (e.target === host.canvas) select(null);
    });
    if (legend) legend.addEventListener('click', (e) => {
      const b = e.target.closest('.lg-item');
      if (!b) return;
      if (b.dataset.net) { select(locked && locked.net === b.dataset.net && !locked.pin ? null : { net: b.dataset.net }); return; }
      select(locked && locked.cls === b.dataset.cls ? null : { cls: b.dataset.cls });
    });

    function onCardClick(e) {
      e.stopPropagation();
      if (e.target.closest('.ic-x')) { select(null); return; }
      const tab = e.target.closest('.ic-tabs button');
      if (tab) { select({ part: locked.part, face: tab.dataset.face }); return; }
      const netBtn = e.target.closest('[data-net]');
      if (netBtn && (netBtn.classList.contains('ic-net') || netBtn.classList.contains('ic-conn'))) { select({ net: netBtn.dataset.net }); return; }
      const conn = e.target.closest('.ic-conn[data-pin]');
      if (conn) { selectPin(conn.dataset.pin); return; }
      const row = e.target.closest('tr[data-cav]');
      const cav = e.target.closest('.ic-face .cav');
      const cavId = row ? row.dataset.cav : cav ? cav.dataset.cav : null;
      if (cavId && locked && locked.face) {
        const ref = cavMap(locked.part, locked.face, meta)[cavId];
        if (ref) selectPin(ref);
        else {
          // documented pin that this diagram doesn't use — just point it out on the face
          select({ part: locked.part, face: locked.face });
          const g = $(`.ic-face [data-cav="${CSS.escape(cavId)}"]`, card);
          const fd = DATA.faces[locked.face];
          if (g) { g.classList.add('hl'); if (fd.pins[cavId] && fd.pins[cavId].cls) g.classList.add('w-' + fd.pins[cavId].cls); }
          const tr = $(`tr[data-cav="${CSS.escape(cavId)}"]`, card);
          if (tr) tr.classList.add('sel');
        }
      }
    }
    function onCardHover(e) {
      const el = e.target.closest('[data-pin]');
      peek(el ? el.dataset.pin : null);
      const row = e.target.closest('tr[data-cav]');
      $$('.ic-face .cav.peek', card).forEach((g) => g.classList.remove('peek'));
      if (row) { const g = $(`.ic-face [data-cav="${CSS.escape(row.dataset.cav)}"]`, card); if (g) g.classList.add('peek'); }
    }
    return { select, clear, close: () => select(null), get open() { return !!locked; }, replace: () => { if (card && card.classList.contains('open') && host.canvas) place(card); } };
  }

  const ICON_CONN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 10v4M12 10v4M16 10v4"/></svg>';

  // inline diagrams
  const figs = $$('.sch-fig').map((fig) => {
    const meta = JSON.parse($('.sch-meta', fig).textContent);
    const ctl = Diagram($('svg.sch', fig), meta, { canvas: $('.fig-canvas', fig) }, $('.legend', fig));
    return { fig, meta, ctl };
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !(viewer && viewer.classList.contains('open'))) figs.forEach((f) => f.ctl.close()); });
  window.addEventListener('resize', () => figs.forEach((f) => f.ctl.replace()));

  // ── viewer (pan / zoom) ─────────────────────────────────────────────────
  const viewer = $('.viewer');
  const stage = viewer && $('.vw-stage', viewer);
  let vw = null;
  function openViewer(f) {
    const src = $('svg.sch', f.fig);
    const svg = src.cloneNode(true);
    const vb = svg.viewBox.baseVal;
    svg.setAttribute('width', vb.width);
    svg.setAttribute('height', vb.height);
    svg.classList.remove('has-hl');
    $$('.hl, .hl-part', svg).forEach((e) => e.classList.remove('hl', 'hl-part'));
    $$('svg.sch', stage).forEach((s) => s.remove());
    stage.appendChild(svg);
    $('.vw-tag', viewer).textContent = $('.fig-tag', f.fig).textContent;
    $('.vw-title', viewer).textContent = $('figcaption span', f.fig).textContent;
    const lg = $('.legend', viewer);
    lg.innerHTML = $('.legend', f.fig).innerHTML;
    const old = $('.inspector', viewer);
    const ni = old.cloneNode(false);
    old.replaceWith(ni);
    ni.classList.remove('open');
    vw = { svg, w: vb.width, h: vb.height, s: 1, x: 0, y: 0 };
    vw.ctl = Diagram(svg, f.meta, { side: ni }, lg);
    viewer.classList.add('open');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(fit);
  }
  function apply() { vw.svg.style.transform = `translate(${vw.x}px, ${vw.y}px) scale(${vw.s})`; }
  function fit() {
    const r = stage.getBoundingClientRect();
    vw.s = Math.min(r.width / vw.w, r.height / vw.h) * 0.94;
    vw.x = (r.width - vw.w * vw.s) / 2;
    vw.y = (r.height - vw.h * vw.s) / 2;
    apply();
  }
  function zoomAt(f, cx, cy) {
    const ns = Math.max(0.2, Math.min(8, vw.s * f));
    const k = ns / vw.s;
    vw.x = cx - (cx - vw.x) * k;
    vw.y = cy - (cy - vw.y) * k;
    vw.s = ns;
    apply();
  }
  function panBy(dx, dy) { vw.x += dx; vw.y += dy; apply(); }
  function closeViewer() {
    viewer.classList.remove('open');
    document.body.style.overflow = '';
    vw = null;
  }
  if (viewer) {
    figs.forEach((f) => {
      $('.fig-expand', f.fig).addEventListener('click', () => openViewer(f));
      $('.fig-canvas', f.fig).addEventListener('dblclick', () => openViewer(f));
    });
    $('.vw-tools', viewer).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !vw) return;
      const r = stage.getBoundingClientRect();
      if (b.dataset.z === 'in') zoomAt(1.3, r.width / 2, r.height / 2);
      if (b.dataset.z === 'out') zoomAt(1 / 1.3, r.width / 2, r.height / 2);
      if (b.dataset.z === 'fit') fit();
      if (b.dataset.z === 'close') closeViewer();
    });
    // Trackpad two-finger scroll pans (any direction); pinch (ctrlKey) or Ctrl/⌘ + wheel zooms.
    // A classic mouse wheel (line mode, or whole-step vertical deltas) keeps zooming.
    const isMouseWheel = (e) => e.deltaMode === 1 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
    stage.addEventListener('wheel', (e) => {
      if (!vw) return;
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || isMouseWheel(e)) {
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)), e.clientX - r.left, e.clientY - r.top);
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX, dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        panBy(-dx, -dy);
      }
    }, { passive: false });
    const ptrs = new Map();
    let drag = null, pinch = null;
    stage.addEventListener('pointerdown', (e) => {
      if (!vw || e.target.closest('.vw-tools')) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      vw.svg.dataset.dragged = '0';
      if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, ox: vw.x, oy: vw.y, moved: false };
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: vw.s };
        drag = null;
      }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!vw || !ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const r = stage.getBoundingClientRect();
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        zoomAt((pinch.s * d / pinch.d) / vw.s, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        vw.svg.dataset.dragged = '1';
      } else if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; stage.classList.add('drag'); stage.setPointerCapture(e.pointerId); }
        if (drag.moved) { vw.x = drag.ox + dx; vw.y = drag.oy + dy; apply(); vw.svg.dataset.dragged = '1'; }
      }
    });
    const up = (e) => {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (ptrs.size === 0) { drag = null; stage.classList.remove('drag'); setTimeout(() => { if (vw) vw.svg.dataset.dragged = '0'; }, 0); }
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    document.addEventListener('keydown', (e) => {
      if (!vw) return;
      if (e.key === 'Escape') closeViewer();
      const r = stage.getBoundingClientRect();
      if (e.key === '+' || e.key === '=') zoomAt(1.3, r.width / 2, r.height / 2);
      if (e.key === '-') zoomAt(1 / 1.3, r.width / 2, r.height / 2);
      if (e.key === '0') fit();
      const step = e.shiftKey ? 240 : 80;
      const arrows = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (arrows[e.key]) { e.preventDefault(); panBy(...arrows[e.key]); }
    });
    window.addEventListener('resize', () => { if (vw) fit(); });
  }

  // ── pinout blocks (face ↔ table) ────────────────────────────────────────
  $$('.pinout').forEach((po) => {
    const svgs = $$('svg.face-svg', po);
    const rows = new Map($$('tr[data-cav]', po).map((tr) => [tr.dataset.cav, tr]));
    let locked = null;
    const hl = (cav) => {
      svgs.forEach((svg) => $$('.cav.hl', svg).forEach((g) => g.classList.remove('hl')));
      rows.forEach((tr) => tr.classList.remove('row-hl'));
      if (cav == null) return;
      svgs.forEach((svg) => { const g = svg.querySelector(`[data-cav="${CSS.escape(cav)}"]`); if (g) g.classList.add('hl'); });
      const tr = rows.get(cav);
      if (tr) tr.classList.add('row-hl');
      return tr;
    };
    svgs.forEach((svg) => {
      svg.addEventListener('pointerover', (e) => { const g = e.target.closest('.cav'); if (!locked) hl(g ? g.dataset.cav : null); });
      svg.addEventListener('pointerleave', () => { if (!locked) hl(null); });
      svg.addEventListener('click', (e) => {
        const g = e.target.closest('.cav');
        locked = g && locked !== g.dataset.cav ? g.dataset.cav : null;
        const tr = hl(locked);
        if (tr && locked) {
          const wrap = tr.closest('.po-table');
          const tr0 = tr.getBoundingClientRect(), w0 = wrap.getBoundingClientRect();
          if (tr0.top < w0.top || tr0.bottom > w0.bottom) tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
    });
    rows.forEach((tr, cav) => {
      tr.addEventListener('pointerenter', () => { if (!locked) hl(cav); });
      tr.addEventListener('pointerleave', () => { if (!locked) hl(null); });
      tr.addEventListener('click', (e) => { if (e.target.closest('a')) return; locked = locked === cav ? null : cav; hl(locked); });
    });
  });

  // ── pin chips (popover with connector face) ─────────────────────────────
  let pop = null;
  function showPop(chip) {
    const id = chip.dataset.pin;
    const p = DATA.ecu[id];
    if (!p) return;
    if (!pop) { pop = document.createElement('div'); pop.className = 'pin-pop'; document.body.appendChild(pop); }
    pop.innerHTML = `<div class="pp-h"><span class="sw w-${p.cls || 'gnd'}"></span>${escH(id)} <span class="io">${escH(p.io)}</span></div><div class="pp-d">${escH(p.f)}</div>`;
    const face = faceNode('ecu-' + id.slice(0, 2).toLowerCase(), id.slice(3), p.cls);
    if (face) pop.appendChild(face);
    const r = chip.getBoundingClientRect();
    const w = 300;
    let left = r.left + window.scrollX + r.width / 2 - w / 2;
    left = Math.max(8 + window.scrollX, Math.min(left, window.scrollX + document.documentElement.clientWidth - w - 8));
    pop.style.left = left + 'px';
    pop.style.top = (r.bottom + window.scrollY + 8) + 'px';
    pop.style.display = 'block';
  }
  const hidePop = () => { if (pop) pop.style.display = 'none'; };
  document.addEventListener('pointerover', (e) => {
    const c = e.target.closest && e.target.closest('.pin-chip');
    if (c && e.pointerType !== 'touch') showPop(c); else if (!c) hidePop();
  });
  document.addEventListener('focusin', (e) => { const c = e.target.closest('.pin-chip'); if (c) showPop(c); });
  document.addEventListener('focusout', hidePop);
  window.addEventListener('scroll', hidePop, { passive: true });

  // highlight a pin row arriving via #pin-X1-B2
  function flashTarget() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id.startsWith('pin-')) return;
    const tr = document.getElementById(id);
    if (!tr) return;
    const po = tr.closest('.pinout');
    tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash');
    const g = po && po.querySelector(`[data-cav="${CSS.escape(tr.dataset.cav)}"]`);
    if (g) { $$('.cav.hl', po).forEach((x) => x.classList.remove('hl')); g.classList.add('hl'); }
  }
  window.addEventListener('hashchange', flashTarget);
  flashTarget();

  // ── checklists (remembered per browser) ─────────────────────────────────
  $$('ul.check').forEach((ul, ui) => {
    $$(':scope > li', ul).forEach((li, i) => {
      const key = `lecu-chk-${document.body.dataset.lang}-${ui}-${i}`;
      if (store.get(key) === '1') li.classList.add('done');
      li.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        li.classList.toggle('done');
        store.set(key, li.classList.contains('done') ? '1' : '0');
      });
    });
  });
})();
