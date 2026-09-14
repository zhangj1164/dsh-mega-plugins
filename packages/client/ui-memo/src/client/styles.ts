/**
 * Memo board stylesheet.
 *
 * Values are copied from the official Agent preset section so a memo card
 * reads as the same kind of object as a preset card: the same `268px` card
 * floor, `20px` radius, `0.5px` borders, `15px/600` name line, four-line
 * clamped body, and a hairline footer of icon buttons. Every color is a
 * `--dsw-alias-*` token, so light and dark themes both work without any
 * JavaScript. Week ids use a monospace stack with an explicit fallback
 * because the shell does not define `--dsw-font-mono`.
 *
 * @module dsh-client-ui-memo/client/styles
 */

/** CSS injected once by the plugin and removed with its disposer. */
export const CSS_TEXT = `
.dsh-memo {
  display: flex;
  flex-direction: column;
  gap: 14px;
  /* A main panel: it owns its own insets now that no settings modal wraps it. */
  padding: 16px 20px 24px;
  color: var(--dsw-alias-text-1);
  font-size: 13px;
}

/* ── Header: title on the left, icon actions next to Close on the right ── */
.dsh-memo-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}
.dsh-memo-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}
.dsh-memo-headActions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
/* Header actions carry an icon and a label, so they need room for both. */
.dsh-memo-headBtn {
  appearance: none;
  font: inherit;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 10px;
  cursor: pointer;
  color: var(--dsw-alias-text-1);
  background: var(--dsw-alias-bg-layer-1);
  border: 0.5px solid var(--dsw-alias-border-l3);
}
.dsh-memo-headBtn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.dsh-memo-headBtn:disabled { opacity: 0.5; cursor: default; }
.dsh-memo-headBtn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }

/* ── Dimension switch (周 / 月 / 季度 / 年) and the year switcher ── */
.dsh-memo-dimRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.dsh-memo-year {
  appearance: none;
  font: inherit;
  font-size: 12px;
  margin-left: auto;
  padding: 5px 10px;
  border-radius: 10px;
  cursor: pointer;
  color: var(--dsw-alias-text-2);
  background: var(--dsw-alias-bg-layer-1);
  border: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-memo-year:disabled { opacity: 0.5; cursor: default; }
.dsh-memo-year:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-memo-dims {
  display: inline-flex;
  align-self: flex-start;
  gap: 2px;
  padding: 2px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  border: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-memo-dim {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-text-2);
  font: inherit;
  font-size: 13px;
  padding: 5px 14px;
  border-radius: 8px;
  cursor: pointer;
}
.dsh-memo-dim:hover { background: var(--dsw-specific-sidebar-nav-item-hover, var(--dsw-alias-bg-layer-2)); }
.dsh-memo-dim[data-active] {
  background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2));
  color: var(--dsw-alias-text-1);
  font-weight: 600;
}

/* ── History chips ── */
.dsh-memo-history {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dsh-memo-chip {
  appearance: none;
  font: inherit;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  cursor: pointer;
  color: var(--dsw-alias-text-2);
  background: var(--dsw-alias-bg-layer-1);
  border: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-memo-chip:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-memo-chip[data-active] {
  color: var(--dsw-alias-text-1);
  border-color: var(--dsw-alias-border-l4);
  font-weight: 600;
}

/* ── Composer ── */
.dsh-memo-composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-memo-input {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  font: inherit;
  font-size: 13px;
  line-height: 1.55;
  color: var(--dsw-alias-text-1);
  background: var(--dsw-alias-bg-layer-1);
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  padding: 10px 12px;
}
.dsh-memo-input:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

/* ── Card grid: fixed card floor, equal-height rows ── */
.dsh-memo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
  grid-auto-rows: 1fr;
  gap: 12px;
}
.dsh-memo-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 20px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-memo-cardMain {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px 12px;
  flex: 1;
  min-width: 0;
}
.dsh-memo-cardBody {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  padding: 0;
  cursor: pointer;
  flex: 1;
  min-width: 0;
}
.dsh-memo-cardText {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dsh-memo-cardMeta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  color: var(--dsw-alias-text-3);
  font-size: 11px;
}
.dsh-memo-cardWeek {
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-memo-cardTime { white-space: nowrap; }
/* Archived cards stay readable but visibly settled: the muted surface and the
   tag are the whole difference, so an archived quarter reads as one block
   without hiding anything. */
.dsh-memo-card[data-archived] {
  opacity: 0.72;
  background: var(--dsw-alias-bg-layer-3);
  border-style: dashed;
}
.dsh-memo-archivedTag {
  padding: 1px 6px;
  border-radius: 5px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-text-3);
  white-space: nowrap;
}
.dsh-memo-archiveHint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  color: var(--dsw-alias-text-3);
  font-size: 12px;
}
.dsh-memo-cardFoot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  padding: 6px 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}

/* ── Icon buttons with the official data-tip tooltip ── */
.dsh-memo-iconBtn {
  position: relative;
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-text-2);
  padding: 6px;
  border-radius: 7px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
}
.dsh-memo-iconBtn:hover { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-text-1); }
.dsh-memo-iconBtn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-memo-iconBtn:disabled { opacity: 0.4; cursor: default; }
.dsh-memo-iconBtn--danger:hover { color: var(--dsw-alias-text-error, #d73a4a); }
.dsh-memo-iconBtn:after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.78));
  color: var(--dsw-static-white, #fff);
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease;
}
.dsh-memo-iconBtn:hover:after,
.dsh-memo-iconBtn:focus-visible:after { opacity: 1; }

/* ── Creator affordance (the dashed full-width row) ── */
.dsh-memo-creator {
  appearance: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  align-self: stretch;
  height: 44px;
  border-radius: 20px;
  border: 1px dashed var(--dsw-alias-border-l3);
  background: transparent;
  color: var(--dsw-alias-text-2);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.dsh-memo-creator:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-text-1);
}
.dsh-memo-creator:disabled { opacity: 0.5; cursor: default; }

/* ── Toolbar and results ── */
.dsh-memo-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding-top: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-memo-analysisTypes { display: inline-flex; gap: 6px; }
.dsh-memo-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.dsh-memo-btn {
  appearance: none;
  font: inherit;
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 10px;
  cursor: pointer;
  color: var(--dsw-alias-text-1);
  background: var(--dsw-alias-bg-layer-1);
  border: 0.5px solid var(--dsw-alias-border-l3);
}
.dsh-memo-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.dsh-memo-btn:disabled { opacity: 0.5; cursor: default; }
.dsh-memo-btn--danger { color: var(--dsw-alias-text-error, #d73a4a); }
.dsh-memo-linkBtn {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-decoration: underline;
  cursor: pointer;
  margin-left: 8px;
}

.dsh-memo-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
}
/* Title on the left, collapse and close on the right. */
.dsh-memo-resultHead {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dsh-memo-resultActions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}
.dsh-memo-subtitle {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-text-2);
}
.dsh-memo-pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  line-height: 1.6;
  max-height: 320px;
  overflow: auto;
}
.dsh-memo-hint { margin: 0; font-size: 12px; color: var(--dsw-alias-text-3); line-height: 1.6; }
.dsh-memo-error {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 10px;
  border: 0.5px solid var(--dsw-alias-border-error, #d73a4a);
  background: var(--dsw-alias-bg-error, rgba(215, 58, 74, 0.08));
  color: var(--dsw-alias-text-error, #d73a4a);
  font-size: 12px;
}
.dsh-memo-empty {
  padding: 28px 16px;
  text-align: center;
  color: var(--dsw-alias-text-3);
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: 16px;
}

/* ── Dialogs ── */
.dsh-memo-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.42));
  backdrop-filter: var(--dsw-mask-blur, blur(2px));
}
.dsh-memo-dialog {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(560px, 100%);
  max-height: 80vh;
  overflow: auto;
  padding: 18px 20px 16px;
  border-radius: 20px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-1));
  box-shadow: var(--dsw-elevation-prominent, 0 12px 32px rgba(0, 0, 0, 0.18));
}
`
