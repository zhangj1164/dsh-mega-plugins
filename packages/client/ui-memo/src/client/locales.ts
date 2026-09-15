/**
 * Locale dictionaries for the memo board. Every user-visible string lives
 * here, including the ones only tests read, so the board never inlines prose.
 * @module dsh-client-ui-memo/client/locales
 */

export type MemoKey =
  // Shell / header
  | 'entryLabel' | 'entryTooltip' | 'panelTitle' | 'close' | 'nav'
  // Dimensions
  | 'period' | 'periodWeek' | 'periodMonth' | 'periodQuarter' | 'periodYear' | 'history' | 'yearFilter'
  // Cards
  | 'addPlaceholder' | 'addEntry' | 'noEntries' | 'noCardsInPeriod' | 'loading'
  | 'viewCard' | 'editEntry' | 'duplicateEntry' | 'deleteEntry' | 'copied' | 'copySuffix'
  // Archive
  | 'archiveQuarter' | 'unarchiveQuarter' | 'archivedTag' | 'archivedComposerHint'
  // Confirmation / errors
  | 'forceConfirmText' | 'confirm' | 'cancel' | 'confirmDeleteText' | 'dismiss'
  // Analysis
  | 'organize' | 'summarize' | 'analyzeLabel' | 'analyze' | 'exportReport' | 'refresh'
  | 'analysisResult' | 'reportResult' | 'modelLabel' | 'followDefault' | 'noModelRoute' | 'modelCatalogEmpty' | 'providerEmpty'
  // Issue editor
  | 'addIssue' | 'issueEditorTitle' | 'issuePlaceholder' | 'optimizeIssue' | 'openGithub' | 'clearIssue' | 'copyIssueBody'
  // Log analysis
  | 'analyzeLogs' | 'logAnalysisTitle' | 'openPrefilledIssue'
  // Result cards
  | 'collapse' | 'expand' | 'closeResult'

export const zh: Record<MemoKey, string> = {
  entryLabel: '备忘',
  entryTooltip: '打开备忘',
  panelTitle: '备忘',
  nav: '备忘',
  close: '关闭',
  period: '周期',
  periodWeek: '周',
  periodMonth: '月',
  periodQuarter: '季度',
  periodYear: '年',
  history: '历史',
  yearFilter: '年份',
  archiveQuarter: '归档本季度',
  unarchiveQuarter: '取消归档',
  archivedTag: '已归档',
  archivedComposerHint: '该季度已归档，取消归档后才能继续添加或编辑',
  modelLabel: '模型',
  followDefault: '跟随默认',
  noModelRoute: '未配置模型路由',
  modelCatalogEmpty: '读取不到模型注册表，暂时无法切换',
  providerEmpty: '该 provider 没有可用模型',
  addPlaceholder: '写一条备忘…',
  addEntry: '添加备忘',
  noEntries: '还没有任何备忘，先在上方添加一条',
  noCardsInPeriod: '这个周期内还没有备忘卡片',
  loading: '加载中…',
  viewCard: '查看',
  editEntry: '编辑',
  duplicateEntry: '复制',
  deleteEntry: '删除',
  copied: '已复制',
  copySuffix: '（副本）',
  forceConfirmText: '该卡片属于历史周期，保存后 AI 分析结果可能变化。',
  confirm: '确认',
  cancel: '取消',
  confirmDeleteText: '删除这条备忘？此操作不可撤销。',
  dismiss: '知道了',
  organize: '梳理',
  summarize: '总结',
  analyzeLabel: '分析',
  analyze: 'AI 分析',
  exportReport: '导出报告',
  refresh: '刷新',
  analysisResult: '分析结果',
  reportResult: '报告',
  addIssue: '添加 Issue',
  issueEditorTitle: 'Issue 编辑器',
  issuePlaceholder: '用自然语言描述问题…',
  optimizeIssue: '优化 Issue',
  openGithub: '在 GitHub 打开',
  clearIssue: '清除',
  copyIssueBody: '复制完整正文',
  analyzeLogs: '日志分析',
  logAnalysisTitle: '日志分析报告',
  openPrefilledIssue: '打开预填 Issue',
  collapse: '折叠',
  expand: '展开',
  closeResult: '关闭此卡片',
}

export const en: Record<MemoKey, string> = {
  entryLabel: 'Memo',
  entryTooltip: 'Open memo',
  panelTitle: 'Memo',
  nav: 'Memo',
  close: 'Close',
  period: 'Period',
  periodWeek: 'Week',
  periodMonth: 'Month',
  periodQuarter: 'Quarter',
  periodYear: 'Year',
  history: 'History',
  yearFilter: 'Year',
  archiveQuarter: 'Archive this quarter',
  unarchiveQuarter: 'Unarchive',
  archivedTag: 'Archived',
  archivedComposerHint: 'This quarter is archived. Unarchive it to add or edit memos.',
  modelLabel: 'Model',
  followDefault: 'Follow default',
  noModelRoute: 'No model route configured',
  modelCatalogEmpty: 'The model registry could not be read, so switching is unavailable',
  providerEmpty: 'This provider advertises no models',
  addPlaceholder: 'Write a memo…',
  addEntry: 'Add memo',
  noEntries: 'No memos yet — add one above',
  noCardsInPeriod: 'No memo cards in this period',
  loading: 'Loading…',
  viewCard: 'View',
  editEntry: 'Edit',
  duplicateEntry: 'Duplicate',
  deleteEntry: 'Delete',
  copied: 'Copied',
  copySuffix: '(copy)',
  forceConfirmText: 'This card belongs to a past period, so saving it may change AI analysis results.',
  confirm: 'Confirm',
  cancel: 'Cancel',
  confirmDeleteText: 'Delete this memo? This cannot be undone.',
  dismiss: 'Dismiss',
  organize: 'Organize',
  summarize: 'Summarize',
  analyzeLabel: 'Analyze',
  analyze: 'AI Analyze',
  exportReport: 'Export Report',
  refresh: 'Refresh',
  analysisResult: 'Analysis',
  reportResult: 'Report',
  addIssue: 'Add Issue',
  issueEditorTitle: 'Issue Editor',
  issuePlaceholder: 'Describe the problem in natural language…',
  optimizeIssue: 'Optimize Issue',
  openGithub: 'Open on GitHub',
  clearIssue: 'Clear',
  copyIssueBody: 'Copy full body',
  analyzeLogs: 'Analyze Logs',
  logAnalysisTitle: 'Log Analysis Report',
  openPrefilledIssue: 'Open Prefilled Issue',
  collapse: 'Collapse',
  expand: 'Expand',
  closeResult: 'Close this card',
}
