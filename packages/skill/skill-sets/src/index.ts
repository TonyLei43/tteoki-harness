/**
 * Skill-set installer: installs npm packages that ship a `skills/` directory
 * into the user skills root, where the existing filesystem provider discovers
 * them for every project. Each install is recorded in a manifest so removal is
 * exact.
 */

import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { runPnpm } from './run.ts'
import type {
  SkillSetInfo,
  SkillSetInstallRequest,
  SkillSetRemoveRequest,
  SkillSetsValue,
} from './types.ts'

export type * from './types.ts'

/** Valid skill directory name inside a package's `skills/` folder. */
const SKILL_DIR = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Valid flat skill file name inside a package's `skills/` folder. */
const SKILL_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/

/** Persisted manifest shape under the staging project. */
interface ManifestFile {
  readonly version: 1
  readonly sets: readonly SkillSetInfo[]
}

/** Installer deployment policy. */
export interface Config {
  /** pnpm executable name or path; defaults to `pnpm`. */
  readonly pnpmCommand?: string
  /** Registry the install asks first, as an http(s) URL. */
  readonly registry?: string
  /** Bound on one package-manager run in milliseconds. */
  readonly timeoutMs?: number
  /** Harness home override; defaults to the resolved DSH home. */
  readonly home?: string
}

/** Collaborators replaceable by direct unit tests. */
export interface SkillSetsInternals {
  /** Runs the package manager; the default spawns pnpm with a scrubbed environment. */
  readonly runPnpm?: (args: readonly string[], cwd: string, signal: AbortSignal) => Promise<void>
}

/**
 * Read the skill entry names a package's `skills/` directory declares.
 * @param skillsDir - absolute path to the package's skills directory.
 * @returns sorted valid directory-bundle and flat-file entry names.
 */
