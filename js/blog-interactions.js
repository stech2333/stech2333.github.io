(function () {
  'use strict';

  var storageKey = 'stech2333-bookmarks';
  var bookmarks = [];

  try {
    var saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(saved)) bookmarks = saved.filter(function (item) { return typeof item === 'string'; });
  } catch (error) {
    bookmarks = [];
  }

  function saveBookmarks() {
    try { localStorage.setItem(storageKey, JSON.stringify(bookmarks)); } catch (error) { /* Private mode can block storage. */ }
  }

  function feedback(message) {
    var target = document.querySelector('.blog-actions__feedback');
    if (target) target.textContent = message;
  }

  function updateBookmarks() {
    document.querySelectorAll('[data-action="bookmark"]').forEach(function (button) {
      var holder = button.closest('[data-url]');
      var active = holder && bookmarks.includes(holder.dataset.url);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.classList.toggle('is-active', !!active);
      var label = button.querySelector('span');
      if (label) label.textContent = active ? '已收藏' : '收藏文章';
      if (button.classList.contains('note-card__bookmark')) {
        button.title = active ? '取消收藏' : '收藏笔记';
        button.setAttribute('aria-label', (active ? '取消收藏' : '收藏') + button.closest('.note-card').querySelector('h3').textContent.trim());
      }
    });
  }

  function filterNotes() {
    var grid = document.getElementById('notes-grid');
    if (!grid) return;
    var input = document.getElementById('notes-search');
    var active = document.querySelector('.notes-filter.is-active');
    var topic = active ? active.dataset.topic : 'all';
    var query = (input.value || '').trim().toLocaleLowerCase();
    var count = 0;

    grid.querySelectorAll('.note-card').forEach(function (card) {
      var topicMatches = topic === 'all' || (topic === 'bookmarks' ? bookmarks.includes(card.dataset.url) : card.dataset.topic === topic);
      var matches = topicMatches && (!query || card.dataset.search.includes(query));
      card.hidden = !matches;
      if (matches) count += 1;
    });

    document.getElementById('notes-result-count').textContent = '显示 ' + count + ' 篇笔记';
    document.getElementById('notes-empty').hidden = count !== 0;
  }

  function copyLink(url) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(url);
    }
    var input = document.createElement('textarea');
    input.value = url;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    var copied = document.execCommand('copy');
    input.remove();
    return copied ? Promise.resolve() : Promise.reject(new Error('Copy failed'));
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-action]');
    if (button) {
      var holder = button.closest('[data-url]');
      var path = holder && holder.dataset.url;
      if (!path) return;
      var url = new URL(path, location.href).href;

      if (button.dataset.action === 'bookmark') {
        bookmarks = bookmarks.includes(path) ? bookmarks.filter(function (item) { return item !== path; }) : bookmarks.concat(path);
        saveBookmarks();
        updateBookmarks();
        filterNotes();
        feedback(bookmarks.includes(path) ? '已加入我的收藏' : '已取消收藏');
      } else if (button.dataset.action === 'copy') {
        copyLink(url).then(function () { feedback('链接已复制'); }, function () { feedback('复制失败，请使用浏览器地址栏复制'); });
      } else if (button.dataset.action === 'share') {
        if (navigator.share) {
          navigator.share({ title: document.title, url: url }).catch(function () {});
        } else {
          copyLink(url).then(function () { feedback('链接已复制，可以发送给朋友'); }, function () { feedback('分享失败，请使用浏览器地址栏复制'); });
        }
      }
      return;
    }

    var filter = event.target.closest('.notes-filter');
    if (filter) {
      document.querySelectorAll('.notes-filter').forEach(function (item) {
        var selected = item === filter;
        item.classList.toggle('is-active', selected);
        item.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
      filterNotes();
    }
  });

  var search = document.getElementById('notes-search');
  if (search) search.addEventListener('input', filterNotes);
  updateBookmarks();
  filterNotes();
})();

// Keep the study link current on previously generated pages until the next full Hexo deploy.
(function () {
  'use strict';
  function updateStudyLink() {
    document.querySelectorAll('#menus .menus_items, #sidebar-menus .menus_items').forEach(function (menu) {
      menu.querySelectorAll('a[href="/drafts/"]').forEach(function (link) {
        link.href = '/study/';
        link.innerHTML = '<i class="fa-fw fas fa-calendar-check"></i><span> 学习空间</span>';
      });
      if (menu.querySelector('a[href="/study/"]')) return;
      var item = document.createElement('div');
      item.className = 'menus_item';
      var link = document.createElement('a');
      link.className = 'site-page';
      link.href = '/study/';
      link.innerHTML = '<i class="fa-fw fas fa-calendar-check"></i><span> 学习空间</span>';
      item.appendChild(link);
      var notes = menu.querySelector('a[href="/notes/"]');
      var anchor = notes && notes.closest('.menus_item');
      if (anchor) anchor.after(item); else menu.appendChild(item);
    });
  }
  updateStudyLink();
  document.addEventListener('pjax:complete', updateStudyLink);
})();

// Keep the click fireworks local so the effect works without a third-party CDN.
(function () {
  'use strict';

  if (window.__blogFireworksReady || !document.body) return;
  window.__blogFireworksReady = true;

  var canvas = document.createElement('canvas');
  canvas.className = 'blog-click-fireworks';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
  document.body.appendChild(canvas);

  var context = canvas.getContext('2d');
  if (!context) {
    canvas.remove();
    return;
  }

  var particles = [];
  var frame = 0;
  var previousTime = 0;

  function resize() {
    var scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * scale);
    canvas.height = Math.round(window.innerHeight * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
  }

  function draw(time) {
    var elapsed = Math.min((time - (previousTime || time)) / 16.67, 2);
    previousTime = time;
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);

    particles = particles.filter(function (particle) {
      particle.x += particle.vx * elapsed;
      particle.y += particle.vy * elapsed;
      particle.vy += 0.075 * elapsed;
      particle.life -= 0.028 * elapsed;
      if (particle.life <= 0) return false;

      context.beginPath();
      context.arc(particle.x, particle.y, particle.radius * particle.life, 0, Math.PI * 2);
      context.fillStyle = 'hsla(' + particle.hue + ', 100%, 65%, ' + particle.life + ')';
      context.fill();
      return true;
    });

    frame = particles.length ? requestAnimationFrame(draw) : 0;
    if (!frame) previousTime = 0;
  }

  document.addEventListener('click', function (event) {
    if (event.button !== 0 || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var hue = Math.floor(Math.random() * 360);
    for (var i = 0; i < 30; i++) {
      var angle = (Math.PI * 2 * i) / 30 + Math.random() * 0.2;
      var speed = 2 + Math.random() * 4;
      particles.push({
        x: event.clientX,
        y: event.clientY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 2 + Math.random() * 2,
        hue: (hue + Math.random() * 70) % 360,
        life: 1
      });
    }
    if (particles.length > 180) particles.splice(0, particles.length - 180);
    if (!frame) frame = requestAnimationFrame(draw);
  });

  window.addEventListener('resize', resize);
  resize();
})();
