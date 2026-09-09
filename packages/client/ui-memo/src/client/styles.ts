/**
 * CSS for the memo UI — non-modal center-column panel pattern, mirroring
 * the dsh-task-board approach. The panel is absolutely positioned within
 * the center column and toggled by the `data-dsh-memo-active` attribute on
 * `<html>`. Uses DSH semantic alias tokens for automatic light/dark/system
 * theme support.
 * @module dsh-client-ui-memo/client/styles
 */

export const CSS_TEXT = `
/* ── Center column relative positioning (required for absolute panel) ── */
[data-pane="conversation"], [class*="centerCol"] { position: relative; }

/* ── Panel view: absolutely positioned, hidden by default ── */
[data-dsh-memo-view] {
  z-index: 60; background: var(--dsw-alias-bg-base);
  display: none; position: absolute; inset: 0; overflow: hidden;
}

/* ── When active: show panel, hide conversation content ── */
html[data-dsh-memo-active] [data-dsh-memo-view] { display: flex; flex-direction: column; }
html[data-dsh-memo-active]:not([data-dsh-ssh-active]):not([data-dsh-taskboard-active]) [data-pane="conversation"] > :not([data-dsh-memo-view]),
html[data-dsh-memo-active]:not([data-dsh-ssh-active]):not([data-dsh-taskboard-active]) [class*="centerCol"] > :not([data-dsh-memo-view]) {
  display: none !important;
}

/* ── Sidebar entry button ── */
[data-dsh-memo-entry] {
  box-sizing: border-box; width: 100%; height: 36px;
  color: var(--dsw-alias-label-secondary); cursor: pointer; white-space: nowrap;
  background: transparent; border: none; border-radius: 8px;
  align-items: center; gap: 8px; padding: 0 10px;
  font-size: 13px; font-family: inherit; display: flex;
  transition: background .15s, color .15s;
}
[data-dsh-memo-entry]:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
[data-dsh-memo-entry][data-active] { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); font-weight: 600; }
[data-dsh-memo-entry] .memo-entry-icon { display: flex; align-items: center; flex-shrink: 0; width: 24px; height: 24px; justify-content: center; }
[data-dsh-memo-entry] .memo-entry-icon svg { width: 18px; height: 18px; display: block; }
[data-dsh-memo-entry] .memo-entry-label { text-overflow: ellipsis; overflow: hidden; }
[data-sidebar-collapsed] [data-dsh-memo-entry] { border-radius: 50%; justify-content: center; width: 36px; height: 36px; margin: 0 auto 12px; padding: 0; }
[data-sidebar-collapsed] [data-dsh-memo-entry] .memo-entry-label { display: none; }

/* ── Memo board (full-height inline panel) ── */
.dsh-memo-board {
  box-sizing: border-box; background: var(--dsw-alias-bg-base);
  min-width: 0; height: 100%; min-height: 0;
  color: var(--dsw-alias-label-primary);
  font-family: system-ui, -apple-system, sans-serif; font-size: 13px;
  flex-direction: column; gap: 12px; padding: 14px 16px 16px;
  display: flex; overflow: hidden;
}
.dsh-memo-board-header { flex: none; align-items: center; gap: 10px; display: flex; }
.dsh-memo-board-title { color: var(--dsw-alias-label-primary); white-space: nowrap; margin: 0; font-size: 16px; font-weight: 700; }
.dsh-memo-board-body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.dsh-memo-board-footer { flex: none; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1); }

/* ── Form elements ── */
.dsh-memo-textarea {
  width: 100%; box-sizing: border-box; min-height: 80px; padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  font-family: inherit; font-size: 13px; resize: vertical;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  outline: none; transition: border-color .15s;
}
.dsh-memo-textarea:focus { border-color: var(--dsw-alias-state-business-primary); }
.dsh-memo-textarea::placeholder { color: var(--dsw-alias-label-tertiary); opacity: .7; }
.dsh-memo-btn {
  padding: 6px 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  cursor: pointer; font-size: 13px; font-family: inherit; transition: background .12s;
}
.dsh-memo-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-memo-btn:disabled { opacity: .45; cursor: default; }
.dsh-memo-btn-primary { color: var(--dsw-alias-label-primary-foreground); background: var(--dsw-alias-button-info-fill); border: none; font-weight: 600; }
.dsh-memo-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-info-hover); }
.dsh-memo-btn-danger { color: #fff; background: var(--dsw-alias-state-error-primary); border: none; font-weight: 600; }
.dsh-memo-btn-danger:hover:not(:disabled) { filter: brightness(1.08); }
.dsh-memo-select {
  padding: 5px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font-size: 12px; font-family: inherit; cursor: pointer; outline: none;
}
.dsh-memo-btnrow { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsh-memo-divider { height: 1px; background: var(--dsw-alias-border-l1); margin: 4px 0; }

/* ── Entry items ── */
.dsh-memo-entry-item {
  padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
  transition: box-shadow .12s, border-color .12s;
}
.dsh-memo-entry-item:hover { box-shadow: var(--dsw-shadow-lv1); border-color: var(--dsw-alias-border-l3); }
.dsh-memo-entry-content { flex: 1; min-width: 0; }
.dsh-memo-entry-actions { display: flex; gap: 4px; flex-shrink: 0; }
.dsh-memo-entry-action {
  padding: 2px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
  font-size: 12px; font-family: inherit;
}
.dsh-memo-entry-action:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dsh-memo-meta { color: var(--dsw-alias-label-tertiary); font-size: 11px; margin-top: 3px; }

/* ── Results ── */
.dsh-memo-result {
  white-space: pre-wrap; padding: 12px; background: var(--dsw-alias-bg-layer-1);
  border-radius: 8px; font-size: 12px; max-height: 300px; overflow-y: auto;
  border: 1px solid var(--dsw-alias-border-l1); line-height: 1.5;
}
.dsh-memo-error {
  padding: 8px 10px; background: var(--dsw-alias-state-error-secondary); color: var(--dsw-alias-state-error-primary);
  border-radius: 8px; font-size: 12px; border: 1px solid var(--dsw-alias-state-error-primary);
}
.dsh-memo-loading { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-memo-empty { color: var(--dsw-alias-label-tertiary); opacity: .5; text-align: center; padding: 24px 8px; font-size: 12px; }
.dsh-memo-section-title { font-weight: 700; margin-bottom: 6px; font-size: 14px; color: var(--dsw-alias-label-primary); }
.dsh-memo-subtitle { font-weight: 600; margin-bottom: 4px; font-size: 13px; color: var(--dsw-alias-label-primary); }

/* ── Week chips ── */
.dsh-memo-week-list { display: flex; gap: 6px; flex-wrap: wrap; max-height: 80px; overflow-y: auto; }
.dsh-memo-week-chip {
  padding: 3px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary);
  cursor: pointer; font-size: 12px; font-family: inherit; transition: all .12s;
}
.dsh-memo-week-chip:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-state-business-primary); }
.dsh-memo-week-chip[data-active] {
  background: var(--dsw-alias-state-business-primary); color: #fff; border-color: var(--dsw-alias-state-business-primary);
}
.dsh-memo-past-badge {
  padding: 1px 8px; border-radius: 999px; background: var(--dsw-alias-state-warn-secondary);
  color: var(--dsw-alias-state-warn-primary); font-size: 11px; margin-left: 4px;
}

/* ── Focus-visible accessibility ── */
.dsh-memo-btn:focus-visible, .dsh-memo-select:focus-visible, .dsh-memo-textarea:focus-visible,
.dsh-memo-entry-action:focus-visible, .dsh-memo-week-chip:focus-visible, [data-dsh-memo-entry]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px;
}
/* ── Mobile responsive ── */
@media (max-width: 768px) {
  .dsh-memo-btn, .dsh-memo-select, .dsh-memo-textarea { min-height: 44px; font-size: 16px; }
  [data-dsh-memo-view] { height: 100dvh; }
}
`
