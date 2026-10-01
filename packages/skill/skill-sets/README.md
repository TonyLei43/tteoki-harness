---
description: "Host Remote service that installs npm packages shipping a skills/ directory into the user skills root, shared across projects."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-sets

## Summary

Install a skill set from npm and its skills become available in every project. The service downloads the package into a staging project under the harness home, copies the `skills/` entries it ships into the user skills root (`~/.dsh/skills`), and records the set so removal is exact. The existing filesystem skill provider discovers the copied skills, so no new provider is needed. Choose it when users install reusable instruction sets rather than authoring files by hand.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Web **Skills** settings section drives this service through the `skillSets` Remote namespace. Mount the plugin in a profile that also serves the client; it requires no other service.

### What a skill set is

A skill set is an npm package that contains a `skills/` directory. Each direct child is either a directory bundle (`<name>/SKILL.md`) or a flat file (`<name>.md`), exactly the shapes the filesystem provider accepts. Entries whose names are not kebab-case, and any other file, are ignored.

### Operations

`list` returns every installed set. `install` takes one npm spec, adds the package to a staging project under `$DSH_HOME/skill-sets`, copies its `skills/` entries into `$DSH_HOME/skills`, and records the set in `$DSH_HOME/skill-sets/manifest.json`. `remove` deletes the skills the set contributed and prunes the manifest. Reinstalling a set replaces its record and overwrites its skills.

| Field | Default | Meaning |
|---|---|---|
| `pnpmCommand` | `pnpm` | Package-manager executable name or path. |
| `registry` | pnpm's own | Registry the install asks first, as an http(s) URL. |
| `timeoutMs` | `120000` | Bound on one package-manager run, in milliseconds. |
| `home` | `$DSH_HOME` | Harness home override; the skills and staging roots resolve under it. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`install` reads the staging project's dependency map before and after `pnpm add`, so the added package name is the one pnpm resolved; a reinstall whose map is unchanged falls back to the spec's package name. Package-manager runs use the canonical scrubbed environment and inherit the parent's proxy routing. The manifest is a small JSON document under the staging project; the skills themselves live in the user skills root, where the filesystem provider already watches for changes, so the next catalog observation picks them up without a restart.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [skills subsystem](../../../docs/subsystems/skills.md) — the registry, providers, and local discovery priority.
- [skill-filesystem](../skill-filesystem/README.md) — the provider that discovers the copied skills.
- [ui-skills](../../client/ui-skills/README.md) — the Web section that drives this service.
- [home-paths](../../util/home-paths/README.md) — how the harness home resolves.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a Host management surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One package per install** — an install copies the skills of the single package the spec added; a multi-package spec records the first added package.
- **No version pinning UI** — the spec is whatever pnpm accepts; the service neither lists registry versions nor upgrades a set.
- **Overwrites on collision** — a skill name already present in the user root is overwritten by a later install of a different set.
- **Desktop packaged builds** — the package-manager command must resolve in the Host environment; a packaged Desktop supplies its bundled pnpm through launcher facts that this service does not yet read.
- **Runtime invariant:** No companion is published. The manifest and the copied skills are the only state, and reads re-derive both.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
