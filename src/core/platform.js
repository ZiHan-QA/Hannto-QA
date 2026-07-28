(function initializeHanntoQAPlatform(global) {
  'use strict';

  const pageTitles = Object.freeze({
    dashboard: '工作台',
    tasks: '工作事项',
    releases: '版本与发布',
    report: '质量报表',
    prd: 'PRD 管理',
    testmap: '全功能测试地图',
    assets: '资产管理',
    ai: 'AI 写用例',
    automation: '自动化测试',
    copy: '文案管理',
    onboarding: '团队知识库',
    cases: '用例库',
    plan: '测试计划',
    bugs: 'BUG 管理',
    members: '成员管理',
    settings: '系统设置',
    portfolio: '项目总排期',
    projects: '项目总览',
    feedback: '意见反馈',
  });

  const projectBusinessPages = Object.freeze([
    'tasks',
    'projects',
    'portfolio',
    'releases',
    'report',
    'bugs',
  ]);

  const projectUnits = Object.freeze({
    xiaomi: '小米',
    consumer: '消费',
    other: 'Other',
    unassigned: '待归属',
  });

  const modules = new Map();

  function projectUnitText(unit) {
    return projectUnits[unit] || projectUnits.other;
  }

  function registerModule(definition) {
    if (!definition || typeof definition !== 'object') {
      throw new TypeError('模块定义必须是对象');
    }
    const id = String(definition.id || '').trim();
    if (!/^[a-z0-9-]+$/.test(id)) {
      throw new Error('模块 id 只能包含小写字母、数字和短横线');
    }
    if (!definition.title || typeof definition.render !== 'function') {
      throw new Error(`模块 ${id} 必须提供 title 和 render`);
    }
    if (modules.has(id)) {
      throw new Error(`模块 ${id} 已注册`);
    }
    const normalized = Object.freeze({
      owner: '',
      version: '0.1.0',
      projectAware: false,
      permissions: Object.freeze(['admin', 'qa_lead', 'tester']),
      destroy: null,
      ...definition,
      id,
    });
    modules.set(id, normalized);
    return normalized;
  }

  function getModule(id) {
    return modules.get(id) || null;
  }

  function listModules() {
    return [...modules.values()];
  }

  global.HanntoQA = Object.freeze({
    pageTitles,
    projectBusinessPages,
    projectUnits,
    projectUnitText,
    registerModule,
    getModule,
    listModules,
  });
})(window);
