(function registerReleasesModule(global) {
  'use strict';

  const state = {
    context: null,
    releases: new Map(),
    tasksByRelease: new Map(),
    checksByRelease: new Map(),
    projects: new Map(),
    editingReleaseId: '',
    statusFilter: 'active',
    platformFilter: 'all',
    keyword: '',
  };

  function statusText(status) {
    return ({
      planned: '计划中',
      active: '当前活动',
      released: '已发布',
      archived: '已归档',
    })[status] || status || '未知状态';
  }

  function platformText(platform) {
    return ({
      android: 'APP',
      ios: 'APP',
      both: 'APP',
      app: 'APP',
      pad: 'Pad',
      pc: 'PC',
      mobile_all: 'APP + Pad',
      app_pad: 'APP + Pad',
    })[platform] || platform || '未指定';
  }

  function platformMatches(platform, selected) {
    if (selected === 'all') return true;
    if (platform === selected) return true;
    if (selected === 'app') return ['android', 'ios', 'both', 'app', 'mobile_all', 'app_pad'].includes(platform);
    if (selected === 'pad') return ['pad', 'mobile_all', 'app_pad'].includes(platform);
    return selected === 'pc' && platform === 'pc';
  }

  function editablePlatform(platform) {
    if (['android', 'ios', 'both'].includes(platform)) return 'app';
    if (platform === 'mobile_all') return 'app_pad';
    return platform || 'app';
  }

  function releaseModalHtml() {
    return `<div class="dashboard-modal releases-module-modal" id="releaseEditorModal">
      <div class="dashboard-modal-panel releases-module-editor">
        <div class="dashboard-modal-hd">
          <div class="dashboard-modal-title" id="releaseEditorTitle">新建版本</div>
          <button class="dashboard-modal-close" type="button" data-release-close><i class="ti ti-x"></i></button>
        </div>
        <div class="dashboard-form-grid">
          <div class="form-group"><label class="form-label">所属项目 *</label><select class="form-select" id="releaseProject" required><option value="">请选择所属项目</option></select></div>
          <div class="form-group"><label class="form-label">版本号 *</label><input class="dashboard-input" id="releaseVersion" maxlength="80" placeholder="例如 2.5.705"></div>
          <div class="form-group"><label class="form-label">版本名称</label><input class="dashboard-input" id="releaseName" maxlength="160" placeholder="例如 证件照功能重构"></div>
          <div class="form-group"><label class="form-label">产品端</label><select class="form-select" id="releasePlatform"><option value="app">APP</option><option value="pad">Pad</option><option value="pc">PC</option><option value="app_pad">APP + Pad</option></select><div class="assignee-allocation-note">APP、Pad、PC 可分别设置一个当前版本。</div></div>
          <div class="form-group"><label class="form-label">计划发布日期</label><input class="dashboard-input" id="releaseDate" type="date"></div>
        </div>
        <div class="form-group releases-module-notes"><label class="form-label">备注</label><textarea class="dashboard-input" id="releaseNotes" rows="3" maxlength="1000" placeholder="填写版本范围、主要改动或发布说明"></textarea></div>
        <div class="releases-module-editor-actions"><button class="btn-secondary" type="button" data-release-close>取消</button><button class="btn-primary" type="button" id="saveReleaseBtn" data-release-save>保存版本</button></div>
      </div>
    </div>`;
  }

  function projectOptions(selectedProjectId = '') {
    const context = state.context;
    const visible = [...state.projects.values()].filter(project =>
      project.status !== 'archived' || project.id === selectedProjectId);
    const groups = [
      ['xiaomi', '小米'],
      ['consumer', '消费'],
      ['other', 'Other'],
    ].map(([unit, label]) => {
      const options = visible
        .filter(project => project.business_unit === unit)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'))
        .map(project => `<option value="${project.id}" data-business-unit="${unit}" ${project.id === selectedProjectId ? 'selected' : ''}>${context.escapeHtml(project.name)}${project.status === 'archived' ? '（已归档）' : ''}</option>`)
        .join('');
      return options ? `<optgroup label="${label}">${options}</optgroup>` : '';
    }).join('');
    return `<option value="">请选择所属项目</option>${groups}`;
  }

  function readiness(release, tasks, checks) {
    const done = tasks.filter(task => task.status === 'done').length;
    const blocked = tasks.filter(task => task.status === 'blocked').length;
    const failed = checks.filter(check => ['failed', 'unavailable'].includes(check.status)).length;
    const passed = checks.filter(check => ['passed', 'waived'].includes(check.status)).length;
    const ready = tasks.length > 0 && done === tasks.length
      && checks.length > 0 && failed === 0 && passed === checks.length;
    const danger = blocked > 0 || checks.some(check =>
      check.severity === 'high' && ['failed', 'unavailable'].includes(check.status));
    return {
      done,
      blocked,
      failed,
      ready,
      className: ready ? 'release-ready' : danger ? 'release-danger' : 'release-warning',
      text: release.status === 'released' ? '已发布' : ready ? '可发布' : danger ? '存在阻塞' : '准备中',
    };
  }

  function taskListHtml(tasks) {
    const context = state.context;
    if (!tasks.length) return '<div class="empty releases-module-empty">暂无关联工作事项</div>';
    return tasks.map(task => `<div class="release-check-row releases-module-task-row">
      <span>${context.escapeHtml(task.title)}${context.taskDelayBadgeHtml(task)}</span>
      <span>${context.escapeHtml(context.taskStatusText(task.status))}</span>
      <span>${task.allocation_end_date || task.due_date ? context.escapeHtml(task.allocation_end_date || task.due_date.slice(0, 10)) : '-'}</span>
      <button class="risk-action" type="button" data-release-task="${task.id}">查看</button>
    </div>`).join('');
  }

  function checkListHtml(releaseId, checks) {
    const context = state.context;
    const canManage = context.canManageQa();
    const rows = checks.length ? checks.map(check => `<div class="release-check-row releases-module-check-row">
      <span>${context.escapeHtml(check.check_name)}</span>
      <span>${check.severity === 'high' ? '高' : check.severity === 'medium' ? '中' : '低'}风险</span>
      <select class="dashboard-filter" data-release-check="${check.id}" ${canManage ? '' : 'disabled'}>
        <option value="pending" ${check.status === 'pending' ? 'selected' : ''}>待检查</option>
        <option value="passed" ${check.status === 'passed' ? 'selected' : ''}>通过</option>
        <option value="failed" ${check.status === 'failed' ? 'selected' : ''}>失败</option>
        <option value="waived" ${check.status === 'waived' ? 'selected' : ''}>豁免</option>
        <option value="unavailable" ${check.status === 'unavailable' ? 'selected' : ''}>不可用</option>
      </select>
      <span>${check.source_type === 'manual' ? '手工' : context.escapeHtml(check.source_type)}</span>
    </div>`).join('') : '<div class="empty releases-module-empty">尚未添加发布检查项</div>';
    const form = canManage ? `<div class="release-check-form">
      <input class="dashboard-input" id="releaseCheckName-${releaseId}" placeholder="新增检查项，例如：P0 用例全部通过">
      <select class="dashboard-filter" id="releaseCheckSeverity-${releaseId}"><option value="high">高风险</option><option value="medium" selected>中风险</option><option value="low">低风险</option></select>
      <button class="btn-secondary" type="button" data-release-check-add="${releaseId}">添加</button>
    </div>` : '';
    return rows + form;
  }

  function cardHtml(release) {
    const context = state.context;
    const tasks = state.tasksByRelease.get(release.id) || [];
    const checks = state.checksByRelease.get(release.id) || [];
    const stats = readiness(release, tasks, checks);
    const project = state.projects.get(release.project_id);
    const actions = context.canManageQa() ? `<div class="releases-module-actions">
      <button class="btn-secondary" type="button" data-release-edit="${release.id}">编辑</button>
      ${release.status === 'planned' ? `<button class="btn-primary" type="button" data-release-status="active" data-release-id="${release.id}">设为当前版本</button>` : ''}
      ${release.status === 'active' ? `<button class="btn-primary" type="button" data-release-status="released" data-release-id="${release.id}">标记已发布</button>` : ''}
      ${!['released', 'archived'].includes(release.status) ? `<button class="btn-secondary" type="button" data-release-status="archived" data-release-id="${release.id}">归档</button>` : ''}
    </div>` : '';
    return `<article class="release-card ${release.status === 'active' ? 'active' : ''}" data-release-card data-status="${release.status}" data-platform="${release.platform}" data-search="${context.escapeHtml(`${release.version || ''} ${release.name || ''} ${project?.name || ''}`.toLowerCase())}">
      <div class="release-card-hd"><div><h3>${context.escapeHtml(release.name || release.version)}</h3><div class="release-meta">${context.escapeHtml(project?.name || '未归属项目')} · ${context.escapeHtml(release.version)} · ${platformText(release.platform)} · ${statusText(release.status)}${release.planned_release_date ? ` · ${release.planned_release_date}` : ''}</div></div><span class="release-readiness ${stats.className}">${stats.text}</span></div>
      <div class="release-stats">
        <div class="release-stat"><strong>${tasks.length}</strong><span>关联事项</span></div>
        <div class="release-stat"><strong>${stats.done}</strong><span>已完成</span></div>
        <div class="release-stat"><strong>${stats.blocked}</strong><span>已阻塞</span></div>
        <div class="release-stat"><strong>${stats.failed}</strong><span>检查失败</span></div>
      </div>
      ${release.notes ? `<div class="release-meta releases-module-description">${context.escapeHtml(release.notes)}</div>` : ''}
      ${actions}
      <details class="member-daily-details"><summary>关联事项（${tasks.length}）</summary>${taskListHtml(tasks)}</details>
      <details class="member-daily-details"><summary>发布检查（${checks.length}）</summary>${checkListHtml(release.id, checks)}</details>
    </article>`;
  }

  function filterCards() {
    const root = state.context?.content;
    if (!root) return;
    const keyword = state.keyword.trim().toLowerCase();
    let visible = 0;
    root.querySelectorAll('[data-release-card]').forEach(card => {
      const statusMatches = state.statusFilter === 'all'
        ? true
        : state.statusFilter === 'active'
          ? ['planned', 'active'].includes(card.dataset.status)
          : card.dataset.status === state.statusFilter;
      const matches = statusMatches
        && platformMatches(card.dataset.platform, state.platformFilter)
        && (!keyword || card.dataset.search.includes(keyword));
      card.hidden = !matches;
      if (matches) visible += 1;
    });
    const empty = root.querySelector('[data-release-filter-empty]');
    if (empty) empty.hidden = visible > 0;
    const count = root.querySelector('[data-release-visible-count]');
    if (count) count.textContent = `${visible} 个版本`;
  }

  function bindActions() {
    const root = state.context.content;
    root.querySelector('[data-release-new]')?.addEventListener('click', () => openEditor());
    root.querySelectorAll('[data-release-edit]').forEach(button =>
      button.addEventListener('click', () => openEditor(button.dataset.releaseEdit)));
    root.querySelectorAll('[data-release-close]').forEach(button =>
      button.addEventListener('click', closeEditor));
    root.querySelector('[data-release-save]')?.addEventListener('click', saveRelease);
    root.querySelectorAll('[data-release-status]').forEach(button =>
      button.addEventListener('click', () => transitionRelease(button.dataset.releaseId, button.dataset.releaseStatus)));
    root.querySelectorAll('[data-release-task]').forEach(button =>
      button.addEventListener('click', () => state.context.openTask(button.dataset.releaseTask, 'edit')));
    root.querySelectorAll('[data-release-check]').forEach(select =>
      select.addEventListener('change', () => updateReleaseCheck(select.dataset.releaseCheck, select.value)));
    root.querySelectorAll('[data-release-check-add]').forEach(button =>
      button.addEventListener('click', () => addReleaseCheck(button.dataset.releaseCheckAdd)));
    root.querySelector('[data-release-keyword]')?.addEventListener('input', event => {
      state.keyword = event.target.value;
      filterCards();
    });
    root.querySelector('[data-release-status-filter]')?.addEventListener('change', event => {
      state.statusFilter = event.target.value;
      filterCards();
    });
    root.querySelector('[data-release-platform-filter]')?.addEventListener('change', event => {
      state.platformFilter = event.target.value;
      filterCards();
    });
    root.querySelector('[data-release-clear-filters]')?.addEventListener('click', () => {
      state.keyword = '';
      state.statusFilter = 'active';
      state.platformFilter = 'all';
      root.querySelector('[data-release-keyword]').value = '';
      root.querySelector('[data-release-status-filter]').value = 'active';
      root.querySelector('[data-release-platform-filter]').value = 'all';
      filterCards();
    });
  }

  async function openEditor(id = '') {
    if (!state.context.canManageQa()) return;
    const release = id ? state.releases.get(id) : null;
    state.editingReleaseId = id;
    const root = state.context.content;
    root.querySelector('#releaseEditorTitle').textContent = release ? '编辑版本' : '新建版本';
    root.querySelector('#releaseProject').innerHTML = projectOptions(release?.project_id || '');
    root.querySelector('#releaseVersion').value = release?.version || '';
    root.querySelector('#releaseName').value = release?.name || '';
    root.querySelector('#releasePlatform').value = editablePlatform(release?.platform);
    root.querySelector('#releaseDate').value = release?.planned_release_date || '';
    root.querySelector('#releaseNotes').value = release?.notes || '';
    root.querySelector('#releaseEditorModal').classList.add('open');
    setTimeout(() => root.querySelector('#releaseVersion')?.focus(), 0);
  }

  function closeEditor() {
    state.context?.content.querySelector('#releaseEditorModal')?.classList.remove('open');
    state.editingReleaseId = '';
  }

  async function saveRelease() {
    const context = state.context;
    if (!context.canManageQa()) return;
    const root = context.content;
    const version = root.querySelector('#releaseVersion').value.trim();
    const projectSelect = root.querySelector('#releaseProject');
    const projectId = projectSelect.value;
    if (!version) {
      context.showToast('请填写版本号', 'error');
      return;
    }
    if (!projectId) {
      context.showToast('请选择所属项目', 'error');
      return;
    }
    const editing = Boolean(state.editingReleaseId);
    const button = root.querySelector('#saveReleaseBtn');
    button.disabled = true;
    try {
      const payload = {
        version,
        name: root.querySelector('#releaseName').value.trim() || null,
        platform: root.querySelector('#releasePlatform').value || 'app',
        planned_release_date: root.querySelector('#releaseDate').value || null,
        notes: root.querySelector('#releaseNotes').value.trim() || null,
        project_id: projectId,
        owner_id: context.currentUser.id,
      };
      const result = state.editingReleaseId
        ? await context.sb.from('releases').update(payload).eq('id', state.editingReleaseId).select('id').maybeSingle()
        : await context.sb.from('releases').insert({ ...payload, created_by: context.currentUser.id }).select('id').single();
      if (result.error) throw result.error;
      const unit = projectSelect.selectedOptions[0]?.dataset.businessUnit;
      if (['xiaomi', 'consumer', 'other'].includes(unit)) context.setBusinessUnit(unit);
      closeEditor();
      context.showToast(editing ? '版本已更新' : '版本已创建');
      context.rerender();
    } catch (error) {
      context.showToast(`保存版本失败：${error.message}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function transitionRelease(id, status) {
    const context = state.context;
    const release = state.releases.get(id);
    if (!context.canManageQa() || !release) return;
    if (status === 'released') {
      const tasks = state.tasksByRelease.get(id) || [];
      const checks = state.checksByRelease.get(id) || [];
      const blockingTask = tasks.some(task => ['todo', 'in_progress', 'blocked'].includes(task.status));
      const blockingCheck = checks.some(check =>
        check.severity === 'high' && ['pending', 'failed', 'unavailable'].includes(check.status));
      if (blockingTask || blockingCheck) {
        context.showToast('仍有未完成事项或高风险检查项，暂不能标记已发布', 'error');
        return;
      }
    }
    try {
      const { error } = await context.sb.rpc('transition_release_status', {
        target_release_id: id,
        target_status: status,
      });
      if (error) throw error;
      context.showToast(`版本已更新为${statusText(status)}`);
      context.rerender();
    } catch (error) {
      context.showToast(`版本状态更新失败：${error.message}`, 'error');
    }
  }

  async function addReleaseCheck(releaseId) {
    const context = state.context;
    if (!context.canManageQa()) return;
    const root = context.content;
    const name = root.querySelector(`#releaseCheckName-${releaseId}`)?.value.trim();
    const severity = root.querySelector(`#releaseCheckSeverity-${releaseId}`)?.value || 'medium';
    if (!name) {
      context.showToast('请填写检查项名称', 'error');
      return;
    }
    try {
      const { error } = await context.sb.from('release_checks').insert({
        release_id: releaseId,
        check_key: `manual_${Date.now()}`,
        check_name: name,
        category: 'manual',
        severity,
        status: 'pending',
        source_type: 'manual',
      });
      if (error) throw error;
      context.showToast('发布检查项已添加');
      context.rerender();
    } catch (error) {
      context.showToast(`添加检查项失败：${error.message}`, 'error');
    }
  }

  async function updateReleaseCheck(id, status) {
    const context = state.context;
    if (!context.canManageQa()) return;
    try {
      const { error } = await context.sb.from('release_checks').update({
        status,
        last_evaluated_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
      context.rerender();
    } catch (error) {
      context.showToast(`更新检查项失败：${error.message}`, 'error');
    }
  }

  async function render(context) {
    state.context = context;
    context.content.style.padding = '24px';
    context.content.innerHTML = '<div class="page-card releases-module"><div class="loading">正在加载版本发布信息…</div></div>';
    try {
      const [releaseResult, taskResult, checkResult, projectsResult] = await Promise.all([
        context.sb.from('releases').select('id,version,name,platform,products,status,project_id,owner_id,planned_release_date,notes,created_by,created_at,updated_at').order('created_at', { ascending: false }),
        context.sb.from('qa_tasks').select('id,release_id,title,status,due_date,allocation_end_date,allocation_end_period,completed_at,blocked_reason,delay_recorded_at,delay_waived_at,delay_waived_by,delay_waiver_reason').not('release_id', 'is', null),
        context.sb.from('release_checks').select('id,release_id,check_name,category,severity,status,source_type,last_evaluated_at').order('created_at', { ascending: true }),
        context.sb.from('qa_projects').select('id,name,business_unit,status'),
      ]);
      for (const result of [releaseResult, taskResult, checkResult, projectsResult]) {
        if (result.error) throw result.error;
      }
      state.projects = new Map((projectsResult.data || []).map(item => [item.id, item]));
      const releases = (releaseResult.data || []).filter(release => {
        const project = state.projects.get(release.project_id);
        return context.businessUnit === 'unassigned'
          ? !release.project_id
          : project?.status !== 'archived' && project?.business_unit === context.businessUnit;
      });
      state.releases = new Map(releases.map(item => [item.id, item]));
      state.tasksByRelease = new Map();
      (taskResult.data || []).forEach(task => {
        const values = state.tasksByRelease.get(task.release_id) || [];
        values.push(task);
        state.tasksByRelease.set(task.release_id, values);
      });
      state.checksByRelease = new Map();
      (checkResult.data || []).forEach(check => {
        const values = state.checksByRelease.get(check.release_id) || [];
        values.push(check);
        state.checksByRelease.set(check.release_id, values);
      });
      const unassigned = context.canManageQa()
        ? (releaseResult.data || []).filter(item => !item.project_id && item.status !== 'archived').length
        : 0;
      const cards = releases.map(cardHtml).join('');
      context.content.innerHTML = `<div class="page-card releases-module">
        <div class="card-hd"><div><div class="card-title">🚀 版本与发布</div><div class="card-sub">当前展示“${context.projectUnitText(context.businessUnit)}”项目的版本、事项和发布检查。</div></div><div class="releases-module-head-actions"><span class="card-tag" data-release-visible-count>${releases.length} 个版本</span>${context.canManageQa() ? '<button class="btn-primary" type="button" data-release-new><i class="ti ti-plus"></i> 新建版本</button>' : ''}</div></div>
        ${unassigned ? `<div class="project-data-warning"><strong>${unassigned} 个活动版本尚未归属项目</strong><span>请切换“待归属”并编辑版本完成项目归属。</span></div>` : ''}
        <div class="team-task-filters releases-module-filters">
          <input class="dashboard-filter" type="search" placeholder="搜索版本号、名称或项目" value="${context.escapeHtml(state.keyword)}" data-release-keyword>
          <select class="dashboard-filter" data-release-status-filter><option value="active" ${state.statusFilter === 'active' ? 'selected' : ''}>活动版本</option><option value="planned" ${state.statusFilter === 'planned' ? 'selected' : ''}>计划中</option><option value="released" ${state.statusFilter === 'released' ? 'selected' : ''}>已发布</option><option value="archived" ${state.statusFilter === 'archived' ? 'selected' : ''}>已归档</option><option value="all" ${state.statusFilter === 'all' ? 'selected' : ''}>全部状态</option></select>
          <select class="dashboard-filter" data-release-platform-filter><option value="all">全部产品端</option><option value="app" ${state.platformFilter === 'app' ? 'selected' : ''}>APP</option><option value="pad" ${state.platformFilter === 'pad' ? 'selected' : ''}>Pad</option><option value="pc" ${state.platformFilter === 'pc' ? 'selected' : ''}>PC</option></select>
          <button class="btn-secondary" type="button" data-release-clear-filters>清空筛选</button>
        </div>
        <div class="release-grid">${cards}</div>
        <div class="empty releases-module-filter-empty" data-release-filter-empty hidden>当前筛选条件下没有版本</div>
      </div>${releaseModalHtml()}`;
      bindActions();
      filterCards();
    } catch (error) {
      context.content.innerHTML = `<div class="page-card releases-module"><div class="empty">版本发布数据加载失败：${context.escapeHtml(error.message)}<br><small>请确认版本、项目和发布检查数据库迁移均已执行</small></div></div>`;
    }
  }

  function destroy() {
    state.context = null;
    state.editingReleaseId = '';
  }

  global.HanntoQA.registerModule({
    id: 'releases',
    title: '版本与发布',
    owner: 'QA Platform',
    version: '1.0.0',
    projectAware: true,
    permissions: ['admin', 'qa_lead', 'tester'],
    render,
    refresh: render,
    destroy,
    openEditor,
  });
})(window);
