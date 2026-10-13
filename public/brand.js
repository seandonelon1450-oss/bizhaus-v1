/* =====================================================================
 * BIZHAUS v1 — brand engine.
 * ?brand= selects a trade (bizhaus | gutterhaus | airhaus | glowhaus;
 * default bizhaus). Per-trade content comes ONLY from
 * /trades/<trade>.json — switching re-skins the same pages with zero
 * code changes. Shared chrome: header, theme, badge, charter, footer.
 * =================================================================== */
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  var TRADES = ['bizhaus', 'gutterhaus', 'airhaus', 'glowhaus'];
  function getBrand() {
    var q = new URLSearchParams(window.location.search).get('brand');
    q = String(q || '').toLowerCase();
    return TRADES.indexOf(q) >= 0 ? q : 'bizhaus';
  }
  var BRAND = getBrand();
  document.documentElement.setAttribute('data-trade', BRAND);

  /* ---------- arch mark (SVG, live markup) ---------- */
  function archSVG() {
    return '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" ' +
      'stroke-width="2.4" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M5 27a11 11 0 0 1 22 0"/><path d="M10.5 27a5.5 5.5 0 0 1 11 0"/>' +
      '<path d="M14.5 27a1.5 1.5 0 0 1 3 0"/></svg>';
  }
  function badgeHTML() {
    return '<a class="powered-badge" href="#" aria-label="Powered by Arbor">' +
      archSVG() + '<span class="pb-by">powered by</span> <span class="pb-name">Arbor</span></a>';
  }

  /* ---------- charter (word for word, §7) ---------- */
  var CHARTER = [
    'Your data is yours. We hold it for you, to do work for you. Take it with you any time.',
    'Never sold. Not to advertisers, data brokers, providers, or partners. No ad trackers.',
    'Never used to train models. Not ours, not anyone\u2019s. The list of providers is public.',
    'Export in one tap. Everything, in a readable format (PDF + JSON/CSV).',
    'Delete in one tap. Gone from the live system right away, and from backups within 30 days.',
    'Encrypted. In transit and at rest. Device-only rooms we can\u2019t read at all.',
    'Collect the minimum. Each feature asks only for what it needs. Every connector is opt-in.',
    'Your choice of home. Our encrypted cloud by default, or on your device only.',
    'People see only what you share. Team access is limited, logged, and visible to you.',
    'No quiet changes. New use of your data? We ask first, in plain words. Silence never counts as yes.'
  ];
  function charterHTML() {
    return '<ol class="charter">' + CHARTER.map(function (c) {
      return '<li>' + c + '</li>';
    }).join('') + '</ol>';
  }

  /* ---------- shared chrome ---------- */
  function withBrand(href) {
    return href + (href.indexOf('?') >= 0 ? '&' : '?') + 'brand=' + BRAND;
  }
  function headerHTML(trade) {
    return '<div class="container">' +
      '<a class="brandmark" href="' + withBrand('/') + '">' + trade.brand + '</a>' +
      '<nav class="site-nav" aria-label="Main">' +
      '<a href="' + withBrand('/missed-call-rescue.html') + '">Missed-Call Rescue</a>' +
      '<a href="' + withBrand('/data.html') + '">Your data</a>' +
      '<button class="theme-toggle" type="button" aria-label="Toggle dark mode">Dark</button>' +
      '<span class="header-badge">' + badgeHTML() + '</span>' +
      '</nav></div>';
  }
  function footerHTML(trade) {
    return '<div class="container"><div class="cols">' +
      '<div><h4>' + trade.brand + '</h4><p class="small">' +
      (trade.businessNote || 'Websites + missed-call text-back for local businesses.') + '</p></div>' +
      '<div><h4>Explore</h4><p class="small">' +
      '<a href="' + withBrand('/missed-call-rescue.html') + '">Missed-Call Rescue</a><br>' +
      '<a href="' + withBrand('/data.html') + '">Your data</a><br>' +
      '<a href="' + withBrand('/dashboard.html') + '">Owner dashboard</a></p></div>' +
      '<div><h4>Trades</h4><p class="small">' +
      TRADES.map(function (t) {
        return '<a href="/?brand=' + t + '">' + t.toUpperCase() + '</a>';
      }).join('<br>') + '</p></div>' +
      '<div><h4>Talk to a person</h4><p class="small">A real person is behind every BIZHAUS product. ' +
      (trade.phone ? 'Call <a href="tel:' + trade.phone.replace(/[^0-9+]/g, '') + '">' + trade.phone + '</a>.' : 'Request an invite and we\u2019ll be in touch.') +
      '</p></div></div>' +
      '<div class="footer-line">' + badgeHTML() +
      '<span>' + trade.footerLine + '</span></div></div>';
  }

  function initChrome(trade) {
    document.title = trade.brand + ' — ' + trade.hero.headline;
    var h = document.querySelector('[data-chrome="header"]');
    if (h) h.innerHTML = headerHTML(trade);
    var f = document.querySelector('[data-chrome="footer"]');
    if (f) f.innerHTML = footerHTML(trade);
    var c = document.querySelector('[data-chrome="charter"]');
    if (c) c.innerHTML = '<h2 class="h2">You own your data</h2>' +
      '<p class="lede">The 10-point data charter, word for word. ' +
      (trade.charterNote || '') + ' <a href="' + withBrand('/data.html') + '">Your data page</a>.</p>' +
      charterHTML();
    initTheme();
    initHeaderScroll();
  }

  /* ---------- theme: OS default + toggle, stored on device ---------- */
  function initTheme() {
    var stored = null;
    try { stored = localStorage.getItem('bizhaus-theme'); } catch (e) {}
    if (stored) document.documentElement.setAttribute('data-theme', stored);
    else if (window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.setAttribute('data-theme', 'dark');
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('bizhaus-theme', next); } catch (e) {}
      });
    });
  }
  function initHeaderScroll() {
    var h = document.querySelector('.site-header');
    if (!h) return;
    var onScroll = function () { h.classList.toggle('scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }

  /* ---------- reveal fallback (IntersectionObserver; CSS scroll-driven
     animations are the primary path — works with no JS) ---------- */
  function initReveals() {
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal-io').forEach(function (el) { io.observe(el); });
  }

  /* ---------- cookieless analytics beacon ---------- */
  function track(event) {
    try {
      fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: window.location.pathname, event: event || 'pageview' }),
        keepalive: true });
    } catch (e) {}
  }

  /* ---------- home-page section renderer (JSON-driven) ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function renderHome(trade) {
    var set = function (sel, html) {
      var el = document.querySelector(sel); if (el) el.innerHTML = html;
    };
    set('[data-s="eyebrow"]', '<span class="label">' + esc(trade.hero.eyebrow) + '</span>');
    set('[data-s="headline"]', esc(trade.hero.headline));
    set('[data-s="sub"]', esc(trade.hero.sub));
    set('[data-s="example"]', trade.businessNote ? '<span class="example-pill">' + esc(trade.businessNote) + '</span>' : '');
    set('[data-s="cta"]',
      '<a class="btn btn-primary" href="' + esc(trade.ctaPrimary.href) + '">' + esc(trade.ctaPrimary.label) + '</a>' +
      '<a class="btn btn-secondary" href="' + withBrand(esc(trade.ctaSecondary.href)) + '">' + esc(trade.ctaSecondary.label) + '</a>');
    set('[data-s="phone"]', trade.phone ?
      '<p class="lede">Call us: <a href="tel:' + trade.phone.replace(/[^0-9+]/g, '') + '">' + esc(trade.phone) + '</a></p>' : '');

    /* services */
    set('[data-s="services"]', (trade.services || []).map(function (s) {
      return '<div class="card reveal-io"><h3 class="h4">' + esc(s.title) + '</h3><p>' + esc(s.desc) + '</p></div>';
    }).join(''));

    /* before / after (slices mask) */
    var ba = document.querySelector('[data-s="beforeafter"]');
    if (ba) {
      if (trade.beforeAfter && trade.beforeAfter.enabled) {
        ba.innerHTML =
          '<div class="container"><h2 class="h2 center" style="text-align:center">' + esc(trade.beforeAfter.headline) + '</h2>' +
          '<div class="ba">' +
          '<div class="ba-frame ba-before"><span class="caption">' + esc(trade.beforeAfter.beforeCaption) + '</span></div>' +
          '<div class="ba-frame ba-after"><div class="slice-layer"></div><span class="caption">' + esc(trade.beforeAfter.afterCaption) + '</span></div>' +
          '</div><p class="small center" style="text-align:center;color:var(--muted)">' + esc(trade.beforeAfter.note) + '</p></div>';
        ba.style.display = '';
      } else ba.style.display = 'none';
    }

    /* service area */
    set('[data-s="area"]', '<h2 class="h2">' + esc(trade.area.headline) + '</h2><p class="lede">' + esc(trade.area.text) + '</p>');

    /* reviews — honest: none until real */
    var rv = document.querySelector('[data-s="reviews"]');
    if (rv) {
      var r = trade.reviews || {};
      if (r.mode === 'none' || !(r.items && r.items.length)) {
        rv.innerHTML = '<div class="container center" style="text-align:center"><h2 class="h2">Reviews</h2>' +
          '<p class="lede">' + esc(r.note || 'No reviews yet — check back soon.') + '</p></div>';
        rv.style.display = '';
      } else rv.style.display = 'none';
    }

    /* missed-call text-back */
    var m = trade.mcr || {};
    set('[data-s="mcr"]',
      '<h2 class="h2 center" style="text-align:center">' + esc(m.headline) + '</h2>' +
      '<p class="lede center" style="text-align:center">' + esc(m.text) + '</p>' +
      ((m.steps && m.steps.length) ? '<div class="grid grid-3" style="margin-top:40px">' +
        m.steps.map(function (s, i) {
          return '<div class="card reveal-io"><div class="story-num" style="font-size:40px">' + (i + 1) + '</div><p>' + esc(s) + '</p></div>';
        }).join('') + '</div>' : ''));

    /* pricing — invite only, never a live charge */
    var pr = document.querySelector('[data-s="pricing"]');
    if (pr) {
      var items = trade.pricing || [];
      if (items.length) {
        pr.innerHTML = '<div class="container"><h2 class="h2 center" style="text-align:center">Pricing, up front</h2>' +
          '<div class="grid grid-3" style="margin-top:40px">' + items.map(function (p) {
            return '<div class="card reveal-io"><h3 class="h4">' + esc(p.name) + '</h3>' +
              '<div class="price">' + esc(p.price) + '</div><p class="note">' + esc(p.note) + '</p>' +
              '<button class="btn btn-primary invite-open" type="button" data-interest="' + esc(p.name) + '">' + esc(p.cta) + '</button></div>';
          }).join('') + '</div>' +
          '<p class="small center form-note" style="text-align:center;margin-top:24px">Checkout is not open yet — invites only. No charges until our payment setup is tested and approved.</p></div>';
        pr.style.display = '';
      } else pr.style.display = 'none';
    }

    /* faq */
    set('[data-s="faq"]', '<h2 class="h2">Questions</h2><div class="faq">' +
      (trade.faq || []).map(function (f) {
        return '<details><summary>' + esc(f.q) + '</summary><p>' + esc(f.a) + '</p></details>';
      }).join('') + '</div>');

    initInvites();
  }

  /* ---------- invite form (replaces checkout until Stripe is approved) ---------- */
  function inviteModal(interest) {
    var overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', 'Request an invite');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:300;background:rgba(28,26,23,.45);display:flex;align-items:center;justify-content:center;padding:24px';
    overlay.innerHTML =
      '<form id="invite-form" style="background:var(--white);border-radius:16px;padding:32px;max-width:440px;width:100%;border:1px solid var(--line)">' +
      '<h3 class="h3">Request an invite</h3>' +
      '<p class="small">For: ' + esc(interest) + '. No charges — a real person follows up.</p>' +
      '<div class="field"><label for="inv-name">Your name</label><input id="inv-name" name="name" required autocomplete="name"></div>' +
      '<div class="field"><label for="inv-email">Your email</label><input id="inv-email" name="email" type="email" required autocomplete="email"></div>' +
      '<p class="form-note" id="inv-note"></p>' +
      '<div class="btn-row"><button class="btn btn-primary" type="submit">Send request</button>' +
      '<button class="btn btn-secondary" type="button" id="inv-cancel">Cancel</button></div></form>';
    document.body.appendChild(overlay);
    overlay.querySelector('#inv-name').focus();
    var close = function () { overlay.remove(); };
    overlay.querySelector('#inv-cancel').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('#invite-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var name = overlay.querySelector('#inv-name').value;
      var email = overlay.querySelector('#inv-email').value;
      fetch('/api/invites', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, email: email, interest: interest }) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.ok) { overlay.querySelector('#inv-note').textContent = 'You\u2019re on the list — a real person will follow up.'; track('invite_request'); }
          else overlay.querySelector('#inv-note').textContent = 'Hmm: ' + (j.error || 'try again');
        })
        .catch(function () { overlay.querySelector('#inv-note').textContent = 'Could not save — try again.'; });
    });
  }
  function initInvites() {
    document.querySelectorAll('.invite-open').forEach(function (btn) {
      btn.addEventListener('click', function () {
        inviteModal(btn.getAttribute('data-interest') || 'missed-call-rescue');
      });
    });
    var form = document.getElementById('booking-form');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var data = { name: form.name.value, phone: form.phone.value, detail: form.detail.value, trade: BRAND };
        fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            var note = document.getElementById('booking-note');
            if (note) note.textContent = j.ok ? 'Got it — we\u2019ll be in touch shortly.' : ('Hmm: ' + (j.error || 'try again'));
            if (j.ok) { form.reset(); track('booking_request'); }
          })
          .catch(function () {
            var note = document.getElementById('booking-note');
            if (note) note.textContent = 'Could not save — try again.';
          });
      });
    }
  }

  /* ---------- boot ---------- */
  function boot() {
    fetch('/trades/' + BRAND + '.json')
      .then(function (r) { if (!r.ok) throw new Error('trade json missing'); return r.json(); })
      .then(function (trade) {
        initChrome(trade);
        if (document.querySelector('[data-s="headline"]')) renderHome(trade);
        else initInvites();
        initReveals();
        track('pageview');
      })
      .catch(function () {
        document.body.innerHTML = '<main class="container" style="padding:128px 24px"><h1>Something\u2019s off</h1>' +
          '<p>We couldn\u2019t load this page\u2019s content. Try refreshing.</p></main>';
      });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.BIZHAUS = { brand: BRAND, charter: function () { return CHARTER.slice(); }, track: track };
})();
