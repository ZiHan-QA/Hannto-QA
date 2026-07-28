(function registerFeedbackModule(global) {
  'use strict';

  const STATUS_VALUES = Object.freeze([
    'submitted',
    'reviewing',
    'planned',
    'resolved',
    'closed',
  ]);

  function categoryText(category) {
    return ({
      bug: '问题',
      suggestion: '建议',
      experience: '体验',
      other: '其他',
    })[category] || '建议';
  }

  function statusText(status) {
    return ({
      submitted: '已提交',
      reviewing: '处理中',
      planned: '已排期',
      resolved: '已解决',
      closed: '已关闭',
    })[status] || '已提交';
  }

  function contextElement(context, id) {
    return context.content.querySelector(`#${id}`);
  }

  function feedbackCardHtml(item, context, projectMap, profileMap) {
    const escapeHtml = context.escapeHtml;
    const admin = context.isSystemAdmin();
    const createdAt = item.created_at
      ? new Date(item.created_at).toLocaleString('zh-CN')
      : '时间未知';
    const tracking = admin ? `
      <div class="dashboard-form-grid" style="margin-top:12px;">
        <div class="form-group">
          <label class="form-label">追踪状态</label>
          <select class="form-select" id="feedbackStatus_${item.id}">
            ${STATUS_VALUES.map(status => `<option value="${status}" ${item.status === status ? 'selected' : ''}>${statusText(status)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">处理回复</label>
          <input class="dashboard-input" id="feedbackReply_${item.id}" value="${escapeHtml(item.admin_reply || '')}" placeholder="填写处理结果或下一步">
        </div>
      </div>
      <div class="feedback-module-actions">
        <button class="btn-secondary" data-feedback-update="${item.id}">保存追踪</button>
        <button class="btn-secondary" style="color:#b4232c;border-color:#f2b8bd;" data-feedback-delete="${item.id}">
          <i class="ti ti-trash"></i> 删除反馈
        </button>
      </div>` : '';

    return `<article class="feedback-module-card">
      <div class="feedback-module-card-head">
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <div class="project-card-meta">
            ${categoryText(item.category)} ·
            ${escapeHtml(projectMap.get(item.project_id)?.name || '未关联项目')} ·
            ${escapeHtml(profileMap.get(item.created_by) || '当前用户')} ·
            ${escapeHtml(createdAt)}
          </div>
        </div>
        <span class="feedback-module-status ${item.status}">${statusText(item.status)}</span>
      </div>
      <div class="feedback-module-description">${escapeHtml(item.description)}</div>
      ${item.admin_reply ? `<div class="feedback-module-reply"><strong>处理回复：</strong>${escapeHtml(item.admin_reply)}</div>` : ''}
      ${tracking}
    </article>`;
  }

  function bindActions(context) {
    contextElement(context, 'submitFeedbackBtn')?.addEventListener('click', () => submitFeedback(context));
    context.content.querySelectorAll('[data-feedback-update]').forEach(button => {
      button.addEventListener('click', () => updateFeedbackTracking(button.dataset.feedbackUpdate, context));
    });
    context.content.querySelectorAll('[data-feedback-delete]').forEach(button => {
      button.addEventListener('click', () => deleteFeedback(button.dataset.feedbackDelete, context));
    });
    contextElement(context, 'feedbackRetryBtn')?.addEventListener('click', () => renderFeedbackPage(context));
  }

  async function renderFeedbackPage(context) {
    const content = context.content;
    content.style.padding = '24px';
    content.innerHTML = '<div class="page-card"><div class="empty"><div class="spinner"></div><div>正在加载反馈…</div></div></div>';
    try {
      const [feedbackRes, projectsRes, profilesRes] = await Promise.all([
        context.sb.from('qa_feedback').select('*').order('created_at', { ascending:false }),
        context.sb.from('qa_projects').select('id,name,business_unit').eq('status','active').order('name'),
        context.sb.from('profiles').select('id,name'),
      ]);
      if (feedbackRes.error) throw feedbackRes.error;
      if (projectsRes.error) throw projectsRes.error;
      if (profilesRes.error) throw profilesRes.error;

      const projects = projectsRes.data || [];
      const projectMap = new Map(projects.map(item => [item.id, item]));
      const profileMap = new Map((profilesRes.data || []).map(item => [item.id, item.name]));
      const feedback = feedbackRes.data || [];
      const items = feedback.length
        ? feedback.map(item => feedbackCardHtml(item, context, projectMap, profileMap)).join('')
        : '<div class="empty">暂无反馈记录</div>';
      const admin = context.isSystemAdmin();

      content.innerHTML = `<div class="feedback-module">
        <div class="page-card">
          <div class="card-hd">
            <div>
              <div class="card-title">💬 意见反馈</div>
              <div class="card-sub">${admin ? '系统管理员可查看和追踪全部反馈。' : '你只能查看自己提交的反馈。'}</div>
            </div>
          </div>
          <div class="dashboard-form-grid" style="margin-top:16px;">
            <div class="form-group">
              <label class="form-label">反馈标题 *</label>
              <input class="dashboard-input" id="feedbackTitle" maxlength="160" placeholder="简要说明问题或建议">
            </div>
            <div class="form-group">
              <label class="form-label">反馈类型</label>
              <select class="form-select" id="feedbackCategory">
                <option value="bug">问题</option>
                <option value="suggestion">建议</option>
                <option value="experience">体验</option>
                <option value="other">其他</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">关联项目（选填）</label>
              <select class="form-select" id="feedbackProject">
                <option value="">不关联项目</option>
                ${projects.map(item => `<option value="${item.id}">${context.projectUnitText(item.business_unit)} · ${context.escapeHtml(item.name)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group" style="margin-top:12px;">
            <label class="form-label">详细描述 *</label>
            <textarea class="dashboard-input" id="feedbackDescription" rows="4" maxlength="3000" placeholder="请说明现象、期望和复现方式"></textarea>
          </div>
          <button class="btn-primary" id="submitFeedbackBtn" style="margin-top:12px;">提交反馈</button>
        </div>
        <div class="page-card">
          <div class="card-title">${admin ? '全部反馈' : '我的反馈'}（${feedback.length}）</div>
          <div class="feedback-module-list">${items}</div>
        </div>
      </div>`;
      bindActions(context);
    } catch (error) {
      content.innerHTML = `<div class="page-card"><div class="empty">
        反馈加载失败：${context.escapeHtml(error.message)}
        <br><small>请先执行意见反馈数据库迁移</small>
        <br><button class="btn-secondary" id="feedbackRetryBtn" style="margin-top:10px;">重新加载</button>
      </div></div>`;
      bindActions(context);
    }
  }

  async function submitFeedback(context) {
    const title = contextElement(context, 'feedbackTitle')?.value.trim() || '';
    const description = contextElement(context, 'feedbackDescription')?.value.trim() || '';
    if (!title || !description) {
      context.showToast('请填写反馈标题和详细描述', 'error');
      return;
    }
    const button = contextElement(context, 'submitFeedbackBtn');
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      const { error } = await context.sb.from('qa_feedback').insert({
        title,
        description,
        category: contextElement(context, 'feedbackCategory').value,
        project_id: contextElement(context, 'feedbackProject').value || null,
        created_by: context.currentUser.id,
      });
      if (error) throw error;
      context.showToast('反馈已提交，可在本页追踪状态');
      await renderFeedbackPage(context);
    } catch (error) {
      context.showToast(`提交失败：${error.message}`, 'error');
      button.disabled = false;
    }
  }

  async function updateFeedbackTracking(id, context) {
    if (!context.isSystemAdmin()) {
      context.showToast('仅系统管理员可以更新反馈追踪', 'error');
      return;
    }
    try {
      const status = contextElement(context, `feedbackStatus_${id}`)?.value;
      const reply = contextElement(context, `feedbackReply_${id}`)?.value.trim() || null;
      const { error } = await context.sb.from('qa_feedback')
        .update({ status, admin_reply:reply })
        .eq('id', id);
      if (error) throw error;
      context.showToast('反馈追踪已更新');
      await renderFeedbackPage(context);
    } catch (error) {
      context.showToast(`更新失败：${error.message}`, 'error');
    }
  }

  async function deleteFeedback(id, context) {
    if (!context.isSystemAdmin()) {
      context.showToast('仅系统管理员可以删除反馈', 'error');
      return;
    }
    if (!global.confirm('确认永久删除这条反馈吗？此操作无法撤销。')) return;
    try {
      const { error } = await context.sb.from('qa_feedback').delete().eq('id', id);
      if (error) throw error;
      context.showToast('反馈已删除');
      await renderFeedbackPage(context);
    } catch (error) {
      context.showToast(`删除失败：${error.message}`, 'error');
    }
  }

  global.HanntoQA.registerModule({
    id: 'feedback',
    title: '意见反馈',
    owner: 'Hannto QA',
    version: '1.0.0',
    projectAware: true,
    permissions: ['admin', 'qa_lead', 'tester'],
    render: renderFeedbackPage,
    destroy() {},
  });
})(window);
