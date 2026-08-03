(function registerDepartmentsModule(global) {
  'use strict';

  const platform = global.HanntoQA;
  if (!platform) throw new Error('HanntoQA platform is required before departments module');

  const categoryLabels = Object.freeze({
    hannto_regular: '汉图正式',
    hannto_contract: '汉图合同',
    third_party_supplier: '第三方供应商',
    unigroup_hannto: '紫光汉图',
    meijie_technology: '美捷科技',
    intern: '实习生',
  });
  const businessUnitLabels = Object.freeze({
    xiaomi: '小米',
    consumer: '消费',
    new_business: '新业务',
    other: 'Other',
  });

  let state = null;
  let clickHandler = null;
  let changeHandler = null;
  let inputHandler = null;
  let compositionStartHandler = null;
  let compositionEndHandler = null;
  let searchTimer = null;
  let searchComposing = false;

  function option(value, label, selectedValue) {
    return `<option value="${value}" ${String(selectedValue || '') === String(value) ? 'selected' : ''}>${label}</option>`;
  }

  function formatDate(value) {
    return value ? String(value).slice(0, 10) : '';
  }

  function localTodayKey() {
    if (state?.context?.localDateKey) return state.context.localDateKey(new Date());
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  }

  function memberEmploymentState(member) {
    const departureDate = formatDate(member?.departure_date);
    if (departureDate) {
      if (departureDate >= localTodayKey()) return 'departing';
      return 'departed';
    }
    return member?.employment_status === 'departed' ? 'departed' : 'active';
  }

  function memberEmploymentLabel(member) {
    const status = memberEmploymentState(member);
    if (status === 'departed') return '已离职';
    if (status === 'departing') {
      return formatDate(member.departure_date) === localTodayKey() ? '今日离职' : '即将离职';
    }
    return '在职';
  }

  function activeDepartment() {
    return state?.departments.find(item => item.id === state.departmentId) || state?.departments[0] || null;
  }

  function canManage(department) {
    return Boolean(
      department
      && (state.context.isSystemAdmin() || department.supervisor_id === state.context.currentUser.id)
    );
  }

  function profileName(profileId) {
    return state.profileMap.get(profileId)?.name || '未设置';
  }

  function supplierName(value) {
    return value === '科之锐' ? '科锐' : value;
  }

  function supplierById(id) {
    return state.suppliers.find(item => item.id === id) || null;
  }

  function projectName(id) {
    return state.projects.find(item => item.id === id)?.name || '未设置';
  }

  function memberMissingFields(member) {
    const missing = [];
    const profile = state.profileMap.get(member.member_id) || {};
    if (!profile.business_unit) missing.push('所属 BU');
    if (!member.employee_category) missing.push('员工类别');
    if (!member.reports_to_id) missing.push('汇报主管');
    if (!member.primary_qa_lead_id) missing.push('QA 负责人');
    if (!member.hire_date) missing.push('入职日期');
    if (!member.onboarding_project_id) missing.push('入职项目');
    if (member.employee_category === 'third_party_supplier') {
      if (!member.supplier_id) missing.push('供应商');
      if (!member.contract_end_date) missing.push('合同到期日');
    }
    return missing;
  }

  function memberCompletion(member) {
    const total = member.employee_category === 'third_party_supplier' ? 8 : 6;
    return Math.round(((total - memberMissingFields(member).length) / total) * 100);
  }

  function memberMatchesQuickView(member) {
    if (state.quickView === 'incomplete') return memberMissingFields(member).length > 0;
    if (state.quickView === 'supplier') return member.employee_category === 'third_party_supplier';
    if (state.quickView === 'regular') return member.employee_category === 'hannto_regular';
    if (state.quickView === 'other') {
      return ['hannto_contract', 'unigroup_hannto', 'meijie_technology', 'intern'].includes(member.employee_category);
    }
    if (state.quickView === 'departing') return memberEmploymentState(member) === 'departing';
    if (state.quickView === 'departed') return memberEmploymentState(member) === 'departed';
    return true;
  }

  function memberListHeaders() {
    if (state.quickView === 'incomplete') return ['员工', '待补充字段', '负责人', '完整度', '状态', ''];
    if (state.quickView === 'supplier') return ['员工', '供应商', '合同期限', 'QA 负责人', '状态', ''];
    if (state.quickView === 'regular') return ['员工', '入职项目', '入职日期', 'QA 负责人', '状态', ''];
    if (state.quickView === 'other') return ['员工', '员工类别', '归属项目', '入职日期', '状态', ''];
    if (state.quickView === 'departing' || state.quickView === 'departed') return ['员工', '员工类别', '离职日期', '离职原因', '状态', ''];
    return ['员工', '类别 / 项目', '负责人', '完整度', '状态', ''];
  }

  function contractExpiryText(member) {
    if (!member.contract_end_date) return ['未登记', '无法计算提醒'];
    const end = new Date(`${member.contract_end_date}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.ceil((end - today) / 86400000);
    if (days < 0) return [formatDate(member.contract_end_date), `已到期 ${Math.abs(days)} 天`];
    if (days <= 31) return [formatDate(member.contract_end_date), `还有 ${days} 天到期`];
    return [formatDate(member.contract_end_date), `还有 ${days} 天`];
  }

  function memberSearchText(member) {
    const profile = state.profileMap.get(member.member_id) || {};
    const supplier = supplierById(member.supplier_id);
    return [
      profile.name,
      profile.email,
      businessUnitLabels[profile.business_unit],
      categoryLabels[member.employee_category],
      supplier?.name,
      profileName(member.reports_to_id),
      profileName(member.primary_qa_lead_id),
      projectName(member.onboarding_project_id),
    ].filter(Boolean).join(' ');
  }

  function normalizeSearchText(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLocaleLowerCase('zh-CN')
      .replace(/[\s\-_/·，,。.;；:：()（）]+/g, ' ')
      .trim();
  }

  function fuzzyContains(haystack, needle) {
    if (!needle) return true;
    if (haystack.includes(needle)) return true;
    if (needle.length < 2) return false;
    let cursor = 0;
    for (const character of haystack) {
      if (character === needle[cursor]) cursor += 1;
      if (cursor === needle.length) return true;
    }
    return false;
  }

  function memberMatchesKeyword(member, keyword) {
    const haystack = normalizeSearchText(memberSearchText(member));
    const terms = normalizeSearchText(keyword).split(' ').filter(Boolean);
    return terms.every(term => fuzzyContains(haystack, term));
  }

  function memberCategorySelect(member) {
    return `<select class="department-input" data-field="employee_category">
      <option value="">请选择员工类别</option>
      ${Object.entries(categoryLabels).map(([value, label]) => option(value, label, member.employee_category)).join('')}
    </select>`;
  }

  function memberBusinessUnitSelect(profile) {
    return `<select class="department-input" data-field="business_unit">
      <option value="">请选择所属 BU</option>
      ${Object.entries(businessUnitLabels).map(([value, label]) => option(value, label, profile.business_unit)).join('')}
    </select>`;
  }

  function profileSelect(field, value, filter) {
    const profiles = filter ? state.profiles.filter(filter) : state.profiles;
    return `<select class="department-input" data-field="${field}">
      <option value="">未设置</option>
      ${profiles.map(profile => option(profile.id, state.context.escapeHtml(profile.name || '未命名成员'), value)).join('')}
    </select>`;
  }

  function projectSelect(member) {
    return `<select class="department-input" data-field="onboarding_project_id">
      <option value="">未设置入职项目</option>
      ${state.projects.map(project => option(project.id, state.context.escapeHtml(project.name), member.onboarding_project_id)).join('')}
    </select>`;
  }

  function renewalProjectSelect(value) {
    return `<select class="department-input" data-field="renewal_project_id">
      <option value="">未关联续约项目</option>
      ${state.projects.map(project => option(project.id, state.context.escapeHtml(project.name), value)).join('')}
    </select>`;
  }

  function supplierSelect(member) {
    const enabled = member.employee_category === 'third_party_supplier';
    return `<select class="department-input" data-field="supplier_id" ${enabled ? '' : 'disabled'}>
      <option value="">${enabled ? '请选择供应商' : '非第三方员工'}</option>
      ${state.suppliers.filter(item =>
        item.department_id === activeDepartment()?.id && item.status === 'active'
      ).map(supplier =>
        option(supplier.id, state.context.escapeHtml(supplierName(supplier.name)), member.supplier_id)
      ).join('')}
    </select>`;
  }

  function memberEditorRow(member, department) {
    const profile = state.profileMap.get(member.member_id) || {};
    const supplier = supplierById(member.supplier_id);
    const missing = memberMissingFields(member);
    const completion = memberCompletion(member);
    const renewals = state.renewals.filter(item => item.department_member_id === member.id);
    const [contractEnd, contractHint] = contractExpiryText(member);
    const employmentState = memberEmploymentState(member);
    const statusCell = `<em class="department-status ${employmentState}">${memberEmploymentLabel(member)}</em>${missing.length ? '<em class="department-status warning">待完善</em>' : ''}`;
    const completionCell = `<span class="department-completeness-cell"><span><strong>${completion}%</strong><small>${missing.length ? `缺 ${missing.length} 项` : '档案完整'}</small></span><i><b style="width:${completion}%"></b></i></span>`;
    let focusCells = `
      <span><strong>${categoryLabels[member.employee_category] || '待完善'}</strong><small>${supplier ? state.context.escapeHtml(supplierName(supplier.name)) : state.context.escapeHtml(projectName(member.onboarding_project_id))}</small></span>
      <span><strong>${state.context.escapeHtml(profileName(member.primary_qa_lead_id))}</strong><small>汇报：${state.context.escapeHtml(profileName(member.reports_to_id))}</small></span>
      ${completionCell}`;
    if (state.quickView === 'incomplete') {
      focusCells = `<span class="department-missing-cell"><strong>${missing.length ? missing.map(item => state.context.escapeHtml(item)).join('、') : '无缺失项'}</strong><small>建议优先补全关键档案</small></span>
        <span><strong>${state.context.escapeHtml(profileName(member.primary_qa_lead_id))}</strong><small>汇报：${state.context.escapeHtml(profileName(member.reports_to_id))}</small></span>
        ${completionCell}`;
    } else if (state.quickView === 'supplier') {
      focusCells = `<span><strong>${supplier ? state.context.escapeHtml(supplierName(supplier.name)) : '待选择供应商'}</strong><small>${renewals.length ? `已续约 ${renewals.length} 次` : '暂无续约记录'}</small></span>
        <span class="${member.contract_end_date && contractHint.includes('到期') ? 'department-contract-attention' : ''}"><strong>${contractEnd}</strong><small>${contractHint}</small></span>
        <span><strong>${state.context.escapeHtml(profileName(member.primary_qa_lead_id))}</strong><small>${state.context.escapeHtml(projectName(member.onboarding_project_id))}</small></span>`;
    } else if (state.quickView === 'regular') {
      focusCells = `<span><strong>${state.context.escapeHtml(projectName(member.onboarding_project_id))}</strong><small>${profile.resource_participant === false ? '不计入资源' : '计入资源'}</small></span>
        <span><strong>${formatDate(member.hire_date) || '待补充'}</strong><small>在职 ${formatDate(member.hire_date) ? '档案已登记' : '缺入职日期'}</small></span>
        <span><strong>${state.context.escapeHtml(profileName(member.primary_qa_lead_id))}</strong><small>汇报：${state.context.escapeHtml(profileName(member.reports_to_id))}</small></span>`;
    } else if (state.quickView === 'other') {
      focusCells = `<span><strong>${categoryLabels[member.employee_category] || '待完善'}</strong><small>${supplier ? state.context.escapeHtml(supplierName(supplier.name)) : '非第三方员工'}</small></span>
        <span><strong>${state.context.escapeHtml(projectName(member.onboarding_project_id))}</strong><small>QA：${state.context.escapeHtml(profileName(member.primary_qa_lead_id))}</small></span>
        <span><strong>${formatDate(member.hire_date) || '待补充'}</strong><small>${profile.resource_participant === false ? '不计入资源' : '计入资源'}</small></span>`;
    } else if (state.quickView === 'departing' || state.quickView === 'departed') {
      focusCells = `<span><strong>${categoryLabels[member.employee_category] || '未设置'}</strong><small>${state.context.escapeHtml(projectName(member.onboarding_project_id))}</small></span>
        <span><strong>${formatDate(member.departure_date) || '未登记'}</strong><small>原入职：${formatDate(member.hire_date) || '-'}</small></span>
        <span><strong>${state.context.escapeHtml(member.departure_reason || '未填写')}</strong><small>离职档案</small></span>`;
    }
    return `<button class="department-member-row ${missing.length ? 'incomplete' : ''} ${state.selectedMemberId === member.id ? 'selected' : ''}" type="button" data-member-id="${member.id}" data-profile-id="${member.member_id}">
      <span class="department-person">
        <span class="department-avatar">${state.context.escapeHtml(String(profile.name || '?').slice(0, 1))}</span>
        <span><strong>${state.context.escapeHtml(profile.name || '未命名成员')}</strong><small>${state.context.escapeHtml(state.context.dutyText(profile.role))}${profile.resource_participant === false ? ' · 不计资源' : ''}</small></span>
      </span>
      ${focusCells}
      <span>${statusCell}</span>
      <i class="ti ti-chevron-right department-row-arrow"></i>
    </button>`;
  }

  function supplierPanel(department) {
    if (!canManage(department)) return '';
    const departmentSuppliers = state.suppliers.filter(item => item.department_id === department.id);
    const editingSupplier = state.editingSupplierId === 'new'
      ? { id: '', name: '', contact_name: '', contact_phone: '', contact_email: '', notes: '', status: 'active' }
      : departmentSuppliers.find(item => item.id === state.editingSupplierId);
    const supplierRows = departmentSuppliers.map(supplier => `<article class="department-supplier-card ${state.editingSupplierId === supplier.id ? 'selected' : ''}">
      <div class="department-supplier-company">
        <span class="department-supplier-logo"><i class="ti ti-building-store"></i></span>
        <span><strong>${state.context.escapeHtml(supplierName(supplier.name))}</strong><small>${state.context.escapeHtml(supplier.notes || '暂无备注')}</small></span>
      </div>
      <div><small>联系人</small><strong>${state.context.escapeHtml(supplier.contact_name || '未设置')}</strong></div>
      <div><small>联系电话</small><strong>${state.context.escapeHtml(supplier.contact_phone || '未设置')}</strong>${supplier.contact_email ? `<small>${state.context.escapeHtml(supplier.contact_email)}</small>` : ''}</div>
      <span class="department-status ${supplier.status === 'active' ? 'active' : 'departed'}">${supplier.status === 'active' ? '启用' : '停用'}</span>
      <div class="department-supplier-row-actions">
        <button class="department-icon-btn department-edit-supplier" type="button" data-supplier-id="${supplier.id}" title="编辑供应商"><i class="ti ti-edit"></i></button>
        <button class="department-icon-btn department-toggle-supplier" type="button" data-supplier-id="${supplier.id}" data-next-status="${supplier.status === 'active' ? 'inactive' : 'active'}" title="${supplier.status === 'active' ? '停用' : '启用'}"><i class="ti ti-${supplier.status === 'active' ? 'player-pause' : 'player-play'}"></i></button>
      </div>
    </article>`).join('');
    return `<section class="page-card department-supplier-panel">
      <div class="department-toolbar">
        <div><h3>供应商档案</h3><p>维护公司名称和主要业务联系人；仅部门主管可见可管理，系统管理员保留运维权限。</p></div>
        <div class="department-supplier-toolbar-actions"><span class="department-status active">${departmentSuppliers.filter(item => item.status === 'active').length} 个启用</span><button class="btn-primary department-new-supplier" type="button"><i class="ti ti-plus"></i> 新增供应商</button></div>
      </div>
      <div class="department-supplier-workspace">
        <div class="department-supplier-list">
          <div class="department-supplier-head"><span>公司</span><span>联系人</span><span>联系方式</span><span>状态</span><span>操作</span></div>
          ${supplierRows || '<div class="department-empty">暂无供应商，点击右上角新增</div>'}
        </div>
        ${editingSupplier ? `<aside class="department-supplier-editor" data-supplier-id="${editingSupplier.id}">
          <div class="department-section-title"><div><small>${editingSupplier.id ? '编辑供应商' : '新增供应商'}</small><h4>${state.context.escapeHtml(editingSupplier.name || '供应商档案')}</h4></div><button class="department-icon-btn department-cancel-supplier" type="button"><i class="ti ti-x"></i></button></div>
          <label><span>公司名称 *</span><input class="department-input" data-field="supplier_name" maxlength="80" value="${state.context.escapeHtml(editingSupplier.name || '')}" placeholder="填写供应商公司名称"></label>
          <label><span>联系人</span><input class="department-input" data-field="contact_name" maxlength="50" value="${state.context.escapeHtml(editingSupplier.contact_name || '')}" placeholder="主要业务联系人"></label>
          <label><span>联系电话</span><input class="department-input" data-field="contact_phone" maxlength="30" value="${state.context.escapeHtml(editingSupplier.contact_phone || '')}" placeholder="手机号或座机"></label>
          <label><span>联系邮箱</span><input class="department-input" data-field="contact_email" type="email" maxlength="100" value="${state.context.escapeHtml(editingSupplier.contact_email || '')}" placeholder="name@example.com"></label>
          <label><span>备注</span><textarea class="department-input" data-field="supplier_notes" rows="3" maxlength="300" placeholder="合作范围、结算或其他说明">${state.context.escapeHtml(editingSupplier.notes || '')}</textarea></label>
          <button class="btn-primary department-save-supplier" type="button"><i class="ti ti-check"></i> ${editingSupplier.id ? '保存修改' : '创建供应商'}</button>
        </aside>` : `<aside class="department-supplier-editor department-profile-empty"><i class="ti ti-building-store"></i><strong>选择供应商</strong><span>点击列表中的编辑按钮维护公司和联系人信息。</span></aside>`}
      </div>
    </section>`;
  }

  function memberDetailPanel(department) {
    const member = state.members.find(item => item.id === state.selectedMemberId);
    if (!member) {
      return `<aside class="department-profile-panel department-profile-empty">
        <i class="ti ti-user-search"></i>
        <strong>选择一名员工</strong>
        <span>在左侧列表选择员工后，可在这里查看和维护完整档案。</span>
      </aside>`;
    }
    const profile = state.profileMap.get(member.member_id) || {};
    const manager = canManage(department);
    const editing = manager && state.editingMemberId === member.id;
    const missing = memberMissingFields(member);
    const completion = memberCompletion(member);
    const supplier = supplierById(member.supplier_id);
    const history = state.histories
      .filter(item => item.member_id === member.member_id)
      .slice(0, 3);
    const renewals = state.renewals
      .filter(item => item.department_member_id === member.id)
      .sort((a, b) => String(b.renewal_date).localeCompare(String(a.renewal_date)));
    const historyLabels = {
      hire: '入职',
      departure: '离职',
      category_change: '类别变更',
      transfer: '转岗',
      conversion: '转正',
      contract_renewal: '合同续签',
    };

    if (editing) {
      return `<aside class="department-profile-panel editing" data-member-id="${member.id}" data-profile-id="${member.member_id}">
        <div class="department-profile-head">
          <div><span>编辑员工档案</span><h3>${state.context.escapeHtml(profile.name || '未命名成员')}</h3><small>${state.context.escapeHtml(state.context.dutyText(profile.role))}</small></div>
          <button class="department-icon-btn department-cancel-edit" type="button" title="取消编辑"><i class="ti ti-x"></i></button>
        </div>
        <div class="department-profile-scroll">
          <section><h4>任职信息</h4><div class="department-form-grid">
            <label><span>所属 BU *</span>${memberBusinessUnitSelect(profile)}</label>
            <label><span>员工类别 *</span>${memberCategorySelect(member)}</label>
            <label><span>第三方供应商</span>${supplierSelect(member)}</label>
            <label><span>汇报主管</span>${profileSelect('reports_to_id', member.reports_to_id)}</label>
            <label><span>主要 QA 负责人</span>${profileSelect('primary_qa_lead_id', member.primary_qa_lead_id, item => item.role === 'qa_lead' || item.role === 'admin')}</label>
          </div></section>
          <section><h4>入职信息</h4><div class="department-form-grid">
            <label><span>入职日期 *</span><input class="department-input" data-field="hire_date" type="date" value="${formatDate(member.hire_date)}"></label>
            <label><span>入职项目</span>${projectSelect(member)}</label>
          </div></section>
          <section class="department-contract-fields ${member.employee_category === 'third_party_supplier' ? '' : 'is-hidden'}"><h4>第三方合同期限</h4><div class="department-form-grid">
            <label><span>首次合同开始日</span><div class="department-derived-field"><strong>${formatDate(member.hire_date) || '请先填写入职日期'}</strong><small>自动取入职日期</small></div></label>
            <label><span>合同到期日 *</span><input class="department-input" data-field="contract_end_date" type="date" value="${formatDate(member.contract_end_date)}"></label>
          </div><p class="department-field-hint"><i class="ti ti-bell"></i> 合同到期日将作为后续提前 1 个月提醒的依据。</p></section>
          <section><h4>离职信息</h4><div class="department-form-grid">
            <label><span>离职日期</span><input class="department-input" data-field="departure_date" type="date" value="${formatDate(member.departure_date)}"></label>
            <label class="department-form-wide"><span>离职原因</span><textarea class="department-input" data-field="departure_reason" rows="3" maxlength="200" placeholder="离职时填写">${state.context.escapeHtml(member.departure_reason || '')}</textarea></label>
          </div></section>
        </div>
        <div class="department-profile-actions"><button class="btn-secondary department-cancel-edit" type="button">取消</button><button class="btn-primary department-save-member" type="button"><i class="ti ti-check"></i> 保存档案</button></div>
      </aside>`;
    }

    return `<aside class="department-profile-panel" data-member-id="${member.id}" data-profile-id="${member.member_id}">
      <div class="department-profile-head">
        <div class="department-profile-identity">
          <span class="department-avatar large">${state.context.escapeHtml(String(profile.name || '?').slice(0, 1))}</span>
          <span><small>员工档案</small><h3>${state.context.escapeHtml(profile.name || '未命名成员')}</h3><em>${state.context.escapeHtml(state.context.dutyText(profile.role))}${profile.resource_participant === false ? ' · 不计入资源' : ''}</em></span>
        </div>
        ${manager ? '<button class="department-icon-btn department-start-edit" type="button" title="编辑档案"><i class="ti ti-edit"></i></button>' : ''}
      </div>
      <div class="department-profile-scroll">
        <section class="department-completeness">
          <div><span>档案完整度</span><strong>${completion}%</strong></div>
          <i><b style="width:${completion}%"></b></i>
          ${missing.length ? `<p><i class="ti ti-alert-circle"></i> 待补充：${missing.map(item => state.context.escapeHtml(item)).join('、')}</p>` : '<p class="complete"><i class="ti ti-circle-check"></i> 关键档案已完整</p>'}
        </section>
        <section class="department-detail-section">
          <h4>任职关系</h4>
          <dl><div><dt>所属 BU</dt><dd>${businessUnitLabels[profile.business_unit] || '待归属'}</dd></div>
          <div><dt>员工类别</dt><dd>${categoryLabels[member.employee_category] || '待完善'}</dd></div>
          <div><dt>供应商</dt><dd>${supplier ? state.context.escapeHtml(supplierName(supplier.name)) : '-'}</dd></div>
          <div><dt>汇报主管</dt><dd>${state.context.escapeHtml(profileName(member.reports_to_id))}</dd></div>
          <div><dt>QA 负责人</dt><dd>${state.context.escapeHtml(profileName(member.primary_qa_lead_id))}</dd></div></dl>
        </section>
        <section class="department-detail-section">
          <h4>入离职信息</h4>
          <dl><div><dt>入职日期</dt><dd>${formatDate(member.hire_date) || '-'}</dd></div>
          <div><dt>入职项目</dt><dd>${state.context.escapeHtml(projectName(member.onboarding_project_id))}</dd></div>
          <div><dt>当前状态</dt><dd><span class="department-status ${memberEmploymentState(member)}">${memberEmploymentLabel(member)}</span></dd></div>
          <div><dt>离职日期</dt><dd>${formatDate(member.departure_date) || '-'}</dd></div></dl>
        </section>
        ${member.employee_category === 'third_party_supplier' ? `<section class="department-detail-section department-contract-summary">
          <div class="department-section-title"><h4>第三方合同期限</h4><span class="department-status ${member.contract_end_date ? 'active' : 'warning'}">${renewals.length ? `已续约 ${renewals.length} 次` : (member.contract_end_date ? '已登记' : '待补充')}</span></div>
          <dl><div><dt>首次合同开始日</dt><dd>${formatDate(member.hire_date || member.contract_start_date) || '-'}</dd></div>
          <div><dt>合同到期日</dt><dd>${formatDate(member.contract_end_date) || '-'}</dd></div></dl>
          <p><i class="ti ti-bell"></i> 后续将按到期日提前 1 个月提醒主管和对应 QA 负责人。</p>
          ${renewals[0] ? `<div class="department-last-renewal"><span>最近续约</span><strong>${formatDate(renewals[0].renewal_date)}</strong><small>${formatDate(renewals[0].previous_end_date) || '-'} → ${formatDate(renewals[0].new_end_date)}</small></div>` : ''}
          ${manager && !state.contractMode ? '<div class="department-contract-actions"><button class="btn-secondary department-open-renewal" type="button">合同续约</button><button class="department-link department-open-history" type="button">补录历史</button></div>' : ''}
          ${manager && state.contractMode ? `<div class="department-renewal-form" data-member-id="${member.id}">
            <div class="department-section-title"><strong>${state.contractMode === 'history' ? '补录历史续约' : '合同续约'}</strong><button class="department-icon-btn department-cancel-renewal" type="button"><i class="ti ti-x"></i></button></div>
            ${state.contractMode === 'history' ? `<label><span>原合同到期日</span><input class="department-input" data-field="previous_end_date" type="date"></label>` : `<div class="department-renewal-baseline">当前到期日：<strong>${formatDate(member.contract_end_date) || '未设置'}</strong></div>`}
            <label><span>续约日期 *</span><input class="department-input" data-field="renewal_date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
            <label><span>新合同到期日 *</span><input class="department-input" data-field="new_end_date" type="date"></label>
            <label><span>续约项目</span>${renewalProjectSelect('')}</label>
            <label><span>备注</span><textarea class="department-input" data-field="renewal_notes" rows="2" maxlength="200"></textarea></label>
            <button class="btn-primary department-save-renewal" type="button">${state.contractMode === 'history' ? '保存历史记录' : '确认续约'}</button>
          </div>` : ''}
        </section>` : ''}
        <section class="department-detail-section">
          <div class="department-section-title"><h4>最近变更</h4>${state.context.isSystemAdmin() ? '<button class="department-link department-go-accounts" type="button">账号与权限 <i class="ti ti-arrow-right"></i></button>' : ''}</div>
          <div class="department-history-list">${history.length ? history.map(item => `<article><i class="ti ti-history"></i><span><strong>${historyLabels[item.change_type] || '档案变更'}</strong><small>${formatDate(item.effective_date)}${item.notes ? ` · ${state.context.escapeHtml(item.notes)}` : ''}</small></span></article>`).join('') : '<div class="department-history-empty">暂无变更记录</div>'}</div>
        </section>
      </div>
      ${manager ? '<div class="department-profile-actions"><button class="btn-primary department-start-edit" type="button"><i class="ti ti-edit"></i> 编辑员工档案</button></div>' : ''}
    </aside>`;
  }

  function render() {
    const { content, escapeHtml } = state.context;
    const department = activeDepartment();
    if (!department) {
      content.innerHTML = `<div class="page-card"><div class="department-empty">当前账号尚未加入任何部门</div></div>`;
      return;
    }
    state.departmentId = department.id;
    const members = state.members
      .filter(item => item.department_id === department.id)
      .filter(memberMatchesQuickView)
      .filter(item => {
        const keyword = state.filter.keyword.trim();
        if (keyword && !memberMatchesKeyword(item, keyword)) return false;
        if (state.filter.category && item.employee_category !== state.filter.category) return false;
        if (state.filter.status && memberEmploymentState(item) !== state.filter.status) return false;
        return true;
      });
    const departmentMembers = state.members.filter(item => item.department_id === department.id);
    const activeCount = departmentMembers.filter(item => memberEmploymentState(item) !== 'departed').length;
    // Keep the metric, quick view, row badge and “next incomplete” action on
    // exactly the same definition. Previously the metric checked only two
    // fields while the list checked the full archive, so the numbers diverged.
    const incompleteCount = departmentMembers.filter(item => memberMissingFields(item).length > 0).length;
    const manager = canManage(department);
    const departmentSuppliers = state.suppliers.filter(item => item.department_id === department.id && item.status === 'active');
    if (state.view === 'suppliers' && !manager) state.view = 'members';
    if (!members.some(item => item.id === state.selectedMemberId)) {
      state.selectedMemberId = members[0]?.id || null;
      state.editingMemberId = null;
    }
    const quickViews = [
      ['all', '全部员工', departmentMembers.length, 'ti-users'],
      ['incomplete', '待完善档案', incompleteCount, 'ti-alert-circle'],
      ['supplier', '第三方员工', departmentMembers.filter(item => item.employee_category === 'third_party_supplier').length, 'ti-building-store'],
      ['regular', '正式员工', departmentMembers.filter(item => item.employee_category === 'hannto_regular').length, 'ti-user-check'],
      ['other', 'Other', departmentMembers.filter(item => ['hannto_contract', 'unigroup_hannto', 'meijie_technology', 'intern'].includes(item.employee_category)).length, 'ti-category-2'],
      ['departing', '即将离职', departmentMembers.filter(item => memberEmploymentState(item) === 'departing').length, 'ti-calendar-time'],
      ['departed', '已离职', departmentMembers.filter(item => memberEmploymentState(item) === 'departed').length, 'ti-user-off'],
    ];

    content.style.padding = '24px';
    content.innerHTML = `<div class="department-page">
      <section class="department-workspace-hero">
        <div class="department-hero-main">
          <span class="department-hero-icon"><i class="ti ti-id-badge-2"></i></span>
          <div><div class="department-eyebrow">团队资源 · 部门管理</div><h2>${escapeHtml(department.name)}</h2><p>${escapeHtml(department.description || '集中维护员工类别、汇报关系、入离职和历史变更')}</p></div>
        </div>
        <div class="department-hero-actions">
          <div class="department-tabs">${state.departments.map(item => `<button class="department-tab ${item.id === department.id ? 'active' : ''}" data-department-id="${item.id}">${escapeHtml(item.name)}</button>`).join('')}</div>
          <span class="department-supervisor-badge"><i class="ti ti-crown"></i> 主管：李旭光</span>
        </div>
      </section>

      <section class="department-metric-strip">
        <article><i class="ti ti-users"></i><span><small>在职员工</small><strong>${activeCount}</strong></span></article>
        <article class="${incompleteCount ? 'warning' : ''}"><i class="ti ti-file-alert"></i><span><small>待完善档案</small><strong>${incompleteCount}</strong></span></article>
        <article><i class="ti ti-building-store"></i><span><small>启用供应商</small><strong>${manager ? departmentSuppliers.length : '-'}</strong></span></article>
        <article><i class="ti ti-user-check"></i><span><small>档案完整率</small><strong>${departmentMembers.length ? Math.round(departmentMembers.reduce((sum, item) => sum + memberCompletion(item), 0) / departmentMembers.length) : 0}%</strong></span></article>
      </section>

      <nav class="department-view-tabs">
        <button class="${state.view === 'members' ? 'active' : ''}" type="button" data-department-view="members"><i class="ti ti-users"></i> 员工档案 <span>${departmentMembers.length}</span></button>
        ${manager ? `<button class="${state.view === 'suppliers' ? 'active' : ''}" type="button" data-department-view="suppliers"><i class="ti ti-building-store"></i> 供应商 <span>${departmentSuppliers.length}</span></button>` : ''}
        <button type="button" disabled><i class="ti ti-file-time"></i> 合同与提醒 <small>后续</small></button>
      </nav>

      ${state.view === 'members' ? `<section class="department-workspace-grid">
        <aside class="department-quick-panel">
          <div class="department-panel-label">快速视图</div>
          <div class="department-quick-list">${quickViews.map(([id, label, count, icon]) => `<button class="${state.quickView === id ? 'active' : ''}" type="button" data-quick-view="${id}"><i class="ti ${icon}"></i><span>${label}</span><b>${count}</b></button>`).join('')}</div>
          ${incompleteCount ? `<button class="department-next-incomplete" type="button"><i class="ti ti-arrow-down"></i> 定位下一份待完善</button>` : '<div class="department-all-complete"><i class="ti ti-circle-check"></i> 关键档案已完善</div>'}
        </aside>
        <main class="department-list-panel">
          <div class="department-list-toolbar">
            <div><h3>员工档案</h3><p>共 ${members.length} 人 · 点击员工在右侧查看详情</p></div>
            <div class="department-filters">
              <label class="department-search"><i class="ti ti-search"></i><input id="departmentKeyword" type="search" lang="zh-CN" inputmode="search" enterkeyhint="search" autocomplete="off" value="${escapeHtml(state.filter.keyword)}" placeholder="搜索姓名、项目、供应商"></label>
              <select class="department-input" id="departmentCategoryFilter"><option value="">全部类别</option>${Object.entries(categoryLabels).map(([value, label]) => option(value, label, state.filter.category)).join('')}</select>
              <select class="department-input" id="departmentStatusFilter">${option('', '全部状态', state.filter.status)}${option('active', '在职', state.filter.status)}${option('departing', '即将离职', state.filter.status)}${option('departed', '已离职', state.filter.status)}</select>
            </div>
          </div>
          <div class="department-compact-head">${memberListHeaders().map(label => `<span>${escapeHtml(label)}</span>`).join('')}</div>
          <div class="department-member-list">${members.map(member => memberEditorRow(member, department)).join('') || '<div class="department-empty">没有符合当前筛选条件的员工</div>'}</div>
        </main>
        ${memberDetailPanel(department)}
      </section>` : supplierPanel(department)}
    </div>`;
  }

  async function load(context) {
    context.content.style.padding = '24px';
    context.content.innerHTML = '<div class="page-card"><div class="department-empty">正在加载部门与员工档案…</div></div>';
    const [departmentsResult, membersResult, profilesResult, suppliersResult, projectsResult, historiesResult, renewalsResult] = await Promise.all([
      context.sb.from('departments').select('*').eq('status', 'active').order('name'),
      context.sb.from('department_members').select('*').order('created_at'),
      context.sb.from('profiles').select('*').order('name'),
      context.sb.from('department_suppliers').select('*').order('name'),
      context.sb.from('qa_projects').select('id,name,business_unit').eq('status', 'active').order('name'),
      context.sb.from('employment_change_history').select('*').order('effective_date', { ascending: false }),
      context.sb.from('department_contract_renewals').select('*').order('renewal_date', { ascending: false }),
    ]);
    if (departmentsResult.error) throw departmentsResult.error;
    if (membersResult.error) throw membersResult.error;
    if (profilesResult.error) throw profilesResult.error;
    if (suppliersResult.error) throw suppliersResult.error;
    if (projectsResult.error) throw projectsResult.error;
    if (historiesResult.error) console.warn('[departments] history load skipped:', historiesResult.error);
    if (renewalsResult.error) console.warn('[departments] contract renewals load skipped:', renewalsResult.error);

    state = {
      context,
      departments: departmentsResult.data || [],
      members: membersResult.data || [],
      profiles: profilesResult.data || [],
      suppliers: suppliersResult.data || [],
      projects: projectsResult.data || [],
      histories: historiesResult.data || [],
      renewals: renewalsResult.data || [],
      profileMap: new Map((profilesResult.data || []).map(profile => [profile.id, profile])),
      departmentId: state?.departmentId || departmentsResult.data?.[0]?.id || '',
      filter: state?.filter || { keyword: '', category: '', status: '' },
      quickView: state?.quickView || 'all',
      view: state?.view || 'members',
      selectedMemberId: state?.selectedMemberId || null,
      editingMemberId: state?.editingMemberId || null,
      contractMode: state?.contractMode || null,
      editingSupplierId: state?.editingSupplierId || null,
    };
    render();
  }

  async function saveMember(row) {
    const memberId = row.dataset.memberId;
    const current = state.members.find(item => item.id === memberId);
    if (!current) return;
    const read = field => row.querySelector(`[data-field="${field}"]`)?.value || null;
    const next = {
      employee_category: read('employee_category'),
      supplier_id: read('supplier_id'),
      reports_to_id: read('reports_to_id'),
      primary_qa_lead_id: read('primary_qa_lead_id'),
      hire_date: read('hire_date'),
      onboarding_project_id: read('onboarding_project_id'),
      contract_start_date: null,
      contract_end_date: read('contract_end_date'),
      departure_date: read('departure_date'),
      departure_reason: read('departure_reason') || '',
    };
    next.employment_status = next.departure_date && next.departure_date < localTodayKey() ? 'departed' : 'active';
    const businessUnit = read('business_unit');
    if (!businessUnit) {
      state.context.showToast('请选择成员所属 BU', 'error');
      return;
    }
    if (!next.employee_category) {
      state.context.showToast('请选择员工类别', 'error');
      return;
    }
    if (!next.hire_date) {
      state.context.showToast('请填写入职日期', 'error');
      return;
    }
    if (next.employee_category === 'third_party_supplier') {
      next.contract_start_date = next.hire_date;
    }
    if (next.employee_category === 'third_party_supplier' && !next.supplier_id) {
      state.context.showToast('第三方供应商员工必须选择供应商', 'error');
      return;
    }
    if (next.employee_category === 'third_party_supplier' && (!next.contract_start_date || !next.contract_end_date)) {
      state.context.showToast('第三方员工必须填写完整合同期限', 'error');
      return;
    }
    if (next.contract_start_date && next.contract_end_date && next.contract_end_date < next.contract_start_date) {
      state.context.showToast('合同到期日不能早于合同开始日', 'error');
      return;
    }
    if (next.employee_category !== 'third_party_supplier') {
      next.supplier_id = null;
      next.contract_start_date = null;
      next.contract_end_date = null;
    }
    const { error } = await state.context.sb.from('department_members').update(next).eq('id', memberId);
    if (error) throw error;
    const profileResult = await state.context.sb.from('profiles')
      .update({ business_unit: businessUnit })
      .eq('id', current.member_id);
    if (profileResult.error) throw profileResult.error;

    const history = [];
    if (!current.hire_date && next.hire_date) {
      history.push({
        member_id: current.member_id,
        department_id: current.department_id,
        change_type: 'hire',
        effective_date: next.hire_date,
        previous_values: {},
        new_values: {
          employee_category: next.employee_category,
          supplier_id: next.supplier_id,
          onboarding_project_id: next.onboarding_project_id,
        },
        notes: '补充员工入职档案',
      });
    }
    if (current.employee_category !== next.employee_category) {
      history.push({
        member_id: current.member_id,
        department_id: current.department_id,
        change_type: 'category_change',
        effective_date: new Date().toISOString().slice(0, 10),
        previous_values: { employee_category: current.employee_category, supplier_id: current.supplier_id },
        new_values: { employee_category: next.employee_category, supplier_id: next.supplier_id },
        notes: '人员档案页面更新员工类别',
      });
    }
    if (!current.departure_date && next.departure_date) {
      history.push({
        member_id: current.member_id,
        department_id: current.department_id,
        change_type: 'departure',
        effective_date: next.departure_date,
        previous_values: { employment_status: current.employment_status },
        new_values: { employment_status: next.employment_status, departure_reason: next.departure_reason },
        notes: next.departure_date >= localTodayKey()
          ? `计划于 ${next.departure_date} 离职${next.departure_reason ? `：${next.departure_reason}` : ''}`
          : (next.departure_reason || '员工离职'),
      });
    }
    if (history.length) {
      const historyResult = await state.context.sb.from('employment_change_history').insert(history);
      if (historyResult.error) throw historyResult.error;
    }
    state.editingMemberId = null;
    state.context.showToast('员工档案已保存');
    await load(state.context);
  }

  async function saveSupplier(editor) {
    const department = activeDepartment();
    const read = field => editor.querySelector(`[data-field="${field}"]`)?.value.trim() || '';
    const name = read('supplier_name');
    if (!department || !name) {
      state.context.showToast('请填写公司名称', 'error');
      return;
    }
    const contactEmail = read('contact_email');
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      state.context.showToast('请填写正确的联系邮箱', 'error');
      return;
    }
    const payload = {
      department_id: department.id,
      name,
      contact_name: read('contact_name'),
      contact_phone: read('contact_phone'),
      contact_email: contactEmail,
      notes: read('supplier_notes'),
    };
    const supplierId = editor.dataset.supplierId;
    const query = supplierId
      ? state.context.sb.from('department_suppliers').update(payload).eq('id', supplierId)
      : state.context.sb.from('department_suppliers').insert(payload);
    const { error } = await query;
    if (error) throw error;
    state.editingSupplierId = null;
    state.context.showToast(supplierId ? '供应商档案已更新' : '供应商已新增');
    await load(state.context);
  }

  async function toggleSupplier(button) {
    const { error } = await state.context.sb.from('department_suppliers')
      .update({ status: button.dataset.nextStatus })
      .eq('id', button.dataset.supplierId);
    if (error) throw error;
    state.context.showToast('供应商状态已更新');
    await load(state.context);
  }

  async function saveContractRenewal(form) {
    const member = state.members.find(item => item.id === form.dataset.memberId);
    if (!member) return;
    const read = field => form.querySelector(`[data-field="${field}"]`)?.value || null;
    const renewalDate = read('renewal_date');
    const newEndDate = read('new_end_date');
    const previousEndDate = read('previous_end_date');
    if (!renewalDate || !newEndDate) {
      state.context.showToast('请填写续约日期和新合同到期日', 'error');
      return;
    }
    const historical = state.contractMode === 'history';
    if (historical && !previousEndDate) {
      state.context.showToast('补录历史时请填写原合同到期日', 'error');
      return;
    }
    const { error } = await state.context.sb.rpc('save_department_contract_renewal', {
      target_department_member_id: member.id,
      target_renewal_date: renewalDate,
      target_new_end_date: newEndDate,
      target_renewal_project_id: read('renewal_project_id'),
      target_notes: read('renewal_notes') || '',
      target_is_historical: historical,
      target_previous_end_date: historical ? previousEndDate : null,
    });
    if (error) throw error;
    state.contractMode = null;
    state.context.showToast(historical ? '历史续约已补录' : '合同续约已保存');
    await load(state.context);
  }

  function refreshMemberDetail() {
    const currentPanel = state.context.content.querySelector('.department-profile-panel');
    if (!currentPanel) {
      render();
      return;
    }
    currentPanel.outerHTML = memberDetailPanel(activeDepartment());
  }

  function selectMember(memberId) {
    state.selectedMemberId = memberId || null;
    state.editingMemberId = null;
    state.contractMode = null;
    state.context.content.querySelectorAll('.department-member-row').forEach(row => {
      row.classList.toggle('selected', row.dataset.memberId === state.selectedMemberId);
    });
    refreshMemberDetail();
  }

  function scheduleKeywordRender(input, immediate = false) {
    if (searchTimer) clearTimeout(searchTimer);
    const cursor = input?.selectionStart ?? String(state.filter.keyword || '').length;
    searchTimer = setTimeout(() => {
      searchTimer = null;
      // A pending render may have been scheduled just before an IME session
      // starts. Replacing the input during composition drops the selected
      // Chinese candidate, so wait until compositionend has fully settled.
      if (searchComposing) {
        scheduleKeywordRender(state.context.content.querySelector('#departmentKeyword'));
        return;
      }
      render();
      const keyword = state.context.content.querySelector('#departmentKeyword');
      if (!keyword) return;
      keyword.focus({ preventScroll: true });
      const nextCursor = Math.min(cursor, keyword.value.length);
      keyword.setSelectionRange(nextCursor, nextCursor);
    }, immediate ? 80 : 260);
  }

  function bindEvents() {
    const content = state.context.content;
    clickHandler = async event => {
      const departmentTab = event.target.closest('[data-department-id]');
      if (departmentTab) {
        state.departmentId = departmentTab.dataset.departmentId;
        state.filter = { keyword: '', category: '', status: '' };
        state.quickView = 'all';
        state.view = 'members';
        state.selectedMemberId = null;
        state.editingMemberId = null;
        state.contractMode = null;
        state.editingSupplierId = null;
        render();
        return;
      }
      const viewTab = event.target.closest('[data-department-view]');
      if (viewTab) {
        state.view = viewTab.dataset.departmentView;
        state.editingMemberId = null;
        state.contractMode = null;
        state.editingSupplierId = null;
        render();
        return;
      }
      const quickView = event.target.closest('[data-quick-view]');
      if (quickView) {
        state.quickView = quickView.dataset.quickView;
        state.filter.category = '';
        state.filter.status = '';
        state.selectedMemberId = null;
        state.editingMemberId = null;
        state.contractMode = null;
        render();
        return;
      }
      const memberRow = event.target.closest('.department-member-row');
      if (memberRow) {
        selectMember(memberRow.dataset.memberId);
        return;
      }
      if (event.target.closest('.department-start-edit')) {
        state.editingMemberId = state.selectedMemberId;
        state.contractMode = null;
        refreshMemberDetail();
        return;
      }
      if (event.target.closest('.department-cancel-edit')) {
        state.editingMemberId = null;
        refreshMemberDetail();
        return;
      }
      if (event.target.closest('.department-next-incomplete')) {
        const candidates = state.members.filter(item =>
          item.department_id === activeDepartment()?.id && memberMissingFields(item).length > 0
        );
        const currentIndex = candidates.findIndex(item => item.id === state.selectedMemberId);
        state.selectedMemberId = candidates[(currentIndex + 1) % candidates.length]?.id || null;
        state.quickView = 'incomplete';
        state.editingMemberId = null;
        state.contractMode = null;
        render();
        return;
      }
      if (event.target.closest('.department-open-renewal')) {
        state.contractMode = 'renewal';
        refreshMemberDetail();
        return;
      }
      if (event.target.closest('.department-open-history')) {
        state.contractMode = 'history';
        refreshMemberDetail();
        return;
      }
      if (event.target.closest('.department-cancel-renewal')) {
        state.contractMode = null;
        refreshMemberDetail();
        return;
      }
      if (event.target.closest('.department-go-accounts')) {
        global.navTo?.('members');
        return;
      }
      if (event.target.closest('.department-new-supplier')) {
        state.editingSupplierId = 'new';
        render();
        return;
      }
      const editSupplier = event.target.closest('.department-edit-supplier');
      if (editSupplier) {
        state.editingSupplierId = editSupplier.dataset.supplierId;
        render();
        return;
      }
      if (event.target.closest('.department-cancel-supplier')) {
        state.editingSupplierId = null;
        render();
        return;
      }
      try {
        if (event.target.closest('.department-save-member')) await saveMember(event.target.closest('[data-member-id]'));
        else if (event.target.closest('.department-save-renewal')) await saveContractRenewal(event.target.closest('[data-member-id]'));
        else if (event.target.closest('.department-save-supplier')) await saveSupplier(event.target.closest('[data-supplier-id]'));
        else if (event.target.closest('.department-toggle-supplier')) await toggleSupplier(event.target.closest('.department-toggle-supplier'));
      } catch (error) {
        console.error('[departments] operation failed:', error);
        state.context.showToast('操作失败：' + error.message, 'error');
      }
    };
    changeHandler = event => {
      if (event.target.id === 'departmentCategoryFilter') {
        state.filter.category = event.target.value;
        render();
      } else if (event.target.id === 'departmentStatusFilter') {
        state.filter.status = event.target.value;
        render();
      } else if (event.target.matches('[data-field="employee_category"]')) {
        const editor = event.target.closest('[data-member-id]');
        const supplier = editor?.querySelector('[data-field="supplier_id"]');
        const contractFields = editor?.querySelector('.department-contract-fields');
        if (!supplier) return;
        const enabled = event.target.value === 'third_party_supplier';
        supplier.disabled = !enabled;
        if (!enabled) supplier.value = '';
        contractFields?.classList.toggle('is-hidden', !enabled);
        if (!enabled && contractFields) {
          contractFields.querySelectorAll('input').forEach(input => { input.value = ''; });
        }
      }
    };
    inputHandler = event => {
      if (event.target.matches('[data-field="hire_date"]')) {
        const derived = event.target.closest('[data-member-id]')?.querySelector('.department-derived-field strong');
        if (derived) derived.textContent = event.target.value || '请先填写入职日期';
        return;
      }
      if (event.target.id !== 'departmentKeyword') return;
      state.filter.keyword = event.target.value;
      // Never replace the input while a Chinese IME is composing text. Doing
      // so cancels the composition and makes the field appear English-only.
      if (searchComposing || event.isComposing) return;
      scheduleKeywordRender(event.target);
    };
    compositionStartHandler = event => {
      if (event.target.id === 'departmentKeyword') searchComposing = true;
    };
    compositionEndHandler = event => {
      if (event.target.id !== 'departmentKeyword') return;
      searchComposing = false;
      state.filter.keyword = event.target.value;
      // Do not redraw synchronously here. Chromium commits the final Chinese
      // character in a trailing input event after compositionend.
      scheduleKeywordRender(event.target);
    };
    content.addEventListener('click', clickHandler);
    content.addEventListener('change', changeHandler);
    content.addEventListener('input', inputHandler);
    content.addEventListener('compositionstart', compositionStartHandler);
    content.addEventListener('compositionend', compositionEndHandler);
  }

  platform.registerModule({
    id: 'departments',
    title: '部门管理',
    owner: 'team-resource',
    version: '1.0.0',
    projectAware: false,
    permissions: ['admin'],
    async render(context) {
      if (state?.context?.content && clickHandler) {
        state.context.content.removeEventListener('click', clickHandler);
        state.context.content.removeEventListener('change', changeHandler);
        state.context.content.removeEventListener('input', inputHandler);
        state.context.content.removeEventListener('compositionstart', compositionStartHandler);
        state.context.content.removeEventListener('compositionend', compositionEndHandler);
      }
      if (searchTimer) clearTimeout(searchTimer);
      try {
        await load(context);
        bindEvents();
      } catch (error) {
        console.error('[departments] load failed:', error);
        context.content.innerHTML = `<div class="page-card"><div class="department-empty">部门管理加载失败：${context.escapeHtml(error.message)}<br><small>请先执行 20260730_department_management_foundation.sql</small></div></div>`;
      }
    },
    destroy() {
      if (state?.context?.content && clickHandler) {
        state.context.content.removeEventListener('click', clickHandler);
        state.context.content.removeEventListener('change', changeHandler);
        state.context.content.removeEventListener('input', inputHandler);
        state.context.content.removeEventListener('compositionstart', compositionStartHandler);
        state.context.content.removeEventListener('compositionend', compositionEndHandler);
      }
      if (searchTimer) clearTimeout(searchTimer);
      clickHandler = null;
      changeHandler = null;
      inputHandler = null;
      compositionStartHandler = null;
      compositionEndHandler = null;
      searchTimer = null;
      searchComposing = false;
    },
  });
})(window);
