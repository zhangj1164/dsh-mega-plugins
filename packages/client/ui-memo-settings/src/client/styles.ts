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
  border-radius: var(--dsw-radius-lg, 8px);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-memo-settings-iconButton:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-memo-settings-iconButton:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}

/* ── Update dialog ── */
/* A modal that reports facts first and asks a question second, so it is laid out
   as a document: title, one-line scope, the three facts, then the two ways
   forward under a separator. Type and spacing follow the deployment's own
   dialogs rather than the dense settings form it is opened from. */
.dsh-memo-update-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--dsw-alias-bg-mask-2, rgba(15, 17, 21, 0.42));
}
.dsh-memo-update-dialog {
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: 84vh;
  overflow: auto;
  padding: 24px 28px 22px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-xl, 16px);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.16);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
}
.dsh-memo-update-head { display: flex; align-items: flex-start; gap: 12px; }
.dsh-memo-update-heading {
  flex: 1 1 auto;
  margin: 0;
  font-size: 19px;
  line-height: 27px;
  font-weight: 600;
}
.dsh-memo-update-close {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  inline-size: 28px;
  block-size: 28px;
  margin: -4px -6px 0 0;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--dsw-radius-lg, 8px);
  color: var(--dsw-alias-label-tertiary);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.dsh-memo-update-close:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-memo-update-close:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.dsh-memo-update-intro {
  margin: 14px 0 22px;
  color: var(--dsw-alias-label-secondary);
  font-size: 14px;
  line-height: 22px;
}
/* Label column and value column, so all three values start on one line. */
.dsh-memo-update-facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  align-items: baseline;
  column-gap: 28px;
  row-gap: 14px;
  margin: 0;
}
.dsh-memo-update-fact { display: contents; }
.dsh-memo-update-fact dt { color: var(--dsw-alias-label-secondary); }
.dsh-memo-update-fact dd {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
  margin: 0;
}
.dsh-memo-update-value { color: var(--dsw-alias-label-primary); }
/* The check's answer sits beside the version it is about, not on its own line. */
.dsh-memo-update-badge { color: var(--dsw-alias-label-tertiary); }
.dsh-memo-update-badge[data-available] { color: var(--dsw-alias-state-warn-primary); }
.dsh-memo-update-badge[data-error] { color: var(--dsw-alias-state-error-primary); }
.dsh-memo-update-divider {
  margin: 22px 0 20px;
  border: none;
  border-top: 0.5px solid var(--dsw-alias-separator-primary);
}
.dsh-memo-update-manual { display: flex; flex-direction: column; gap: 8px; }
.dsh-memo-update-manualTitle {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}
.dsh-memo-update-manualHint {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 14px;
  line-height: 22px;
}
/* The command is one pick-up-and-run object: the copy action belongs inside it,
   so the pair reads as a unit rather than as a row of two controls. */
.dsh-memo-update-commandCard {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-top: 6px;
  padding: 14px 16px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg, 10px);
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-memo-update-code {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 13px;
  line-height: 22px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dsh-memo-update-copyButton { flex: 0 0 auto; }
.dsh-memo-update-applied {
  margin: 16px 0 0;
  color: var(--dsw-alias-state-success-primary);
  font-size: 13px;
}
.dsh-memo-update-error {
  margin: 14px 0 0;
  color: var(--dsw-alias-state-error-primary);
  font-size: 13px;
}
.dsh-memo-update-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
}
.dsh-memo-update-button {
  flex: 0 0 auto;
  padding: 8px 18px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg, 10px);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}
.dsh-memo-update-button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-memo-update-button--primary {
  border-color: var(--dsw-alias-button-contrast-fill);
  background: var(--dsw-alias-button-contrast-fill);
  color: var(--dsw-alias-label-primary-inverted);
}
.dsh-memo-update-button--primary:hover:not(:disabled) {
  border-color: var(--dsw-alias-interactive-bg-hover-solid);
  background: var(--dsw-alias-interactive-bg-hover-solid);
}
.dsh-memo-update-button:disabled { opacity: 0.45; cursor: not-allowed; }
.dsh-memo-update-button:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
`
