(function registerLeaveManagementModule(global) {
  'use strict';

  const platform = global.HanntoQA;
  if (!platform) throw new Error('HanntoQA platform is required before leave management module');

  platform.registerModule({
    id: 'leave-management',
    title: '假期管理',
    owner: 'team-resource',
    version: '0.1.0',
    projectAware: false,
    permissions: ['admin', 'qa_lead', 'tester'],
    render(context) {
      context.content.style.padding = '24px';
      context.content.innerHTML = `
        <div class="leave-page">
          <section class="leave-hero">
            <span class="leave-hero-icon"><i class="ti ti-calendar-check"></i></span>
            <div>
              <div class="leave-eyebrow">团队资源 · 独立模块</div>
              <h2>假期管理</h2>
              <p>统一承载加班、请假、审批记录和法定假日，避免与员工档案混在一起。</p>
            </div>
          </section>
          <section class="leave-overview">
            <article><i class="ti ti-clock-plus"></i><strong>加班记录</strong><span>QA 负责人提交，部门主管审批</span><em>待开发</em></article>
            <article><i class="ti ti-calendar-off"></i><strong>请假申请</strong><span>记录假期类型、时段和申请原因</span><em>待开发</em></article>
            <article><i class="ti ti-checkup-list"></i><strong>审批记录</strong><span>保留申请、审批人与状态变更轨迹</span><em>待开发</em></article>
            <article><i class="ti ti-calendar-event"></i><strong>法定假日</strong><span>由主管维护，不计入未出勤</span><em>待开发</em></article>
          </section>
          <section class="leave-next">
            <i class="ti ti-info-circle"></i>
            <div><strong>当前已完成模块拆分</strong><p>下一阶段再接入数据表、审批权限和资源容量扣减逻辑。</p></div>
          </section>
        </div>`;
    },
  });
})(window);
