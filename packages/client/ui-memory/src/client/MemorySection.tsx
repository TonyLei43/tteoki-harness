/** Memory settings section: endpoint, knowledge workspaces, indexing, search. */

import { useEffect, useState } from 'react'
import type {
  MemoryCollection, MemoryIndexValue, MemorySearchValue, MemorySettings, MemorySettingsUpdate, MemoryStatus,
} from '@deepseek-ai/dsh-api-remotes/client'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryLocaleKey } from './locales.ts'
import css from './MemorySection.module.css'

/** Registration-side business face for the section. */
export interface MemorySectionInjected {
  /** @returns stored settings and the current index status. */
  load: () => Promise<{ settings: MemorySettings; status: MemoryStatus }>
  /**
   * Persist a settings update.
   * @param update - partial settings.
   * @returns the stored settings.
   */
  save: (update: MemorySettingsUpdate) => Promise<MemorySettings>
  /** @returns the models the configured endpoint advertises. */
  listModels: () => Promise<string[]>
  /**
   * Index every workspace, or one of them.
   * @param collection - workspace id to index.
   * @returns the updated status.
   */
  index: (collection?: string) => Promise<MemoryIndexValue>
  /**
   * Search the knowledge base.
   * @param query - query text.
   * @returns ranked passages with related entities.
   */
  search: (query: string) => Promise<MemorySearchValue>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Memory settings section copy. */
    memory: MemoryLocaleKey
  }
}

/** Props the renderer binds for the section. */
export type MemorySectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'memory'>
  & InjectFace<MemorySectionInjected>

/** Endpoint presets offered beside the base-URL field. */
const BASE_URL_PRESETS = [
  'http://127.0.0.1:1234/v1',
  'http://127.0.0.1:11434/v1',
  'https://api.openai.com/v1',
]

/** One workspace editor row. */
function WorkspaceRow({
  collection, count, busy, t, onRename, onSources, onRemove, onIndex,
}: {
  collection: MemoryCollection
  count: number | undefined
  busy: boolean
  t: (key: MemoryLocaleKey) => string
  onRename: (name: string) => void
  onSources: (value: string) => void
  onRemove: () => void
  onIndex: () => void
}) {
  return (
    <li className={css.workspace}>
      <div className={css.row}>
        <label className={css.field + ` ${css.grow}`}>
          <span className={css.label}>{t('workspaceName')}</span>
          <input
            className={css.input}
            value={collection.name}
            aria-label={t('workspaceName')}
            onChange={(event) => { onRename(event.target.value) }}
          />
        </label>
        <span className={css.hitMeta}>{count === undefined ? collection.id : `${collection.id} · ${count}`}</span>
        <button type="button" className={css.secondary} disabled={busy} onClick={onIndex}>{t('indexWorkspace')}</button>
        <button type="button" className={css.secondary} disabled={busy} onClick={onRemove}>{t('remove')}</button>
      </div>
      <label className={css.field}>
        <span className={css.label}>{t('sources')}</span>
        <textarea
          className={css.textarea}
          value={collection.sources.join('\n')}
          aria-label={t('sources')}
          placeholder={t('sourcesHint')}
          onChange={(event) => { onSources(event.target.value) }}
        />
      </label>
    </li>
  )
}

/**
 * Render the Memory page: endpoint, workspaces, indexing, and test search.
 * @param props - localized copy and the memory actions.
 * @returns the memory section.
 */
