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
  };

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
    const taskIds = new Set(allProjectTasks.map(item => item.id));
    const projectReleases = releases.filter(item => item.project_id === project.id);
    const releaseIds = new Set(projectReleases.map(item => item.id));
    const projectDefects = defects.filter(item => taskIds.has(item.qa_task_id) || releaseIds.has(item.release_id));
    const openDefects = projectDefects.filter(item => !['closed', 'resolved', 'done'].includes(item.status)).length;
    const missedDefects = projectDefects.filter(item => item.is_missed_test).length;
    const blocked = allProjectTasks.filter(item => item.status === 'blocked').length;
    const todayKey = context.localDateKey(new Date());
    const overdue = allProjectTasks.filter(item =>
      ['todo', 'in_progress', 'blocked'].includes(item.status)
      && (item.allocation_end_date || '') < todayKey
    ).length;
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
    const template = `270px repeat(${days.length},45px)`;
    const header = `<div class="project-gantt-cell project-gantt-task project-gantt-head">工作事项 / 负责人 / 排期</div>${days.map(day => `<div class="project-gantt-cell project-gantt-head project-gantt-day ${day.isWorkday ? '' : 'weekend'} ${day.key === today ? 'project-gantt-today' : ''}" title="${escapeHtml(day.name || (day.isWorkday ? '工作日' : '非工作日'))}">${String(day.day).padStart(2, '0')}<br>周${day.weekday}</div>`).join('')}`;
    const rows = projectTasks.length ? projectTasks.map(task => {
      const ids = assigneesByTask.get(task.id) || (task.assignee_id ? [task.assignee_id] : []);
      const names = ids.map(id => state.profiles.get(id)?.name).filter(Boolean).join('、') || '未指定负责人';
      const slots = days.map(day => {
        const label = day.isWorkday ? taskSlotLabel(task, day.key) : '';
        return `<div class="project-gantt-cell project-gantt-slot ${day.isWorkday ? '' : 'weekend'} ${day.key === today ? 'project-gantt-today' : ''}">${label ? `<div class="project-gantt-bar ${taskBarClass(task.status)}" title="${escapeHtml(`${task.title} · ${day.key} ${label}`)}">${label}</div>` : ''}</div>`;
      }).join('');
      return `<div class="project-gantt-cell project-gantt-task"><div><strong>${escapeHtml(task.title || '未命名事项')}</strong><div class="project-card-meta">${escapeHtml(names)} · 第 ${Number(task.test_round || 1)} 轮 · ${context.taskStatusText(task.status)}</div><div class="project-card-meta">${escapeHtml(task.allocation_start_date || '未排期')} ${context.taskAllocationPeriodText(task.allocation_start_period)} → ${escapeHtml(task.allocation_end_date || '未排期')} ${context.taskAllocationPeriodText(task.allocation_end_period)}</div></div></div>${slots}`;
    }).join('') : `<div class="project-gantt-cell project-gantt-task">本月暂无工作事项</div><div class="project-gantt-cell projects-module-empty-gantt" style="grid-column:span ${days.length};">可先在工作事项中关联该项目排期</div>`;
    const completed = projectTasks.filter(item => item.status === 'done' || item.status === 'completed').length;
    return `<div class="page-card projects-module">
      <div class="card-hd">
        <div><button class="btn-secondary projects-module-back" type="button" data-project-back><i class="ti ti-arrow-left"></i> 返回项目列表</button><div class="card-title">${escapeHtml(project.name)}</div><div class="card-sub">${context.projectUnitText(project.business_unit)} · ${memberNames.join('、') || '尚未分配成员'}</div></div>
        ${context.canManageQa() ? `<button class="btn-secondary" type="button" data-project-edit="${project.id}"><i class="ti ti-edit"></i> 编辑项目</button>` : ''}
      </div>
      <div class="project-data-flow"><strong>当前项目的数据关系</strong><span>项目 → 版本 → 工作事项</span><small>月度人力规划由工作事项的版本和日期自动关联，不需要在事项中手工选择。</small></div>
      <div class="summary-grid projects-module-summary">
        <div class="summary-item"><div class="summary-label">计划 / 实际点数</div><div class="summary-value">${plannedPoints.toFixed(1)} / ${actualPoints.toFixed(1)}</div></div>
        <div class="summary-item"><div class="summary-label">TestHub 执行率</div><div class="summary-value">${testHubTotal ? `${Math.round(testHubExecuted / testHubTotal * 100)}%` : '-'}</div><div class="project-card-meta">${testHubExecuted}/${testHubTotal} Case</div></div>
        <div class="summary-item"><div class="summary-label">当前版本</div><div class="summary-value">${projectReleases.filter(item => item.status === 'active').length}</div><div class="project-card-meta">共 ${projectReleases.length} 个版本</div></div>
        <div class="summary-item"><div class="summary-label">事项完成</div><div class="summary-value">${allProjectTasks.filter(item => ['done','completed'].includes(item.status)).length}/${allProjectTasks.length}</div></div>
        <div class="summary-item"><div class="summary-label">延期 / 阻塞</div><div class="summary-value">${overdue} / ${blocked}</div></div>
        <div class="summary-item"><div class="summary-label">BUG / 漏测</div><div class="summary-value">${projectDefects.length} / ${missedDefects}</div><div class="project-card-meta">${openDefects} 个未关闭</div></div>
        <div class="summary-item"><div class="summary-label">项目成员</div><div class="summary-value">${memberships.length}</div></div>
      </div>
      <div class="projects-module-release-strip">${projectReleases.length ? projectReleases.map(release => `<span><strong>${escapeHtml(release.version || release.name || '未命名版本')}</strong> · ${releaseStatusText(release.status)}</span>`).join('') : '<span>尚未关联版本</span>'}</div>
      <div class="project-detail-toolbar projects-module-toolbar"><button class="btn-secondary" type="button" data-project-month-shift="-1">上个月</button><input class="dashboard-filter" type="month" value="${state.detailMonth}" data-project-month><button class="btn-secondary" type="button" data-project-current-month>本月</button><button class="btn-secondary" type="button" data-project-month-shift="1">下个月</button><div class="project-detail-legend"><span>进行中</span><span class="todo">待处理</span><span class="done">已完成</span><span class="off">周末/节假日</span></div></div>
      <div class="project-gantt-wrap"><div class="project-gantt-grid" style="grid-template-columns:${template};">${header}${rows}</div></div>
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
  }

  async function render(context) {
    state.context = context;
    if (state.businessUnit && state.businessUnit !== context.businessUnit) state.selectedProjectId = null;
    state.businessUnit = context.businessUnit;
    const content = context.content;
    content.style.padding = '24px';
    content.innerHTML = '<div class="page-card"><div class="empty"><div class="spinner"></div><div>正在加载项目…</div></div></div>';
    try {
      const [projectsRes, membersRes, profilesRes, plansRes, tasksRes, assigneesRes, calendarRes, releasesRes, defectsRes, snapshotsRes, progressRes, healthRes] = await Promise.all([
        context.sb.from('qa_projects').select('*').order('status').order('name'),
        context.sb.from('qa_project_members').select('*'),
        context.sb.from('profiles').select('id,name,role,resource_participant').order('name'),
        context.sb.from('project_monthly_plans').select('id,project_id,project_name,plan_month,end_month,status'),
        context.sb.from('qa_tasks').select('id,title,project_id,portfolio_plan_id,release_id,status,test_round,assignee_id,effort_person_days,allocation_start_date,allocation_end_date,allocation_start_period,allocation_end_period').neq('status', 'cancelled'),
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
      for (const result of [projectsRes, membersRes, profilesRes, plansRes, tasksRes, assigneesRes, calendarRes, releasesRes, defectsRes, snapshotsRes, progressRes, healthRes]) {
        if (result.error) throw result.error;
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
        <div class="card-hd"><div><div class="card-title">🗂️ 项目总览</div><div class="card-sub">一个项目统一管理成员、版本、工作事项、月度人力和质量数据。</div></div><div class="projects-module-head-actions"><button class="btn-secondary" type="button" data-project-toggle-archived>${state.showArchived ? '隐藏已归档' : '查看已归档'}</button>${context.canManageQa() ? '<button class="btn-primary" type="button" data-project-new><i class="ti ti-plus"></i> 新增项目</button>' : ''}</div></div>
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

  global.HanntoQA.registerModule({
    id: 'projects',
    title: '项目总览',
    owner: 'QA Platform',
    version: '1.0.0',
    projectAware: true,
    permissions: ['admin', 'qa_lead', 'tester'],
    render,
    destroy,
    openProject,
  });
})(window);
