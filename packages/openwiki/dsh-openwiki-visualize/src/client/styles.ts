/**
 * The plugin's stylesheet, as a TypeScript string constant.
 *
 * Styles ship as code because the browser bundle has no CSS pipeline, matching
 * how `@zhangj1164/dsh-client-ui-memo` ships its own. Every colour is a DSH
 * alias token rather than a literal, so the pane follows the active theme and
 * needs no light/dark branch of its own.
 *
 * @module @zhangj1164/dsh-openwiki-visualize/client/styles
 */

/** The stylesheet this plugin appends to the document head once. */
export const CSS_TEXT = `
.dsh-openwiki-pane {
  display: flex;
  flex-direction: column;
  block-size: 100%;
  min-block-size: 0;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
}

.dsh-openwiki-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-block-end: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1));
  font-size: 12px;
}

.dsh-openwiki-dot {
  inline-size: 8px;
  block-size: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--dsw-alias-state-idle-primary);
}

.dsh-openwiki-dot[data-state="running"] { background: var(--dsw-alias-state-success-primary); }
.dsh-openwiki-dot[data-state="starting"] { background: var(--dsw-alias-state-warn-primary); }
.dsh-openwiki-dot[data-state="error"] { background: var(--dsw-alias-state-error-primary); }

.dsh-openwiki-label {
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}

.dsh-openwiki-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-inline-size: 0;
  overflow: hidden;
}

.dsh-openwiki-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: start;
  max-inline-size: 22rem;
  color: var(--dsw-alias-label-secondary);
}

.dsh-openwiki-spacer { flex: 1 1 auto; }

.dsh-openwiki-button {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  padding: 3px 8px;
  cursor: pointer;
}

.dsh-openwiki-button:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary); }
.dsh-openwiki-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-openwiki-button:disabled { opacity: 0.55; cursor: default; }

.dsh-openwiki-button[data-variant="brand"] {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
}

.dsh-openwiki-frame {
  flex: 1 1 auto;
  inline-size: 100%;
  block-size: 100%;
  min-block-size: 0;
  border: 0;
  background: var(--dsw-alias-bg-base);
}

.dsh-openwiki-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 20px 16px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.dsh-openwiki-empty-title {
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}

.dsh-openwiki-hint {
  color: var(--dsw-alias-state-warn-primary);
  font-size: 12px;
}

.dsh-openwiki-failure {
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.dsh-openwiki-entry {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 28px;
  block-size: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  flex: 0 0 auto;
}

.dsh-openwiki-entry:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}

.dsh-openwiki-entry:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-openwiki-entry:disabled { opacity: 0.45; cursor: default; }
`
