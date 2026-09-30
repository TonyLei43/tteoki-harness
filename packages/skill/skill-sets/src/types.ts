/** Wire vocabulary for the skill-set installer Remote namespace. */

/** One installed skill set and the skills it contributed to the user root. */
export interface SkillSetInfo {
  /** npm package name that provides the set. */
  readonly name: string
  /** Spec the set was installed from. */
  readonly spec: string
  /** Installed package version read from its manifest, when available. */
  readonly version?: string
  /** Skill entry names copied into the user skills root. */
  readonly skills: readonly string[]
  /** ISO timestamp of the install. */
  readonly installedAt: string
}

/** Every installed skill set, ordered by package name. */
export interface SkillSetsValue {
  readonly sets: readonly SkillSetInfo[]
}

/** Install request naming one npm spec. */
export interface SkillSetInstallRequest {
  /** Package name with an optional version, tag, path, or git address. */
  readonly spec: string
}

/** Remove request naming one installed set. */
export interface SkillSetRemoveRequest {
  /** npm package name of the installed set. */
  readonly name: string
}
