(function registerProjectsModule(global) {
  'use strict';

  const state = {
    context: null,
    businessUnit: '',
    selectedProjectId: null,
    projects: new Map(),
    members: [],
    profiles: new Map(),
    editingProjectId: null,
    detailMonth: '',
    showArchived: false,
    detailTasks: new Map(),
    draggingTaskId: null,
    dragAnchorDate: '',
    suppressTaskClick: false,
    dataCache: null,
    dataCacheKey: '',
    dataCacheAt: 0,
  };

  const DATA_CACHE_TTL_MS = 5 * 60 * 1000;

  function invalidateDataCache() {
    state.dataCache = null;
    state.dataCacheKey = '';
    state.dataCacheAt = 0;
  }

  function statusText(status) {
    return ({
      planned: '筹备中',
      active: '进行中',
      paused: '已暂停',
      closed: '已结束',
      archived: '已归档',
    })[status] || '进行中';
  }

  function releaseStatusText(status) {
    return ({
      planned: '计划中',
      active: '当前活动',
      released: '已发布',
      archived: '已归档',
    })[status] || status || '未知状态';
  }

  function monthKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function shiftMonth(month, offset) {
    const [year, number] = String(month || monthKey()).split('-').map(Number);
    return monthKey(new Date(year, number - 1 + offset, 1));
  }

  function shiftDate(dateKey, offset) {
    const [year, month, day] = String(dateKey).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + offset));
    return date.toISOString().slice(0, 10);
  }

  function dateOffset(from, to) {
    const parse = value => {
      const [year, month, day] = String(value).split('-').map(Number);
      return Date.UTC(year, month - 1, day);
    };
    return Math.round((parse(to) - parse(from)) / 86400000);
  }

  function monthDays(month, calendarRows) {
    const [year, number] = String(month).split('-').map(Number);
    const calendar = new Map(calendarRows.map(item => [item.work_date, item]));
    const count = new Date(year, number, 0).getDate();
    return Array.from({ length: count }, (_, index) => {
      const day = index + 1;
      const date = new Date(year, number - 1, day);
      const key = `${year}-${String(number).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const override = calendar.get(key);
      const weekend = date.getDay() === 0 || date.getDay() === 6;
      return {
        key,
        day,
        weekday: ['日', '一', '二', '三', '四', '五', '六'][date.getDay()],
        isWorkday: override ? override.is_workday : !weekend,
        name: override?.name || '',
      };
    });
  }

  function taskSlotLabel(task, dateKey) {
    if (!task.allocation_start_date || !task.allocation_end_date
      || dateKey < task.allocation_start_date || dateKey > task.allocation_end_date) return '';
    const startsAfternoon = task.allocation_start_period === 'pm';
    const endsMorning = task.allocation_end_period === 'am';
    if (task.allocation_start_date === task.allocation_end_date) {
      if (startsAfternoon) return '下午';
      if (endsMorning) return '上午';
      return '全天';
    }
    if (dateKey === task.allocation_start_date && startsAfternoon) return '下午';
    if (dateKey === task.allocation_end_date && endsMorning) return '上午';
    return '全天';
  }

  function taskBarClass(status) {
    if (status === 'done' || status === 'completed') return 'completed';
    if (status === 'blocked') return 'blocked';
    if (status === 'todo') return 'todo';
    return '';
  }

  function editorModalHtml() {
    return `<div class="dashboard-modal projects-module-modal" id="qaProjectModal">
      <div class="dashboard-modal-panel projects-module-editor">
        <div class="dashboard-modal-hd">
          <div class="dashboard-modal-title" id="qaProjectModalTitle">新增项目</div>
          <button class="dashboard-modal-close" type="button" data-project-close><i class="ti ti-x"></i></button>
        </div>
        <div class="dashboard-form-grid">
          <div class="form-group"><label class="form-label">项目名称 *</label><input class="dashboard-input" id="qaProjectName" maxlength="120" placeholder="例如：米家照片打印"></div>
          <div class="form-group"><label class="form-label">所属分类 *</label><select class="form-select" id="qaProjectUnit"><option value="xiaomi">小米</option><option value="consumer">消费</option><option value="other">Other</option></select></div>
          <div class="form-group"><label class="form-label">生命周期</label><select class="form-select" id="qaProjectStatus"><option value="planned">筹备中</option><option value="active">进行中</option><option value="paused">已暂停</option><option value="closed">已结束</option><option value="archived">已归档</option></select></div>
          <div class="form-group"><label class="form-label">项目负责人</label><select class="form-select" id="qaProjectOwner"><option value="">暂不指定</option></select></div>
        </div>
        <div class="form-group projects-module-field"><label class="form-label">项目成员（决定测试工程师可见范围）</label><div id="qaProjectMemberChoices" class="feature-card-grid"></div></div>
        <div class="form-group projects-module-field"><label class="form-label">项目说明</label><textarea class="dashboard-input" id="qaProjectDescription" rows="3" maxlength="1000"></textarea></div>
        <div class="projects-module-editor-actions"><button class="btn-secondary" type="button" data-project-close>取消</button><button class="btn-primary" type="button" id="saveQaProjectBtn" data-project-save>保存项目</button></div>
      </div>
    </div>`;
  }

  function renderDetail(project, plans, tasks, assignees, calendarRows, releases, defects, snapshots, progressLogs) {
    const context = state.context;
    const escapeHtml = context.escapeHtml;
    state.detailMonth ||= monthKey();
    const memberships = state.members.filter(item => item.project_id === project.id);
    const memberNames = memberships.map(item => `${escapeHtml(state.profiles.get(item.member_id)?.name || '未命名成员')}${item.is_owner ? '（负责人）' : ''}`);
    const projectPlans = plans.filter(item => item.project_id === project.id);
    const planIds = new Set(projectPlans.map(item => item.id));
    const allProjectTasks = tasks.filter(item =>
      item.project_id === project.id || planIds.has(item.portfolio_plan_id));
    state.detailTasks = new Map(allProjectTasks.map(item => [item.id, item]));
    const taskIds = new Set(allProjectTasks.map(item => item.id));
    const projectReleases = releases.filter(item => item.project_id === project.id);
    const releaseIds = new Set(projectReleases.map(item => item.id));
    const projectDefects = defects.filter(item => taskIds.has(item.qa_task_id) || releaseIds.has(item.release_id));
    const openDefects = projectDefects.filter(item => !['closed', 'resolved', 'done'].includes(item.status)).length;
    const missedDefects = projectDefects.filter(item => item.is_missed_test).length;
    const blocked = allProjectTasks.filter(item => item.status === 'blocked').length;
    const todayKey = context.localDateKey(new Date());
    const overdue = allProjectTasks.filter(item => context.taskDelayState
      ? context.taskDelayState(item).delayed
      : ['todo', 'in_progress', 'blocked'].includes(item.status)
        && (item.allocation_end_date || '') < todayKey).length;
    const plannedPoints = allProjectTasks.reduce((sum, task) => sum + Number(task.effort_person_days || 0), 0);
    const snapshotsByTask = new Map(snapshots.map(item => [item.task_id, item]));
    const logsByTask = new Map();
    progressLogs.forEach(item => {
      const values = logsByTask.get(item.task_id) || [];
      values.push(item);
      logsByTask.set(item.task_id, values);
    });
    let testHubExecuted = 0;
    let testHubTotal = 0;
    const actualPoints = allProjectTasks.reduce((sum, task) => {
      const snapshot = snapshotsByTask.get(task.id);
      if (snapshot && Number(snapshot.total_cases || 0) > 0) {
        testHubExecuted += Number(snapshot.executed_cases || 0);
        testHubTotal += Number(snapshot.total_cases || 0);
        return sum + Number(task.effort_person_days || 0) * Math.min(1, Number(snapshot.executed_cases || 0) / Number(snapshot.total_cases || 1));
      }
      return sum + (logsByTask.get(task.id) || []).reduce((subtotal, log) => subtotal + Number(log.progress_points || 0), 0);
    }, 0);
    const days = monthDays(state.detailMonth, calendarRows);
    const monthStart = days[0]?.key || `${state.detailMonth}-01`;
    const monthEnd = days.at(-1)?.key || monthStart;
    const projectTasks = tasks.filter(item =>
      (item.project_id === project.id || planIds.has(item.portfolio_plan_id))
      && item.allocation_start_date
      && item.allocation_end_date
      && item.allocation_start_date <= monthEnd
      && item.allocation_end_date >= monthStart
    ).sort((a, b) =>
      String(a.allocation_start_date || '').localeCompare(String(b.allocation_start_date || ''))
      || String(a.title || '').localeCompare(String(b.title || '')));
    const assigneesByTask = new Map();
    assignees.forEach(item => {
      const values = assigneesByTask.get(item.task_id) || [];
      if (!values.includes(item.member_id)) values.push(item.member_id);
      assigneesByTask.set(item.task_id, values);
    });
    const today = todayKey;
    const template = `248px repeat(${days.length},42px)`;
    const header = `<div class="project-gantt-cell project-gantt-task project-gantt-head" style="grid-row:1;grid-column:1;">工作事项 / 负责人 / 排期</div>${days.map((day, dayIndex) => `<div class="project-gantt-cell project-gantt-head project-gantt-day ${day.isWorkday ? '' : 'weekend'} ${day.key === today ? 'project-gantt-today' : ''}" style="grid-row:1;grid-column:${dayIndex + 2};" title="${escapeHtml(day.name || (day.isWorkday ? '工作日' : '非工作日'))}">${String(day.day).padStart(2, '0')}<br>周${day.weekday}</div>`).join('')}`;
    const rows = projectTasks.length ? projectTasks.map((task, taskIndex) => {
      const ids = assigneesByTask.get(task.id) || (task.assignee_id ? [task.assignee_id] : []);
      const names = ids.map(id => state.profiles.get(id)?.name).filter(Boolean).join('、') || '未指定负责人';
      const row = taskIndex + 2;
      const visibleStart = task.allocation_start_date < monthStart ? monthStart : task.allocation_start_date;
      const visibleEnd = task.allocation_end_date > monthEnd ? monthEnd : task.allocation_end_date;
      const startIndex = Math.max(0, days.findIndex(day => day.key === visibleStart));
      const endIndex = Math.max(startIndex, days.findIndex(day => day.key === visibleEnd));
      const startsAfternoon = visibleStart === task.allocation_start_date && task.allocation_start_period === 'pm';
      const endsMorning = visibleEnd === task.allocation_end_date && task.allocation_end_period === 'am';
      const slots = days.map((day, dayIndex) => `<div class="project-gantt-cell project-gantt-slot ${day.isWorkday ? '' : 'weekend'} ${day.key === today ? 'project-gantt-today' : ''}" style="grid-row:${row};grid-column:${dayIndex + 2};" data-project-drop-date="${day.key}" data-project-workday="${day.isWorkday ? 'true' : 'false'}"></div>`).join('');
      const delayBadge = context.taskDelayBadgeHtml ? context.taskDelayBadgeHtml(task) : '';
      const movable = context.canManageQa();
      const durationText = `${task.allocation_start_date} ${context.taskAllocationPeriodText(task.allocation_start_period)} → ${task.allocation_end_date} ${context.taskAllocationPeriodText(task.allocation_end_period)}`;
      const barText = `${Number(task.effort_person_days || 0).toFixed(1)} 人天`;
      return `<div class="project-gantt-cell project-gantt-task" style="grid-row:${row};grid-column:1;"><button type="button" class="project-gantt-task-button" data-project-task-open="${task.id}"><strong>${escapeHtml(task.title || '未命名事项')}${delayBadge}</strong><span class="project-card-meta">${escapeHtml(names)} · 第 ${Number(task.test_round || 1)} 轮 · ${context.taskStatusText(task.status)}</span><span class="project-card-meta">${escapeHtml(durationText)}</span></button></div>${slots}<button type="button" class="project-gantt-continuous-bar ${taskBarClass(task.status)}" style="grid-row:${row};grid-column:${startIndex + 2} / ${endIndex + 3};--bar-start-inset:${startsAfternoon ? '50%' : '4px'};--bar-end-inset:${endsMorning ? '50%' : '4px'};" data-project-task-open="${task.id}" data-project-slot-date="${visibleStart}" ${movable ? 'draggable="true"' : ''} title="${escapeHtml(`${task.title} · ${durationText}${movable ? ' · 拖动可整体改期' : ' · 点击查看详情'}`)}"><span>${escapeHtml(barText)}</span></button>`;
    }).join('') : `<div class="project-gantt-cell project-gantt-task">本月暂无工作事项</div><div class="project-gantt-cell projects-module-empty-gantt" style="grid-column:span ${days.length};">可先在工作事项中关联该项目排期</div>`;
    const completed = allProjectTasks.filter(item => item.status === 'done' || item.status === 'completed').length;
    const completionRate = allProjectTasks.length ? Math.round(completed / allProjectTasks.length * 100) : 0;
    const executionRate = testHubTotal ? Math.round(testHubExecuted / testHubTotal * 100) : 0;
    const effortRate = plannedPoints ? Math.round(actualPoints / plannedPoints * 100) : 0;
    const activeReleases = projectReleases.filter(item => item.status === 'active');
    const riskCount = overdue + blocked + openDefects;
    return `<div class="projects-module project-detail-page">
      <section class="project-detail-hero">
        <div class="project-detail-heading">
          <button class="project-detail-back" type="button" data-project-back title="返回项目列表"><i class="ti ti-arrow-left"></i></button>
          <div class="project-detail-identity">
            <div class="project-detail-kicker"><span>${escapeHtml(context.projectUnitText(project.business_unit))}</span><span class="project-state ${escapeHtml(project.status || 'active')}">${escapeHtml(statusText(project.status))}</span></div>
            <h2>${escapeHtml(project.name)}</h2>
            <p><i class="ti ti-users"></i>${memberNames.join('、') || '尚未分配成员'}</p>
          </div>
        </div>
        <div class="project-detail-actions">
          <button class="btn-primary" type="button" data-project-task-new="${project.id}"><i class="ti ti-plus"></i> 新建事项</button>
          <button class="btn-secondary" type="button" data-project-refresh><i class="ti ti-refresh"></i> 刷新</button>
          ${context.canManageQa() ? `<button class="btn-primary" type="button" data-project-edit="${project.id}"><i class="ti ti-edit"></i> 编辑项目</button>` : ''}
        </div>
      </section>

      <section class="project-detail-metrics">
        <article class="${effortRate > 100 ? 'danger' : ''}">
          <span class="project-metric-icon pink"><i class="ti ti-chart-dots-3"></i></span>
          <div><small>计划 / 实际点数</small><strong>${plannedPoints.toFixed(1)} <em>/ ${actualPoints.toFixed(1)}</em></strong><p>${effortRate}% 投入</p></div>
          <i class="project-metric-progress"><b style="width:${Math.min(100, effortRate)}%"></b></i>
        </article>
        <article>
          <span class="project-metric-icon purple"><i class="ti ti-test-pipe"></i></span>
          <div><small>TestHub 执行率</small><strong>${testHubTotal ? `${executionRate}%` : '-'}</strong><p>${testHubExecuted}/${testHubTotal} Case</p></div>
          <i class="project-metric-progress"><b style="width:${executionRate}%"></b></i>
        </article>
        <article>
          <span class="project-metric-icon teal"><i class="ti ti-checkbox"></i></span>
          <div><small>事项完成</small><strong>${completed} <em>/ ${allProjectTasks.length}</em></strong><p>${completionRate}% 已交付</p></div>
          <i class="project-metric-progress"><b style="width:${completionRate}%"></b></i>
        </article>
        <article class="${riskCount ? 'warning' : ''}">
          <span class="project-metric-icon amber"><i class="ti ti-alert-triangle"></i></span>
          <div><small>待处理风险</small><strong>${riskCount}</strong><p>${overdue} 延期 · ${blocked} 阻塞 · ${openDefects} BUG</p></div>
        </article>
        <article>
          <span class="project-metric-icon blue"><i class="ti ti-rocket"></i></span>
          <div><small>当前版本</small><strong>${activeReleases.length}</strong><p>共 ${projectReleases.length} 个版本</p></div>
        </article>
        <article>
          <span class="project-metric-icon mint"><i class="ti ti-users-group"></i></span>
          <div><small>项目成员</small><strong>${memberships.length}</strong><p>${memberNames.length ? '已配置参与成员' : '等待分配成员'}</p></div>
        </article>
      </section>

      <section class="project-release-panel">
        <div class="project-section-heading"><div><span class="project-section-icon"><i class="ti ti-versions"></i></span><strong>版本状态</strong><small>项目 → 版本 → 工作事项自动关联</small></div><span>${projectReleases.length} 个版本</span></div>
        <div class="projects-module-release-strip">${projectReleases.length ? projectReleases.map(release => `<span class="${release.status === 'active' ? 'active' : ''}"><i class="ti ti-rocket"></i><strong>${escapeHtml(release.version || release.name || '未命名版本')}</strong><small>${escapeHtml(releaseStatusText(release.status))}</small></span>`).join('') : '<span class="empty"><i class="ti ti-link-off"></i>尚未关联版本</span>'}</div>
      </section>

      <section class="project-schedule-panel">
        <div class="project-schedule-head">
          <div><span class="project-section-icon"><i class="ti ti-calendar-stats"></i></span><strong>月度工作排期</strong><small>${projectTasks.length} 个事项覆盖 ${state.detailMonth}</small></div>
          <span class="project-gantt-hint">${context.canManageQa() ? '点击事项编辑，拖动可调整排期' : '点击事项查看详情'}</span>
        </div>
        <div class="project-detail-toolbar projects-module-toolbar">
          <div class="project-month-nav"><button class="btn-secondary" type="button" data-project-month-shift="-1" title="上个月"><i class="ti ti-chevron-left"></i></button><input class="dashboard-filter" type="month" value="${state.detailMonth}" data-project-month><button class="btn-secondary project-current-month" type="button" data-project-current-month>回到本月</button><button class="btn-secondary" type="button" data-project-month-shift="1" title="下个月"><i class="ti ti-chevron-right"></i></button></div>
          <div class="project-detail-legend"><span>进行中</span><span class="todo">待处理</span><span class="done">已完成</span><span class="off">周末/节假日</span></div>
        </div>
        <div class="project-gantt-wrap"><div class="project-gantt-grid" style="grid-template-columns:${template};grid-template-rows:34px repeat(${Math.max(1, projectTasks.length)},64px);">${header}${rows}</div></div>
      </section>
    </div>${editorModalHtml()}`;
  }

  function bindActions() {
    const root = state.context.content;
    root.querySelectorAll('[data-project-open]').forEach(button => button.addEventListener('click', () => {
      state.selectedProjectId = button.dataset.projectOpen;
      state.detailMonth = monthKey();
      render(state.context);
    }));
    root.querySelector('[data-project-new]')?.addEventListener('click', () => openEditor());
    root.querySelector('[data-project-toggle-archived]')?.addEventListener('click', () => {
      state.showArchived = !state.showArchived;
      render(state.context);
    });
    root.querySelector('[data-project-refresh]')?.addEventListener('click', () => {
      invalidateDataCache();
      render(state.context);
    });
    root.querySelector('[data-project-task-new]')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await state.context.createTaskForProject?.(button.dataset.projectTaskNew);
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    });
    root.querySelectorAll('[data-project-edit]').forEach(button => button.addEventListener('click', () => openEditor(button.dataset.projectEdit)));
    root.querySelector('[data-project-back]')?.addEventListener('click', () => {
      state.selectedProjectId = null;
      render(state.context);
    });
    root.querySelectorAll('[data-project-close]').forEach(button => button.addEventListener('click', closeEditor));
    root.querySelector('[data-project-save]')?.addEventListener('click', saveProject);
    root.querySelector('[data-project-month]')?.addEventListener('change', event => {
      state.detailMonth = event.target.value || monthKey();
      render(state.context);
    });
    root.querySelector('[data-project-current-month]')?.addEventListener('click', () => {
      state.detailMonth = monthKey();
      render(state.context);
    });
    root.querySelectorAll('[data-project-month-shift]').forEach(button => button.addEventListener('click', () => {
      state.detailMonth = shiftMonth(state.detailMonth || monthKey(), Number(button.dataset.projectMonthShift));
      render(state.context);
    }));
    root.querySelectorAll('[data-project-task-open]').forEach(button => {
      button.addEventListener('click', () => {
        if (state.suppressTaskClick) return;
        state.context.openTask?.(button.dataset.projectTaskOpen, 'edit');
      });
      button.addEventListener('dragstart', event => {
        if (!state.context.canManageQa() || !button.draggable) {
          event.preventDefault();
          return;
        }
        state.draggingTaskId = button.dataset.projectTaskOpen;
        state.dragAnchorDate = button.dataset.projectSlotDate;
        state.suppressTaskClick = true;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', state.draggingTaskId);
        button.classList.add('dragging');
      });
      button.addEventListener('dragend', () => {
        button.classList.remove('dragging');
        root.querySelectorAll('.project-gantt-drop-target').forEach(cell => cell.classList.remove('project-gantt-drop-target'));
        state.draggingTaskId = null;
        state.dragAnchorDate = '';
        setTimeout(() => { state.suppressTaskClick = false; }, 80);
      });
    });
    root.querySelectorAll('[data-project-drop-date]').forEach(cell => {
      cell.addEventListener('dragover', event => {
        if (!state.draggingTaskId || cell.dataset.projectWorkday !== 'true') return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        cell.classList.add('project-gantt-drop-target');
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('project-gantt-drop-target'));
      cell.addEventListener('drop', async event => {
        event.preventDefault();
        cell.classList.remove('project-gantt-drop-target');
        await moveTaskSchedule(state.draggingTaskId, state.dragAnchorDate, cell.dataset.projectDropDate);
      });
    });
  }

  async function moveTaskSchedule(taskId, anchorDate, targetDate) {
    const context = state.context;
    const task = state.detailTasks.get(taskId);
    if (!context.canManageQa() || !task || !anchorDate || !targetDate) return;
    const offset = dateOffset(anchorDate, targetDate);
    if (!offset) return;
    const nextStart = shiftDate(task.allocation_start_date, offset);
    const nextEnd = shiftDate(task.allocation_end_date, offset);
    if (!window.confirm(`确认将“${task.title}”整体移动 ${Math.abs(offset)} 天至 ${nextStart}—${nextEnd}？`)) return;
    try {
      const cutoff = task.allocation_end_period === 'am' ? '12:00:00' : '19:00:00';
      const due = new Date(`${nextEnd}T${cutoff}`).toISOString();
      const { error } = await context.sb.from('qa_tasks').update({
        allocation_start_date: nextStart,
        allocation_end_date: nextEnd,
        due_date: due,
      }).eq('id', task.id);
      if (error) throw error;
      context.showToast(`排期已更新为 ${nextStart} — ${nextEnd}`);
      invalidateDataCache();
      context.rerender();
    } catch (error) {
      context.showToast(`移动排期失败：${error.message}`, 'error');
    }
  }

  async function render(context) {
    state.context = context;
    if (state.businessUnit && state.businessUnit !== context.businessUnit) state.selectedProjectId = null;
    state.businessUnit = context.businessUnit;
    const content = context.content;
    content.style.padding = '24px';
    try {
      const cacheKey = `${context.currentUser?.id || ''}:${context.currentDuty || ''}`;
      const cacheFresh = state.dataCache
        && state.dataCacheKey === cacheKey
        && Date.now() - state.dataCacheAt < DATA_CACHE_TTL_MS;
      let results = state.dataCacheKey === cacheKey ? state.dataCache : null;
      let fetchedFreshData = false;
      if (!cacheFresh) {
        content.innerHTML = '<div class="page-card"><div class="empty"><div class="spinner"></div><div>正在加载项目…</div></div></div>';
        results = await Promise.all([
          context.sb.from('qa_projects').select('*').order('status').order('name'),
          context.sb.from('qa_project_members').select('*'),
          context.sb.from('profiles').select('id,name,role,resource_participant').order('name'),
          context.sb.from('project_monthly_plans').select('id,project_id,project_name,plan_month,end_month,status'),
          context.sb.from('qa_tasks').select('id,title,project_id,portfolio_plan_id,release_id,status,test_round,assignee_id,effort_person_days,allocation_start_date,allocation_end_date,allocation_start_period,allocation_end_period,completed_at,delay_recorded_at,delay_waived_at,delay_waived_by,delay_waiver_reason').neq('status', 'cancelled'),
          context.sb.from('qa_task_assignees').select('task_id,member_id'),
          context.sb.from('work_calendar').select('work_date,is_workday,name'),
          context.sb.from('releases').select('id,project_id,version,name,status,planned_release_date'),
          context.sb.from('quality_defects').select('id,qa_task_id,release_id,status,severity,review_status,is_missed_test'),
          context.sb.from('task_testhub_progress').select('task_id,total_cases,executed_cases,progress_ratio,synced_at'),
          context.sb.from('task_progress_logs').select('task_id,progress_points,source,work_date'),
          context.canManageQa()
            ? context.sb.from('qa_project_data_health').select('*').maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);
        fetchedFreshData = true;
      }
      const [projectsRes, membersRes, profilesRes, plansRes, tasksRes, assigneesRes, calendarRes, releasesRes, defectsRes, snapshotsRes, progressRes, healthRes] = results;
      for (const result of [projectsRes, membersRes, profilesRes, plansRes, tasksRes, assigneesRes, calendarRes, releasesRes, defectsRes, snapshotsRes, progressRes, healthRes]) {
        if (result.error) throw result.error;
      }
      if (fetchedFreshData) {
        state.dataCache = results;
        state.dataCacheKey = cacheKey;
        state.dataCacheAt = Date.now();
      }
      state.projects = new Map((projectsRes.data || []).map(item => [item.id, item]));
      state.members = membersRes.data || [];
      state.profiles = new Map((profilesRes.data || []).map(item => [item.id, item]));
      if (state.selectedProjectId && !state.projects.has(state.selectedProjectId)) state.selectedProjectId = null;
      const plans = plansRes.data || [];
      const tasks = tasksRes.data || [];
      const selectedProject = state.selectedProjectId ? state.projects.get(state.selectedProjectId) : null;
      if (selectedProject) {
        content.innerHTML = renderDetail(selectedProject, plans, tasks, assigneesRes.data || [], calendarRes.data || [], releasesRes.data || [], defectsRes.data || [], snapshotsRes.data || [], progressRes.data || []);
        bindActions();
        return;
      }
      const visible = [...state.projects.values()].filter(item =>
        item.business_unit === context.businessUnit
        && (state.showArchived || item.status !== 'archived')
      );
      const cards = visible.length ? visible.map(project => {
        const memberships = state.members.filter(item => item.project_id === project.id);
        const owners = memberships.filter(item => item.is_owner).map(item => state.profiles.get(item.member_id)?.name).filter(Boolean);
        const projectPlans = plans.filter(item => item.project_id === project.id);
        const planIds = new Set(projectPlans.map(item => item.id));
        const projectTasks = tasks.filter(item =>
          item.project_id === project.id || planIds.has(item.portfolio_plan_id));
        const done = projectTasks.filter(item => item.status === 'done' || item.status === 'completed').length;
        return `<button class="project-card" type="button" data-project-open="${project.id}">
          <div class="projects-module-card-head"><div><div class="project-card-title">${context.escapeHtml(project.name)}</div><div class="project-card-meta">${context.escapeHtml(owners.join('、') || '待指定负责人')} · ${statusText(project.status)}</div></div><span class="project-state ${project.status}">${statusText(project.status)}</span></div>
          <div class="project-card-stats"><div class="project-card-stat"><strong>${memberships.length}</strong><span>成员</span></div><div class="project-card-stat"><strong>${projectPlans.length}</strong><span>月度人力</span></div><div class="project-card-stat"><strong>${done}/${projectTasks.length}</strong><span>事项完成</span></div></div>
          <div class="project-card-meta projects-module-description">${context.escapeHtml(project.description || '暂无项目说明')}</div>
        </button>`;
      }).join('') : '<div class="empty projects-module-full-row">当前分类暂无可见项目</div>';
      const health = healthRes.data || {};
      const healthTotal = Number(health.unassigned_plans || 0) + Number(health.unassigned_releases || 0) + Number(health.unassigned_tasks || 0) + Number(health.unassigned_bugs || 0);
      content.innerHTML = `<div class="page-card projects-module">
        <div class="card-hd"><div><div class="card-title">🗂️ 项目总览</div><div class="card-sub">一个项目统一管理成员、版本、工作事项、月度人力和质量数据。数据会缓存 5 分钟，可随时手动刷新。</div></div><div class="projects-module-head-actions"><button class="btn-secondary" type="button" data-project-refresh><i class="ti ti-refresh"></i> 刷新数据</button><button class="btn-secondary" type="button" data-project-toggle-archived>${state.showArchived ? '隐藏已归档' : '查看已归档'}</button>${context.canManageQa() ? '<button class="btn-primary" type="button" data-project-new><i class="ti ti-plus"></i> 新增项目</button>' : ''}</div></div>
        <div class="project-data-flow"><strong>统一关联规则</strong><span>项目 → 版本 → 工作事项</span><small>创建工作事项只选版本；系统自动归属项目并匹配对应月份的人力规划。</small></div>
        ${healthTotal ? `<div class="project-data-warning"><strong>数据待归属 ${healthTotal} 项</strong><span>排期 ${Number(health.unassigned_plans || 0)} · 版本 ${Number(health.unassigned_releases || 0)} · 未完成事项 ${Number(health.unassigned_tasks || 0)} · BUG ${Number(health.unassigned_bugs || 0)}</span><small>请进入对应模块补充项目关系，避免统计遗漏。</small></div>` : ''}
        <div class="project-card-grid">${cards}</div>
      </div>${editorModalHtml()}`;
      bindActions();
    } catch (error) {
      content.innerHTML = `<div class="page-card"><div class="empty">项目加载失败：${context.escapeHtml(error.message)}<br><small>请先执行项目中心数据库迁移</small></div></div>`;
    }
  }

  function openEditor(id = '') {
    const context = state.context;
    state.editingProjectId = id;
    const modal = context.content.querySelector('#qaProjectModal');
    if (!modal) return;
    const project = id ? state.projects.get(id) : null;
    context.content.querySelector('#qaProjectModalTitle').textContent = project ? '编辑项目' : '新增项目';
    context.content.querySelector('#qaProjectName').value = project?.name || '';
    context.content.querySelector('#qaProjectUnit').value = project?.business_unit || context.businessUnit;
    context.content.querySelector('#qaProjectStatus').value = project?.status || 'active';
    context.content.querySelector('#qaProjectDescription').value = project?.description || '';
    const selected = new Set(state.members.filter(item => item.project_id === id).map(item => item.member_id));
    const owner = state.members.find(item => item.project_id === id && item.is_owner)?.member_id || '';
    const profiles = [...state.profiles.values()];
    context.content.querySelector('#qaProjectOwner').innerHTML = `<option value="">暂不指定</option>${profiles.map(item => `<option value="${item.id}" ${owner === item.id ? 'selected' : ''}>${context.escapeHtml(item.name || item.id)}</option>`).join('')}`;
    context.content.querySelector('#qaProjectMemberChoices').innerHTML = profiles.map(item => `<label class="feature-mini-stat projects-module-member"><input type="checkbox" name="qaProjectMember" value="${item.id}" ${selected.has(item.id) ? 'checked' : ''}><span><strong>${context.escapeHtml(item.name || '未命名成员')}</strong><small>${context.dutyText(item.role)}${context.isResourceParticipant(item) ? ' · 计入资源' : ''}</small></span></label>`).join('');
    modal.classList.add('open');
  }

  function closeEditor() {
    state.context?.content.querySelector('#qaProjectModal')?.classList.remove('open');
    state.editingProjectId = null;
  }

  async function saveProject() {
    const context = state.context;
    const name = context.content.querySelector('#qaProjectName').value.trim();
    if (!name) {
      context.showToast('请填写项目名称', 'error');
      return;
    }
    const button = context.content.querySelector('#saveQaProjectBtn');
    button.disabled = true;
    try {
      const payload = {
        name,
        business_unit: context.content.querySelector('#qaProjectUnit').value,
        status: context.content.querySelector('#qaProjectStatus').value,
        description: context.content.querySelector('#qaProjectDescription').value.trim() || null,
      };
      const result = state.editingProjectId
        ? await context.sb.from('qa_projects').update(payload).eq('id', state.editingProjectId).select().single()
        : await context.sb.from('qa_projects').insert({ ...payload, created_by: context.currentUser.id }).select().single();
      if (result.error) throw result.error;
      const projectId = result.data.id;
      const ownerId = context.content.querySelector('#qaProjectOwner').value;
      const selected = [...context.content.querySelectorAll('input[name="qaProjectMember"]:checked')].map(item => item.value);
      if (ownerId && !selected.includes(ownerId)) selected.push(ownerId);
      const remove = await context.sb.from('qa_project_members').delete().eq('project_id', projectId);
      if (remove.error) throw remove.error;
      if (selected.length) {
        const add = await context.sb.from('qa_project_members').insert(selected.map(memberId => ({
          project_id: projectId,
          member_id: memberId,
          is_owner: memberId === ownerId,
          added_by: context.currentUser.id,
        })));
        if (add.error) throw add.error;
      }
      state.businessUnit = payload.business_unit;
      state.selectedProjectId = projectId;
      invalidateDataCache();
      context.setBusinessUnit(payload.business_unit);
      context.showToast('项目已保存');
      context.rerender();
    } catch (error) {
      context.showToast(`保存失败：${error.message}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function openProject(context, projectId, month = '') {
    state.context = context;
    state.selectedProjectId = projectId;
    state.detailMonth = String(month || monthKey()).slice(0, 7);
  }

  function destroy() {
    state.context = null;
    state.editingProjectId = null;
  }

  function invalidate() {
    invalidateDataCache();
  }

  global.HanntoQA.registerModule({
    id: 'projects',
    title: '项目总览',
    owner: 'QA Platform',
    version: '1.0.0',
    projectAware: true,
    permissions: ['admin', 'qa_lead', 'tester'],
    render,
    destroy,
    invalidate,
    openProject,
  });
})(window);
