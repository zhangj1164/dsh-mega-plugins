/**
 * Locale dictionaries for the memo settings page. Every user-visible string
 * lives here, including the ones only tests read, so the page never inlines
 * prose.
 *
 * `{sessionId}`, `{sessionTitle}`, `{language}` and `{maxChars}` are the memo
 * host's own placeholders and are deliberately untranslated: the page explains
 * them, it never evaluates them.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/client/locales
 */

/** One user-visible string key of the memo settings page. */
export type MemoKey =
  // Navigation and page chrome
  | 'nav' | 'title' | 'description'
  // Groups
  | 'groupAi' | 'groupSummary' | 'groupProse' | 'groupRepo'
  // Field labels and hints
  | 'providerLabel' | 'providerHint' | 'modelLabel' | 'modelHint'
  | 'languageLabel' | 'languageHint' | 'languageAuto' | 'languageZh' | 'languageEn'
  | 'maxSessionsLabel' | 'maxSessionsHint'
  | 'transcriptCharsLabel' | 'transcriptCharsHint'
  | 'maxCharsLabel' | 'maxCharsHint'
  | 'sourceTemplateLabel' | 'sourceTemplateHint'
  | 'promptLabel' | 'promptHint'
  | 'repoLabel' | 'repoHint'
  // Actions and states
  | 'save' | 'saving' | 'saved' | 'saveFailed' | 'discard' | 'reset' | 'overridden'
  | 'loading' | 'unavailable' | 'readOnly' | 'invalidNumber' | 'invalidRange'

/** Simplified Chinese copy. */
export const zh: Record<MemoKey, string> = {
  nav: '备忘',
  title: '备忘设置',
  description: '这些值保存在当前部署的配置里，保存后立即生效，不需要重启。',
  groupAi: 'AI 分析',
  groupSummary: '归档会话总结',
  groupProse: '总结文案',
  groupRepo: 'GitHub',
  providerLabel: 'Provider 路由',
  providerHint: '留空则跟随本部署的默认模型。',
  modelLabel: '模型',
  modelHint: '留空则跟随本部署的默认模型。',
  languageLabel: '输出语言',
  languageHint: '「自动」跟随请求方的语言，请求没带语言时用中文。',
  languageAuto: '自动',
  languageZh: '中文',
  languageEn: '英文',
  maxSessionsLabel: '单次最多会话数',
  maxSessionsHint: '一次总结最多接受多少个已归档会话（1–20）。每个会话消耗一次模型调用。',
  transcriptCharsLabel: '转录字符预算',
  transcriptCharsHint: '单个会话送入模型的字符上限，超出时保留头尾（1000–200000）。',
  maxCharsLabel: '默认总结字数',
  maxCharsHint: '每次总结的目标长度（100–4000）。',
  sourceTemplateLabel: '来源标注模板',
  sourceTemplateHint: '追加在每条总结之后，支持 {sessionId} 与 {sessionTitle} 占位符。',
  promptLabel: '总结提示词',
  promptHint: '作为 system 提示送给模型，支持 {language} 与 {maxChars} 占位符。',
  repoLabel: 'GitHub 仓库',
  repoHint: '从备忘生成 issue 时使用的仓库地址。',
  save: '保存',
  saving: '保存中…',
  saved: '已保存',
  saveFailed: '部署没有接受这些值，草稿已保留。',
  discard: '放弃修改',
  reset: '恢复默认',
  overridden: '已覆盖',
  loading: '正在读取部署配置…',
  unavailable: '当前部署没有暴露备忘设置。',
  readOnly: '当前部署的设置为只读。',
  invalidNumber: '请输入整数。',
  invalidRange: '超出允许范围。',
}

/** English copy. */
export const en: Record<MemoKey, string> = {
  nav: 'Memo',
  title: 'Memo settings',
  description: 'These values persist in this deployment’s configuration and apply as soon as you save; no restart is needed.',
  groupAi: 'AI analysis',
  groupSummary: 'Archived-session summaries',
  groupProse: 'Summary copy',
  groupRepo: 'GitHub',
  providerLabel: 'Provider route',
  providerHint: 'Leave blank to follow this deployment’s default model.',
  modelLabel: 'Model',
  modelHint: 'Leave blank to follow this deployment’s default model.',
  languageLabel: 'Output language',
  languageHint: 'Automatic follows the requesting client and falls back to Chinese when a request carries no language.',
  languageAuto: 'Automatic',
  languageZh: 'Chinese',
  languageEn: 'English',
  maxSessionsLabel: 'Sessions per request',
  maxSessionsHint: 'How many archived sessions one summary request accepts (1–20). Each session costs one model call.',
  transcriptCharsLabel: 'Transcript character budget',
  transcriptCharsHint: 'Character ceiling for one session sent to the model; the head and tail are kept (1000–200000).',
  maxCharsLabel: 'Default summary length',
  maxCharsHint: 'Target length for one summary, in characters (100–4000).',
  sourceTemplateLabel: 'Source annotation template',
  sourceTemplateHint: 'Appended after every summary; supports the {sessionId} and {sessionTitle} placeholders.',
  promptLabel: 'Summary prompt',
  promptHint: 'Sent to the model as the system prompt; supports the {language} and {maxChars} placeholders.',
  repoLabel: 'GitHub repository',
  repoHint: 'Repository used when an issue is generated from memos.',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  saveFailed: 'The deployment did not accept these values; your draft was kept.',
  discard: 'Discard changes',
  reset: 'Reset to default',
  overridden: 'Overridden',
  loading: 'Reading the deployment’s configuration…',
  unavailable: 'This deployment does not expose memo settings.',
  readOnly: 'This deployment’s settings are read-only.',
  invalidNumber: 'Enter a whole number.',
  invalidRange: 'Outside the allowed range.',
}
