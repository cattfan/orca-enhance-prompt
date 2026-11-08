// Detects the stack and the real build/test commands from manifest files.
import { readText } from './files.ts'

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

function packageJson(text: string, files: Set<string>): string[] {
  const out: string[] = []
  try {
    const pkg = JSON.parse(text) as {
      name?: string
      packageManager?: string
      scripts?: Record<string, string>
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      workspaces?: unknown
    }
    const manager = pkg.packageManager?.split('@')[0] ??
      (files.has('pnpm-lock.yaml') ? 'pnpm' : files.has('yarn.lock') ? 'yarn' : files.has('bun.lockb') || files.has('bun.lock') ? 'bun' : 'npm')
    out.push(`Node project${pkg.name ? ` "${pkg.name}"` : ''}, package manager: ${manager}${pkg.workspaces ? ' (monorepo workspaces)' : ''}`)
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    if (deps.length > 0) {
      out.push(`Key dependencies: ${deps.slice(0, 30).join(', ')}${deps.length > 30 ? ', …' : ''}`)
    }
    const scripts = Object.entries(pkg.scripts ?? {})
    if (scripts.length > 0) {
      out.push(`Scripts (run with "${manager} run <name>"):`)
      for (const [name, command] of scripts.slice(0, 25)) {
        out.push(`  ${name}: ${truncate(command, 120)}`)
      }
    }
  } catch {
    // invalid JSON
  }
  return out
}

function makefileTargets(text: string): string[] {
  const targets = [...text.matchAll(/^([A-Za-z0-9_.-]+):(?!=)/gm)]
    .map((match) => match[1])
    .filter((name) => !name.startsWith('.'))
  return targets.length > 0 ? [`Makefile targets: ${[...new Set(targets)].slice(0, 25).join(', ')}`] : []
}

function tomlSection(text: string, section: string, maxLines = 25): string | null {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `[${section}]`)
  if (start < 0) {
    return null
  }
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[/.test(line) || body.length >= maxLines) {
      break
    }
    if (line.trim()) {
      body.push(`  ${line.trim()}`)
    }
  }
  return body.length > 0 ? `[${section}]\n${body.join('\n')}` : null
}

export async function detectStack(root: string, fileList: string[]): Promise<string | null> {
  const files = new Set(fileList.filter((file) => !file.includes('/')))
  const out: string[] = []
  const read = (name: string) => (files.has(name) ? readText(root, name, 300_000) : Promise.resolve(null))

  const pkg = await read('package.json')
  if (pkg) out.push(...packageJson(pkg, files))
  if (files.has('tsconfig.json')) out.push('TypeScript (tsconfig.json)')
  if (files.has('deno.json') || files.has('deno.jsonc')) out.push('Deno project')

  const pyproject = await read('pyproject.toml')
  if (pyproject) {
    out.push(`Python project${files.has('uv.lock') ? ' (uv)' : files.has('poetry.lock') ? ' (poetry)' : ''}`)
    for (const section of ['project', 'tool.poetry', 'tool.pytest.ini_options', 'project.scripts']) {
      const body = tomlSection(pyproject, section, 15)
      if (body) out.push(body)
    }
  } else if (files.has('requirements.txt')) {
    const reqs = (await read('requirements.txt')) ?? ''
    out.push(`Python requirements: ${reqs.split(/\r?\n/).map((l) => l.split(/[=<>~ ]/)[0]).filter(Boolean).slice(0, 25).join(', ')}`)
  }

  const gomod = await read('go.mod')
  if (gomod) out.push(`Go module: ${gomod.split(/\r?\n/).slice(0, 3).join(' | ')} (test: go test ./...)`)

  const cargo = await read('Cargo.toml')
  if (cargo) {
    out.push('Rust (cargo build / cargo test)')
    const pkgSection = tomlSection(cargo, 'package', 6)
    const deps = tomlSection(cargo, 'dependencies', 20)
    if (pkgSection) out.push(pkgSection)
    if (deps) out.push(deps)
  }

  if (files.has('pom.xml')) out.push('Java/Maven (mvn test)')
  if (files.has('build.gradle') || files.has('build.gradle.kts')) out.push('Gradle (./gradlew test)')
  if (files.has('composer.json')) out.push('PHP/Composer')
  if (files.has('Gemfile')) out.push('Ruby/Bundler')
  if ([...files].some((f) => f.endsWith('.csproj') || f.endsWith('.sln'))) out.push('.NET (dotnet build / dotnet test)')
  if (files.has('pubspec.yaml')) out.push('Dart/Flutter (flutter test)')
  if (files.has('Dockerfile') || files.has('docker-compose.yml') || files.has('compose.yaml')) out.push('Docker present')

  const makefile = await read('Makefile')
  if (makefile) out.push(...makefileTargets(makefile))
  const justfile = (await read('justfile')) ?? (await read('Justfile'))
  if (justfile) out.push(...makefileTargets(justfile).map((line) => line.replace('Makefile', 'just')))

  const ci = fileList.filter((f) => f.startsWith('.github/workflows/')).slice(0, 5)
  if (ci.length > 0) out.push(`CI workflows: ${ci.join(', ')}`)

  return out.length > 0 ? out.join('\n') : null
}
