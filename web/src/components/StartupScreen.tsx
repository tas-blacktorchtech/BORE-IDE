type StartupMode = 'home' | 'clone'

type StartupScreenProps = {
  mode: StartupMode
  startupBusy: boolean
  startupError: string | null
  cloneUrl: string
  cloneDestination: string
  recentProjects: string[]
  onModeChange: (mode: StartupMode) => void
  onCloneUrlChange: (value: string) => void
  onCloneDestinationChange: (value: string) => void
  onOpenOptions: () => void
  onOpenFolder: () => void
  onOpenRecent: (projectPath: string) => void
  onPickCloneDestination: () => void
  onCloneProject: () => void
}

export function StartupScreen({
  mode,
  startupBusy,
  startupError,
  cloneUrl,
  cloneDestination,
  recentProjects,
  onModeChange,
  onCloneUrlChange,
  onCloneDestinationChange,
  onOpenOptions,
  onOpenFolder,
  onOpenRecent,
  onPickCloneDestination,
  onCloneProject,
}: StartupScreenProps) {
  return (
    <section className="startup-shell">
      {mode === 'home' ? (
        <div className="startup-card">
          <img className="startup-logo" src="/borelogo.png" alt="BORE IDE" />
          <h1>Create Or Open Project</h1>
          <p>Start by cloning a repository or pointing BORE to an existing folder.</p>
          <div className="startup-actions">
            <button onClick={() => onModeChange('clone')} disabled={startupBusy}>
              Git Clone
            </button>
            <button onClick={onOpenFolder} disabled={startupBusy}>
              Open Folder
            </button>
            <button onClick={onOpenOptions} disabled={startupBusy}>
              Options
            </button>
          </div>
          <div className="recent-projects">
            <div className="recent-title">Recent Projects</div>
            {recentProjects.length === 0 ? (
              <div className="recent-empty">No projects yet.</div>
            ) : (
              recentProjects.map((projectPath) => (
                <button
                  key={projectPath}
                  className="recent-item"
                  onClick={() => onOpenRecent(projectPath)}
                  disabled={startupBusy}
                >
                  {projectPath}
                </button>
              ))
            )}
          </div>
          {startupError && <div className="startup-error">{startupError}</div>}
        </div>
      ) : (
        <div className="startup-card">
          <img className="startup-logo" src="/borelogo.png" alt="BORE IDE" />
          <h1>Clone Repository</h1>
          <p>Paste a git URL and choose where to clone it on your machine.</p>
          <label>
            Repository URL
            <input
              value={cloneUrl}
              onChange={(event) => onCloneUrlChange(event.target.value)}
              placeholder="https://github.com/org/repo.git"
            />
          </label>
          <label>
            Destination Folder
            <div className="startup-inline">
              <input
                value={cloneDestination}
                onChange={(event) => onCloneDestinationChange(event.target.value)}
                placeholder="/Users/dev/Desktop/code"
              />
              <button onClick={onPickCloneDestination} disabled={startupBusy}>
                Browse
              </button>
            </div>
          </label>
          <div className="startup-actions">
            <button onClick={() => onModeChange('home')} disabled={startupBusy}>
              Back
            </button>
            <button onClick={onCloneProject} disabled={startupBusy}>
              {startupBusy ? 'Cloning...' : 'Clone Project'}
            </button>
          </div>
          {startupError && <div className="startup-error">{startupError}</div>}
        </div>
      )}
    </section>
  )
}
