(function registerReportsModule(global) {
  'use strict';

  const state = {
    context: null,
    rendering: false,
    workspace: null,
  };

  function platformMatches(platform, selected) {
    if (selected === 'all') return true;
    if (platform === selected) return true;
    if (selected === 'app') return ['android', 'ios', 'both', 'app', 'mobile_all', 'app_pad'].includes(platform);
    if (selected === 'pad') return ['pad', 'mobile_all', 'app_pad'].includes(platform);
    return selected === 'pc' && platform === 'pc';
  }

  function readFilters() {
    const root = state.context.content;
    return {
      releaseId: root.querySelector('#qualityReleaseFilter')?.value || 'all',
      platform: root.querySelector('#qualityPlatformFilter')?.value || 'all',
      memberId: root.querySelector('#qualityMemberFilter')?.value || 'all',
      from: root.querySelector('#qualityFromFilter')?.value || '',
      to: root.querySelector('#qualityToFilter')?.value || '',
    };
  }

  function percent(value, total) {
    return total > 0 ? Math.round(value / total * 100) : 0;
  }

  function buildSummary(tasks, defects) {
    const workspace = state.workspace;
    const done = tasks.filter(task => task.status === 'done').length;
    const blocked = tasks.filter(task => task.status === 'blocked').length;
    const overdue = tasks.filter(task => state.context.taskDelayState(task).delayed).length;
    const effort = tasks.reduce((sum, task) => sum + Number(task.effort_person_days || 0), 0);
    const actual = tasks.reduce((sum, task) => {
      const snapshot = workspace.snapshotMap.get(task.id);
      return sum + state.context.taskActualProgressPoints(
        task,
        workspace.progressMap.get(task.id) || [],
        snapshot,
      ).totalActual;
    }, 0);
    const snapshots = tasks.map(task => workspace.snapshotMap.get(task.id)).filter(Boolean);
    const totalCases = snapshots.reduce((sum, item) => sum + Number(item.total_cases || 0), 0);
    const executedCases = snapshots.reduce((sum, item) => sum + Number(item.executed_cases || 0), 0);
    const releaseIds = new Set(tasks.map(task => task.release_id).filter(Boolean));
    const checks = workspace.checks.filter(check => releaseIds.has(check.release_id));
    const passedChecks = checks.filter(check => ['passed', 'waived'].includes(check.status)).length;
    const productionDefects = defects.filter(defect => defect.exposed_stage === 'production').length;
    const integrationDefects = defects.filter(defect => defect.exposed_stage === 'integration').length;
    const reviewedDefects = defects.filter(defect => defect.review_status === 'completed').length;
    return {
      done,
      blocked,
      overdue,
      effort,
      actual,
      totalCases,
      executedCases,
      checks: checks.length,
      passedChecks,
      productionDefects,
      integrationDefects,
      reviewedDefects,
      taskRate: percent(done, tasks.length),
      caseRate: percent(executedCases, totalCases),
      checkRate: percent(passedChecks, checks.length),
      reviewRate: percent(reviewedDefects, defects.length),
    };
  }

  function buildMemberStats(tasks) {
    const stats = new Map();
    tasks.forEach(task => {
      const snapshot = state.workspace.snapshotMap.get(task.id);
      const taskActual = state.context.taskActualProgressPoints(
        task,
        state.workspace.progressMap.get(task.id) || [],
        snapshot,
      ).totalActual;
      const assignments = state.workspace.assigneeMap.get(task.id) || [];
      const totalAllocated = assignments.reduce(
        (sum, item) => sum + Number(item.allocated_effort || 0),
        0,
      ) || Number(task.effort_person_days || 0) || 1;
      assignments.forEach(item => {
        const stat = stats.get(item.member_id) || {
          tasks: 0,
          done: 0,
          blocked: 0,
          plan: 0,
          actual: 0,
        };
        const allocated = Number(item.allocated_effort || 0);
        stat.tasks += 1;
        stat.done += task.status === 'done' ? 1 : 0;
        stat.blocked += task.status === 'blocked' ? 1 : 0;
        stat.plan += allocated;
        stat.actual += taskActual * allocated / totalAllocated;
        stats.set(item.member_id, stat);
      });
    });
    return [...stats.entries()].map(([memberId, stat]) => ({ memberId, ...stat }));
  }

  function buildWeeklyBrief(tasks, filters) {
    const briefs = new Map();
    tasks.forEach(task => {
      const assignments = state.workspace.assigneeMap.get(task.id) || [];
      const completedDate = task.completed_at?.slice(0, 10) || task.updated_at?.slice(0, 10) || '';
      const completedInRange = task.status === 'done'
        && (!filters.from || !completedDate || completedDate >= filters.from)
        && (!filters.to || !completedDate || completedDate <= filters.to);
      const delayed = state.context.taskDelayState(task).delayed;
      assignments.forEach(item => {
        const brief = briefs.get(item.member_id) || {
          completedIds: [],
          delayedIds: [],
          activeIds: [],
        };
        if (completedInRange) brief.completedIds.push(task.id);
        if (delayed) brief.delayedIds.push(task.id);
        if (!['done', 'cancelled'].includes(task.status)) brief.activeIds.push(task.id);
        briefs.set(item.member_id, brief);
      });
    });
    return [...briefs.entries()].map(([memberId, brief]) => ({ memberId, ...brief }));
  }

  function buildTaskDetails(tasks) {
    return tasks.map(task => {
      const snapshot = state.workspace.snapshotMap.get(task.id);
      return {
        taskId: task.id,
        assigneeIds: (state.workspace.assigneeMap.get(task.id) || []).map(item => item.member_id),
        actual: state.context.taskActualProgressPoints(
          task,
          state.workspace.progressMap.get(task.id) || [],
          snapshot,
        ).totalActual,
        executedCases: snapshot ? Number(snapshot.executed_cases || 0) : null,
        totalCases: snapshot ? Number(snapshot.total_cases || 0) : null,
        endDate: task.allocation_end_date || task.due_date?.slice(0, 10) || '-',
      };
    });
  }

  function buildMemberDetails(memberStats) {
    return memberStats
      .map(stat => ({
        ...stat,
        name: state.workspace.memberMap.get(stat.memberId) || '未命名成员',
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  function buildDefectDetails(defects) {
    return defects.map(defect => ({
      defectId: defect.id,
      taskId: defect.qa_task_id || null,
      executorId: defect.executor_id || null,
      exposedStage: defect.exposed_stage,
      severity: defect.severity,
      rootCauseCategory: defect.root_cause_category,
      reviewStatus: defect.review_status,
    }));
  }

  function buildRetrospective(defects) {
    const rootCounts = new Map();
    const ownerCounts = new Map();
    const pending = [];
    defects.forEach(defect => {
      const rootKey = defect.root_cause_category || 'pending';
      rootCounts.set(rootKey, (rootCounts.get(rootKey) || 0) + 1);
      const owner = ownerCounts.get(defect.executor_id) || {
        memberId: defect.executor_id,
        total: 0,
        integration: 0,
        production: 0,
        reviewed: 0,
      };
      owner.total += 1;
      if (defect.exposed_stage === 'integration') owner.integration += 1;
      if (defect.exposed_stage === 'production') owner.production += 1;
      if (defect.review_status === 'completed') owner.reviewed += 1;
      ownerCounts.set(defect.executor_id, owner);
      if (defect.review_status !== 'completed' || !defect.prevention_action) {
        pending.push({
          defectId: defect.id,
          reason: defect.review_status !== 'completed' ? defect.review_status : 'missing_prevention',
        });
      }
    });
    return {
      roots: [...rootCounts.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count),
      owners: [...ownerCounts.values()].sort((a, b) => b.total - a.total),
      pending: pending.slice(0, 20),
    };
  }

  function buildExternalQuality(defects) {
    const rounds = new Map();
    defects.forEach(defect => {
      const task = state.workspace.qaTaskMap.get(defect.qa_task_id);
      const key = task ? Number(task.test_round || 1) : 'unlinked';
      const stat = rounds.get(key) || {
        round: key,
        total: 0,
        reopenedBugs: 0,
        reopenTimes: 0,
        changeInduced: 0,
        missedTest: 0,
        closed: 0,
      };
      const reopenCount = Number(defect.reopen_count || 0);
      stat.total += 1;
      stat.reopenedBugs += reopenCount > 0 ? 1 : 0;
      stat.reopenTimes += reopenCount;
      stat.changeInduced += defect.is_change_induced ? 1 : 0;
      stat.missedTest += defect.is_missed_test ? 1 : 0;
      stat.closed += ['verified', 'closed'].includes(defect.status) ? 1 : 0;
      rounds.set(key, stat);
    });
    const reopenedBugs = defects.filter(item => Number(item.reopen_count || 0) > 0).length;
    const reopenTimes = defects.reduce((sum, item) => sum + Number(item.reopen_count || 0), 0);
    const changeInduced = defects.filter(item => item.is_change_induced).length;
    const missedTest = defects.filter(item => item.is_missed_test).length;
    const critical = defects.filter(item => ['P0', 'P1'].includes(item.severity)).length;
    const closed = defects.filter(item => ['verified', 'closed'].includes(item.status)).length;
    return {
      total: defects.length,
      reopenedBugs,
      reopenTimes,
      changeInduced,
      missedTest,
      critical,
      closed,
      rounds: [...rounds.values()].sort((a, b) =>
        a.round === 'unlinked' ? 1 : b.round === 'unlinked' ? -1 : Number(a.round) - Number(b.round)),
    };
  }

  function filterWorkspace() {
    if (!state.workspace) return;
    const filters = readFilters();
    const taskIds = state.workspace.tasks.filter(task => {
      const release = state.workspace.releaseMap.get(task.release_id);
      const assignments = state.workspace.assigneeMap.get(task.id) || [];
      const taskStart = task.allocation_start_date || task.created_at?.slice(0, 10) || '';
      const taskEnd = task.allocation_end_date || task.due_date?.slice(0, 10) || taskStart;
      return (filters.releaseId === 'all' || task.release_id === filters.releaseId)
        && platformMatches(release?.platform, filters.platform)
        && (filters.memberId === 'all' || assignments.some(item => item.member_id === filters.memberId))
        && (!filters.from || !taskEnd || taskEnd >= filters.from)
        && (!filters.to || !taskStart || taskStart <= filters.to);
    }).map(task => task.id);
    const defectIds = state.workspace.defects.filter(defect => {
      const release = state.workspace.releaseMap.get(defect.release_id);
      return (filters.releaseId === 'all' || defect.release_id === filters.releaseId)
        && platformMatches(release?.platform, filters.platform)
        && (filters.memberId === 'all' || defect.executor_id === filters.memberId)
        && (!filters.from || defect.found_at >= filters.from)
        && (!filters.to || defect.found_at <= filters.to);
    }).map(defect => defect.id);
    const taskIdSet = new Set(taskIds);
    const defectIdSet = new Set(defectIds);
    const tasks = state.workspace.tasks.filter(task => taskIdSet.has(task.id));
    const defects = state.workspace.defects.filter(defect => defectIdSet.has(defect.id));
    const memberStats = buildMemberStats(tasks);
    state.context.renderQualityResults({
      taskIds,
      defectIds,
      summary: buildSummary(tasks, defects),
      memberStats,
      memberDetails: buildMemberDetails(memberStats),
      taskDetails: buildTaskDetails(tasks),
      defectDetails: buildDefectDetails(defects),
      retrospective: buildRetrospective(defects),
      externalQuality: buildExternalQuality(defects),
      weeklyBrief: buildWeeklyBrief(tasks, filters),
    });
  }

  function clearFilters() {
    const root = state.context.content;
    root.querySelector('#qualityReleaseFilter').value = 'all';
    root.querySelector('#qualityPlatformFilter').value = 'all';
    root.querySelector('#qualityMemberFilter').value = 'all';
    root.querySelector('#qualityFromFilter').value = '';
    root.querySelector('#qualityToFilter').value = '';
    filterWorkspace();
  }

  function bindFilters() {
    const root = state.context.content;
    root.querySelectorAll('[data-report-filter]').forEach(input =>
      input.addEventListener('change', filterWorkspace));
    root.querySelector('[data-report-clear]')?.addEventListener('click', clearFilters);
  }

  async function loadQualityData(context) {
    const results = await Promise.all([
      context.sb.from('releases').select('id,version,name,platform,status,project_id,planned_release_date').order('created_at', { ascending: false }),
      context.sb.from('qa_tasks').select('id,title,status,test_round,prd_id,requirement_id,release_id,project_id,portfolio_plan_id,due_date,created_at,updated_at,completed_at,completion_note,assignee_id,effort_person_days,allocation_start_date,allocation_end_date,allocation_start_period,allocation_end_period,testhub_plan_id,testhub_plan_ids,testhub_effort_person_days,testhub_scope_mode,testhub_scope_suite_ids,delay_recorded_at,delay_waived_at,delay_waived_by,delay_waiver_reason'),
      context.sb.from('profiles').select('id,name,resource_participant').eq('resource_participant', true).order('name'),
      context.sb.from('qa_task_assignees').select('task_id,member_id,allocated_effort'),
      context.sb.from('task_progress_logs').select('task_id,work_date,progress_points,source,executor_id'),
      context.sb.from('task_testhub_progress').select('task_id,plan_id,plan_ids,total_cases,executed_cases,progress_ratio,status_counts,sync_status,synced_at,scope_mode,scope_suite_ids,scope_suite_names'),
      context.sb.from('release_checks').select('release_id,status,severity'),
      context.sb.from('quality_defects').select('id,title,qa_task_id,prd_id,requirement_id,release_id,exposed_stage,severity,status,executor_id,found_at,root_cause_category,review_status,reopen_count,is_change_induced,is_missed_test,impact,escape_reason,corrective_action,prevention_action'),
      context.sb.from('prds').select('id,title'),
      context.sb.from('qa_projects').select('id,business_unit,status'),
      context.sb.from('project_monthly_plans').select('id,project_id'),
    ]);
    const error = results.find(result => result.error)?.error;
    if (error) throw error;
    return results;
  }

  async function render(context) {
    state.context = context;
    if (state.rendering) return;
    state.rendering = true;
    context.content.style.padding = '24px';
    context.content.innerHTML = '<div class="history-card reports-module"><div class="dashboard-loading">正在汇总质量数据…</div></div>';
    try {
      const results = await loadQualityData(context);
      state.workspace = await context.renderQualityWorkspace(results);
      bindFilters();
      filterWorkspace();
      context.content.querySelector('.history-card')?.classList.add('reports-module');
    } catch (error) {
      context.content.innerHTML = `<div class="history-card reports-module"><div class="dashboard-empty">质量报表加载失败：${context.escapeHtml(error.message)}<br><span class="release-meta">请刷新后重试；若持续失败，请检查报表依赖的数据库迁移。</span></div><button class="btn-secondary reports-module-retry" type="button">重新加载</button></div>`;
      context.content.querySelector('.reports-module-retry')?.addEventListener('click', () => render(context));
    } finally {
      state.rendering = false;
    }
  }

  function destroy() {
    state.context = null;
    state.rendering = false;
    state.workspace = null;
  }

  global.HanntoQA.registerModule({
    id: 'report',
    title: '质量报表',
    owner: 'QA Platform',
    version: '1.0.0',
    projectAware: true,
    permissions: ['admin', 'qa_lead', 'tester'],
    render,
    refresh: render,
    destroy,
    loadQualityData,
    buildSummary,
    buildMemberStats,
    buildMemberDetails,
    buildTaskDetails,
    buildDefectDetails,
    buildRetrospective,
    buildExternalQuality,
    buildWeeklyBrief,
  });
})(window);
