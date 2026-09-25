(() => {
  'use strict';
  if (!document.getElementById('study-app')) return;
  const $ = id => document.getElementById(id);
  const pad = value => String(value).padStart(2, '0');
  const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const today = dateKey(new Date());
  const statusName = { todo: '待做', solved: '已完成', review: '待复习' };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const readableDate = value => { const [year, month, day] = value.split('-').map(Number); return `${year} 年 ${month} 月 ${day} 日`; };
  const markdownBody = value => [{ type: 'markdown', text: value }];
  function markdownFromBlocks(blocks) {
    if (!Array.isArray(blocks)) return '';
    if (blocks.length === 1 && blocks[0].type === 'markdown') return blocks[0].text || '';
    return blocks.map(item => {
      const value = item.text || '';
      if (item.type === 'heading') return '# ' + value;
      if (item.type === 'code') return '```' + (item.language || '') + '\n' + value + '\n```';
      if (item.type === 'link') return '[' + (value || item.url || '链接') + '](' + (item.url || '') + ')';
      if (item.type === 'image') return '![' + (value || item.name || '图片') + '](draft-asset://' + (item.path || '') + ')';
      if (item.type === 'file') return '[' + (value || item.name || '附件') + '](draft-asset://' + (item.path || '') + ')';
      return value;
    }).filter(Boolean).join('\n\n');
  }
  let db, owner;
  let data = { plans: [], tasks: [], records: [], docs: [] };
  let selected = today;
  let month = new Date(); month.setDate(1);
  let activeDoc = null;
  let dirty = false;
  let revision = 0;
  let saveTimer = 0;
  let saving = null;
  let pendingDelete = null;
  let previousFocus = null;
  let menuTriggerActive = null;
  const expandedRecords = new Set();
  function message(value, error = false) { const el = $('study-message'); el.textContent = value || ''; el.classList.toggle('is-error', error); el.hidden = !value; }
  function report(error) { message(error && error.message ? error.message : '操作失败，请稍后重试。', true); }
  function show(id, value) { $(id).hidden = !value; }
  async function checked(query) { const result = await query; if (result.error) throw result.error; return result.data; }
  async function loadAll() {
    if (dirty) await flushDoc();
    const [plans, tasks, records, docs] = await Promise.all([
      checked(db.from('study_plans').select('id,name,updated_at').is('deleted_at', null).order('created_at')),
      checked(db.from('study_tasks').select('id,title,plan_id,scheduled_on,completed_at,updated_at').is('deleted_at', null).order('scheduled_on')),
      checked(db.from('leetcode_records').select('id,title,url,topic,status,studied_on,solution_md,updated_at').is('deleted_at', null).order('studied_on', { ascending: false })),
      checked(db.from('drafts').select('id,title,body,updated_at').is('deleted_at', null).order('updated_at', { ascending: false }))
    ]);
    data = {
      plans: plans.map(row => ({ id: row.id, name: row.name })),
      tasks: tasks.map(row => ({ id: row.id, title: row.title, planId: row.plan_id, date: row.scheduled_on, done: !!row.completed_at })),
      records: records.map(row => ({ id: row.id, title: row.title, url: row.url || '', topic: row.topic || '', status: row.status, date: row.studied_on, solution: row.solution_md || '' })),
      docs: docs.map(row => ({ id: row.id, title: row.title || '未命名草稿', body: markdownFromBlocks(row.body), updated_at: row.updated_at }))
    };
    if (!data.docs.some(doc => doc.id === activeDoc)) activeDoc = data.docs[0]?.id || null;
    render();
  }
  function toast(message) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { $('toast').hidden = true; }, 2600);
  }
  function planName(id) {
    const plan = data.plans.find(item => item.id === id);
    return plan ? plan.name : '未分类';
  }
  function problemUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || !['leetcode.cn', 'leetcode.com', 'www.leetcode.cn', 'www.leetcode.com'].includes(url.hostname)) return '';
      return url.href;
    } catch (_) { return ''; }
  }
  function problemTitle(record) {
    const url = problemUrl(record.url);
    return url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="在 LeetCode 打开题目">${escapeHtml(record.title)} ↗</a>`
      : escapeHtml(record.title);
  }
  function menuButton(label) {
    return `<button class="menu-trigger" type="button" data-menu-trigger aria-haspopup="menu" aria-controls="item-menu" aria-expanded="false" aria-label="${escapeHtml(label)}的更多操作">⋯</button>`;
  }
  function taskHtml(task) {
    return `<div class="task ${task.done ? 'done' : ''}" data-menu-kind="task" data-menu-id="${task.id}">
      <label class="task-main"><input type="checkbox" data-task="${task.id}" ${task.done ? 'checked' : ''}><span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(planName(task.planId))} · ${escapeHtml(task.date)}</small></span></label>
      ${menuButton(task.title)}
    </div>`;
  }
  function recordActions(record) {
    return `<span class="item-actions">
      ${record.solution && record.solution.trim() ? `<button class="text-button" type="button" data-action="view-solution" data-id="${record.id}">题解</button>` : ''}
      ${menuButton(record.title)}
    </span>`;
  }
  function renderStats() {
    const todayTasks = data.tasks.filter(task => task.date === today);
    const todayDone = todayTasks.filter(task => task.done).length;
    const completed = data.tasks.filter(task => task.done).length;
    const solutions = data.records.filter(record => record.solution && record.solution.trim()).length;
    $('stats').innerHTML = `<div class="stat"><small>今日计划</small><strong>${todayDone} / ${todayTasks.length}<em>项完成</em></strong></div>
      <div class="stat"><small>累计完成</small><strong>${completed}<em>项任务</em></strong></div>
      <div class="stat"><small>已记录题目</small><strong>${data.records.length}<em>道 LeetCode 题</em></strong></div>
      <div class="stat"><small>已有题解</small><strong>${solutions}<em>篇记录</em></strong></div>`;
  }
  function renderCalendar() {
    $('calendar-month').textContent = `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`;
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - (first.getDay() + 6) % 7);
    const cells = [];
    for (let index = 0; index < 42; index++) {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const value = dateKey(date);
      const dayTasks = data.tasks.filter(task => task.date === value);
      const hasRecord = data.records.some(record => record.date === value);
      const dots = dayTasks.slice(0, 2).map(task => `<i class="dot ${task.done ? 'done' : ''}"></i>`).join('') + (hasRecord ? '<i class="dot practice"></i>' : '');
      cells.push(`<button class="day ${date.getMonth() !== month.getMonth() ? 'outside' : ''} ${value === today ? 'today' : ''} ${value === selected ? 'selected' : ''}" data-date="${value}" aria-label="${readableDate(value)}" aria-pressed="${value === selected}"><span class="day-number">${date.getDate()}</span><span class="dots">${dots}</span></button>`);
    }
    $('calendar-days').innerHTML = cells.join('');
  }
  function renderAgenda() {
    const tasks = data.tasks.filter(task => task.date === selected);
    const records = data.records.filter(record => record.date === selected);
    $('agenda-title').textContent = readableDate(selected);
    $('agenda-sub').textContent = `${tasks.filter(task => task.done).length} / ${tasks.length} 项任务已完成`;
    $('agenda-tasks').innerHTML = tasks.length ? tasks.map(taskHtml).join('') : '<div class="empty">这一天还没有安排任务</div>';
    $('agenda-records').innerHTML = records.length
      ? records.map(record => `<div class="mini-record" data-menu-kind="record" data-menu-id="${record.id}"><strong>${problemTitle(record)}</strong><small>${escapeHtml(record.topic || '未分类专题')} · ${statusName[record.status] || '待做'}</small>${recordActions(record)}</div>`).join('')
      : '<div class="empty">这一天还没有题目记录</div>';
  }
  function renderPlans() {
    const groups = data.plans.map(plan => ({ ...plan, editable: true }));
    if (data.tasks.some(task => !data.plans.some(plan => plan.id === task.planId))) groups.push({ id: null, name: '未分类', editable: false });
    $('plan-grid').innerHTML = groups.length ? groups.map(plan => {
      const items = data.tasks.filter(task => plan.id === null ? !data.plans.some(item => item.id === task.planId) : task.planId === plan.id);
      const done = items.filter(task => task.done).length;
      return `<article class="plan-card" ${plan.editable ? `data-menu-kind="plan" data-menu-id="${plan.id}"` : ''}><div class="plan-card-head"><div><h3>${escapeHtml(plan.name)}</h3><p>学习任务 · ${items.length} 项</p></div>${plan.editable ? menuButton(plan.name) : ''}</div>
        <div class="progress"><i style="width:${items.length ? done / items.length * 100 : 0}%"></i></div><div class="progress-label">已完成 ${done} / ${items.length}</div>${items.length ? items.map(taskHtml).join('') : '<div class="empty">尚无任务</div>'}</article>`;
    }).join('') : '<div class="empty">尚无学习计划，点击“新建计划”开始。</div>';
  }
  function renderPractice() {
    const query = $('practice-search').value.trim().toLocaleLowerCase();
    const filter = $('practice-filter').value;
    const records = data.records.filter(record =>
      (filter === 'all' || record.status === filter) && (!query || `${record.title} ${record.topic || ''}`.toLocaleLowerCase().includes(query))
    ).sort((a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)));
    $('record-list').innerHTML = records.length ? records.map(record => `<article class="record" data-record="${record.id}" data-menu-kind="record" data-menu-id="${record.id}"><div><h3>${problemTitle(record)} <span class="pill ${record.status === 'solved' ? 'green' : record.status === 'review' ? 'orange' : ''}">${statusName[record.status] || '待做'}</span></h3><p>${escapeHtml(record.date)} · ${escapeHtml(record.topic || '未分类专题')} · ${record.solution && record.solution.trim() ? '已写题解' : '尚未写题解'}</p></div>${recordActions(record)}${expandedRecords.has(record.id) && record.solution && record.solution.trim() ? `<pre class="record-solution">${escapeHtml(record.solution)}</pre>` : ''}</article>`).join('') : '<div class="empty">没有匹配的题目记录</div>';
  }
  function renderDocs() {
    $('docs-list').innerHTML = data.docs.length
      ? data.docs.map(doc => `<div class="doc-row ${doc.id === activeDoc ? 'active' : ''}" data-menu-kind="doc" data-menu-id="${doc.id}"><button class="doc-select" type="button" data-doc="${doc.id}">${escapeHtml(doc.title.trim() === '未命名草稿' ? '未命名文档' : (doc.title.trim() || '未命名文档'))}</button>${menuButton(doc.title.trim() === '未命名草稿' ? '未命名文档' : (doc.title.trim() || '未命名文档'))}</div>`).join('')
      : '<div class="empty">还没有 Markdown 文档</div>';
    const doc = data.docs.find(item => item.id === activeDoc);
    $('docs-editor').hidden = !doc;
    if (!doc) return;
    $('doc-title').value = doc.title === '未命名草稿' ? '' : doc.title;
    $('doc-body').value = doc.body;
    $('docs-status').textContent = dirty ? '尚未保存' : '已保存到私人数据库';
  }
  function render() {
    hideMenu();
    renderStats();
    renderCalendar();
    renderAgenda();
    renderPlans();
    renderPractice();
    renderDocs();
  }
  function switchView(next) {
    document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === next));
    ['calendar', 'plans', 'practice', 'docs'].forEach(name => { $('view-' + name).hidden = name !== next; });
  }
  function showModal(id) {
    hideMenu();
    previousFocus = document.activeElement;
    $(id).hidden = false;
    const input = $(id).querySelector('input,button');
    if (input) input.focus();
  }
  function closeModal(id) {
    $(id).hidden = true;
    if (id === 'confirm-modal') pendingDelete = null;
    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
  }
  function askDelete(message, action) {
    $('confirm-message').textContent = message;
    pendingDelete = action;
    showModal('confirm-modal');
  }
  function hideMenu() {
    $('item-menu').hidden = true;
    if (menuTriggerActive && menuTriggerActive.isConnected) menuTriggerActive.setAttribute('aria-expanded', 'false');
    menuTriggerActive = null;
  }
  function showMenu(item, x, y, trigger) {
    hideMenu();
    const kind = item.dataset.menuKind;
    const id = item.dataset.menuId;
    if (!['task', 'plan', 'record', 'doc'].includes(kind) || !id) return;
    const menu = $('item-menu');
    menu.innerHTML = `<button type="button" role="menuitem" data-action="edit-${kind}" data-id="${id}">编辑</button><button type="button" role="menuitem" class="danger" data-action="delete-${kind}" data-id="${id}">删除</button>`;
    menu.hidden = false;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - 154))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - 88))}px`;
    menuTriggerActive = trigger || item.querySelector('[data-menu-trigger]');
    if (menuTriggerActive) menuTriggerActive.setAttribute('aria-expanded', 'true');
    menu.querySelector('button').focus();
  }
  function planOptions(selectedId) {
    const options = ['<option value="">未分类</option>'];
    data.plans.forEach(plan => options.push(`<option value="${plan.id}" ${plan.id === selectedId ? 'selected' : ''}>${escapeHtml(plan.name)}</option>`));
    return options.join('');
  }
  function openPlan(id) {
    const form = $('plan-form');
    const plan = data.plans.find(item => item.id === id);
    form.reset();
    form.dataset.editId = plan ? String(plan.id) : '';
    $('plan-modal-title').textContent = plan ? '编辑学习计划' : '新建学习计划';
    form.elements.namedItem('name').value = plan ? plan.name : '';
    showModal('plan-modal');
  }
  function openTask(id) {
    const form = $('task-form');
    const task = data.tasks.find(item => item.id === id);
    form.reset();
    form.dataset.editId = task ? String(task.id) : '';
    $('task-modal-title').textContent = task ? '编辑学习任务' : '添加学习任务';
    form.elements.namedItem('plan').innerHTML = planOptions(task ? task.planId : null);
    form.elements.namedItem('title').value = task ? task.title : '';
    form.elements.namedItem('date').value = task ? task.date : selected;
    showModal('task-modal');
  }
  function openRecord(id) {
    const form = $('practice-form');
    const record = data.records.find(item => item.id === id);
    form.reset();
    form.dataset.editId = record ? String(record.id) : '';
    $('practice-modal-title').textContent = record ? '编辑题目记录' : '记录 LeetCode 题目';
    ['title', 'url', 'topic', 'status', 'solution'].forEach(name => {
      form.elements.namedItem(name).value = record ? record[name] || '' : name === 'status' ? 'todo' : '';
    });
    form.elements.namedItem('date').value = record ? record.date : selected;
    showModal('practice-modal');
  }
  function selectDate(value) {
    selected = value;
    const [year, monthNumber] = value.split('-').map(Number);
    month = new Date(year, monthNumber - 1, 1);
    renderCalendar();
    renderAgenda();
  }

  function markDirty() {
    dirty = true;
    revision += 1;
    $('docs-status').textContent = '尚未保存…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { flushDoc().catch(report); }, 1200);
  }
  async function flushDoc() {
    clearTimeout(saveTimer);
    if (saving) await saving;
    if (!dirty || !activeDoc) return;
    const doc = data.docs.find(item => item.id === activeDoc);
    if (!doc) return;
    const atRevision = revision;
    const payload = { title: doc.title.trim() || '未命名草稿', body: markdownBody(doc.body) };
    $('docs-status').textContent = '正在保存…';
    saving = (async () => {
      const row = await checked(db.from('drafts').update(payload).eq('id', doc.id).eq('owner_id', owner.id).select('updated_at').single());
      doc.updated_at = row.updated_at;
      if (revision === atRevision && activeDoc === doc.id) {
        dirty = false;
        $('docs-status').textContent = '已保存到私人数据库';
      }
    })();
    try { await saving; }
    catch (error) { $('docs-status').textContent = '保存失败，修改仍保留在当前页面'; throw error; }
    finally { saving = null; }
    if (dirty && activeDoc === doc.id) await flushDoc();
  }
  async function chooseDoc(id, focusTitle = false) {
    if (activeDoc === id && !focusTitle) return;
    await flushDoc();
    activeDoc = id;
    switchView('docs');
    renderDocs();
    if (focusTitle) $('doc-title').focus();
  }
  async function mutate(action, success) {
    try { await action(); if (success) toast(success); message(''); return true; }
    catch (error) { report(error); return false; }
  }
  async function signedIn(user) {
    const access = await checked(db.rpc('can_access_drafts'));
    if (!access) {
      await db.auth.signOut();
      show('study-login', true);
      throw new Error('此账号没有私人学习空间的访问权限。');
    }
    owner = user;
    await loadAll();
    show('study-login', false);
    show('study-workspace', true);
    switchView(location.hash === '#docs' ? 'docs' : 'calendar');
    message('');
  }
  async function initialize() {
    const config = window.DRAFTS_CONFIG || {};
    if (!config.url || !config.publishableKey || !window.supabase?.createClient) {
      show('study-setup', true);
      return;
    }
    db = window.supabase.createClient(config.url, config.publishableKey);
    try {
      const session = await db.auth.getUser();
      if (session.error) throw session.error;
      if (session.data.user) await signedIn(session.data.user);
      else show('study-login', true);
    } catch (error) { show('study-login', true); report(error); }
  }

  $('study-login-form').addEventListener('submit', async event => {
    event.preventDefault();
    message('正在登录…');
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const result = await db.auth.signInWithPassword({ email: $('study-email').value.trim(), password: $('study-password').value });
      $('study-password').value = '';
      if (result.error) throw result.error;
      await signedIn(result.data.user);
    } catch (error) { report(error); }
    finally { button.disabled = false; }
  });
  $('study-sign-out').addEventListener('click', () => mutate(async () => {
    await flushDoc();
    const result = await db.auth.signOut();
    if (result.error) throw result.error;
    owner = null; activeDoc = null; dirty = false;
    data = { plans: [], tasks: [], records: [], docs: [] };
    show('study-workspace', false); show('study-login', true);
    message('已退出登录。');
  }));

  $('study-app').addEventListener('contextmenu', event => {
    if (event.target.closest('input,textarea,select')) { hideMenu(); return; }
    const item = event.target.closest('[data-menu-kind]');
    if (!item) { hideMenu(); return; }
    event.preventDefault();
    showMenu(item, event.clientX, event.clientY);
  });
  $('study-app').addEventListener('click', event => {
    const trigger = event.target.closest('[data-menu-trigger]');
    if (trigger) {
      const item = trigger.closest('[data-menu-kind]');
      if (item) { const box = trigger.getBoundingClientRect(); showMenu(item, box.left, box.bottom + 4, trigger); }
      return;
    }
    const action = event.target.closest('[data-action]');
    if (action) {
      hideMenu();
      const id = action.dataset.id;
      const kind = action.dataset.action;
      if (kind === 'edit-task') openTask(id);
      if (kind === 'edit-plan') openPlan(id);
      if (kind === 'edit-record') openRecord(id);
      if (kind === 'edit-doc') chooseDoc(id, true).catch(report);
      if (kind === 'delete-task') {
        const task = data.tasks.find(item => item.id === id);
        if (task) askDelete(`删除任务“${task.title}”？`, async () => {
          await checked(db.from('study_tasks').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('owner_id', owner.id).select('id').single());
          await loadAll(); toast('任务已删除');
        });
      }
      if (kind === 'delete-plan') {
        const plan = data.plans.find(item => item.id === id);
        if (plan) {
          const count = data.tasks.filter(task => task.planId === id).length;
          askDelete(`删除计划“${plan.name}”？其中 ${count} 项任务会保留在“未分类”。`, async () => {
            await checked(db.rpc('delete_study_plan', { plan_uuid: id }));
            await loadAll(); toast('计划已删除，任务已保留');
          });
        }
      }
      if (kind === 'delete-record') {
        const record = data.records.find(item => item.id === id);
        if (record) askDelete(`删除题目记录“${record.title}”及其题解？`, async () => {
          await checked(db.from('leetcode_records').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('owner_id', owner.id).select('id').single());
          expandedRecords.delete(id); await loadAll(); toast('题目记录已删除');
        });
      }
      if (kind === 'delete-doc') {
        const doc = data.docs.find(item => item.id === id);
        if (doc) askDelete(`删除 Markdown 文档“${doc.title.trim() || '未命名文档'}”？`, async () => {
          if (activeDoc !== id) await flushDoc();
          else { clearTimeout(saveTimer); if (saving) await saving; dirty = false; }
          await checked(db.from('drafts').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('owner_id', owner.id).select('id').single());
          activeDoc = null; await loadAll(); toast('文档已删除');
        });
      }
      if (kind === 'view-solution') {
        expandedRecords.add(id); $('practice-search').value = ''; $('practice-filter').value = 'all';
        switchView('practice'); renderPractice();
        document.querySelector(`[data-record="${id}"]`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      }
      return;
    }
    if (!event.target.closest('#item-menu')) hideMenu();
    const nav = event.target.closest('[data-view]');
    if (nav) { if (nav.dataset.view === 'docs') location.hash = 'docs'; switchView(nav.dataset.view); return; }
    const day = event.target.closest('[data-date]');
    if (day) { selectDate(day.dataset.date); return; }
    const open = event.target.closest('[data-open]');
    if (open) {
      if (open.dataset.open === 'task') openTask(null);
      if (open.dataset.open === 'practice') openRecord(null);
      if (open.dataset.open === 'plan') openPlan(null);
      return;
    }
    const close = event.target.closest('[data-close]');
    if (close) { closeModal(close.closest('.modal-backdrop').id); return; }
    if (event.target.classList.contains('modal-backdrop')) { closeModal(event.target.id); return; }
    const docButton = event.target.closest('[data-doc]');
    if (docButton) chooseDoc(docButton.dataset.doc).catch(report);
  });
  $('study-app').addEventListener('change', event => {
    if (!event.target.matches('[data-task]')) return;
    const task = data.tasks.find(item => item.id === event.target.dataset.task);
    if (!task) return;
    const done = event.target.checked;
    mutate(async () => {
      await checked(db.from('study_tasks').update({ completed_at: done ? new Date().toISOString() : null }).eq('id', task.id).eq('owner_id', owner.id).select('id').single());
      task.done = done; render();
    }, done ? '任务已完成' : '任务已恢复为待完成').then(ok => { if (!ok) event.target.checked = task.done; });
  });
  $('prev-month').addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); renderCalendar(); });
  $('next-month').addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); renderCalendar(); });
  $('go-today').addEventListener('click', () => selectDate(today));
  $('practice-search').addEventListener('input', renderPractice);
  $('practice-filter').addEventListener('change', renderPractice);

  $('plan-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = form.elements.namedItem('name').value.trim();
    if (!name) return;
    const id = form.dataset.editId;
    if (data.plans.some(plan => plan.id !== id && plan.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { toast('计划名称已存在'); return; }
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
    mutate(async () => {
      if (id) await checked(db.from('study_plans').update({ name }).eq('id', id).eq('owner_id', owner.id).select('id').single());
      else await checked(db.from('study_plans').insert({ owner_id: owner.id, name }).select('id').single());
      closeModal('plan-modal'); await loadAll();
    }, id ? '计划已修改' : '计划已创建').finally(() => { button.disabled = false; });
  });
  $('task-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const title = form.elements.namedItem('title').value.trim();
    const date = form.elements.namedItem('date').value;
    if (!title || !date) return;
    const id = form.dataset.editId;
    const fields = { title, scheduled_on: date, plan_id: form.elements.namedItem('plan').value || null };
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
    mutate(async () => {
      if (id) await checked(db.from('study_tasks').update(fields).eq('id', id).eq('owner_id', owner.id).select('id').single());
      else await checked(db.from('study_tasks').insert({ ...fields, owner_id: owner.id }).select('id').single());
      closeModal('task-modal'); selected = date; month = new Date(Number(date.slice(0,4)), Number(date.slice(5,7))-1, 1); await loadAll();
    }, id ? '任务已修改' : '任务已添加').finally(() => { button.disabled = false; });
  });
  $('practice-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const title = form.elements.namedItem('title').value.trim();
    const rawUrl = form.elements.namedItem('url').value.trim();
    const url = rawUrl ? problemUrl(rawUrl) : '';
    if (rawUrl && !url) { toast('题目链接请使用 leetcode.cn 或 leetcode.com 的 HTTPS 地址'); return; }
    const date = form.elements.namedItem('date').value;
    if (!title || !date) return;
    const id = form.dataset.editId;
    const fields = { title, url, studied_on: date, topic: form.elements.namedItem('topic').value.trim(), status: form.elements.namedItem('status').value, solution_md: form.elements.namedItem('solution').value };
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
    mutate(async () => {
      if (id) await checked(db.from('leetcode_records').update(fields).eq('id', id).eq('owner_id', owner.id).select('id').single());
      else await checked(db.from('leetcode_records').insert({ ...fields, owner_id: owner.id }).select('id').single());
      $('practice-search').value = ''; $('practice-filter').value = 'all'; closeModal('practice-modal');
      selected = date; month = new Date(Number(date.slice(0,4)), Number(date.slice(5,7))-1, 1); await loadAll();
    }, id ? '题目记录已修改' : '题目已记录').finally(() => { button.disabled = false; });
  });
  $('confirm-delete').addEventListener('click', () => {
    const action = pendingDelete;
    closeModal('confirm-modal');
    if (action) mutate(action);
  });
  $('new-doc').addEventListener('click', () => mutate(async () => {
    await flushDoc();
    const row = await checked(db.from('drafts').insert({ owner_id: owner.id, kind: 'article', title: '未命名草稿', body: markdownBody('') }).select('id,title,body,updated_at').single());
    data.docs.unshift({ id: row.id, title: row.title, body: '', updated_at: row.updated_at });
    activeDoc = row.id; renderDocs(); $('doc-body').focus();
  }, '文档已创建'));
  $('doc-body').addEventListener('input', event => {
    const doc = data.docs.find(item => item.id === activeDoc);
    if (!doc) return;
    doc.body = event.target.value; markDirty();
  });
  $('doc-title').addEventListener('input', event => {
    const doc = data.docs.find(item => item.id === activeDoc);
    if (!doc) return;
    doc.title = event.target.value; markDirty();
    const label = $('docs-list').querySelector('.active .doc-select');
    if (label) label.textContent = doc.title.trim() || '未命名文档';
  });
  $('download-doc').addEventListener('click', () => mutate(async () => {
    await flushDoc();
    const doc = data.docs.find(item => item.id === activeDoc);
    if (!doc) return;
    const filename = (doc.title.trim() || '未命名文档').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') + '.md';
    const url = URL.createObjectURL(new Blob([doc.body], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  $('study-app').addEventListener('keydown', event => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const item = event.target.closest('[data-menu-kind]');
      if (item) { event.preventDefault(); const box = item.getBoundingClientRect(); showMenu(item, box.left + 12, box.top + 12); }
    }
    if (event.key === 'Escape') { hideMenu(); document.querySelectorAll('#study-app .modal-backdrop:not([hidden])').forEach(modal => closeModal(modal.id)); }
  });
  document.addEventListener('click', event => { if (!event.target.closest('#study-app')) hideMenu(); });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  initialize();
})();

