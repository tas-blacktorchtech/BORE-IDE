import { useCallback, useEffect, useMemo, useState } from 'react'

type GitTab = 'dashboard' | 'graph' | 'changes'

type GitCommit = {
  id: string
  shortId: string
  message: string
  author: string
  authoredAt: string
  parents: string[]
  refs: string[]
  head: boolean
}

type GitCommitLane = GitCommit & {
  lane: number
  badge?: string
}

type GitGraphSummary = {
  branch: string
  ahead: number
  behind: number
  dirtyCount: number
  clean: boolean
  localBranches: string[]
  remoteBranches: string[]
}

type GitGraphPayload = {
  ok: boolean
  error?: string
  summary: GitGraphSummary
  commits: GitCommit[]
  offset: number
  limit: number
  hasMore: boolean
}

type GitCommitFileChange = {
  status: string
  path: string
}

type GitCommitDetailsPayload = {
  ok: boolean
  commitId: string
  files: GitCommitFileChange[]
  patch: string
}

type GitCommitStatsPayload = {
  ok: boolean
  commitId: string
  filesChanged: number
  insertions: number
  deletions: number
}

type GitBranchMutatePayload = {
  ok: boolean
  name?: string
  from?: string | null
  checkedOut?: string
  created?: boolean
}

type GitBranchChangeFile = {
  status: string
  path: string
  insertions: number
  deletions: number
}

type GitBranchChangesPayload = {
  ok: boolean
  branch: string
  base: string | null
  files: GitBranchChangeFile[]
  summary: {
    filesChanged: number
    insertions: number
    deletions: number
  }
}

function formatCommitDate(value: string) {
  if (!value) {
    return 'Unknown date'
  }
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString()
  }
  return value
}

type DiffLineKind = 'meta' | 'hunk' | 'add' | 'del' | 'ctx' | 'empty'

type SideBySideRow = {
  left: string
  right: string
  leftKind: DiffLineKind
  rightKind: DiffLineKind
}

type GitCommandCenterProps = {
  projectRoot: string
}

const LANE_COLORS = ['#5bc5ff', '#f59e0b', '#34d399', '#f472b6', '#a78bfa', '#f97316']

function laneColor(lane: number) {
  return LANE_COLORS[lane % LANE_COLORS.length]
}

function buildLaneAssignments(commits: GitCommit[]): GitCommitLane[] {
  const pendingLaneByHash = new Map<string, number>()

  const firstFreeLane = () => {
    const used = new Set<number>(pendingLaneByHash.values())
    let lane = 0
    while (used.has(lane)) {
      lane += 1
    }
    return lane
  }

  const result: GitCommitLane[] = []

  for (const commit of commits) {
    const existingLane = pendingLaneByHash.get(commit.id)
    const lane = existingLane ?? firstFreeLane()
    if (existingLane !== undefined) {
      pendingLaneByHash.delete(commit.id)
    }

    if (commit.parents[0] && !pendingLaneByHash.has(commit.parents[0])) {
      pendingLaneByHash.set(commit.parents[0], lane)
    }

    for (const parentId of commit.parents.slice(1)) {
      if (!pendingLaneByHash.has(parentId)) {
        pendingLaneByHash.set(parentId, firstFreeLane())
      }
    }

    const refBadge = commit.head
      ? 'HEAD'
      : commit.refs.find((ref) => !ref.startsWith('origin/')) ?? commit.refs[0] ?? undefined

    result.push({
      ...commit,
      lane,
      badge: refBadge,
    })
  }

  return result
}

function splitPatchByFile(patch: string) {
  const map = new Map<string, string>()
  const lines = patch.split('\n')
  let currentFile = ''
  let currentLines: string[] = []

  const flush = () => {
    if (!currentFile) {
      return
    }
    map.set(currentFile, `${currentLines.join('\n')}\n`)
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush()
      currentLines = [line]
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/)
      currentFile = match?.[2] ?? match?.[1] ?? ''
    } else if (currentFile) {
      currentLines.push(line)
    }
  }

  flush()
  return map
}

function classifyDiffLine(line: string): DiffLineKind {
  if (!line) {
    return 'empty'
  }
  if (line.startsWith('@@')) {
    return 'hunk'
  }
  if (
    line.startsWith('diff --git ') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('new file mode ') ||
    line.startsWith('deleted file mode ') ||
    line.startsWith('similarity index ') ||
    line.startsWith('rename from ') ||
    line.startsWith('rename to ')
  ) {
    return 'meta'
  }
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return 'add'
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return 'del'
  }
  return 'ctx'
}

