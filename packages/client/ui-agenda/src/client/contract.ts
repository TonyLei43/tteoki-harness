/** The class page's slot contract: sections other plugins add below the page's own cards. */

import type { CourseConfig } from '@deepseek-ai/dsh-api-remotes/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Class page sections, one card each, such as lectures and study aids. */
    'course.section': { kind: 'list'; scope: 'root'; owner: CourseSectionOwnerProps }
  }
}

/** Props the class page passes to every section. */
export interface CourseSectionOwnerProps {
  /** The class shown, as configured in the connectors settings. */
  readonly course: CourseConfig
  /** Current time, shared by every section in one render. */
  readonly now: number
}
