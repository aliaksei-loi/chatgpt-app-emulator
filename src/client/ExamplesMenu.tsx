import { useEffect, useRef, useState } from 'react'
import type { EmulatorState } from './api'
import { Glyph } from './Glyph'

const RUNTIME_LABEL = { node: 'Node', python: 'Python', remote: 'Remote' }

export function ExamplesMenu({ examples, onStart }: { examples: EmulatorState['examples']; onStart: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
        className={`inline-flex h-7 cursor-pointer items-center gap-1 rounded-control px-2 text-[12.5px] font-medium transition-colors duration-150 hover:bg-hover hover:text-ink ${
          open ? 'bg-hover text-ink' : 'text-ink-2'
        }`}
      >
        Examples
        <span className="text-ink-3">
          <Glyph name="chevron" size={11} />
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-30 mt-1 max-h-[70vh] w-80 overflow-y-auto rounded-[10px] bg-surface p-1 shadow-raised"
          style={{ animation: 'pop-in 180ms cubic-bezier(0.23,1,0.32,1) both', transformOrigin: 'top right' }}
        >
          {examples.list.map((example) => (
            <button
              key={example.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onStart(example.id)
              }}
              className="flex w-full cursor-pointer flex-col gap-0.5 rounded-[6px] px-2.5 py-2 text-left transition-colors duration-100 hover:bg-hover"
            >
              <span className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-ink">{example.title}</span>
                <span className="rounded-chip bg-field px-1.5 text-[10.5px] font-medium text-ink-2">{RUNTIME_LABEL[example.runtime]}</span>
                {examples.active.id === example.id && examples.active.status === 'running' && (
                  <span className="ml-auto size-1.5 rounded-full bg-green" title="Running" />
                )}
              </span>
              <span className="text-[12px] leading-[1.45] text-ink-2">{example.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
