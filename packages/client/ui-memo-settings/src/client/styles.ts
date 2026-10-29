/**
 * Page styles, shipped as a TypeScript constant.
 *
 * Every color and border comes from a DSH alias token so the page follows the
 * active theme; nothing here paints a literal color. The class prefix keeps the
 * page's overrides out of every other plugin's selectors.
 *
 * @module @zhangj1164/dsh-client-ui-memo-settings/client/styles
 */

/** Stylesheet text for the memo settings page. */
export const CSS_TEXT = `
.dsh-memo-settings {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 4px 0 32px;
  color: var(--dsw-alias-text-1);
  font-size: 14px;
  line-height: 20px;
}
.dsh-memo-settings-header { display: flex; flex-direction: column; gap: 6px; }
.dsh-memo-settings-heading { margin: 0; font-size: 18px; line-height: 26px; font-weight: 600; }
.dsh-memo-settings-description { margin: 0; color: var(--dsw-alias-text-2); font-size: 13px; line-height: 20px; }
.dsh-memo-settings-muted { margin: 0; color: var(--dsw-alias-text-2); }
.dsh-memo-settings-group { display: flex; flex-direction: column; gap: 4px; }
.dsh-memo-settings-groupTitle {
  margin: 0 0 4px;
  color: var(--dsw-alias-text-2);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.dsh-memo-settings-row {
  display: flex;
  gap: 24px;
  justify-content: space-between;
  align-items: flex-start;
  padding: 14px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-memo-settings-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dsh-memo-settings-titleLine { display: flex; align-items: center; gap: 8px; }
.dsh-memo-settings-label { font-size: 14px; line-height: 20px; }
.dsh-memo-settings-badge {
  padding: 0 6px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 999px;
  color: var(--dsw-alias-text-2);
  font-size: 11px;
  line-height: 16px;
}
.dsh-memo-settings-hint { margin: 0; color: var(--dsw-alias-text-3); font-size: 12px; line-height: 18px; }
.dsh-memo-settings-error { margin: 0; color: var(--dsw-alias-brand-primary); font-size: 12px; line-height: 18px; }
.dsh-memo-settings-control { display: flex; align-items: center; gap: 8px; flex: 0 0 300px; }
.dsh-memo-settings-input,
.dsh-memo-settings-select,
.dsh-memo-settings-textarea {
  flex: 1 1 auto;
  min-width: 0;
  box-sizing: border-box;
  padding: 6px 10px;
  background: var(--dsw-alias-bg-layer-2);
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 8px;
  color: var(--dsw-alias-text-1);
  font: inherit;
}
.dsh-memo-settings-textarea { resize: vertical; font-family: inherit; line-height: 18px; }
.dsh-memo-settings-input:focus-visible,
.dsh-memo-settings-select:focus-visible,
.dsh-memo-settings-textarea:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-memo-settings-input[aria-invalid='true'],
.dsh-memo-settings-textarea[aria-invalid='true'] { border-color: var(--dsw-alias-brand-primary); }
.dsh-memo-settings-input:disabled,
.dsh-memo-settings-select:disabled,
.dsh-memo-settings-textarea:disabled { opacity: 0.6; cursor: not-allowed; }
.dsh-memo-settings-reset,
.dsh-memo-settings-discard,
.dsh-memo-settings-save {
  flex: 0 0 auto;
  padding: 5px 12px;
  background: var(--dsw-alias-bg-layer-2);
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 8px;
  color: var(--dsw-alias-text-1);
  font: inherit;
  cursor: pointer;
}
.dsh-memo-settings-save {
  background: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-layer-1);
}
.dsh-memo-settings-reset:disabled,
.dsh-memo-settings-discard:disabled,
.dsh-memo-settings-save:disabled { opacity: 0.5; cursor: not-allowed; }
.dsh-memo-settings-actions { display: flex; align-items: center; gap: 12px; }
.dsh-memo-settings-notice { color: var(--dsw-alias-text-2); font-size: 12px; }
`
