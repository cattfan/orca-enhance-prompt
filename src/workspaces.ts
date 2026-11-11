// Telling Orca's workspaces apart, shared by the worker and the panel (no Node imports).
//
// Orca names one workspace two ways. `workspace.list` answers `identity:<key>` for a Git worktree
// (and `<key>::<path>` for a folder), while Orca's events and hooks (agent.status.changed,
// agent.tool.after, editor.save.before, workspace.removed) carry the worktree's own id,
// `<repository id>::<path>`. Neither can be made from the other, so two ids are never compared with
// `===`: the id of an event ends with the workspace's path, and the list gives that path too.

/** The path inside an id of the form `<repository id>::<path>`, or null for any other id. */
export function pathInWorkspaceId(id: string): string | null {
  const at = id.indexOf('::')
  return at > 0 && at + 2 < id.length ? id.slice(at + 2) : null
}

/**
 * A path as a key: one kind of slash, no trailing slash, lower case. Orca answers the same folder
 * as `C:/Users/me/App` in one place and `C:\Users\me\App` in another. Folding the case can make two
 * folders of a case-sensitive system look alike; callers treat more than one match as "cannot tell".
 */
export function pathKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** Whether `id` (from workspace.list, from an event, or kept by the panel) names the listed workspace. */
export function namesWorkspace(id: string, workspace: { id: string; path: string }): boolean {
  if (id === workspace.id) return true
  const path = pathInWorkspaceId(id)
  return path !== null && pathKey(path) === pathKey(workspace.path)
}

/**
 * One key for a workspace whichever way Orca named it: its path when the id carries one, else the
 * id itself. What is kept per workspace (what its agents did, the files saved in it) is kept under it.
 */
export function workspaceKey(id: string): string {
  const path = pathInWorkspaceId(id)
  return path === null ? `id:${id}` : `path:${pathKey(path)}`
}

/** The keys a listed workspace can have been kept under: by its id, and by its path. */
export function workspaceKeys(workspace: { id: string; path: string }): string[] {
  return [...new Set([workspaceKey(workspace.id), `path:${pathKey(workspace.path)}`])]
}

/** How a project is shown where several share a name: its project (repository) name, then its folder. */
export function projectLabel(choice: { path: string; project?: string | null }): string {
  const project = choice.project?.trim()
  return project ? `${project} · ${choice.path}` : choice.path
}

/**
 * The workspace as the rewriter and the run card read it. Orca's name for a project's first checkout
 * is its branch ("main"), which says nothing: the project's name comes first when it is another one.
 */
export function workspaceTitle(displayName: string, project?: string | null): string {
  const name = project?.trim()
  return name && name.toLowerCase() !== displayName.trim().toLowerCase() ? `${name}: ${displayName}` : displayName
}
