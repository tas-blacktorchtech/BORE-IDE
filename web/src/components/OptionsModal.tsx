export type CommandAliasTarget = 'editor' | 'explorer' | 'terminal'

export type CommandAlias = {
  keyword: string
  target: CommandAliasTarget
}

type OptionsModalProps = {
  isOpen: boolean
  optionsTab: 'command-line'
  commandAliases: CommandAlias[]
  optionsBusy: boolean
  optionsError: string | null
  onClose: () => void
  onSetTab: (tab: 'command-line') => void
  onKeywordChange: (index: number, value: string) => void
  onTargetChange: (index: number, value: CommandAliasTarget) => void
  onRemoveAlias: (index: number) => void
  onAddAlias: () => void
  onSave: () => void
}

export function OptionsModal({
  isOpen,
  optionsTab,
  commandAliases,
  optionsBusy,
  optionsError,
  onClose,
  onSetTab,
  onKeywordChange,
  onTargetChange,
  onRemoveAlias,
  onAddAlias,
  onSave,
}: OptionsModalProps) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="options-overlay">
      <section className="options-window">
        <header className="options-header">
          <span>Options</span>
          <button onClick={onClose}>×</button>
        </header>
        <div className="options-body">
          <aside className="options-left">
            <button className={optionsTab === 'command-line' ? 'active' : ''} onClick={() => onSetTab('command-line')}>
              Command Line
            </button>
          </aside>
          <section className="options-right">
            <h2>Command Line Commands</h2>
            <p>Create short commands that open panels. Example: `de` -&gt; `editor`.</p>
            <div className="alias-list">
              {commandAliases.map((alias, index) => (
                <div key={`${alias.keyword}-${index}`} className="alias-row">
                  <input
                    value={alias.keyword}
                    onChange={(event) => onKeywordChange(index, event.target.value)}
                    placeholder="command"
                  />
                  <select
                    value={alias.target}
                    onChange={(event) => onTargetChange(index, event.target.value as CommandAliasTarget)}
                  >
                    <option value="editor">editor</option>
                    <option value="explorer">explorer</option>
                    <option value="terminal">terminal</option>
                  </select>
                  <button onClick={() => onRemoveAlias(index)}>Remove</button>
                </div>
              ))}
            </div>
            <div className="options-actions">
              <button onClick={onAddAlias}>Add Command</button>
              <button onClick={onSave} disabled={optionsBusy}>
                {optionsBusy ? 'Saving...' : 'Save'}
              </button>
            </div>
            {optionsError && <div className="startup-error">{optionsError}</div>}
          </section>
        </div>
      </section>
    </div>
  )
}
