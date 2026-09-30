/** English copy for the agenda widgets and panel. */

/** Locale keys the agenda renders. */
export type AgendaLocaleKey =
  | 'nav' | 'title' | 'intro' | 'upcomingWidget' | 'assignmentsWidget' | 'calendarWidget'
  | 'viewLabel' | 'viewDay' | 'viewWeek' | 'viewMonth' | 'previous' | 'next' | 'todayButton'
  | 'calendarEmpty' | 'moreEvents'
  | 'today' | 'tomorrow' | 'allDay' | 'noEvents' | 'noAssignments' | 'overdue' | 'done' | 'points'
  | 'status.upcoming' | 'status.submitted' | 'status.graded' | 'status.missing' | 'status.late' | 'status.excused'
  | 'setUp' | 'syncNow' | 'syncing' | 'syncedAt' | 'neverSynced'
  | 'kind.ics' | 'kind.canvas'
  | 'connectorsTitle' | 'noConnectors' | 'addCalendar' | 'addCanvas' | 'calendarHint' | 'canvasHint'
  | 'name' | 'baseUrl' | 'secretCalendar' | 'secretCanvas' | 'save' | 'cancel' | 'remove' | 'enabled'
  | 'replaceSecret' | 'secretMissing' | 'lastSync' | 'itemsCount'
  | 'coursesTitle' | 'coursesHint' | 'noCourses' | 'courseName' | 'courseAliases' | 'courseAliasesHint' | 'courseKb' | 'courseNoKb' | 'courseFolders' | 'courseFoldersHint' | 'saveCourses' | 'coursesSaved'
  | 'backHome' | 'classes' | 'alsoListed' | 'nextClass' | 'noNextClass' | 'inProgress' | 'weekly' | 'exam' | 'materials' | 'linkedKb' | 'loading' | 'openClass'
  | 'notesTitle' | 'notesHint' | 'notesPlaceholder' | 'agendaTitle' | 'noItems' | 'loadFailed' | 'error'

/** English copy. */
export const en: Record<AgendaLocaleKey, string> = {
  nav: 'Agenda',
  title: 'Agenda',
  intro: 'Calendars and course deadlines, synced from your connected accounts.',
  upcomingWidget: 'Upcoming',
  assignmentsWidget: 'Assignments due',
  calendarWidget: 'Calendar',
  viewLabel: 'Calendar view',
  viewDay: 'Day',
  viewWeek: 'Week',
  viewMonth: 'Month',
  previous: 'Previous',
  next: 'Next',
  todayButton: 'Today',
  calendarEmpty: 'Nothing scheduled.',
  moreEvents: '+{count} more',
  today: 'Today',
  tomorrow: 'Tomorrow',
  allDay: 'All day',
  noEvents: 'Nothing scheduled this week.',
  noAssignments: 'No assignments due.',
  overdue: 'Overdue',
  done: '{count} done',
  points: '{points} pts',
  'status.upcoming': 'To do',
  'status.submitted': 'Submitted',
  'status.graded': 'Graded',
  'status.missing': 'Missing',
  'status.late': 'Late',
  'status.excused': 'Excused',
  setUp: 'Connect a calendar or Canvas',
  syncNow: 'Sync now',
  syncing: 'Syncing…',
  syncedAt: 'Synced {time}',
  neverSynced: 'Not synced yet',
  'kind.ics': 'iCal',
  'kind.canvas': 'Canvas',
  connectorsTitle: 'Connectors',
  noConnectors: 'No connectors yet.',
  addCalendar: 'Add calendar (Google or iCloud)',
  addCanvas: 'Add Canvas',
  calendarHint: 'Paste the calendar\'s private iCal address: Google Calendar → Settings → your calendar → "Secret address in iCal format"; iCloud → Calendar → share → Public Calendar link.',
  canvasHint: 'Create a token in Canvas → Account → Settings → "New access token".',
  name: 'Name',
  baseUrl: 'Canvas address',
  secretCalendar: 'Private iCal address',
  secretCanvas: 'Access token',
  save: 'Save',
  cancel: 'Cancel',
  remove: 'Remove',
  enabled: 'Enabled',
  replaceSecret: 'Replace secret',
  secretMissing: 'Secret not set',
  lastSync: 'Last sync {time}',
  itemsCount: '{count} items',
  coursesTitle: 'Courses',
  coursesHint: 'Name each class and link it to a knowledge base and its folders. Linked classes can be asked about by code, and their syllabi add deadlines.',
  noCourses: 'Classes appear here after Canvas syncs.',
  courseName: 'Class name',
  courseAliases: 'Also listed as',
  courseAliasesHint: 'Also listed as: other codes, comma separated (BIOST 583, STAT 536/427)',
  courseKb: 'Knowledge base',
  courseNoKb: 'Not linked',
  courseFolders: 'Folders',
  courseFoldersHint: 'One folder per line, such as ~/Documents/UW - Graduate/Autumn 2026/STAT 536',
  saveCourses: 'Save courses',
  coursesSaved: 'Saved.',
  backHome: '← Home',
  classes: 'Classes',
  alsoListed: 'Also listed as {codes}',
  nextClass: 'Next class',
  noNextClass: 'No class on the calendar in the next five weeks.',
  inProgress: 'Happening now',
  weekly: 'Every week',
  exam: 'Exam',
  materials: 'Materials',
  linkedKb: 'Notes are searched in the {kb} knowledge base.',
  loading: 'Loading…',
  openClass: 'Open the {course} class page',
  notesTitle: 'Obsidian agenda note',
  notesHint: 'Tteoki keeps an Agenda.md in this folder up to date; your own text outside the generated block is kept.',
  notesPlaceholder: 'Folder, such as ~/Documents/My Vault',
  agendaTitle: 'Next 30 days',
  noItems: 'Nothing in the next 30 days.',
  loadFailed: 'Couldn\'t load the agenda.',
  error: 'The request failed: {message}',
}
