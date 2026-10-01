/**
 * Dashboard slot contract: the `dashboard.widget` list the Home panel declares.
 * Any plugin adds a widget by registering a `dashboard.widget` entry with an
 * `id`, an `order`, and a `label`; Home renders each entry inside a card
 * titled by its label, in ascending order.
 */

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Home dashboard widgets, one card each. */
    'dashboard.widget': { kind: 'list'; scope: 'root'; owner: DashboardWidgetOwnerProps }
    /** Optional banner below the greeting, such as a skin's illustration. */
    'dashboard.hero': { kind: 'single'; scope: 'root'; owner: DashboardWidgetOwnerProps }
  }
}

/** Props Home passes to every widget. */
export interface DashboardWidgetOwnerProps {
  /** Current time, shared so every widget reads the same "now" in one render. */
  readonly now: number
}

/** One widget's card metadata. */
export interface DashboardWidgetMetadata {
  /** Entry id. */
  readonly id: string
  /** Ascending position. */
  readonly order: number
  /** Card title. */
  readonly label: string
}