function stripPrefix(line: string, kind: DiffLineKind) {
  if (kind === 'add' || kind === 'del') {
    return line.slice(1)
  }
  if (kind === 'ctx' && line.startsWith(' ')) {
    return line.slice(1)
  }
  return line
}

function buildSideBySideRows(patch: string): SideBySideRow[] {
  const rows: SideBySideRow[] = []
  const lines = patch.split('\n')
  let index = 0

  while (index < lines.length) {
    const current = lines[index]
    const currentKind = classifyDiffLine(current)

    if (currentKind === 'del') {
      const next = lines[index + 1]
      const nextKind = classifyDiffLine(next ?? '')
      if (nextKind === 'add') {
        rows.push({
          left: stripPrefix(current, 'del'),
          right: stripPrefix(next, 'add'),
          leftKind: 'del',
          rightKind: 'add',
        })
        index += 2
        continue
      }
    }

    if (currentKind === 'meta' || currentKind === 'hunk') {
      rows.push({
        left: current,
        right: current,
        leftKind: currentKind,
        rightKind: currentKind,
      })
      index += 1
      continue
    }

    if (currentKind === 'add') {
      rows.push({
        left: '',
        right: stripPrefix(current, 'add'),
        leftKind: 'empty',
        rightKind: 'add',
      })
      index += 1
      continue
    }

    if (currentKind === 'del') {
      rows.push({
        left: stripPrefix(current, 'del'),
        right: '',
        leftKind: 'del',
        rightKind: 'empty',
      })
      index += 1
      continue
    }

    rows.push({
      left: stripPrefix(current, currentKind),
      right: stripPrefix(current, currentKind),
      leftKind: currentKind,
      rightKind: currentKind,
    })
    index += 1
  }

  return rows
}