export function MemorySection({ t, load, save, listModels, index, search }: MemorySectionProps) {
  const [draft, setDraft] = useState<MemorySettings>()
  const [status, setStatus] = useState<MemoryStatus>()
  const [models, setModels] = useState<readonly string[]>([])
  const [busy, setBusy] = useState<'models' | 'save' | 'index' | 'search'>()
  const [failed, setFailed] = useState(false)
  const [saved, setSaved] = useState(true)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemorySearchValue>()

  useEffect(() => {
    let active = true
    load().then(
      (state) => {
        if (!active) return
        setDraft(state.settings)
        setStatus(state.status)
      },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [load])

  if (draft === undefined) {
    return (
      <div className={css.section}>
        <h2 className={css.heading}>{t('title')}</h2>
        {failed ? <p className={css.notice} role="alert">{t('error')}</p> : <p className={css.notice}>{t('intro')}</p>}
      </div>
    )
  }

  const edit = (patch: Partial<MemorySettings>): void => {
    setDraft({ ...draft, ...patch })
    setSaved(false)
  }

  const saveSettings = async (): Promise<void> => {
    setBusy('save')
    setFailed(false)
    try {
      // An absent vision model means OCR off; the update needs an explicit null to clear a stored one.
      setDraft(await save(draft.visionModel === undefined ? { ...draft, visionModel: null } : draft))
      setSaved(true)
    } catch {
      setFailed(true)
    } finally {
      setBusy(undefined)
    }
  }

  const runSearch = async (): Promise<void> => {
    setBusy('search')
    setFailed(false)
    try {
      setResults(await search(query))
    } catch {
      setFailed(true)
    } finally {
      setBusy(undefined)
    }
  }

  const runIndex = async (collection?: string): Promise<void> => {
    setBusy('index')
    setFailed(false)
    try {
      setStatus(await index(collection))
    } catch {
      setFailed(true)
    } finally {
      setBusy(undefined)
    }
  }

  const loadModels = async (): Promise<void> => {
    setBusy('models')
    setFailed(false)
    try {
      setModels(await listModels())
    } catch {
      setFailed(true)
    } finally {
      setBusy(undefined)
    }
  }

  const countFor = (id: string): number | undefined => status?.collections.find(entry => entry.id === id)?.documents

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>

      <h3 className={css.subheading}>{t('endpointTitle')}</h3>
      <div className={css.field}>
        <span className={css.label}>{t('baseUrl')}</span>
        <input
          className={css.input}
          list="memory-base-urls"
          value={draft.baseUrl}
          aria-label={t('baseUrl')}
          onChange={(event) => { edit({ baseUrl: event.target.value }) }}
        />
        <datalist id="memory-base-urls">
          {BASE_URL_PRESETS.map(url => <option key={url} value={url} />)}
        </datalist>
      </div>
      <div className={css.row}>
        <label className={css.field + ` ${css.grow}`}>
          <span className={css.label}>{t('model')}</span>
          <input
            className={css.input}
            list="memory-models"
            value={draft.model}
            aria-label={t('model')}
            onChange={(event) => { edit({ model: event.target.value }) }}
          />
          <datalist id="memory-models">
            {models.map(name => <option key={name} value={name} />)}
          </datalist>
        </label>
        <button type="button" className={css.secondary} disabled={busy !== undefined} onClick={() => { void loadModels() }}>
          {busy === 'models' ? t('loadingModels') : t('loadModels')}
        </button>
      </div>
      <label className={css.field}>
        <span className={css.label}>{t('apiKey')}</span>
        <input
          className={css.input}
          type="password"
          autoComplete="new-password"
          value={draft.apiKey}
          aria-label={t('apiKey')}
          placeholder={t('apiKeyHint')}
          onChange={(event) => { edit({ apiKey: event.target.value }) }}
        />
      </label>
      <label className={css.field}>
        <span className={css.label}>{t('chatModel')}</span>
        <input
          className={css.input}
          value={draft.chatModel}
          aria-label={t('chatModel')}
          onChange={(event) => { edit({ chatModel: event.target.value }) }}
        />
      </label>
      <label className={css.field}>
        <span className={css.label}>{t('visionModel')}</span>
        <input
          className={css.input}
          list="memory-models"
          value={draft.visionModel ?? ''}
          aria-label={t('visionModel')}
          placeholder={t('visionModelHint')}
          onChange={(event) => {
            const value = event.target.value
            const { visionModel: _previous, ...rest } = draft
            setDraft(value.trim() === '' ? rest : { ...rest, visionModel: value })
            setSaved(false)
          }}
        />
      </label>
      <label className={css.inline}>
        <input
          type="checkbox"
          checked={draft.graphEnabled}
          aria-label={t('graph')}
          onChange={(event) => { edit({ graphEnabled: event.target.checked }) }}
        />
        <span className={css.label}>{`${t('graph')} — ${t('graphHint')}`}</span>
      </label>

      <h3 className={css.subheading}>{t('workspacesTitle')}</h3>
      <p className={css.intro}>{t('workspacesIntro')}</p>
      <ul className={css.list}>
        {draft.collections.map(collection => (
          <WorkspaceRow
            key={collection.id}
            collection={collection}
            count={countFor(collection.id)}
            busy={busy !== undefined}
            t={t}
            onRename={(name) => {
              edit({ collections: draft.collections.map(entry => entry.id === collection.id ? { ...entry, name } : entry) })
            }}
            onSources={(value) => {
              const sources = value.split('\n').map(line => line.trim()).filter(line => line !== '')
              edit({ collections: draft.collections.map(entry => entry.id === collection.id ? { ...entry, sources } : entry) })
            }}
            onRemove={() => { edit({ collections: draft.collections.filter(entry => entry.id !== collection.id) }) }}
            onIndex={() => { void runIndex(collection.id) }}
          />
        ))}
      </ul>
      <div className={css.inline}>
        <button type="button" className={css.secondary} disabled={busy !== undefined} onClick={() => {
          const id = `workspace-${draft.collections.length + 1}`
          edit({ collections: [...draft.collections, { id, name: '', sources: [] }] })
        }}>{t('addWorkspace')}</button>
        <button type="button" className={css.button} disabled={busy !== undefined || saved} onClick={() => { void saveSettings() }}>
          {t('save')}
        </button>
        <span className={css.hitMeta}>{saved ? t('saved') : t('unsaved')}</span>
      </div>

      <h3 className={css.subheading}>{t('indexTitle')}</h3>
      <div className={css.inline}>
        <button type="button" className={css.button} disabled={busy !== undefined} onClick={() => { void runIndex() }}>
          {busy === 'index' ? t('indexing') : t('indexAll')}
        </button>
      </div>
      <h3 className={css.subheading}>{t('statusTitle')}</h3>
      {status === undefined || (status.documents === 0 && status.chunks === 0)
        ? <p className={css.notice}>{t('noIndex')}</p>
        : (
          <p className={css.notice}>
            {`${t('documents')}: ${status.documents} · ${t('chunks')}: ${status.chunks} · ${t('entities')}: ${status.entities} · ${t('relations')}: ${status.relations}`}
          </p>
        )}

      <h3 className={css.subheading}>{t('searchTitle')}</h3>
      <div className={css.row}>
        <input
          className={css.input + ` ${css.grow}`}
          value={query}
          aria-label={t('searchPlaceholder')}
          placeholder={t('searchPlaceholder')}
          onChange={(event) => { setQuery(event.target.value) }}
        />
        <button type="button" className={css.button} disabled={busy !== undefined || query.trim() === ''} onClick={() => { void runSearch() }}>
          {busy === 'search' ? t('searching') : t('searchTitle')}
        </button>
      </div>
      {results !== undefined && results.hits.length === 0 ? <p className={css.notice}>{t('noResults')}</p> : null}
      {results !== undefined && results.hits.length > 0 ? (
        <ul className={css.list}>
          {results.hits.map(hit => (
            <li key={`${hit.source}:${hit.text.slice(0, 24)}`} className={css.hit}>
              <span className={css.hitMeta}>{`${hit.source}${hit.heading === undefined ? '' : ` — ${hit.heading}`} (${hit.score.toFixed(3)})`}</span>
              <p className={css.hitText}>{hit.text}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {results !== undefined && results.entities.length > 0 ? (
        <p className={css.notice}>
          {`${t('related')}: ${results.entities.map(entity => entity.name).join(', ')}`}
        </p>
      ) : null}

      {failed ? <p className={css.notice} role="alert">{t('error')}</p> : null}
    </div>
  )
}
