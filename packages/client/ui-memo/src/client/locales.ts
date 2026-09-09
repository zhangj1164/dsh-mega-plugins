/**
 * Locale dictionaries for the memo UI.
 * @module dsh-client-ui-memo/client/locales
 */

export type MemoKey =
  | 'entryLabel' | 'entryTooltip' | 'panelTitle' | 'close'
  | 'currentWeek' | 'addPlaceholder' | 'addEntry' | 'analyze' | 'exportReport' | 'refresh'
  | 'noEntries' | 'noWeeks' | 'loading'
  | 'organize' | 'summarize' | 'analyzeLabel'
  | 'analysisResult' | 'reportResult' | 'entries'
  // Period selector (req 4)
  | 'periodWeek' | 'periodMonth' | 'periodQuarter' | 'periodYear' | 'period'
  // Week history (req 3)
  | 'weekHistory' | 'editEntry' | 'deleteEntry' | 'forceConfirm' | 'forceConfirmText' | 'confirm' | 'cancel'
  // Issue editor (req 11)
  | 'addIssue' | 'issueEditorTitle' | 'issuePlaceholder' | 'optimizeIssue' | 'issueOptimized' | 'openGithub' | 'clearIssue'
  // Log analysis (req 8, 9)
  | 'analyzeLogs' | 'logAnalysisTitle' | 'openPrefilledIssue' | 'noFailures'

export const zh: Record<MemoKey, string> = {
  entryLabel: '备忘',
  entryTooltip: '打开备忘面板',
  panelTitle: '备忘',
  close: '关闭',
  currentWeek: '本周备忘',
  addPlaceholder: '写一条备忘…',
  addEntry: '添加',
  analyze: 'AI 分析',
  exportReport: '导出报告',
  refresh: '刷新',
  noEntries: '还没有条目',
  noWeeks: '没有找到任何周',
  loading: '加载中…',
  organize: '梳理',
  summarize: '总结',
  analyzeLabel: '分析',
  analysisResult: '分析结果',
  reportResult: '报告',
  entries: '条目',
  period: '周期',
  periodWeek: '周',
  periodMonth: '月',
  periodQuarter: '季度',
  periodYear: '年',
  weekHistory: '历史周',
  editEntry: '编辑',
  deleteEntry: '删除',
  forceConfirm: '提权确认',
  forceConfirmText: '修改历史备忘会导致 AI 分析结果变化。确定要继续吗？',
  confirm: '确认',
  cancel: '取消',
  addIssue: '添加 Issue',
  issueEditorTitle: 'Issue 编辑器',
  issuePlaceholder: '用自然语言描述问题…',
  optimizeIssue: '优化 Issue',
  issueOptimized: '优化结果',
  openGithub: '在 GitHub 打开',
  clearIssue: '清除',
  analyzeLogs: '日志分析',
  logAnalysisTitle: '日志分析报告',
  openPrefilledIssue: '打开预填 Issue',
  noFailures: '没有发现失败记录',
}

export const en: Record<MemoKey, string> = {
  entryLabel: 'Memo',
  entryTooltip: 'Open memo panel',
  panelTitle: 'Memo',
  close: 'Close',
  currentWeek: 'Current Week',
  addPlaceholder: 'Write a memo entry…',
  addEntry: 'Add',
  analyze: 'AI Analyze',
  exportReport: 'Export Report',
  refresh: 'Refresh',
  noEntries: 'No entries yet',
  noWeeks: 'No weeks found',
  loading: 'Loading…',
  organize: 'Organize',
  summarize: 'Summarize',
  analyzeLabel: 'Analyze',
  analysisResult: 'Analysis',
  reportResult: 'Report',
  entries: 'entries',
  period: 'Period',
  periodWeek: 'Week',
  periodMonth: 'Month',
  periodQuarter: 'Quarter',
  periodYear: 'Year',
  weekHistory: 'Week History',
  editEntry: 'Edit',
  deleteEntry: 'Delete',
  forceConfirm: 'Privilege Confirm',
  forceConfirmText: 'Editing a past memo will change AI analysis results. Continue?',
  confirm: 'Confirm',
  cancel: 'Cancel',
  addIssue: 'Add Issue',
  issueEditorTitle: 'Issue Editor',
  issuePlaceholder: 'Describe the problem in natural language…',
  optimizeIssue: 'Optimize Issue',
  issueOptimized: 'Optimized Result',
  openGithub: 'Open on GitHub',
  clearIssue: 'Clear',
  analyzeLogs: 'Analyze Logs',
  logAnalysisTitle: 'Log Analysis Report',
  openPrefilledIssue: 'Open Prefilled Issue',
  noFailures: 'No failures recorded',
}
