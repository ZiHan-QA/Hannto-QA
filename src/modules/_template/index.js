(function registerExampleModule(global) {
  'use strict';

  global.HanntoQA.registerModule({
    id: 'replace-me',
    title: '模块名称',
    owner: '开发负责人',
    version: '0.1.0',
    projectAware: true,
    permissions: ['admin', 'qa_lead', 'tester'],
    async render(context) {
      void context;
      throw new Error('请实现模块 render');
    },
    destroy() {},
  });
})(window);