async function listSkillEntries(skillsDir: string): Promise<string[]> {
  let dirents
  try {
    dirents = await readdir(skillsDir, { withFileTypes: true })
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const entries: string[] = []
  for (const dirent of dirents) {
    if (dirent.isDirectory() && SKILL_DIR.test(dirent.name)) entries.push(dirent.name)
    else if (dirent.isFile() && SKILL_FILE.test(dirent.name)) entries.push(dirent.name)
  }
  return entries.sort()
}

/**
 * Strip a flat skill entry's extension to its addressable name.
 * @param entry - directory or `.md` entry name.
 * @returns the skill name.
 */
function skillNameOf(entry: string): string {
  return entry.endsWith('.md') ? entry.slice(0, -3) : entry
}

/**
 * Parse the package name a registry spec names.
 * @param spec - a package name with an optional version or tag.
 * @returns the package name, or undefined for a scope without a name.
 */
function packageNameOf(spec: string): string | undefined {
  if (spec.startsWith('@')) {
    const slash = spec.indexOf('/')
    if (slash === -1) return undefined
    const at = spec.indexOf('@', slash)
    return at === -1 ? spec : spec.slice(0, at)
  }
  const at = spec.indexOf('@')
  return at === -1 ? spec : spec.slice(0, at)
}

/**
 * Read the staging project's dependency map.
 * @param dir - staging project directory.
 * @returns declared dependencies (empty when absent).
 */
async function readDependencies(dir: string): Promise<Record<string, string>> {
  const parsed = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  return parsed.dependencies ?? {}
}

/**
 * Create the staging project manifest when it is absent.
 * @param dir - staging project directory.
 */
async function ensureStagingProject(dir: string): Promise<void> {
  try {
    await readFile(join(dir, 'package.json'), 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await writeFile(
      join(dir, 'package.json'),
      `${JSON.stringify({ name: 'dsh-skill-sets', version: '0.0.0', private: true }, null, 2)}\n`,
      'utf8',
    )
  }
}

/**
 * Read the installed-set manifest.
 * @param file - manifest path.
 * @returns recorded sets (empty when the manifest is absent).
 */
async function readManifest(file: string): Promise<SkillSetInfo[]> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as ManifestFile
    return [...parsed.sets]
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/**
 * Persist the installed-set manifest.
 * @param file - manifest path.
 * @param sets - complete set list to write.
 */
async function writeManifest(file: string, sets: readonly SkillSetInfo[]): Promise<void> {
  await writeFile(file, `${JSON.stringify({ version: 1, sets }, null, 2)}\n`, 'utf8')
}

/** Remote service that installs npm skill sets into the user skills root. */
export class SkillSets extends TypertRemoteService {
  static Config: z<Config> = z.object({
    pnpmCommand: z.string().default('pnpm'),
    registry: z.string(),
    timeoutMs: z.number().step(1).min(1).default(120000),
    home: z.string(),
  })

  private readonly stagingRoot: string
  private readonly skillsRoot: string
  private readonly manifestFile: string
  private readonly registry: string | undefined
  private readonly run: (args: readonly string[], cwd: string, signal: AbortSignal) => Promise<void>

  /**
   * @param ctx - Host context (no other service is required).
   * @param config - installer deployment policy.
   * @param internals - collaborators replaceable by tests.
   */
  constructor(ctx: Context, config: Config = {}, internals: SkillSetsInternals = {}) {
    super(ctx, 'skillSets')
    const home = config.home ?? resolveDshHome()
    this.stagingRoot = join(home, 'skill-sets')
    this.skillsRoot = join(home, 'skills')
    this.manifestFile = join(this.stagingRoot, 'manifest.json')
    this.registry = config.registry
    const command = config.pnpmCommand ?? 'pnpm'
    const timeoutMs = config.timeoutMs ?? 120000
    this.run = internals.runPnpm ?? ((args, cwd, signal) => runPnpm(command, args, cwd, signal, timeoutMs))
  }

  /**
   * List every installed skill set.
   * @returns installed sets ordered by package name.
   */
  @Remote('list')
  async list(): Promise<SkillSetsValue> {
    return { sets: await this.readSets() }
  }

  /**
   * Install one npm package's skills into the user skills root.
   * @param request - the npm spec to install.
   * @param signal - caller cancellation; abort terminates the package-manager run.
   * @returns the updated installed-set list.
   * @throws RemoteError when the spec is invalid, the package ships no skills, or the install fails.
   */
  @Remote('installSet')
  async install(request: SkillSetInstallRequest, signal: AbortSignal): Promise<SkillSetsValue> {
    const spec = request.spec.trim()
    if (spec.length === 0 || spec.startsWith('-')) {
      throw new RemoteError('gateway/bad-request', 'a non-empty npm spec is required', {})
    }
    signal.throwIfAborted()
    await mkdir(this.stagingRoot, { recursive: true })
    await ensureStagingProject(this.stagingRoot)
    const before = await readDependencies(this.stagingRoot)
    await this.runInstall(spec, signal)
    const after = await readDependencies(this.stagingRoot)
    const added = Object.keys(after).filter(name => !(name in before))
    const name = added[0] ?? this.fallbackName(spec, after)
    if (name === undefined) {
      throw new RemoteError('gateway/internal', `"${spec}" did not add a package to the staging project`, {})
    }
    const packageDir = join(this.stagingRoot, 'node_modules', name)
    const skillsDir = join(packageDir, 'skills')
    const entries = await listSkillEntries(skillsDir)
    if (entries.length === 0) {
      throw new RemoteError('gateway/internal', `"${name}" ships no skills to install`, {})
    }
    for (const entry of entries) {
      await cp(join(skillsDir, entry), join(this.skillsRoot, entry), { recursive: true })
    }
    const sets = (await this.readSets()).filter(set => set.name !== name)
    const version = await this.readVersion(packageDir)
    sets.push({
      name,
      spec,
      ...version === undefined ? {} : { version },
      skills: entries.map(skillNameOf),
      installedAt: new Date().toISOString(),
    })
    await writeManifest(this.manifestFile, sortSets(sets))
    return { sets: await this.readSets() }
  }

  /**
   * Remove one installed skill set and the skills it contributed.
   * @param request - the installed set's package name.
   * @param signal - caller cancellation for the package-manager removal.
   * @returns the updated installed-set list.
   * @throws RemoteError when no such set is installed.
   */
  @Remote('removeSet')
  async remove(request: SkillSetRemoveRequest, signal: AbortSignal): Promise<SkillSetsValue> {
    const name = request.name.trim()
    const sets = await this.readSets()
    const target = sets.find(set => set.name === name)
    if (target === undefined) {
      throw new RemoteError('gateway/internal', `skill set "${name}" is not installed`, {})
    }
    for (const skill of target.skills) await this.removeSkill(skill)
    await this.run(['remove', name], this.stagingRoot, signal).catch(() => {
      // A staging removal failure leaves the package files but must not block
      // withdrawing the skills the user asked to remove.
    })
    await writeManifest(this.manifestFile, sets.filter(set => set.name !== name))
    return { sets: await this.readSets() }
  }

  private async runInstall(spec: string, signal: AbortSignal): Promise<void> {
    const args = this.registry === undefined ? ['add', spec] : ['add', spec, `--registry=${this.registry}`]
    await this.run(args, this.stagingRoot, signal)
  }

  private fallbackName(spec: string, after: Record<string, string>): string | undefined {
    const name = packageNameOf(spec)
    return name !== undefined && name in after ? name : undefined
  }

  private async readSets(): Promise<SkillSetInfo[]> {
    return sortSets(await readManifest(this.manifestFile))
  }

  private async readVersion(packageDir: string): Promise<string | undefined> {
    try {
      const parsed = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')) as { version?: string }
      return parsed.version
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  private async removeSkill(skill: string): Promise<void> {
    await rm(join(this.skillsRoot, skill), { recursive: true, force: true })
    await rm(join(this.skillsRoot, `${skill}.md`), { force: true })
  }
}

/**
 * Order sets by package name for stable output.
 * @param sets - sets in any order.
 * @returns a new name-ordered array.
 */
function sortSets(sets: readonly SkillSetInfo[]): SkillSetInfo[] {
  return [...sets].sort((left, right) => left.name.localeCompare(right.name))
}

export default SkillSets
