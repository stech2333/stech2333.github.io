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
