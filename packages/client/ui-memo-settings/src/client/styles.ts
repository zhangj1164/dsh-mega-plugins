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
.dsh-memo-settings-toggle { inline-size: 18px; block-size: 18px; margin: 0; accent-color: var(--dsw-alias-brand-primary); }
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
.dsh-memo-settings-actionGroup { display: flex; align-items: center; gap: 12px; margin-left: auto; }
.dsh-memo-settings-notice { color: var(--dsw-alias-text-2); font-size: 12px; }
/* The page-level tool at the leading edge of the action row: an icon button,
   because its label lives in the dialog it opens. */
.dsh-memo-settings-iconButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 28px;
  block-size: 28px;
  padding: 0;
  background: var(--dsw-alias-bg-layer-2);
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 8px;
  color: var(--dsw-alias-text-2);
  cursor: pointer;
}
.dsh-memo-settings-iconButton:hover { color: var(--dsw-alias-text-1); background: var(--dsw-alias-bg-layer-1); }
.dsh-memo-settings-iconButton:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }

/* ── Update dialog ── */
.dsh-memo-update-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.42));
}
.dsh-memo-update-dialog {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(520px, 100%);
  max-height: 80vh;
  overflow: auto;
  padding: 18px 20px 16px;
  border-radius: 20px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-1));
  box-shadow: var(--dsw-elevation-prominent, 0 12px 32px rgba(0, 0, 0, 0.18));
  color: var(--dsw-alias-text-1);
}
.dsh-memo-update-head { display: flex; align-items: center; gap: 12px; }
.dsh-memo-update-heading {
  flex: 1 1 auto;
  margin: 0;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
}
.dsh-memo-update-close {
  flex: 0 0 auto;
  padding: 0 6px;
  background: transparent;
  border: none;
  color: var(--dsw-alias-text-3);
  font-size: 18px;
  line-height: 22px;
  cursor: pointer;
}
.dsh-memo-update-close:hover { color: var(--dsw-alias-text-1); }
.dsh-memo-update-intro { margin: 0; color: var(--dsw-alias-text-2); font-size: 12px; line-height: 18px; }
.dsh-memo-update-grid { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 0; }
.dsh-memo-update-pair { display: flex; flex-direction: column; gap: 2px; }
.dsh-memo-update-pair dt { font-size: 11px; color: var(--dsw-alias-text-3); }
.dsh-memo-update-pair dd { margin: 0; font-size: 13px; color: var(--dsw-alias-text-1); }
.dsh-memo-update-status { margin: 0; font-size: 12px; color: var(--dsw-alias-text-2); }
.dsh-memo-update-status[data-available] { color: var(--dsw-alias-brand-primary); }
.dsh-memo-update-status[data-error] { color: var(--dsw-alias-brand-primary); }
.dsh-memo-update-manual { display: flex; flex-direction: column; gap: 6px; }
.dsh-memo-update-manualTitle { margin: 0; font-size: 12px; font-weight: 600; color: var(--dsw-alias-text-2); }
.dsh-memo-update-manualHint { margin: 0; font-size: 11px; line-height: 17px; color: var(--dsw-alias-text-3); }
.dsh-memo-update-commandRow { display: flex; align-items: flex-start; gap: 8px; }
.dsh-memo-update-code {
  flex: 1 1 auto;
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-text-1);
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
.dsh-memo-update-applied { margin: 0; font-size: 12px; color: var(--dsw-alias-text-2); }
.dsh-memo-update-error { margin: 0; color: var(--dsw-alias-brand-primary); font-size: 12px; }
.dsh-memo-update-actions { display: flex; justify-content: flex-end; gap: 10px; }
.dsh-memo-update-button {
  flex: 0 0 auto;
  padding: 5px 12px;
  background: var(--dsw-alias-bg-layer-2);
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 8px;
  color: var(--dsw-alias-text-1);
  font: inherit;
  cursor: pointer;
}
.dsh-memo-update-button--primary {
  background: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-layer-1);
}
.dsh-memo-update-button:disabled { opacity: 0.5; cursor: not-allowed; }
.dsh-memo-update-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
`
