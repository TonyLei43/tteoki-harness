/** English copy for the workbench tab strip and status bar. */

/** Locale keys the workbench renders. */
export type WorkbenchLocaleKey =
  | 'tabs' | 'home' | 'untitled' | 'closeTab' | 'newSession'
  | 'status.running' | 'status.needs-feedback' | 'status.done' | 'status.idle'
  | 'running' | 'nextDue' | 'nothingDue' | 'knowledge' | 'synced' | 'statusBar'

/** English copy. */
export const en: Record<WorkbenchLocaleKey, string> = {
  tabs: 'Open tabs',
  home: 'Home',
  untitled: 'New session',
  closeTab: 'Close tab',
  newSession: 'New session',
  'status.running': 'Running',
  'status.needs-feedback': 'Needs your input',
  'status.done': 'Finished',
  'status.idle': 'Idle',
  running: '{count} running',
  nextDue: 'Next due: {title} · {when}',
  nothingDue: 'Nothing due soon',
  knowledge: 'Knowledge: {count} docs',
  synced: 'Synced {when}',
  statusBar: 'Status',
}
