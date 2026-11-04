/**
 * Locale dictionaries for the settings pages. Every user-visible string lives
 * here, including the ones only tests read, so the pages never inline prose.
 *
 * Two namespaces share this dictionary: the memo page (`MemoKey`) and the
 * GitHub-intake page (`IntakeKey`). `{sessionId}`, `{sessionTitle}`,
 * `{language}`, `{maxChars}`, `{number}`, `{title}`, `{url}`, `{body}` and
 * `{labels}` are placeholders of the owning services and are deliberately
 * untranslated: these pages explain them, they never evaluate them.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/client/locales
 */

/** Copy shared by every settings page this plugin registers. */
export type SharedKey =
  | 'save' | 'saving' | 'saved' | 'saveFailed' | 'discard' | 'reset' | 'overridden'
  | 'loading' | 'readOnly' | 'invalidNumber' | 'invalidRange'

/** One user-visible string key of the memo settings page. */
export type MemoKey =
  | SharedKey
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
  // Version and update dialog
  | 'updateCheck' | 'updateTitle' | 'updateIntro' | 'updateCurrent' | 'updateLatest'
  | 'updateChecking' | 'updateAvailable' | 'updateUpToDate' | 'updateProfile'
  | 'updateManual' | 'updateManualHint' | 'updateCopy' | 'updateCopied'
  | 'updateRecheck' | 'updateApply' | 'updateApplying' | 'updateApplied'
  | 'updateNeedsRestart' | 'updateFailed' | 'updateInstallFailed' | 'updateClose'
  // Page-specific states
  | 'unavailable'

/** One user-visible string key of the GitHub-intake settings page. */
export type IntakeKey =
  | SharedKey
  // Navigation and page chrome
  | 'intakeNav' | 'intakeTitle' | 'intakeDescription' | 'intakeUnavailable'
  // Groups
  | 'intakeGroupIntake' | 'intakeGroupAutopilot' | 'intakeGroupPrompt'
  // Field labels and hints
  | 'intakeRepoLabel' | 'intakeRepoHint'
  | 'claimLabelLabel' | 'claimLabelHint'
  | 'maxIssuesLabel' | 'maxIssuesHint'
  | 'autopilotEnabledLabel' | 'autopilotEnabledHint'
  | 'autopilotCwdLabel' | 'autopilotCwdHint'
  | 'autopilotPresetLabel' | 'autopilotPresetHint'
  | 'autopilotTimeZoneLabel' | 'autopilotTimeZoneHint'
  | 'autopilotPromptLabel' | 'autopilotPromptHint'

/** Simplified Chinese copy. */
export const zh: Record<MemoKey | IntakeKey, string> = {
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
  updateCheck: '检查更新',
  updateTitle: '备忘 更新',
  updateIntro: '仅检查并更新当前插件，不会联动安装其他插件。',
  updateCurrent: '运行版本',
  updateLatest: '最新版本',
  updateChecking: '检查中…',
  updateAvailable: '发现新版本',
  updateUpToDate: '已是最新版本',
  updateProfile: '目标 profile',
  updateManual: '手工更新',
  updateManualHint: '自动更新失败时，可在当前 DSH 终端执行以下命令，完成后重启 DSH Web。',
  updateCopy: '复制命令',
  updateCopied: '已复制',
  updateRecheck: '重新检查',
  updateApply: '自动更新',
  updateApplying: '正在更新…',
  updateApplied: '更新完成',
  updateNeedsRestart: '重启 DSH Web 后生效',
  updateFailed: '检查更新失败',
  updateInstallFailed: '自动更新失败',
  updateClose: '关闭',
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
  intakeNav: 'GitHub 接单',
  intakeTitle: 'GitHub 接单设置',
  intakeDescription: '保存后立即写入当前部署的配置；「首次启动检查」在下次启动 DSH 时生效。',
  intakeUnavailable: '当前部署没有暴露 GitHub 接单设置。',
  intakeGroupIntake: '接单',
  intakeGroupAutopilot: '自动派发',
  intakeGroupPrompt: '提示词模板',
  intakeRepoLabel: '建单仓库',
  intakeRepoHint: '创建 issue、拉取可接单列表时使用的仓库（owner/repo 或完整 URL）。',
  claimLabelLabel: '接单标签',
  claimLabelHint: '只有带这个标签的 issue 会被接单，不能留空。',
  maxIssuesLabel: '单次最多接单数',
  maxIssuesHint: '一次检查最多派发几条 issue（1–20）。',
  autopilotEnabledLabel: '首次启动检查',
  autopilotEnabledHint: '开启后，每天第一次启动 DSH 时自动检查可接单 issue；关闭则只能从面板手动接单。',
  autopilotCwdLabel: '工作目录',
  autopilotCwdHint: '派发会话的工作目录；留空跟随宿主默认目录。',
  autopilotPresetLabel: 'Agent preset',
  autopilotPresetHint: '派发会话使用的 preset；留空跟随部署默认。',
  autopilotTimeZoneLabel: '时区',
  autopilotTimeZoneHint: '「今天」按这个 IANA 时区计算，留空跟随宿主时区；非法值会回落到宿主时区。',
  autopilotPromptLabel: '派发提示词',
  autopilotPromptHint: '派发会话收到的提示词，支持 {number}、{title}、{url}、{body}、{labels} 占位符。',
}

