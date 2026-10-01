/** The class-page opener shared with agenda items rendered deep inside the calendar and lists. */

import { createContext } from 'react'

/** Opens the class page for a course code; absent where items are not linked to classes. */
export const OpenCourse = createContext<((code: string) => void) | undefined>(undefined)
