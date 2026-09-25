(function () {
  'use strict';

  var root = document.getElementById('drafts-app');
  if (!root) return;

  var settings = window.DRAFTS_CONFIG || {};
  var db;
  var owner;
  var drafts = [];
  var current = null;
  var dirty = false;
  var revision = 0;
  var saveTimer = 0;
  var saving = null;

  function el(id) { return document.getElementById(id); }
  function show(id, visible) { el(id).hidden = !visible; }
  function notice(message, error) {
    var target = el('drafts-message');
    target.textContent = message || '';
    target.classList.toggle('is-error', !!error);
    target.hidden = !message;
  }
  function report(error) { notice(error && error.message ? error.message : '操作失败，请稍后重试。', true); }
  function textNode(tag, value) {
    var node = document.createElement(tag);
    node.textContent = value || '';
    return node;
  }
  function markdownFromBlocks(blocks) {
    if (!Array.isArray(blocks)) return '';
    if (blocks.length === 1 && blocks[0].type === 'markdown') return blocks[0].text || '';
    return blocks.map(function (item) {
      var value = item.text || '';
      if (item.type === 'heading') return '# ' + value;
      if (item.type === 'code') return '```' + (item.language || '') + '\n' + value + '\n```';
      if (item.type === 'link') return '[' + (value || item.url || '链接') + '](' + (item.url || '') + ')';
      if (item.type === 'image') return '![' + (value || item.name || '图片') + '](draft-asset://' + (item.path || '') + ')';
      if (item.type === 'file') return '[' + (value || item.name || '附件') + '](draft-asset://' + (item.path || '') + ')';
      if (item.type === 'table') {
        var rows = value.split('\n').filter(Boolean).map(function (row) { return row.split('\t'); });
        if (!rows.length) return '';
        var table = rows.map(function (row) { return '| ' + row.join(' | ') + ' |'; });
        table.splice(1, 0, '| ' + rows[0].map(function () { return '---'; }).join(' | ') + ' |');
        return table.join('\n');
      }
      return value;
    }).filter(Boolean).join('\n\n');
  }
  function markdownBody(value) { return [{ type: 'markdown', text: value }]; }
  function editableTitle(value) { return value === '未命名草稿' ? '' : (value || ''); }
  function displayTitle(value) { return value.trim() || '未命名草稿'; }

  function renderList() {
    var list = el('drafts-list');
    list.replaceChildren();
    var visible = drafts.filter(function (draft) { return !draft.deleted_at; });
    visible.sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });
    el('drafts-count').textContent = ' · ' + visible.length + ' 篇';
    if (!visible.length) list.appendChild(textNode('p', '这里还没有草稿'));
    visible.forEach(function (draft) {
      var item = document.createElement('button');
      item.type = 'button';
      item.dataset.id = draft.id;
      item.className = 'drafts-app__list-item' + (current && current.id === draft.id ? ' is-active' : '');
      item.appendChild(textNode('strong', displayTitle(draft.title || '')));
      item.appendChild(textNode('small', new Date(draft.updated_at).toLocaleString('zh-CN')));
      list.appendChild(item);
    });
  }
  function renderEditor() {
    show('drafts-empty', !current);
    show('drafts-editor-form', !!current);
    if (!current) { renderList(); return; }
    el('drafts-markdown').value = current.markdown;
    el('drafts-title').value = editableTitle(current.title);
    el('drafts-save-state').textContent = dirty ? '尚未保存' : '已保存';
    renderList();
  }
  function markDirty() {
    if (!current) return;
    dirty = true;
    revision += 1;
    el('drafts-save-state').textContent = '尚未保存';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveCurrent().catch(report); }, 1500);
  }
  async function saveCurrent() {
    clearTimeout(saveTimer);
    if (saving) await saving;
    if (!current || !dirty) return;
    var draft = current;
    var atRevision = revision;
    var title = displayTitle(draft.title || '');
    var markdown = draft.markdown;
    el('drafts-save-state').textContent = '保存中…';
    saving = (async function () {
      var result = await db.from('drafts').update({ title: title, body: markdownBody(markdown) })
        .eq('id', draft.id).select('updated_at').single();
      if (result.error) throw result.error;
      draft.updated_at = result.data.updated_at;
      draft.body = markdownBody(markdown);
      if (draft === current && atRevision === revision) {
        dirty = false;
        el('drafts-save-state').textContent = '已保存';
      }
      renderList();
    })();
    try { await saving; }
    catch (error) { el('drafts-save-state').textContent = '保存失败'; throw error; }
    finally { saving = null; }
    if (dirty && draft === current) await saveCurrent();
  }
  async function loadDrafts() {
    var result = await db.from('drafts').select('id,title,body,updated_at,deleted_at').is('deleted_at', null);
    if (result.error) throw result.error;
    drafts = result.data || [];
    drafts.forEach(function (draft) { draft.markdown = markdownFromBlocks(draft.body); });
    renderList();
  }
  async function selectDraft(id) {
    if (dirty) await saveCurrent();
    current = drafts.find(function (draft) { return draft.id === id; }) || null;
    renderEditor();
  }
  async function createDraft() {
    if (dirty) await saveCurrent();
    var result = await db.from('drafts').insert({ owner_id: owner.id, kind: 'article', title: '未命名草稿', body: markdownBody('') }).select('id,title,body,updated_at,deleted_at').single();
    if (result.error) throw result.error;
    result.data.markdown = '';
    drafts.unshift(result.data);
    current = result.data;
    dirty = false;
    renderEditor();
    el('drafts-markdown').focus();
  }
  async function deleteDraft() {
    if (!current || !confirm('确定删除这篇草稿吗？')) return;
    if (dirty) await saveCurrent();
    else if (saving) await saving;
    clearTimeout(saveTimer);
    var draft = current;
    var result = await db.from('drafts').update({ deleted_at: new Date().toISOString() }).eq('id', draft.id).select('deleted_at').single();
    if (result.error) throw result.error;
    draft.deleted_at = result.data.deleted_at;
    dirty = false;
    current = null;
    renderEditor();
    notice('草稿已删除。');
  }
  async function downloadDraft() {
    if (!current) return;
    await saveCurrent();
    var filename = displayTitle(current.title || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') + '.md';
    var url = URL.createObjectURL(new Blob([current.markdown], { type: 'text/markdown;charset=utf-8' }));
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
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
      owner = null; current = null; drafts = []; dirty = false;
      show('drafts-workspace', false); show('drafts-login', true);
      notice('已退出登录。');
    } catch (error) { report(error); }
  });
  el('drafts-create').addEventListener('click', function () { createDraft().catch(report); });
  el('drafts-list').addEventListener('click', function (event) {
    var item = event.target.closest('[data-id]');
    if (item) selectDraft(item.dataset.id).catch(report);
  });
  el('drafts-editor-form').addEventListener('submit', function (event) {
    event.preventDefault();
    saveCurrent().then(function () { notice('草稿已保存。'); }).catch(report);
  });
  el('drafts-markdown').addEventListener('input', function (event) {
    current.markdown = event.target.value;
    markDirty();
  });
  el('drafts-title').addEventListener('input', function (event) {
    current.title = event.target.value;
    markDirty();
    renderList();
  });
  el('drafts-delete').addEventListener('click', function () { deleteDraft().catch(report); });
  el('drafts-download').addEventListener('click', function () { downloadDraft().catch(report); });
  window.addEventListener('beforeunload', function (event) {
    if (dirty) { event.preventDefault(); event.returnValue = ''; }
  });

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

