(function registerTasksModule(global) {
  'use strict';

  const state = {
    context: null,
    renderRevision: 0,
    viewModel: null,
    expandedIds: new Set(),
    taskDetails: new Map(),
  };

  const TASK_FIELDS = [
    'id',
    'title',
    'description',
    'priority',
    'task_type',
    'status',
    'test_round',
    'assignee_id',
    'due_date',
    'release_id',
    'project_id',
    'portfolio_plan_id',
    'prd_id',
    'requirement_id',
    'blocked_reason',
    'blocked_owner_id',
    'blocked_until',
    'completion_note',
    'created_by',
    'created_at',
    'completed_at',
    'source',
    'related_type',
    'related_id',
    'external_id',
    'external_url',
    'effort_person_days',
    'allocation_start_date',
    'allocation_end_date',
    'allocation_start_period',
    'allocation_end_period',
    'testhub_library_id',
    'testhub_plan_id',
    'testhub_plan_ids',
    'testhub_effort_person_days',
    'testhub_scope_mode',
    'testhub_scope_suite_ids',
  ].join(',');

  async function loadWorkspaceData(context) {
    const taskQuery = context.sb.from('qa_tasks')
      .select(TASK_FIELDS)
      .order('created_at', { ascending: false })
      .limit(1000);
    const requests = {
      tasksResult: taskQuery,
      profilesResult: context.sb.from('profiles').select('id,name,resource_participant'),
      progressResult: context.sb.from('task_progress_logs')
        .select('id,task_id,work_date,progress_points,source,note,executor_id,reported_by,created_at')
        .order('work_date', { ascending: false }),
      testHubResult: context.sb.from('task_testhub_progress')
        .select('task_id,plan_id,plan_ids,total_cases,executed_cases,progress_ratio,status_counts,sync_status,sync_error,synced_at,scope_mode,scope_suite_ids,scope_suite_names'),
      assigneesResult: context.sb.from('qa_task_assignees').select('task_id,member_id,allocated_effort'),
      dailyResult: context.sb.from('task_testhub_daily_execution').select('*'),
      historyResult: context.sb.from('qa_task_allocation_history')
        .select('task_id,revision,total_effort,allocation_start_date,allocation_end_date,assignments,changed_by,changed_at')
        .order('changed_at', { ascending: false }),
      releasesResult: context.sb.from('releases').select('id,version,name,platform,status'),
      portfolioPlansResult: context.sb.from('project_monthly_plans').select('id,project_id,project_name'),
      activityResult: context.sb.from('qa_task_activity')
        .select('task_id,action,changed_fields,changed_by,created_at')
        .order('created_at', { ascending: false })
        .limit(1000),
      requirementsResult: context.sb.from('requirements').select('id,title'),
      prdsResult: context.sb.from('prds').select('id,title'),
      testHubSuitesResult: context.sb.from('testhub_plan_suite_cache')
        .select('library_id,plan_id,suite_id,suite_name,case_count,synced_at'),
      planCacheResult: context.isSystemAdmin()
        ? context.sb.from('testhub_plan_cache').select('plan_id,name,status,state_name,synced_at')
        : Promise.resolve({ data: [], error: null }),
      qaProjectsResult: context.sb.from('qa_projects').select('id,business_unit,status'),
    };
    const keys = Object.keys(requests);
    const values = await Promise.all(Object.values(requests));
    const workspaceData = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
    const failedEntry = Object.entries(workspaceData).find(([, result]) => result?.error);
    if (failedEntry) {
      const [name, result] = failedEntry;
      const error = result.error instanceof Error
        ? result.error
        : new Error(result.error?.message || `${name} 查询失败`);
      error.taskDataSource = name;
      throw error;
    }
    return workspaceData;
  }

  function groupTaskAssignees(rows) {
    const grouped = new Map();
    for (const item of rows || []) {
      const assignments = grouped.get(item.task_id) || [];
      assignments.push(item);
      grouped.set(item.task_id, assignments);
    }
    return grouped;
  }

  function taskAssignments(task, groupedAssignees) {
    const assignments = groupedAssignees.get(task.id) || [];
    if (assignments.length) return assignments;
    return [{
      task_id: task.id,
      member_id: task.assignee_id,
      allocated_effort: Number(task.effort_person_days) || 0,
    }];
  }

  function buildWorkspaceViewModel(context, workspaceData) {
    const profiles = workspaceData.profilesResult.data || [];
    const tasks = workspaceData.tasksResult.data || [];
    const portfolioPlans = workspaceData.portfolioPlansResult.data || [];
    const projects = workspaceData.qaProjectsResult.data || [];
    const groupedAssignees = groupTaskAssignees(workspaceData.assigneesResult.data);
    const projectById = new Map(projects.map(project => [project.id, project]));
    const portfolioPlanById = new Map(portfolioPlans.map(plan => [plan.id, plan]));
    const unitTasks = tasks.filter(task => {
      const plan = portfolioPlanById.get(task.portfolio_plan_id);
      const project = projectById.get(task.project_id || plan?.project_id);
      if (project) {
        return project.status !== 'archived'
          && project.business_unit === context.businessUnit;
      }
      return context.businessUnit === 'unassigned';
    });
    const visibleTasks = context.canViewTeamTasks()
      ? unitTasks
      : unitTasks.filter(task => taskAssignments(task, groupedAssignees)
        .some(item => item.member_id === context.currentUser?.id));
    const todayKey = context.todayKey();
    const activeStatuses = new Set(['todo', 'in_progress', 'blocked']);
    const taskCounts = {
      active: visibleTasks.filter(task => activeStatuses.has(task.status)).length,
      todo: visibleTasks.filter(task => task.status === 'todo').length,
      in_progress: visibleTasks.filter(task => task.status === 'in_progress').length,
      blocked: visibleTasks.filter(task => task.status === 'blocked').length,
      overdue: visibleTasks.filter(task => activeStatuses.has(task.status)
        && task.due_date
        && task.due_date.slice(0, 10) < todayKey).length,
      done: visibleTasks.filter(task => task.status === 'done').length,
      mine: visibleTasks.filter(task => taskAssignments(task, groupedAssignees)
        .some(item => item.member_id === context.currentUser?.id)).length,
      dueSoon: visibleTasks.filter(task => activeStatuses.has(task.status)
        && (task.allocation_end_date || '') >= todayKey
        && (task.allocation_end_date || '') <= context.addDate(todayKey, 3)).length,
    };

    return Object.freeze({
      profiles,
      resourceMembers: profiles.filter(context.isResourceParticipant),
      groupedAssignees,
      projectById,
      portfolioPlanById,
      unitTasks,
      visibleTasks,
      names: new Map(profiles.map(profile => [profile.id, profile.name || '未命名成员'])),
      releaseNames: new Map((workspaceData.releasesResult.data || [])
        .map(release => [
          release.id,
          `${release.name || release.version}${release.platform ? ` · ${release.platform}` : ''}`,
        ])),
      portfolioNames: new Map(portfolioPlans.map(plan => [plan.id, plan.project_name])),
      requirementNames: new Map((workspaceData.requirementsResult.data || [])
        .map(requirement => [requirement.id, requirement.title])),
      prdNames: new Map((workspaceData.prdsResult.data || [])
        .map(prd => [prd.id, prd.title])),
      testHubSuites: workspaceData.testHubSuitesResult.data || [],
      unassignedTaskCount: context.canManageQa()
        ? tasks.filter(task => !(task.project_id || portfolioPlanById.get(task.portfolio_plan_id)?.project_id)
          && !['done', 'cancelled'].includes(task.status)).length
        : 0,
      todayKey,
      taskCounts: Object.freeze(taskCounts),
    });
  }

  function viewStorageKey() {
    return `lieneqa:task-view:${state.context?.currentUser?.id || 'anonymous'}:${state.context?.businessUnit || 'other'}`;
  }

  function readFilters() {
    return {
      keyword: document.getElementById('teamTaskKeywordFilter')?.value || '',
      member: document.getElementById('teamTaskMemberFilter')?.value || 'all',
      status: document.getElementById('teamTaskStatusFilter')?.value || 'active',
      progressMode: document.getElementById('teamTaskProgressModeFilter')?.value || 'all',
      date: document.getElementById('teamTaskDateFilter')?.value || '',
    };
  }

  function saveViewState() {
    const payload = {
      ...readFilters(),
      expanded: [...state.expandedIds],
    };
    try {
      localStorage.setItem(viewStorageKey(), JSON.stringify(payload));
    } catch {}
  }

  function filterRows() {
    if (!state.context) return;
    const filters = readFilters();
    const keyword = filters.keyword.trim().toLowerCase();
    const today = state.context.todayKey();
    const soon = state.context.addDate(today, 3);
    let visible = 0;
    document.querySelectorAll('[data-team-task-row]').forEach(row => {
      const members = (row.dataset.members || '').split(',');
      const matchesDate = !filters.date
        || (!!row.dataset.start && !!row.dataset.end
          && row.dataset.start <= filters.date && row.dataset.end >= filters.date);
      const matches = (!keyword || (row.dataset.title || '').includes(keyword))
        && (filters.member === 'all' || members.includes(filters.member))
        && (filters.status === 'all'
          || (filters.status === 'active' ? ['todo', 'in_progress', 'blocked'].includes(row.dataset.status)
            : filters.status === 'mine' ? members.includes(state.context.currentUser?.id)
            : filters.status === 'overdue' ? row.dataset.overdue === 'true'
            : filters.status === 'due_soon'
              ? ['todo', 'in_progress', 'blocked'].includes(row.dataset.status)
                && row.dataset.end >= today && row.dataset.end <= soon
              : row.dataset.status === filters.status))
        && (filters.progressMode === 'all' || row.dataset.progressMode === filters.progressMode)
        && matchesDate;
      row.style.display = matches ? '' : 'none';
      if (matches) visible += 1;
    });
    const count = document.getElementById('teamTaskVisibleCount');
    if (count) count.textContent = `${visible} 项`;
    const empty = document.getElementById('teamTaskEmptyState');
    if (empty) empty.style.display = visible ? 'none' : 'block';
    document.querySelectorAll('[data-task-quick-view]').forEach(button => {
      button.classList.toggle('task-view-active', button.dataset.taskQuickView === filters.status);
    });
    saveViewState();
  }

  function restoreViewState() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(viewStorageKey()) || 'null');
    } catch {}
    if (!saved) return;
    const mappings = {
      teamTaskKeywordFilter: saved.keyword,
      teamTaskMemberFilter: saved.member,
      teamTaskStatusFilter: saved.status,
      teamTaskProgressModeFilter: saved.progressMode,
      teamTaskDateFilter: saved.date,
    };
    Object.entries(mappings).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element && [...(element.options || [])].some?.(option => option.value === value)) {
        element.value = value;
      } else if (element?.tagName === 'INPUT') {
        element.value = value || '';
      }
    });
    state.expandedIds = new Set(Array.isArray(saved.expanded) ? saved.expanded : []);
    document.querySelectorAll('[data-task-detail]').forEach(details => {
      details.open = state.expandedIds.has(details.dataset.taskDetail);
    });
  }

  function rememberExpansion(taskId, open) {
    if (open) state.expandedIds.add(taskId);
    else state.expandedIds.delete(taskId);
    saveViewState();
  }

  function clearFilters() {
    ['teamTaskKeywordFilter', 'teamTaskDateFilter'].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.value = '';
    });
    const defaults = {
      teamTaskMemberFilter: 'all',
      teamTaskStatusFilter: 'active',
      teamTaskProgressModeFilter: 'all',
    };
    Object.entries(defaults).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.value = value;
    });
    filterRows();
  }

  function resetFiltersForFocus(taskId) {
    const task = state.viewModel?.visibleTasks.find(item => item.id === taskId);
    const keyword = document.getElementById('teamTaskKeywordFilter');
    if (keyword) keyword.value = task?.title || '';
    const defaults = {
      teamTaskMemberFilter: 'all',
      teamTaskStatusFilter: 'all',
      teamTaskProgressModeFilter: 'all',
      teamTaskDateFilter: '',
    };
    Object.entries(defaults).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.value = value;
    });
    filterRows();
  }

  function applyQuickFilter(status) {
    const select = document.getElementById('teamTaskStatusFilter');
    if (select) select.value = status;
    filterRows();
  }

  function selectedBatchTaskIds() {
    return [...document.querySelectorAll('.task-batch-checkbox:checked')]
      .map(input => input.value);
  }

  function updateBatchSelection() {
    const selected = selectedBatchTaskIds().length;
    const count = document.getElementById('taskBatchCount');
    if (count) count.textContent = `已选 ${selected} 项`;
    document.getElementById('taskBatchToolbar')?.classList.toggle('visible', selected > 0);
  }

  function toggleAllVisible(checked) {
    document.querySelectorAll('[data-team-task-row]').forEach(row => {
      const checkbox = row.querySelector('.task-batch-checkbox');
      if (checkbox && row.style.display !== 'none') checkbox.checked = checked;
    });
    updateBatchSelection();
  }

  function focusAfterRefresh(taskId) {
    if (!taskId) return;
    const row = document.querySelector(`[data-team-task-row][data-task-id="${taskId}"]`);
    if (!row) return;
    resetFiltersForFocus(taskId);
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.style.transition = 'box-shadow .2s ease, background .2s ease';
    row.style.boxShadow = '0 0 0 3px rgba(108,53,220,.28)';
    row.style.background = '#faf7ff';
    setTimeout(() => {
      if (!row.isConnected) return;
      row.style.boxShadow = '';
      row.style.background = '';
    }, 3500);
  }

  function taskSummaryHtml() {
    const counts = state.viewModel?.taskCounts || {};
    return `<div class="task-summary-chips">
      <button class="task-summary-chip" data-task-quick-view="mine" onclick="applyTaskQuickFilter('mine')">我的事项<strong>${counts.mine || 0}</strong></button>
      <button class="task-summary-chip" data-task-quick-view="active" onclick="applyTaskQuickFilter('active')">未完成<strong>${counts.active || 0}</strong></button>
      <button class="task-summary-chip" data-task-quick-view="in_progress" onclick="applyTaskQuickFilter('in_progress')">进行中<strong>${counts.in_progress || 0}</strong></button>
      <button class="task-summary-chip danger" data-task-quick-view="due_soon" onclick="applyTaskQuickFilter('due_soon')">即将截止<strong>${counts.dueSoon || 0}</strong></button>
      <button class="task-summary-chip danger" data-task-quick-view="overdue" onclick="applyTaskQuickFilter('overdue')">已逾期<strong>${counts.overdue || 0}</strong></button>
      <button class="task-summary-chip" data-task-quick-view="done" onclick="applyTaskQuickFilter('done')">已完成<strong>${counts.done || 0}</strong></button>
    </div>`;
  }

  function taskFiltersHtml() {
    const escapeHtml = state.context.escapeHtml;
    const memberFilter = state.context.canViewTeamTasks()
      ? `<select class="dashboard-filter" id="teamTaskMemberFilter" onchange="filterTeamTaskRows()">
          <option value="all">全部成员</option>
          ${(state.viewModel?.resourceMembers || []).map(profile => `<option value="${profile.id}">${escapeHtml(profile.name || '未命名成员')}</option>`).join('')}
        </select>`
      : '';
    return `<div class="team-task-filters">
      <input class="dashboard-filter" id="teamTaskKeywordFilter" type="search" placeholder="搜索任务" oninput="filterTeamTaskRows()">
      ${memberFilter}
      <select class="dashboard-filter" id="teamTaskStatusFilter" onchange="filterTeamTaskRows()">
        <option value="active" selected>未完成任务</option>
        <option value="mine">我的事项</option>
        <option value="due_soon">未来 3 天截止</option>
        <option value="todo">待处理</option>
        <option value="in_progress">进行中</option>
        <option value="blocked">已阻塞</option>
        <option value="overdue">已逾期</option>
        <option value="done">已完成</option>
        <option value="cancelled">已取消</option>
        <option value="all">全部状态</option>
      </select>
      <select class="dashboard-filter" id="teamTaskProgressModeFilter" onchange="filterTeamTaskRows()">
        <option value="all">全部进度方式</option>
        <option value="auto">TestHub 自动</option>
        <option value="manual">手工填报</option>
      </select>
      <input class="dashboard-filter" id="teamTaskDateFilter" type="date" onchange="filterTeamTaskRows()" title="筛选该日期正在执行的任务">
      <button class="btn-secondary" type="button" onclick="clearTeamTaskFilters()">清空筛选</button>
    </div>`;
  }

  function taskDetailDrawerHtml() {
    return `<div class="task-drawer" id="taskDetailDrawer" onclick="closeTaskDetailDrawer()">
      <aside class="task-drawer-panel" onclick="event.stopPropagation()">
        <div class="task-drawer-head">
          <div>
            <div class="dashboard-modal-title" id="taskDetailTitle">事项详情</div>
            <div class="release-meta" id="taskDetailSubtitle"></div>
          </div>
          <button class="dashboard-modal-close" onclick="closeTaskDetailDrawer()"><i class="ti ti-x"></i></button>
        </div>
        <div class="task-drawer-body" id="taskDetailBody"></div>
      </aside>
    </div>`;
  }

  function taskStatusBadgeHtml(status) {
    const statuses = {
      todo: ['status-queued', '待处理'],
      in_progress: ['status-running', '进行中'],
      blocked: ['status-failed', '已阻塞'],
      done: ['status-done', '已完成'],
      cancelled: ['status-failed', '已取消'],
    };
    const [className, label] = statuses[status] || ['', status || '未知'];
    return `<span class="status-badge ${className}">${state.context.escapeHtml(label)}</span>`;
  }

  function renderTaskRowHtml(row) {
    const escapeHtml = state.context.escapeHtml;
    const id = escapeHtml(row.id);
    const progressPercent = Number(row.progressPercent || 0);
    const progressMode = row.progressMode === 'auto' ? 'auto' : 'manual';
    return `<tr data-team-task-row data-task-id="${id}" data-title="${escapeHtml(String(row.title || '').toLowerCase())}" data-members="${escapeHtml(row.memberIds || '')}" data-status="${escapeHtml(row.status || '')}" data-progress-mode="${progressMode}" data-overdue="${row.overdue ? 'true' : 'false'}" data-start="${escapeHtml(row.startDate || '')}" data-end="${escapeHtml(row.endDate || '')}">
      <td>${row.canEdit ? `<input type="checkbox" class="task-batch-checkbox" value="${id}" onchange="updateBatchTaskSelection()" aria-label="选择 ${escapeHtml(row.title)}">` : ''}</td>
      <td>
        <button class="task-title-button" onclick="openTaskDetailDrawer('${id}')">${escapeHtml(row.title)}</button>
        ${row.warningsHtml || ''}
        <div class="release-meta">第 ${Number(row.testRound || 1)} 轮${row.releaseName ? ` · ${escapeHtml(row.releaseName)}` : ''}${row.portfolioName ? ` · 项目 ${escapeHtml(row.portfolioName)}` : ''}</div>
      </td>
      <td><strong class="tasks-module-assignees">${escapeHtml((row.assigneeNames || []).join('、'))}</strong><div class="release-meta">${Number(row.assignmentCount || 0)} 位负责人</div></td>
      <td>${taskStatusBadgeHtml(row.status)}</td>
      <td class="task-list-progress">
        <strong>${progressPercent.toFixed(0)}%</strong>
        <div class="task-list-progress-track"><span class="task-list-progress-fill ${progressPercent >= 100 ? 'done' : ''}" style="width:${progressPercent.toFixed(1)}%"></span></div>
        <div class="release-meta">${Number(row.actualTotal || 0).toFixed(2)} / ${Number(row.taskEffort || 0).toFixed(2)} 点 · ${progressMode === 'auto' ? 'TestHub' : '手工'}</div>
      </td>
      <td><strong class="tasks-module-range">${escapeHtml(row.range || '-')}</strong><div class="release-meta">${row.overdue ? '已逾期' : escapeHtml(row.syncText || '')}</div></td>
      <td><div class="tasks-module-row-actions">
        <button class="btn-secondary" onclick="openTaskDetailDrawer('${id}')">详情</button>
        ${row.canUpdateStatus ? `<button class="btn-primary" onclick="openProgressModal('${id}')">${row.testHubPlanCount ? '更新状态' : '更新进度'}</button>` : ''}
      </div></td>
    </tr>`;
  }

  function taskDetailBodyHtml(detail) {
    const escapeHtml = state.context.escapeHtml;
    const progressPercent = Number(detail.progressPercent || 0);
    const progressMode = detail.progressMode === 'auto' ? 'auto' : 'manual';
    const relationship = [
      `第 ${Number(detail.testRound || 1)} 轮`,
      detail.range || '-',
      detail.releaseName ? `版本 ${detail.releaseName}` : '',
      detail.portfolioName ? `项目 ${detail.portfolioName}` : '',
    ].filter(Boolean).map(escapeHtml).join(' · ');
    const relatedAsset = detail.requirementName
      ? `<div class="assignee-allocation-note">验收范围：${escapeHtml(detail.requirementName)}</div>`
      : detail.prdName
        ? `<div class="assignee-allocation-note">PRD：${escapeHtml(detail.prdName)}</div>`
        : '';
    const blockedSection = detail.status === 'blocked' && detail.blockedReason
      ? `<div class="task-detail-section"><div class="task-detail-section-title">阻塞信息</div><div>${escapeHtml(detail.blockedReason)}${detail.blockedUntil ? ` · 预计 ${escapeHtml(detail.blockedUntil)} 解除` : ''}</div></div>`
      : '';
    const completionSection = detail.status === 'done' && detail.completionNote
      ? `<div class="task-detail-section"><div class="task-detail-section-title">完成说明</div><div>${escapeHtml(detail.completionNote)}</div></div>`
      : '';
    return `${detail.actionsHtml || ''}
      <div class="task-detail-section">
        <div class="task-detail-section-title">事项概览</div>
        ${detail.description ? `<div class="tasks-module-description">${escapeHtml(detail.description)}</div>` : '<div class="release-meta">未填写事项说明</div>'}
        <div class="assignee-allocation-note">${relationship}</div>
        ${relatedAsset}
        ${detail.warningsHtml || ''}
      </div>
      <div class="task-detail-section">
        <div class="task-detail-section-title">进度与 TestHub</div>
        <div class="tasks-module-progress-head"><strong>${progressPercent.toFixed(0)}%</strong><span class="progress-mode-badge ${progressMode}">${progressMode === 'auto' ? 'TestHub 自动' : '成员手工'}</span></div>
        <div class="task-list-progress-track"><span class="task-list-progress-fill ${progressPercent >= 100 ? 'done' : ''}" style="width:${progressPercent.toFixed(1)}%"></span></div>
        <div class="assignee-allocation-note">实际 ${Number(detail.actualTotal || 0).toFixed(2)} / ${Number(detail.taskEffort || 0).toFixed(2)} 点 · ${escapeHtml(detail.syncText || '')}<br>${escapeHtml(detail.points || '-')}${escapeHtml(detail.testHubText || '')}</div>
        ${detail.reconciliationHtml || ''}${detail.planSyncHtml || ''}
      </div>
      <div class="task-detail-section"><div class="task-detail-section-title">负责人进度</div>${detail.memberProgressHtml || ''}${detail.memberDailyHtml || ''}</div>
      ${blockedSection}
      ${completionSection}
      <div class="task-detail-section"><div class="task-detail-section-title">资源与变更记录</div>${detail.allocationHistoryHtml || ''}${detail.activityHtml || ''}</div>`;
  }

  function renderListPage(payload) {
    if (!state.context || !state.viewModel) return;
    const { memberSummary = '', rows = [], overlays = '', taskDetails = new Map() } = payload || {};
    state.taskDetails = taskDetails;
    const rowsHtml = Array.isArray(rows)
      ? rows.map(renderTaskRowHtml).join('')
      : String(rows || '');
    const canViewTeam = state.context.canViewTeamTasks();
    const unassignedTaskCount = state.viewModel.unassignedTaskCount;
    const adminActions = state.context.isSystemAdmin()
      ? `<button class="btn-secondary" onclick="copyLocalSyncAuthorization(this)">复制本地同步授权</button>
         <button class="btn-secondary" onclick="syncTestHubProgress(null, this)"><i class="ti ti-refresh"></i> 一键同步 TestHub</button>`
      : '';
    state.context.content.innerHTML = `
      ${memberSummary}
      <div class="history-card tasks-module-list">
        <div class="card-hd" style="margin-bottom:12px;">
          <span class="card-title">📋 ${canViewTeam ? '团队工作事项' : '我的工作事项'}</span>
          <div class="tasks-module-toolbar">
            ${adminActions}
            <span class="card-tag" id="teamTaskVisibleCount">${state.viewModel.visibleTasks.length} 项</span>
          </div>
        </div>
        ${unassignedTaskCount ? `<div class="feature-change-alert project-data-warning">
          <strong>${unassignedTaskCount} 个未完成事项尚未归属项目</strong>
          <div>当前暂归入 Other；请由 QA 负责人编辑事项并选择所属项目排期。</div>
        </div>` : ''}
        ${taskSummaryHtml()}
        ${taskFiltersHtml()}
        <div class="team-task-filters task-batch-floating" id="taskBatchToolbar">
          <strong id="taskBatchCount">已选 0 项</strong>
          <select class="dashboard-filter" id="taskBatchStatus">
            <option value="todo">改为待处理</option>
            <option value="in_progress">改为进行中</option>
            <option value="cancelled">改为已取消</option>
          </select>
          <button class="btn-secondary" onclick="batchUpdateTaskStatus()">批量更新状态</button>
          <input class="dashboard-filter" id="taskBatchDeadline" type="date">
          <button class="btn-secondary" onclick="batchUpdateTaskDeadline()">批量修改截止日</button>
        </div>
        <div class="tasks-module-table-wrap">
          <table class="history-table tasks-module-table">
            <thead><tr><th><input type="checkbox" onchange="toggleAllVisibleTasks(this.checked)" aria-label="全选当前可见事项"></th><th>事项</th><th>负责人</th><th>状态</th><th>进度</th><th>排期</th><th>操作</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="7" class="tasks-module-empty-row">暂无工作事项</td></tr>'}</tbody>
          </table>
        </div>
        <div class="dashboard-empty" id="teamTaskEmptyState">当前筛选条件下没有工作事项，请调整筛选条件</div>
      </div>
      ${overlays}
      ${taskDetailDrawerHtml()}`;
  }

  function openDetail(taskId) {
    const drawer = document.getElementById('taskDetailDrawer');
    const detail = state.taskDetails.get(taskId);
    if (!drawer || !detail) {
      state.context?.showToast('事项详情尚未加载，请刷新后重试', 'error');
      return;
    }
    document.getElementById('taskDetailTitle').textContent = detail.title;
    document.getElementById('taskDetailSubtitle').textContent = detail.subtitle;
    document.getElementById('taskDetailBody').innerHTML = taskDetailBodyHtml(detail);
    drawer.classList.add('open');
  }

  function closeDetail() {
    document.getElementById('taskDetailDrawer')?.classList.remove('open');
  }

  function renderError(error) {
    if (!state.context) return;
    const message = state.context.escapeHtml(error?.message || '未知错误');
    state.context.content.style.padding = '24px';
    state.context.content.innerHTML = `<section class="history-card tasks-module">
      <div class="tasks-module-error">
        <i class="ti ti-alert-triangle"></i>
        <div>
          <strong>工作事项加载失败</strong>
          <div class="release-meta">${message}</div>
        </div>
        <button class="btn-secondary" type="button" data-task-module-retry>重新加载</button>
      </div>
    </section>`;
    state.context.content
      .querySelector('[data-task-module-retry]')
      ?.addEventListener('click', () => render(state.context));
  }

  async function render(context) {
    state.context = context;
    const revision = ++state.renderRevision;
    context.content.dataset.activeModule = 'tasks';
    context.content.style.padding = '24px';
    context.content.innerHTML = '<div class="history-card tasks-module"><div class="dashboard-loading">正在加载工作事项…</div></div>';

    try {
      const workspaceData = await loadWorkspaceData(context);
      if (revision !== state.renderRevision) return;
      workspaceData.viewModel = buildWorkspaceViewModel(context, workspaceData);
      workspaceData.renderListPage = renderListPage;
      state.viewModel = workspaceData.viewModel;
      await context.renderTaskWorkspace(workspaceData);
      if (revision !== state.renderRevision) return;
      context.content.querySelector('.history-card')?.classList.add('tasks-module');
    } catch (error) {
      if (revision !== state.renderRevision) return;
      console.error('[tasks-module] render failed:', error);
      renderError(error);
    }
  }

  global.HanntoQA.registerModule({
    id: 'tasks',
    title: '工作事项',
    owner: 'Hannto QA',
    version: '1.0.0',
    projectAware: true,
    permissions: ['admin', 'qa_lead', 'tester'],
    render,
    refresh(context = state.context) {
      if (!context) return Promise.resolve();
      return render(context);
    },
    filterRows,
    saveViewState,
    restoreViewState,
    rememberExpansion,
    clearFilters,
    resetFiltersForFocus,
    applyQuickFilter,
    selectedBatchTaskIds,
    updateBatchSelection,
    toggleAllVisible,
    focusAfterRefresh,
    renderListPage,
    renderTaskRowHtml,
    taskDetailBodyHtml,
    openDetail,
    closeDetail,
    destroy() {
      state.renderRevision += 1;
      if (state.context?.content?.dataset?.activeModule === 'tasks') {
        delete state.context.content.dataset.activeModule;
      }
      state.context = null;
      state.viewModel = null;
      state.taskDetails = new Map();
    },
  });
})(window);
