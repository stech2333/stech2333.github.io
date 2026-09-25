(function () {
  'use strict';

  var root = document.getElementById('drafts-app');
  if (!root) return;

  var settings = window.DRAFTS_CONFIG || {};
  var db;
  var owner;
  var drafts = [];
  var current = null;
  var filter = 'active';
  var dirty = false;
  var changeNumber = 0;
  var saveTimer = 0;
  var saving = null;
  var previewing = false;

  function el(id) { return document.getElementById(id); }
  function show(id, visible) { el(id).hidden = !visible; }
  function notice(text, error) {
    var target = el('drafts-message');
    target.textContent = text || '';
    target.classList.toggle('is-error', !!error);
    target.hidden = !text;
  }
  function errorText(error) { return error && error.message ? error.message : '操作失败，请稍后重试。'; }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2); }
  function block(type) { return { id: uid(), type: type, text: '', path: '', name: '', language: '', url: '' }; }
  function textNode(tag, value, className) {
    var node = document.createElement(tag);
    node.textContent = value || '';
    if (className) node.className = className;
    return node;
  }
  function button(label, action) {
    var node = textNode('button', label);
    node.type = 'button';
    node.dataset.action = action;
    return node;
  }
  function input(value, field, multiline, placeholder) {
    var node = document.createElement(multiline ? 'textarea' : 'input');
    node.value = value || '';
    node.dataset.field = field;
    node.placeholder = placeholder || '';
    if (multiline) node.rows = 4;
    return node;
  }
  function markDirty() {
    if (!current || current.deleted_at) return;
    dirty = true;
    changeNumber += 1;
    el('drafts-save-state').textContent = '尚未保存';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveCurrent().catch(report); }, 1500);
  }
  function report(error) { notice(errorText(error), true); }

  async function saveCurrent() {
    clearTimeout(saveTimer);
    if (saving) await saving;
    if (!dirty || !current || current.deleted_at) return;
    var draft = current;
    var serial = changeNumber;
    var fields = { kind: draft.kind, title: draft.title.trim() || '未命名草稿', summary: draft.summary, tags: draft.tags, body: draft.body };
    el('drafts-save-state').textContent = '保存中…';
    saving = (async function () {
      var result = await db.from('drafts').update(fields).eq('id', draft.id).select('updated_at').single();
      if (result.error) throw result.error;
      draft.updated_at = result.data.updated_at;
      if (current === draft && serial === changeNumber) {
        dirty = false;
        el('drafts-save-state').textContent = '已保存';
      }
      renderList();
    })();
    try { await saving; }
    catch (error) { el('drafts-save-state').textContent = '保存失败'; throw error; }
    finally { saving = null; }
    if (dirty && current === draft) saveTimer = setTimeout(function () { saveCurrent().catch(report); }, 1500);
  }

  function renderList() {
    var query = el('drafts-search').value.trim().toLocaleLowerCase();
    var list = el('drafts-list');
    list.replaceChildren();
    var visible = drafts.filter(function (draft) {
      if (filter === 'trash') { if (!draft.deleted_at) return false; }
      else if (draft.deleted_at || (filter !== 'active' && draft.kind !== filter)) return false;
      return !query || (draft.title + ' ' + draft.summary + ' ' + (draft.tags || []).join(' ')).toLocaleLowerCase().includes(query);
    });
    el('drafts-count').textContent = ' · ' + visible.length + ' 篇';
    if (!visible.length) list.appendChild(textNode('p', filter === 'trash' ? '回收站为空' : '这里还没有草稿', 'drafts-app__list-empty'));
    visible.forEach(function (draft) {
      var item = button('', 'open');
      item.dataset.id = draft.id;
      item.className = 'drafts-app__list-item' + (current && current.id === draft.id ? ' is-active' : '');
      item.appendChild(textNode('strong', draft.title || '未命名草稿'));
      item.appendChild(textNode('small', (draft.kind === 'note' ? '笔记' : '文章') + ' · ' + new Date(draft.updated_at).toLocaleString('zh-CN')));
      list.appendChild(item);
    });
  }

  function renderBlock(item) {
    var wrapper = document.createElement('section');
    wrapper.className = 'drafts-app__block';
    wrapper.dataset.id = item.id;
    var actions = document.createElement('div');
    actions.className = 'drafts-app__block-actions';
    var label = { paragraph: '段落', heading: '标题', code: '代码', table: '表格', link: '链接', image: '图片', file: '附件' }[item.type] || '内容';
    actions.appendChild(textNode('span', label));
    actions.appendChild(button('↑', 'up'));
    actions.appendChild(button('↓', 'down'));
    actions.appendChild(button('删除', 'remove'));
    wrapper.appendChild(actions);

    if (item.type === 'paragraph' || item.type === 'heading' || item.type === 'code' || item.type === 'table') {
      if (item.type === 'code') wrapper.appendChild(input(item.language, 'language', false, '语言，例如 javascript'));
      var area = input(item.text, 'text', item.type !== 'heading', item.type === 'table' ? '每行一条记录，列之间用 Tab 分隔' : '在这里输入内容');
      if (item.type === 'paragraph') area.rows = 5;
      if (item.type === 'code') area.className = 'drafts-app__code';
      wrapper.appendChild(area);
    } else if (item.type === 'link') {
      wrapper.appendChild(input(item.text, 'text', false, '链接名称'));
      wrapper.appendChild(input(item.url, 'url', false, 'https://example.com'));
    } else {
      wrapper.appendChild(input(item.text, 'text', false, item.type === 'image' ? '图片说明' : '附件说明'));
      var picker = document.createElement('input');
      picker.type = 'file';
      picker.dataset.upload = item.type;
      if (item.type === 'image') picker.accept = 'image/png,image/jpeg,image/webp,image/gif';
      wrapper.appendChild(picker);
      if (item.path) {
        wrapper.appendChild(textNode('small', item.name || '已上传文件'));
        if (item.type === 'image') {
          var img = document.createElement('img');
          img.alt = item.text || item.name || '草稿图片';
          img.className = 'drafts-app__image';
          wrapper.appendChild(img);
          signedUrl(item.path).then(function (url) { if (wrapper.isConnected) img.src = url; }).catch(report);
        }
      }
    }
    return wrapper;
  }

  function renderBlocks() {
    var target = el('drafts-blocks');
    target.replaceChildren();
    (current.body || []).forEach(function (item) { target.appendChild(renderBlock(item)); });
  }
  function renderEditor() {
    show('drafts-empty', !current);
    show('drafts-editor-form', !!current);
    show('drafts-preview-panel', false);
    show('drafts-history-panel', false);
    el('drafts-blocks').hidden = false;
    root.querySelector('.drafts-app__add-blocks').hidden = false;
    previewing = false;
    el('drafts-preview').textContent = '预览';
    if (!current) return;
    el('drafts-title').value = current.title || '';
    el('drafts-kind').value = current.kind || 'article';
    el('drafts-summary').value = current.summary || '';
    el('drafts-tags').value = (current.tags || []).join(', ');
    el('drafts-save-state').textContent = current.deleted_at ? '已删除' : '已保存';
    show('drafts-restore', !!current.deleted_at);
    show('drafts-delete', !current.deleted_at);
    Array.from(el('drafts-editor-form').elements).forEach(function (field) { field.disabled = !!current.deleted_at; });
    el('drafts-preview').disabled = false;
    el('drafts-restore').disabled = false;
    renderBlocks();
    renderList();
  }
  async function signedUrl(path) {
    var result = await db.storage.from('draft-assets').createSignedUrl(path, 3600);
    if (result.error) throw result.error;
    return result.data.signedUrl;
  }
  async function selectDraft(id) {
    if (dirty) await saveCurrent();
    current = drafts.find(function (item) { return item.id === id; }) || null;
    renderEditor();
  }
  async function loadDrafts() {
    var result = await db.from('drafts').select('id,kind,title,summary,tags,body,created_at,updated_at,deleted_at').order('updated_at', { ascending: false });
    if (result.error) throw result.error;
    drafts = result.data || [];
    renderList();
  }
  async function createDraft() {
    if (dirty) await saveCurrent();
    var result = await db.from('drafts').insert({ owner_id: owner.id, kind: 'article', title: '未命名草稿', summary: '', tags: [], body: [block('paragraph')] }).select().single();
    if (result.error) throw result.error;
    drafts.unshift(result.data);
    current = result.data;
    filter = 'active';
    setFilterButtons();
    renderEditor();
    el('drafts-title').focus();
  }
  function setFilterButtons() {
    root.querySelectorAll('[data-filter]').forEach(function (button) { button.classList.toggle('is-active', button.dataset.filter === filter); });
    renderList();
  }
  async function softDelete() {
    if (!current || !confirm('将这篇草稿移到回收站？之后可以恢复。')) return;
    if (dirty) await saveCurrent();
    var result = await db.from('drafts').update({ deleted_at: new Date().toISOString() }).eq('id', current.id).select('deleted_at,updated_at').single();
    if (result.error) throw result.error;
    current.deleted_at = result.data.deleted_at;
    current.updated_at = result.data.updated_at;
    current = null;
    renderEditor();
    renderList();
    notice('草稿已移到回收站，可随时恢复。');
  }
  async function restore() {
    if (!current) return;
    var result = await db.from('drafts').update({ deleted_at: null }).eq('id', current.id).select('deleted_at,updated_at').single();
    if (result.error) throw result.error;
    current.deleted_at = null;
    current.updated_at = result.data.updated_at;
    filter = 'active';
    setFilterButtons();
    renderEditor();
    notice('草稿已恢复。');
  }
  async function uploadFile(file, item) {
    if (file.size > 25 * 1024 * 1024) throw new Error('单个文件不能超过 25 MB。');
    var extension = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    var path = owner.id + '/' + current.id + '/' + uid() + '.' + extension;
    notice('正在上传 ' + file.name + '…');
    var result = await db.storage.from('draft-assets').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (result.error) throw result.error;
    item.path = path;
    item.name = file.name;
    markDirty();
    await saveCurrent();
    renderBlocks();
    notice('文件已保存在私人空间。');
  }
  function addPreviewBlock(parent, item) {
    var node;
    if (item.type === 'heading') node = textNode('h3', item.text);
    else if (item.type === 'paragraph') node = textNode('p', item.text);
    else if (item.type === 'code') { node = textNode('pre', item.text); node.className = 'drafts-app__code'; }
    else if (item.type === 'table') {
      node = document.createElement('table');
      (item.text || '').split('\n').filter(Boolean).forEach(function (line) {
        var tr = document.createElement('tr');
        line.split('\t').forEach(function (cell) { tr.appendChild(textNode('td', cell)); });
        node.appendChild(tr);
      });
    } else if (item.type === 'link') {
      node = textNode('a', item.text || item.url);
      if (/^https?:\/\//i.test(item.url || '')) { node.href = item.url; node.rel = 'noopener noreferrer'; node.target = '_blank'; }
    } else if (item.type === 'image' && item.path) {
      node = document.createElement('figure');
      var img = document.createElement('img');
      img.alt = item.text || item.name || '';
      node.appendChild(img);
      if (item.text) node.appendChild(textNode('figcaption', item.text));
      signedUrl(item.path).then(function (url) { if (node.isConnected) img.src = url; }).catch(report);
    } else if (item.type === 'file' && item.path) {
      node = textNode('a', '下载附件：' + (item.text || item.name));
      node.download = item.name;
      signedUrl(item.path).then(function (url) { if (node.isConnected) node.href = url; }).catch(report);
    }
    if (node) parent.appendChild(node);
  }
  function togglePreview() {
    if (!current) return;
    previewing = !previewing;
    show('drafts-preview-panel', previewing);
    el('drafts-blocks').hidden = previewing;
    root.querySelector('.drafts-app__add-blocks').hidden = previewing;
    el('drafts-preview').textContent = previewing ? '返回编辑' : '预览';
    if (!previewing) return;
    var panel = el('drafts-preview-panel');
    panel.replaceChildren(textNode('h2', current.title), textNode('p', current.summary, 'drafts-app__preview-summary'));
    (current.body || []).forEach(function (item) { addPreviewBlock(panel, item); });
  }
  async function signedIn(user) {
    var access = await db.rpc('can_access_drafts');
    if (access.error) throw access.error;
    if (!access.data) {
      await db.auth.signOut();
      show('drafts-login', true);
      throw new Error('此账号没有草稿空间的访问权限。');
    }
    owner = user;
    show('drafts-login', false);
    show('drafts-workspace', true);
    notice('');
    await loadDrafts();
  }

  el('drafts-login-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    notice('正在登录…');
    var result = await db.auth.signInWithPassword({ email: el('drafts-email').value.trim(), password: el('drafts-password').value });
    el('drafts-password').value = '';
    if (result.error) return report(result.error);
    try { await signedIn(result.data.user); } catch (error) { report(error); }
  });
  el('drafts-sign-out').addEventListener('click', async function () {
    try {
      if (dirty) await saveCurrent();
      var result = await db.auth.signOut();
      if (result.error) throw result.error;
      owner = null; current = null; drafts = [];
      show('drafts-workspace', false); show('drafts-login', true);
      notice('已退出登录。');
    } catch (error) { report(error); }
  });
  el('drafts-create').addEventListener('click', function () { createDraft().catch(report); });
  el('drafts-search').addEventListener('input', renderList);
  root.querySelectorAll('[data-filter]').forEach(function (item) { item.addEventListener('click', function () { filter = item.dataset.filter; setFilterButtons(); }); });
  el('drafts-list').addEventListener('click', function (event) {
    var item = event.target.closest('[data-id]');
    if (item) selectDraft(item.dataset.id).catch(report);
  });
  el('drafts-editor-form').addEventListener('submit', function (event) { event.preventDefault(); saveCurrent().then(function () { notice('草稿已保存。'); }).catch(report); });
  el('drafts-editor-form').addEventListener('input', function (event) {
    if (!current) return;
    var target = event.target;
    if (target.id === 'drafts-title') current.title = target.value;
    else if (target.id === 'drafts-summary') current.summary = target.value;
    else if (target.id === 'drafts-tags') current.tags = target.value.split(',').map(function (part) { return part.trim(); }).filter(Boolean).slice(0, 20);
    else if (target.dataset.field) {
      var container = target.closest('[data-id]');
      var item = current.body.find(function (part) { return part.id === container.dataset.id; });
      if (item) item[target.dataset.field] = target.value;
    } else return;
    markDirty();
    renderList();
  });
  el('drafts-kind').addEventListener('change', function (event) { current.kind = event.target.value; markDirty(); renderList(); });
  el('drafts-blocks').addEventListener('click', function (event) {
    var action = event.target.closest('[data-action]');
    if (!action || !current) return;
    var container = action.closest('[data-id]');
    var index = current.body.findIndex(function (part) { return part.id === container.dataset.id; });
    if (index < 0) return;
    if (action.dataset.action === 'remove') current.body.splice(index, 1);
    else {
      var other = index + (action.dataset.action === 'up' ? -1 : 1);
      if (other < 0 || other >= current.body.length) return;
      var tmp = current.body[index]; current.body[index] = current.body[other]; current.body[other] = tmp;
    }
    renderBlocks(); markDirty();
  });
  el('drafts-blocks').addEventListener('change', function (event) {
    if (!event.target.dataset.upload || !event.target.files.length || !current) return;
    var container = event.target.closest('[data-id]');
    var item = current.body.find(function (part) { return part.id === container.dataset.id; });
    if (item) uploadFile(event.target.files[0], item).catch(report);
  });
  root.querySelectorAll('[data-add-block]').forEach(function (item) {
    item.addEventListener('click', function () { if (!current) return; current.body.push(block(item.dataset.addBlock)); renderBlocks(); markDirty(); });
  });
  el('drafts-preview').addEventListener('click', togglePreview);
  el('drafts-history').addEventListener('click', async function () {
    if (!current) return;
    var panel = el('drafts-history-panel');
    if (!panel.hidden) { show('drafts-history-panel', false); return; }
    var result = await db.from('draft_revisions').select('id,created_at,snapshot').eq('draft_id', current.id).order('created_at', { ascending: false }).limit(20);
    if (result.error) return report(result.error);
    panel.replaceChildren(textNode('h3', '历史版本'));
    if (!result.data.length) panel.appendChild(textNode('p', '保存一段时间后，旧版本会出现在这里。'));
    result.data.forEach(function (revision) {
      var choice = button(new Date(revision.created_at).toLocaleString('zh-CN') + ' · ' + (revision.snapshot.title || '未命名草稿'), 'restore-version');
      choice.addEventListener('click', function () {
        if (!confirm('用这个历史版本覆盖当前编辑内容？')) return;
        current.kind = revision.snapshot.kind;
        current.title = revision.snapshot.title;
        current.summary = revision.snapshot.summary;
        current.tags = revision.snapshot.tags;
        current.body = revision.snapshot.body;
        renderEditor();
        markDirty();
      });
      panel.appendChild(choice);
    });
    show('drafts-history-panel', true);
  });
  el('drafts-delete').addEventListener('click', function () { softDelete().catch(report); });
  el('drafts-restore').addEventListener('click', function () { restore().catch(report); });
  window.addEventListener('beforeunload', function (event) { if (dirty) { event.preventDefault(); event.returnValue = ''; } });

  if (!settings.url || !settings.publishableKey) {
    show('drafts-setup', true);
    notice('草稿页面已部署，等待私人数据库连接。');
    return;
  }
  if (!window.supabase || !window.supabase.createClient) {
    notice('认证组件未能加载，请检查网络后刷新。', true);
    return;
  }
  db = window.supabase.createClient(settings.url, settings.publishableKey);
  db.auth.getUser().then(function (result) {
    if (result.data && result.data.user) return signedIn(result.data.user);
    show('drafts-login', true);
    notice('');
  }).catch(report);
})();

