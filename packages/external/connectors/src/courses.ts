/** Course labels: parse source course names into a code and a readable title, and label agenda items. */

import type { AgendaItem, CourseConfig } from './types.ts'

/** A course code at the start of a name: department letters, a number, optional cross-listed numbers. */
const CODE = /^([A-Z][A-Z&]{1,7})\s+(\d{3}[A-Z]?(?:\/\d{3}[A-Z]?)*)\b/

/** Canvas section and term suffixes after the code, such as `A Au 26` or `Sp 26`. */
const SECTION_TERM = /^(?:[A-Z]{1,2}\s+)?(?:(?:Au|Wi|Sp|Su|Fall|Winter|Spring|Summer)\s+\d{2,4})?\s*/

/** Words kept lower case inside a title. */
const MINOR = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with', 'via', 'vs'])

/**
 * Title-case a course title, keeping minor words lower case and acronyms and Roman numerals as written.
 * @param title - the raw title.
 * @returns the title.
 */
export function titleCase(title: string): string {
  // In an all-caps title only short words can be acronyms (R, SQL); elsewhere any all-caps word is one.
  const shouting = /[A-Z]/.test(title) && title === title.toUpperCase()
  return title.trim().split(/\s+/).map((word, index) => {
    if (/^[IVX]+$/.test(word)) return word
    if (/^[A-Z0-9]+$/.test(word) && (shouting ? word.length <= 3 && !MINOR.has(word.toLowerCase()) : word.length >= 2)) return word
    const lower = word.toLowerCase()
    if (index > 0 && MINOR.has(lower)) return lower
    return lower.charAt(0).toUpperCase() + lower.slice(1)
  }).join(' ')
}

/**
 * Split a source course name into its code and title.
 * @param raw - a name such as `BIOST 583 A Au 26: Advanced Theory Of Statistical Inference I`.
 * @returns the code and title, or undefined when the name starts with no course code.
 */
export function parseCourse(raw: string): { code: string; name: string } | undefined {
  const match = CODE.exec(raw.trim())
  if (match === null) return undefined
  const code = `${match[1]} ${match[2]}`
  const rest = raw.trim().slice(match[0].length).trimStart().replace(SECTION_TERM, '')
  const name = rest.replace(/^[:\-–—\s]+/, '').trim()
  return { code, name: titleCase(name) }
}

/**
 * Format a course label.
 * @param course - code and name.
 * @returns `CODE: Name`, or the code alone when the name is empty.
 */
export function courseLabel(course: { readonly code: string; readonly name: string }): string {
  return course.name === '' ? course.code : `${course.code}: ${course.name}`
}

/**
 * Find the configured course a code names, directly or through an alias.
 * @param courses - configured courses.
 * @param code - a course code such as `BIOST 583`.
 * @returns the course, or undefined.
 */
export function findCourse(courses: readonly CourseConfig[], code: string): CourseConfig | undefined {
  return courses.find(course => course.code === code) ?? courses.find(course => course.aliases?.includes(code) === true)
}

/**
 * Label agenda items with their course: items whose course name parses to a
 * code get `courseCode` and the configured or parsed `CODE: Name` label; a
 * code that is a configured course's alias is labeled with that course. Items
 * from a calendar that is not a course calendar are labeled from a configured
 * course code at the start of their title, such as `STAT 581 A`.
 * @param items - agenda items.
 * @param courses - configured courses, which override parsed names.
 * @returns relabeled items.
 */
export function labelItems(items: readonly AgendaItem[], courses: readonly CourseConfig[]): AgendaItem[] {
  return items.map((item) => {
    const parsed = item.courseCode !== undefined
      ? { code: item.courseCode, name: (item.course ?? '').replace(/^[^:]*:\s*/, '') }
      : item.course === undefined ? undefined : parseCourse(item.course)
    if (parsed === undefined) {
      const titled = parseCourse(item.title)
      const course = titled === undefined ? undefined : findCourse(courses, titled.code)
      return course === undefined ? item : { ...item, courseCode: course.code, course: courseLabel(course) }
    }
    const configured = findCourse(courses, parsed.code)
    return { ...item, courseCode: configured?.code ?? parsed.code, course: courseLabel(configured ?? parsed) }
  })
}

/**
 * Add courses seen in the agenda that the settings do not list yet.
 * @param courses - configured courses.
 * @param items - agenda items with `courseCode` labels.
 * @returns the configured courses followed by newly seen ones, each with no knowledge-base link.
 */
export function detectCourses(courses: readonly CourseConfig[], items: readonly AgendaItem[]): CourseConfig[] {
  const out = [...courses]
  for (const item of items) {
    if (item.courseCode === undefined || findCourse(out, item.courseCode) !== undefined) continue
    const parsed = parseCourse(item.course ?? item.courseCode)
    out.push({ code: item.courseCode, name: parsed?.name ?? '', folders: [] })
  }
  return out
}