export function GitCommandCenter({ projectRoot }: GitCommandCenterProps) {
  const GRAPH_PAGE_SIZE = 20
  const [activeTab, setActiveTab] = useState<GitTab>('dashboard')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<GitGraphSummary>({
    branch: 'n/a',
    ahead: 0,
    behind: 0,
    dirtyCount: 0,
    clean: true,
    localBranches: [],
    remoteBranches: [],
  })
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [diffViewMode, setDiffViewMode] = useState<'unified' | 'split'>('unified')
  const [detailsByCommit, setDetailsByCommit] = useState<Record<string, GitCommitDetailsPayload>>({})
  const [hoveredCommitId, setHoveredCommitId] = useState<string | null>(null)
  const [hoverMeta, setHoverMeta] = useState<{ x: number; y: number } | null>(null)
  const [hoverLoadingId, setHoverLoadingId] = useState<string | null>(null)
  const [hoverStatsByCommit, setHoverStatsByCommit] = useState<Record<string, GitCommitStatsPayload>>({})
  const [hoverStatsErrorByCommit, setHoverStatsErrorByCommit] = useState<Record<string, string>>({})
  const [newBranchName, setNewBranchName] = useState('')
  const [branchOpBusy, setBranchOpBusy] = useState(false)
  const [branchOpError, setBranchOpError] = useState<string | null>(null)
  const [branchOpMessage, setBranchOpMessage] = useState<string | null>(null)
  const [selectedBranchForChanges, setSelectedBranchForChanges] = useState('')
  const [branchChanges, setBranchChanges] = useState<GitBranchChangesPayload | null>(null)
  const [branchChangesLoading, setBranchChangesLoading] = useState(false)
  const [branchChangesError, setBranchChangesError] = useState<string | null>(null)

  const loadGraph = useCallback(
    async (mode: 'reset' | 'append', offset: number) => {
      if (mode === 'append') {
        setLoadingMore(true)
      } else {
        setLoading(true)
        setError(null)
        setHasMore(true)
      }

      try {
        const payload = (await window.ide.getGitGraph(projectRoot, {
          offset,
          limit: GRAPH_PAGE_SIZE,
        })) as GitGraphPayload
        setSummary(payload.summary)
        setCommits((previous) => {
          const incoming = payload.commits
          if (mode === 'append') {
            const seen = new Set(previous.map((commit) => commit.id))
            const merged = [...previous]
            for (const commit of incoming) {
              if (!seen.has(commit.id)) {
                merged.push(commit)
              }
            }
            return merged
          }
          return incoming
        })
        if (payload.commits[0]) {
          setSelectedCommitId((previous) => previous ?? payload.commits[0].id)
        }
        setHasMore(payload.hasMore)
        if (!payload.ok) {
          setError(payload.error ?? 'Unable to load git data.')
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load git data.')
      } finally {
        if (mode === 'append') {
          setLoadingMore(false)
        } else {
          setLoading(false)
        }
      }
    },
    [projectRoot],
  )

  useEffect(() => {
    void loadGraph('reset', 0)
  }, [loadGraph, projectRoot])

  const loadCommitDetails = useCallback(
    async (commitId: string) => {
      if (!commitId) {
        return
      }

      if (detailsByCommit[commitId]) {
        const cached = detailsByCommit[commitId]
        setSelectedFilePath(cached.files[0]?.path ?? null)
        return
      }

      setDetailsLoading(true)
      setDetailsError(null)
      try {
        const payload = (await window.ide.getGitCommitDetails(projectRoot, commitId)) as GitCommitDetailsPayload
        setDetailsByCommit((previous) => ({
          ...previous,
          [commitId]: payload,
        }))
        setSelectedFilePath(payload.files[0]?.path ?? null)
      } catch (loadError) {
        setDetailsError(loadError instanceof Error ? loadError.message : 'Unable to load commit details.')
      } finally {
        setDetailsLoading(false)
      }
    },
    [detailsByCommit, projectRoot],
  )

  useEffect(() => {
    if (!selectedCommitId) {
      return
    }
    void loadCommitDetails(selectedCommitId)
  }, [loadCommitDetails, selectedCommitId])

  const ensureHoverStats = useCallback(
    async (commitId: string) => {
      if (!commitId || hoverStatsByCommit[commitId] || hoverLoadingId === commitId) {
        return
      }
      setHoverLoadingId(commitId)
      try {
        const payload = (await window.ide.getGitCommitStats(projectRoot, commitId)) as GitCommitStatsPayload
        setHoverStatsByCommit((previous) => ({
          ...previous,
          [commitId]: payload,
        }))
        setHoverStatsErrorByCommit((previous) => {
          if (!previous[commitId]) {
            return previous
          }
          const next = { ...previous }
          delete next[commitId]
          return next
        })
      } catch (error) {
        setHoverStatsErrorByCommit((previous) => ({
          ...previous,
          [commitId]: error instanceof Error ? error.message : 'Unable to load stats',
        }))
      } finally {
        setHoverLoadingId((previous) => (previous === commitId ? null : previous))
      }
    },
    [hoverLoadingId, hoverStatsByCommit, projectRoot],
  )

  useEffect(() => {
    if (!selectedCommitId) {
      return
    }
    void ensureHoverStats(selectedCommitId)
  }, [ensureHoverStats, selectedCommitId])

  useEffect(() => {
    if (!selectedBranchForChanges && summary.branch && summary.branch !== 'n/a') {
      setSelectedBranchForChanges(summary.branch)
    }
  }, [selectedBranchForChanges, summary.branch])

  const loadBranchChanges = useCallback(
    async (branchName?: string) => {
      const target = (branchName ?? selectedBranchForChanges ?? summary.branch).trim()
      if (!target || target === 'n/a') {
        return
      }

      setBranchChangesLoading(true)
      setBranchChangesError(null)
      try {
        const payload = (await window.ide.getGitBranchChanges(projectRoot, target)) as GitBranchChangesPayload
        setBranchChanges(payload)
        setSelectedBranchForChanges(payload.branch)
      } catch (error) {
        setBranchChangesError(error instanceof Error ? error.message : 'Unable to load branch changes.')
      } finally {
        setBranchChangesLoading(false)
      }
    },
    [projectRoot, selectedBranchForChanges, summary.branch],
  )

  useEffect(() => {
    if (activeTab === 'changes') {
      void loadBranchChanges()
    }
  }, [activeTab, loadBranchChanges])

  const refreshAllGitData = useCallback(
    async (focusBranch?: string) => {
      await loadGraph('reset', 0)
      if (focusBranch) {
        setSelectedBranchForChanges(focusBranch)
        await loadBranchChanges(focusBranch)
      } else if (activeTab === 'changes') {
        await loadBranchChanges()
      }
    },
    [activeTab, loadBranchChanges, loadGraph],
  )

  const handleCreateBranch = useCallback(async () => {
    const name = newBranchName.trim()
    if (!name) {
      setBranchOpError('Branch name is required.')
      return
    }

    setBranchOpBusy(true)
    setBranchOpError(null)
    setBranchOpMessage(null)
    try {
      const payload = (await window.ide.createGitBranch(projectRoot, {
        name,
        from: summary.branch !== 'n/a' ? summary.branch : undefined,
      })) as GitBranchMutatePayload
      setBranchOpMessage(`Created branch ${payload.name ?? name}.`)
      setNewBranchName('')
      await refreshAllGitData(payload.name ?? name)
    } catch (error) {
      setBranchOpError(error instanceof Error ? error.message : 'Unable to create branch.')
    } finally {
      setBranchOpBusy(false)
    }
  }, [newBranchName, projectRoot, refreshAllGitData, summary.branch])

  const handleCheckoutBranch = useCallback(
    async (branchName: string) => {
      if (!branchName) {
        return
      }

      setBranchOpBusy(true)
      setBranchOpError(null)
      setBranchOpMessage(null)
      try {
        const payload = (await window.ide.checkoutGitBranch(projectRoot, {
          name: branchName,
        })) as GitBranchMutatePayload
        const checkedOut = payload.checkedOut ?? branchName.replace(/^origin\//, '')
        setBranchOpMessage(`Checked out ${checkedOut}.`)
        await refreshAllGitData(checkedOut)
      } catch (error) {
        setBranchOpError(error instanceof Error ? error.message : 'Unable to checkout branch.')
      } finally {
        setBranchOpBusy(false)
      }
    },
    [projectRoot, refreshAllGitData],
  )

  const graphCommits = useMemo(() => buildLaneAssignments(commits), [commits])

  const selectedCommit = useMemo(
    () => graphCommits.find((commit) => commit.id === selectedCommitId) ?? null,
    [graphCommits, selectedCommitId],
  )

  const selectedDetails = selectedCommitId ? detailsByCommit[selectedCommitId] : undefined
  const patchByFile = useMemo(() => splitPatchByFile(selectedDetails?.patch ?? ''), [selectedDetails?.patch])
  const selectedPatch = selectedFilePath
    ? patchByFile.get(selectedFilePath) ?? selectedDetails?.patch ?? ''
    : selectedDetails?.patch ?? ''
  const unifiedLines = useMemo(() => selectedPatch.split('\n'), [selectedPatch])
  const splitRows = useMemo(() => buildSideBySideRows(selectedPatch), [selectedPatch])

  const graph = useMemo(() => {
    const rowHeight = 56
    const firstRowY = 34
    const laneXStart = 52
    const laneGap = 44

    const indexById = new Map<string, number>()
    graphCommits.forEach((commit, index) => {
      indexById.set(commit.id, index)
    })

    const maxLane = graphCommits.length > 0 ? Math.max(...graphCommits.map((commit) => commit.lane)) : 0
    const laneAreaWidth = laneXStart + (maxLane + 1) * laneGap
    const textX = laneAreaWidth + 72
    const graphWidth = Math.max(980, textX + 520)
    const height = Math.max(260, firstRowY + Math.max(0, graphCommits.length - 1) * rowHeight + 34)

    const laneX = (lane: number) => laneXStart + lane * laneGap
    const rowY = (index: number) => firstRowY + index * rowHeight

    return {
      textX,
      graphWidth,
      height,
      maxLane,
      laneX,
      rowY,
      indexById,
    }
  }, [graphCommits])

  const hoveredCommit = useMemo(
    () => graphCommits.find((commit) => commit.id === hoveredCommitId) ?? null,
    [graphCommits, hoveredCommitId],
  )
  const hoveredStats = hoveredCommitId ? hoverStatsByCommit[hoveredCommitId] : undefined
  const hoveredStatsError = hoveredCommitId ? hoverStatsErrorByCommit[hoveredCommitId] : undefined

  const onGraphScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (!hasMore || loadingMore || loading || activeTab !== 'graph') {
      return
    }

    const element = event.currentTarget
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight
    if (remaining < 220) {
      void loadGraph('append', commits.length)
    }
  }

  return (
    <section className="git-command-center">
      <header className="git-folder-tabs">
        <button
          className={`git-folder-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={`git-folder-tab ${activeTab === 'graph' ? 'active' : ''}`}
          onClick={() => setActiveTab('graph')}
        >
          Graph
        </button>
        <button
          className={`git-folder-tab ${activeTab === 'changes' ? 'active' : ''}`}
          onClick={() => setActiveTab('changes')}
        >
          Changes
        </button>
        <button className="git-refresh-btn" onClick={() => void refreshAllGitData()} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </header>

      <div className="git-command-body">
        {activeTab === 'dashboard' && (
          <div className="git-dashboard-pane">
            <div className="git-stat-card">
              <div className="git-stat-label">Current Branch</div>
              <div className="git-stat-value">{summary.branch}</div>
            </div>
            <div className="git-stat-card">
              <div className="git-stat-label">Ahead / Behind</div>
              <div className="git-stat-value">
                +{summary.ahead} / -{summary.behind}
              </div>
            </div>
            <div className="git-stat-card">
              <div className="git-stat-label">Working Tree</div>
              <div className="git-stat-value">{summary.clean ? 'Clean' : `${summary.dirtyCount} changes`}</div>
            </div>
            <div className="git-stat-card git-branch-lists-card">
              <div className="git-stat-label">Branches</div>
              <div className="git-branch-action-row">
                <input
                  value={newBranchName}
                  onChange={(event) => setNewBranchName(event.target.value)}
                  placeholder="new branch name"
                  disabled={branchOpBusy}
                />
                <button onClick={() => void handleCreateBranch()} disabled={branchOpBusy || !newBranchName.trim()}>
                  Create
                </button>
              </div>
              {branchOpError && <div className="git-branch-feedback error">{branchOpError}</div>}
              {branchOpMessage && <div className="git-branch-feedback success">{branchOpMessage}</div>}
              <div className="git-branch-lists">
                <div className="git-branch-list">
                  <div className="git-branch-list-title">Local ({summary.localBranches.length})</div>
                  {summary.localBranches.length > 0 ? (
                    <ul>
                      {summary.localBranches.map((branch) => (
                        <li key={`local-${branch}`}>
                          <button
                            className={`git-branch-item ${branch === summary.branch ? 'active' : ''}`}
                            onClick={() => void handleCheckoutBranch(branch)}
                            disabled={branchOpBusy}
                          >
                            <span>{branch}</span>
                            <span>{branch === summary.branch ? 'current' : 'checkout'}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="git-branch-empty">No local branches</div>
                  )}
                </div>
                <div className="git-branch-list">
                  <div className="git-branch-list-title">Remote ({summary.remoteBranches.length})</div>
                  {summary.remoteBranches.length > 0 ? (
                    <ul>
                      {summary.remoteBranches.map((branch) => (
                        <li key={`remote-${branch}`}>
                          <button
                            className="git-branch-item remote"
                            onClick={() => void handleCheckoutBranch(branch)}
                            disabled={branchOpBusy}
                          >
                            <span>{branch}</span>
                            <span>track</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="git-branch-empty">No remote branches</div>
                  )}
                </div>
              </div>
            </div>
            {error && <div className="git-load-error">{error}</div>}
          </div>
        )}

        {activeTab === 'graph' && (
          <div className="git-graph-pane git-graph-pane-with-inspector">
            {error ? (
              <div className="git-load-error">{error}</div>
            ) : graphCommits.length === 0 ? (
              <div className="empty-editor">No commits found.</div>
            ) : (
              <>
                <div className="git-graph-canvas-shell">
                <div className="git-graph-canvas-shell-scroll" onScroll={onGraphScroll}>
                  <svg
                    className="git-graph-svg"
                    viewBox={`0 0 ${graph.graphWidth} ${graph.height}`}
                    style={{ width: `${graph.graphWidth}px` }}
                    role="img"
                    aria-label="Git commit graph"
                  >
                    {Array.from({ length: graph.maxLane + 1 }).map((_, lane) => {
                      const x = graph.laneX(lane)
                      return (
                        <line
                          key={`lane-${lane}`}
                          x1={x}
                          y1={10}
                          x2={x}
                          y2={graph.height - 12}
                          stroke={laneColor(lane)}
                          strokeOpacity={0.18}
                          strokeWidth={1}
                        />
                      )
                    })}

                    {graphCommits.flatMap((commit, index) =>
                      commit.parents.map((parentId) => {
                        const parentIndex = graph.indexById.get(parentId)
                        if (parentIndex === undefined) {
                          return null
                        }

                        const x1 = graph.laneX(commit.lane)
                        const y1 = graph.rowY(index)
                        const parent = graphCommits[parentIndex]
                        const x2 = graph.laneX(parent.lane)
                        const y2 = graph.rowY(parentIndex)

                        const path =
                          x1 === x2
                            ? `M ${x1} ${y1} L ${x2} ${y2}`
                            : `M ${x1} ${y1} C ${x1} ${y1 + 20}, ${x2} ${y2 - 20}, ${x2} ${y2}`

                        return (
                          <path
                            key={`${commit.id}-${parentId}`}
                            d={path}
                            fill="none"
                            stroke={laneColor(commit.lane)}
                            strokeWidth={3}
                            strokeLinecap="round"
                          />
                        )
                      }),
                    )}

                    {graphCommits.map((commit, index) => {
                      const x = graph.laneX(commit.lane)
                      const y = graph.rowY(index)
                      const active = commit.id === selectedCommitId
                      return (
                        <g
                          key={commit.id}
                          className={`git-commit-node ${active ? 'active' : ''}`}
                          onClick={() => setSelectedCommitId(commit.id)}
                          onMouseEnter={() => {
                            setHoveredCommitId(commit.id)
                            setHoverMeta({ x, y })
                            void ensureHoverStats(commit.id)
                          }}
                          onMouseLeave={() => {
                            setHoveredCommitId((previous) => (previous === commit.id ? null : previous))
                            setHoverMeta(null)
                          }}
                        >
                          <circle
                            cx={x}
                            cy={y}
                            r={active ? 10 : 8}
                            fill="#0f151d"
                            stroke={laneColor(commit.lane)}
                            strokeWidth={active ? 4 : 3}
                          />
                          <circle cx={x} cy={y} r={2.5} fill={laneColor(commit.lane)} />
                          <line
                            x1={x + (active ? 10 : 8)}
                            y1={y}
                            x2={graph.textX - 14}
                            y2={y}
                            className={`git-graph-link ${active ? 'active' : ''}`}
                          />
                          <text x={graph.textX} y={y - 2} className="git-graph-message">
                            {commit.message}
                          </text>
                          <text x={graph.textX} y={y + 16} className="git-graph-meta">
                            {commit.shortId} · {commit.author}
                          </text>
                          {commit.badge && (
                            <g>
                              <rect
                                x={graph.textX + 280}
                                y={y - 16}
                                rx={8}
                                ry={8}
                                width={Math.max(56, commit.badge.length * 8)}
                                height={18}
                                className="git-graph-badge-bg"
                              />
                              <text x={graph.textX + 288} y={y - 3} className="git-graph-badge-text">
                                {commit.badge}
                              </text>
                            </g>
                          )}
                        </g>
                      )
                    })}
                  </svg>
                  {hoveredCommit && hoverMeta && (
                    <div
                      className="git-commit-tooltip"
                      style={{
                        left: `${Math.max(12, hoverMeta.x + 18)}px`,
                        top: `${Math.max(8, hoverMeta.y - 72)}px`,
                      }}
                    >
                      <div>{hoveredCommit.author}</div>
                      <div>{formatCommitDate(hoveredCommit.authoredAt)}</div>
                      <div className="git-tooltip-message">{hoveredCommit.message}</div>
                      <div className="git-tooltip-statline">
                        {hoverLoadingId === hoveredCommit.id
                          ? 'Loading...'
                          : hoveredStatsError
                            ? hoveredStatsError
                            : hoveredStats
                            ? `${hoveredStats.filesChanged} ${hoveredStats.filesChanged === 1 ? 'file' : 'files'} changed, ${hoveredStats.insertions} insertion(+), ${hoveredStats.deletions} deletion(-)`
                            : 'No stats'}
                      </div>
                    </div>
                  )}
                  {loadingMore && <div className="git-graph-loading-more">Loading more commits...</div>}
                </div>
                </div>

                <section className="git-commit-inspector">
                  <header className="git-commit-inspector-header">
                    <div>
                      <div className="git-stat-label">Selected Commit</div>
                      <div className="git-inspector-title">
                        {selectedCommit ? `${selectedCommit.shortId} ${selectedCommit.message}` : 'No commit selected'}
                      </div>
                    </div>
                    <div className="git-inspector-controls">
                      <div className="git-diff-mode-toggle">
                        <button
                          className={diffViewMode === 'unified' ? 'active' : ''}
                          onClick={() => setDiffViewMode('unified')}
                        >
                          Unified
                        </button>
                        <button
                          className={diffViewMode === 'split' ? 'active' : ''}
                          onClick={() => setDiffViewMode('split')}
                        >
                          Side by Side
                        </button>
                      </div>
                      {detailsLoading && <div className="git-inspector-loading">Loading details...</div>}
                    </div>
                  </header>

                  {detailsError ? (
                    <div className="git-load-error">{detailsError}</div>
                  ) : (
                    <div className="git-commit-inspector-body">
                      <aside className="git-commit-file-list">
                        {selectedDetails?.files.length ? (
                          selectedDetails.files.map((file) => (
                            <button
                              key={`${selectedDetails.commitId}-${file.path}`}
                              className={`git-commit-file ${selectedFilePath === file.path ? 'active' : ''}`}
                              onClick={() => setSelectedFilePath(file.path)}
                            >
                              <span className={`git-file-status status-${file.status.toLowerCase()}`}>{file.status}</span>
                              <span className="git-file-path">{file.path}</span>
                            </button>
                          ))
                        ) : (
                          <div className="git-empty-details">No changed files.</div>
                        )}
                      </aside>

                      <div className="git-commit-diff-view">
                        {!selectedPatch ? (
                          <pre>No patch data available for this commit.</pre>
                        ) : diffViewMode === 'unified' ? (
                          <div className="git-diff-unified">
                            {unifiedLines.map((line, lineIndex) => {
                              const kind = classifyDiffLine(line)
                              return (
                                <div key={`${lineIndex}-${line.slice(0, 24)}`} className={`git-diff-line ${kind}`}>
                                  {line}
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="git-diff-split">
                            <div className="git-diff-split-header">Old</div>
                            <div className="git-diff-split-header">New</div>
                            {splitRows.map((row, rowIndex) => (
                              <div key={`row-${rowIndex}`} className="git-diff-split-row">
                                <div
                                  className={`git-diff-split-cell left ${row.leftKind}`}
                                >
                                  {row.left}
                                </div>
                                <div
                                  className={`git-diff-split-cell right ${row.rightKind}`}
                                >
                                  {row.right}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        )}

        {activeTab === 'changes' && (
          <div className="git-changes-pane">
            <div className="git-changes-toolbar">
              <label>
                <span>Branch</span>
                <select
                  value={selectedBranchForChanges}
                  onChange={(event) => setSelectedBranchForChanges(event.target.value)}
                  disabled={branchChangesLoading}
                >
                  {summary.localBranches.length === 0 && <option value="">No branches</option>}
                  {summary.localBranches.map((branch) => (
                    <option key={`changes-${branch}`} value={branch}>
                      {branch}
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={() => void loadBranchChanges(selectedBranchForChanges)} disabled={branchChangesLoading}>
                {branchChangesLoading ? 'Loading...' : 'Load Changes'}
              </button>
            </div>

            {branchChangesError && <div className="git-load-error">{branchChangesError}</div>}

            {branchChanges && (
              <div className="git-branch-summary">
                <div className="git-stat-card">
                  <div className="git-stat-label">Branch</div>
                  <div className="git-stat-value">{branchChanges.branch}</div>
                </div>
                <div className="git-stat-card">
                  <div className="git-stat-label">Compared To</div>
                  <div className="git-stat-value">{branchChanges.base ?? 'No base found'}</div>
                </div>
                <div className="git-stat-card">
                  <div className="git-stat-label">Diff Summary</div>
                  <div className="git-stat-value">
                    {branchChanges.summary.filesChanged} files, +{branchChanges.summary.insertions} / -
                    {branchChanges.summary.deletions}
                  </div>
                </div>
              </div>
            )}

            <div className="git-changes-list">
              {branchChanges?.files.length ? (
                branchChanges.files.map((file) => (
                  <div className="git-change-row" key={`${file.status}:${file.path}`}>
                    <span className={`git-file-status status-${file.status.toLowerCase()}`}>{file.status}</span>
                    <span className="git-file-path">{file.path}</span>
                    <span className="git-change-metrics">
                      +{file.insertions} / -{file.deletions}
                    </span>
                  </div>
                ))
              ) : (
                <div className="git-empty-details">
                  {branchChangesLoading ? 'Loading branch changes...' : 'No branch changes to display.'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
