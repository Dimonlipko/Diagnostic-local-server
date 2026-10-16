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

  // keep the current section when switching language
  $$('.seg a[data-lang]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    location.href = a.getAttribute('href') + location.hash;
  }));

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
  function faceFor(ref, meta) {
    const i = ref.indexOf('.');
    const part = ref.slice(0, i), pin = ref.slice(i + 1);
    const pm = meta.pins[ref];
    if (pm && pm.ecu && /^X[12]-/.test(pin)) return { face: 'ecu-' + pin.slice(0, 2).toLowerCase(), cav: pin.slice(3) };
    const f = meta.parts[part] && meta.parts[part].face;
    return f ? { face: f, cav: pin } : null;
  }
  function faceNode(faceId, cav, cls) {
    const tpl = document.getElementById('tpl-face-' + faceId);
    if (!tpl) return null;
    const svg = tpl.content.firstElementChild.cloneNode(true);
    if (cav != null) {
      const g = svg.querySelector(`[data-cav="${CSS.escape(cav)}"]`);
      if (g) { g.classList.add('hl'); if (cls) g.classList.add('w-' + cls); }
    }
    return svg;
  }

  // ── diagram controller ──────────────────────────────────────────────────
  function Diagram(svg, meta, panel, legend) {
    const nets = {}, pins = {}, parts = {};
    $$('.net', svg).forEach((g) => { nets[g.dataset.net] = g; });
    $$('.pin', svg).forEach((g) => { (pins[g.dataset.pin] = pins[g.dataset.pin] || []).push(g); });
    $$('.part, .part-over', svg).forEach((g) => { (parts[g.dataset.part] = parts[g.dataset.part] || []).push(g); });
    let locked = null;
    let added = [];

    function clear() {
      svg.classList.remove('has-hl');
      $$('.hl, .hl-part', svg).forEach((e) => e.classList.remove('hl', 'hl-part'));
      for (const [el, c] of added) el.classList.remove(c);
      added = [];
      if (legend) $$('.lg-item.on', legend).forEach((b) => b.classList.remove('on'));
    }
    function show(netIds, focusPin) {
      clear();
      if (!netIds.length && !focusPin) return;
      svg.classList.add('has-hl');
      for (const id of netIds) {
        const n = meta.nets[id];
        if (!n) continue;
        nets[id] && nets[id].classList.add('hl');
        for (const p of n.pins) {
          for (const el of pins[p] || []) { el.classList.add('hl', 'w-' + n.cls); added.push([el, 'w-' + n.cls]); }
          for (const el of parts[p.slice(0, p.indexOf('.'))] || []) el.classList.add('hl-part');
        }
      }
      if (focusPin) {
        for (const el of pins[focusPin] || []) el.classList.add('hl');
        for (const el of parts[focusPin.slice(0, focusPin.indexOf('.'))] || []) el.classList.add('hl-part');
      }
    }
    function pinTitle(ref) {
      const p = meta.pins[ref];
      const part = meta.parts[p.part];
      return { part: part ? part.title : p.part, pin: p.pin, label: p.label };
    }
    function renderPanel(sel) {
      if (!panel) return;
      if (!sel) { panel.classList.remove('open'); panel.innerHTML = ''; return; }
      let html = '';
      let focus = sel.pin || null;
      if (sel.cls) {
        const ids = Object.keys(meta.nets).filter((k) => meta.nets[k].cls === sel.cls);
        html = `<div class="ni-head"><span class="sw w-${sel.cls}"></span><span class="nm">${escH(DATA.cls[sel.cls])}</span><button class="x" type="button" aria-label="close">×</button></div>` +
          `<div class="ni-pins">${ids.map((id) => `<button type="button" class="ni-pin" data-net="${escH(id)}"><span class="sw w-${meta.nets[id].cls}"></span><b>${escH(meta.nets[id].name)}</b></button>`).join('')}</div>`;
      } else {
        const netId = sel.net;
        const n = netId ? meta.nets[netId] : null;
        if (n) {
          html = `<div class="ni-head"><span class="sw w-${n.cls}"></span><span class="nm">${escH(n.name)}</span><span class="cls">${escH(DATA.cls[n.cls])}${n.gauge ? ' · ' + escH(n.gauge) : ''}</span><button class="x" type="button" aria-label="close">×</button></div>`;
          if (n.desc) html += `<div class="ni-desc">${escH(n.desc)}</div>`;
          html += `<div class="ni-sub">${escH(UIS.connections)}</div><div class="ni-pins">` + n.pins.map((ref) => {
            const t = pinTitle(ref);
            return `<button type="button" class="ni-pin${ref === focus ? ' on' : ''}" data-pin="${escH(ref)}"><b>${escH(t.pin)}</b><span>${escH(t.part)}${t.label ? ' — ' + escH(t.label) : ''}</span></button>`;
          }).join('') + '</div>';
        } else if (focus) {
          const t = pinTitle(focus);
          html = `<div class="ni-head"><span class="nm">${escH(t.part)} · ${escH(t.pin)}</span><button class="x" type="button" aria-label="close">×</button></div>${t.label ? `<div class="ni-desc">${escH(t.label)}</div>` : ''}`;
        }
        if (!focus && n) focus = n.pins.find((r) => faceFor(r, meta)) || null;
        const ff = focus && faceFor(focus, meta);
        if (ff) {
          const node = faceNode(ff.face, ff.cav, n && n.cls);
          const fd = DATA.faces[ff.face];
          if (node) {
            const lbl = fd && fd.pins[ff.cav] ? fd.pins[ff.cav].label : '';
            html += `<div class="ni-face"><div class="ni-face-cap"><b>${escH(fd ? fd.title : ff.face)}</b>${lbl ? ` — ${escH(UIS.pin)} ${escH(ff.cav)}: ${escH(lbl)}` : ''}</div></div>`;
            panel.innerHTML = html;
            $('.ni-face', panel).appendChild(node);
            panel.classList.add('open');
            return;
          }
        }
      }
      panel.innerHTML = html;
      panel.classList.add('open');
    }
    function select(sel) {
      locked = sel;
      if (!sel) { clear(); renderPanel(null); return; }
      if (sel.cls) {
        show(Object.keys(meta.nets).filter((k) => meta.nets[k].cls === sel.cls));
        if (legend) $$(`.lg-item[data-cls="${sel.cls}"]`, legend).forEach((b) => b.classList.add('on'));
      } else show(sel.net ? [sel.net] : [], sel.pin);
      renderPanel(sel);
    }
    const targetOf = (el) => {
      const pin = el.closest('.pin');
      if (pin && meta.pins[pin.dataset.pin]) return { pin: pin.dataset.pin, net: meta.pins[pin.dataset.pin].net };
      const net = el.closest('.net');
      if (net) return { net: net.dataset.net };
      return null;
    };
    svg.addEventListener('pointerover', (e) => {
      if (locked || e.pointerType === 'touch') return;
      const tg = targetOf(e.target);
      if (tg) show(tg.net ? [tg.net] : [], tg.pin); else clear();
    });
    svg.addEventListener('pointerleave', () => { if (!locked) clear(); });
    svg.addEventListener('click', (e) => {
      if (svg.dataset.dragged === '1') return;
      const tg = targetOf(e.target);
      if (!tg) { select(null); return; }
      if (locked && !locked.cls && locked.net === tg.net && (!tg.pin || locked.pin === tg.pin)) { select(null); return; }
      select(tg);
    });
    if (legend) legend.addEventListener('click', (e) => {
      const b = e.target.closest('.lg-item');
      if (!b) return;
      select(locked && locked.cls === b.dataset.cls ? null : { cls: b.dataset.cls });
    });
    if (panel) panel.addEventListener('click', (e) => {
      if (e.target.closest('.x')) { select(null); return; }
      const b = e.target.closest('.ni-pin');
      if (!b) return;
      if (b.dataset.net) select({ net: b.dataset.net });
      else if (b.dataset.pin) select({ net: meta.pins[b.dataset.pin].net, pin: b.dataset.pin });
    });
    return { select, clear };
  }

  // inline diagrams
  const figs = $$('.sch-fig').map((fig) => {
    const meta = JSON.parse($('.sch-meta', fig).textContent);
    const ctl = Diagram($('svg.sch', fig), meta, $('.netinfo', fig), $('.legend', fig));
    return { fig, meta, ctl };
  });

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
    const ni = $('.netinfo', viewer);
    ni.innerHTML = '';
    ni.classList.remove('open');
    vw = { svg, w: vb.width, h: vb.height, s: 1, x: 0, y: 0 };
    vw.ctl = Diagram(svg, f.meta, ni, lg);
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
    stage.addEventListener('wheel', (e) => {
      if (!vw) return;
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)), e.clientX - r.left, e.clientY - r.top);
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
    });
    window.addEventListener('resize', () => { if (vw) fit(); });
  }

  // ── pinout blocks (face ↔ table) ────────────────────────────────────────
  $$('.pinout').forEach((po) => {
    const svg = $('svg.face-svg', po);
    const rows = new Map($$('tr[data-cav]', po).map((tr) => [tr.dataset.cav, tr]));
    let locked = null;
    const hl = (cav) => {
      $$('.cav.hl', svg).forEach((g) => g.classList.remove('hl'));
      rows.forEach((tr) => tr.classList.remove('row-hl'));
      if (cav == null) return;
      const g = svg && svg.querySelector(`[data-cav="${CSS.escape(cav)}"]`);
      if (g) g.classList.add('hl');
      const tr = rows.get(cav);
      if (tr) tr.classList.add('row-hl');
      return tr;
    };
    if (svg) {
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
    }
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
