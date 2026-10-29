/**
 * `openwiki` namespace dictionaries: the Sidebar entry, the tab chip, the pane's
 * toolbar, the environment readout, and the update affordances.
 *
 * The Chinese dictionary is the key-set source of truth and the English one is
 * typed against it, so a key added to one and forgotten in the other is a
 * compile error rather than a missing string at runtime.
 *
 * @module @zhangj1164/dsh-openwiki-visualize/client/locales
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'openwiki'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav': 'OpenWiki',
  'nav.tooltip': '预览 OpenWiki',
  'nav.disabled.noWiki': '当前工作区没有 OpenWiki',
  'nav.disabled.noTool': '未检测到可用的 openwiki',
  'nav.busy': '正在启动 OpenWiki 预览',

  'tab.title': 'OpenWiki',

  'pane.reload': '重新加载',
  'pane.external': '在浏览器中打开',
  'pane.stop': '停止',
  'pane.start': '启动预览',

  'status.running': '运行中',
  'status.starting': '启动中…',
  'status.stopped': '未运行',

  'empty.noWiki': '当前工作区没有 OpenWiki。请在项目根目录运行 `openwiki --init` 生成后重试。',
  'empty.noTool': '未检测到 openwiki。请先安装：`npm install -g openwiki`。',
  'empty.belowMinimum': 'openwiki 版本低于最低要求 {minimum}，请先升级。',
  'empty.startFailed': '预览启动失败。',
  'empty.retry': '重试',

  'hint.offline': '页面资源来自 CDN，离线时可能无法正常渲染。',

  'env.title': '环境检查',
  'env.openwiki': 'openwiki',
  'env.dsh': 'DSH',
  'env.missing': '未安装',
  'env.belowMinimum': '低于 {minimum}',
  'env.ok': '正常',

  'version.current': '当前版本 {version}',
  'version.latest': '最新版本 {version}',
  'version.check': '检查更新',
  'version.checking': '检查中…',
  'version.update': '更新到 {version}',
  'version.uptodate': '已是最新版本',
  'version.updating': '更新中…',
  'version.reloadRequired': '更新完成，请重新加载 DSH 使其生效。',
  'version.failed': '更新失败',

  'wiki.pages': '{count} 个页面',
  'wiki.path': '路径',

  'error.rpc': '与主机通信失败',
} as const

/** Key domain of the `openwiki` namespace (the Chinese dictionary is the source of truth). */
export type OpenWikiKey = keyof typeof zh

/**
 * A translate function bound to this plugin's namespace.
 *
 * Declared here so the pane and the Sidebar entry can both be typed against it
 * without either importing the other.
 */
export type OpenWikiTranslate = (key: OpenWikiKey, vars?: Record<string, string | number>) => string

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<OpenWikiKey, string> = {
  'nav': 'OpenWiki',
  'nav.tooltip': 'Preview OpenWiki',
  'nav.disabled.noWiki': 'This workspace has no OpenWiki',
  'nav.disabled.noTool': 'No usable openwiki installation found',
  'nav.busy': 'Starting the OpenWiki preview',

  'tab.title': 'OpenWiki',

  'pane.reload': 'Reload',
  'pane.external': 'Open in browser',
  'pane.stop': 'Stop',
  'pane.start': 'Start preview',

  'status.running': 'Running',
  'status.starting': 'Starting…',
  'status.stopped': 'Not running',

  'empty.noWiki': 'This workspace has no OpenWiki. Run `openwiki --init` at the project root, then try again.',
  'empty.noTool': 'No openwiki installation found. Install it first: `npm install -g openwiki`.',
  'empty.belowMinimum': 'openwiki is below the required minimum {minimum}. Upgrade it first.',
  'empty.startFailed': 'The preview failed to start.',
  'empty.retry': 'Retry',

  'hint.offline': 'The page loads its assets from a CDN, so it may not render correctly offline.',

  'env.title': 'Environment',
  'env.openwiki': 'openwiki',
  'env.dsh': 'DSH',
  'env.missing': 'not installed',
  'env.belowMinimum': 'below {minimum}',
  'env.ok': 'ok',

  'version.current': 'Version {version}',
  'version.latest': 'Latest {version}',
  'version.check': 'Check for updates',
  'version.checking': 'Checking…',
  'version.update': 'Update to {version}',
  'version.uptodate': 'Up to date',
  'version.updating': 'Updating…',
  'version.reloadRequired': 'Updated. Reload DSH for it to take effect.',
  'version.failed': 'Update failed',

  'wiki.pages': '{count} pages',
  'wiki.path': 'Path',

  'error.rpc': 'Could not reach the host',
}