/** English copy. */
export const en: Record<MemoKey | IntakeKey, string> = {
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
  updateCheck: 'Check for updates',
  updateTitle: 'Memo update',
  updateIntro: 'Checks and updates this plugin only; no other plugin is installed as a side effect.',
  updateCurrent: 'Running version',
  updateLatest: 'Latest version',
  updateChecking: 'Checking…',
  updateAvailable: 'New version found',
  updateUpToDate: 'Already up to date',
  updateProfile: 'Target profile',
  updateManual: 'Manual update',
  updateManualHint: 'If the automatic update fails, run this command in the current DSH terminal, then restart DSH Web.',
  updateCopy: 'Copy command',
  updateCopied: 'Copied',
  updateRecheck: 'Check again',
  updateApply: 'Update now',
  updateApplying: 'Updating…',
  updateApplied: 'Update complete',
  updateNeedsRestart: 'Restart DSH Web to apply it',
  updateFailed: 'The update check failed',
  updateInstallFailed: 'The automatic update failed',
  updateClose: 'Close',
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
  intakeNav: 'GitHub intake',
  intakeTitle: 'GitHub intake settings',
  intakeDescription: 'Saved values persist in this deployment’s configuration immediately; the first-startup check applies on the next DSH start.',
  intakeUnavailable: 'This deployment does not expose GitHub intake settings.',
  intakeGroupIntake: 'Intake',
  intakeGroupAutopilot: 'Automatic dispatch',
  intakeGroupPrompt: 'Prompt template',
  intakeRepoLabel: 'Repository',
  intakeRepoHint: 'Repository used to file issues and to list claimable ones (owner/repo or a full URL).',
  claimLabelLabel: 'Claim label',
  claimLabelHint: 'Only issues carrying this label are claimable; it cannot be blank.',
  maxIssuesLabel: 'Issues per pass',
  maxIssuesHint: 'How many issues one check may dispatch (1–20).',
  autopilotEnabledLabel: 'First-startup check',
  autopilotEnabledHint: 'When on, the first DSH start of each day checks for claimable issues; when off, intake only starts from the panel.',
  autopilotCwdLabel: 'Working directory',
  autopilotCwdHint: 'Working directory the dispatched Session owns; blank follows the host default.',
  autopilotPresetLabel: 'Agent preset',
  autopilotPresetHint: 'Preset the dispatched Session runs; blank follows the deployment default.',
  autopilotTimeZoneLabel: 'Time zone',
  autopilotTimeZoneHint: 'The IANA zone “today” is measured in; blank follows the host zone, and an invalid zone also falls back to it.',
  autopilotPromptLabel: 'Dispatch prompt',
  autopilotPromptHint: 'Prompt the dispatched Session receives; supports the {number}, {title}, {url}, {body} and {labels} placeholders.',
}
