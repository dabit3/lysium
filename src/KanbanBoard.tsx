import { useState, useMemo, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  useDroppable,
  useDraggable,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, X } from 'lucide-react'

/* ------------------------------------------------------------------ */
/*  Types re-exported / shared with App.tsx                            */
/* ------------------------------------------------------------------ */

interface BaseCard {
  id: number
  repo: string
  author: string
  avatarUrl: string
  timestamp: string
  title: string
  summary: string[]
  codeSnippet: string
}

interface IssueCard extends BaseCard {
  kind: 'issue'
  labels: string[]
}

interface PullRequestCard extends BaseCard {
  kind: 'pullRequest'
  additions: number
  deletions: number
  checks: Array<{ label: string; passed: boolean }>
  autoMergePermissionRace?: boolean
}

type TriageCard = IssueCard | PullRequestCard

interface ActionEntry {
  id: number
  label: string
  outcome: 'pending' | 'success' | 'failed'
  createdAt: number
}

interface JobEntry {
  id: number
  label: string
  target: string
  status: 'running' | 'success' | 'failed'
  message: string
  retryable: boolean
  retryPrompt?: string
  sessionUrl?: string
  pullRequestUrl?: string
  createdAt: number
}

/* ------------------------------------------------------------------ */
/*  Kanban column id type                                              */
/* ------------------------------------------------------------------ */

type KanbanColumnId = 'inbox' | 'inReview' | 'blocked' | 'backlog' | 'done'

interface BacklogItem {
  localId: string
  title: string
  body: string
  repo: string
  labels: string[]
  createdAt: number
}

const BACKLOG_STORAGE_KEY = 'minion.kanban_backlog.v1'

const loadPersistedBacklog = (): BacklogItem[] => {
  try {
    const raw = window.localStorage.getItem(BACKLOG_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as BacklogItem[]) : []
  } catch {
    return []
  }
}

const savePersistedBacklog = (items: BacklogItem[]) => {
  try {
    window.localStorage.setItem(BACKLOG_STORAGE_KEY, JSON.stringify(items))
  } catch { /* noop */ }
}

/* ------------------------------------------------------------------ */
/*  Column metadata                                                    */
/* ------------------------------------------------------------------ */

const COLUMN_META: Record<KanbanColumnId, { label: string; allowCreate: boolean }> = {
  inbox: { label: 'Inbox', allowCreate: true },
  inReview: { label: 'In Review', allowCreate: false },
  blocked: { label: 'Blocked', allowCreate: false },
  backlog: { label: 'Backlog', allowCreate: true },
  done: { label: 'Done', allowCreate: false },
}

const COLUMN_ORDER: KanbanColumnId[] = ['inbox', 'inReview', 'blocked', 'backlog', 'done']

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const normalizeRepoPath = (value: unknown) => {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^github\.com\//i, '')
    .replace(/^\/+/, '')
    .replace(/\.git$/i, '')
}

const toCardKey = (card: TriageCard) => {
  const repo = normalizeRepoPath(card.repo).toLowerCase()
  const id = Number(card.id)
  if (!repo || !Number.isFinite(id)) return ''
  return `${repo}#${Math.trunc(id)}`
}

const truncate = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max)}...`

/* ------------------------------------------------------------------ */
/*  Derive column from card state                                      */
/* ------------------------------------------------------------------ */

const deriveColumn = (
  card: TriageCard,
  actionStream: ActionEntry[],
  jobs: JobEntry[],
  mergeConflictLookup: Record<string, number>,
): KanbanColumnId => {
  const key = toCardKey(card)

  // Check if blocked (merge conflicts or failed checks)
  if (card.kind === 'pullRequest') {
    if (key && mergeConflictLookup[key] !== undefined) {
      return 'blocked'
    }
    const hasFailedChecks = card.checks.some((c) => !c.passed)
    if (hasFailedChecks) {
      return 'blocked'
    }
  }

  // Check actions for this card
  const cardActions = actionStream.filter((a) => {
    const lower = a.label.toLowerCase()
    return lower.includes(`#${card.id}`)
  })

  // Check jobs for this card
  const cardJobs = jobs.filter((j) => {
    const target = j.target.toLowerCase()
    return target.includes(`#${card.id}`)
  })

  // If there's a successful close or merge action, it's done
  const hasDoneAction = cardActions.some(
    (a) =>
      a.outcome === 'success' &&
      (a.label.toLowerCase().includes('close') ||
        a.label.toLowerCase().includes('merge')),
  )
  if (hasDoneAction) {
    return 'done'
  }

  // If there's a running job or pending review action, it's in review
  const hasRunningJob = cardJobs.some((j) => j.status === 'running')
  const hasPendingAction = cardActions.some(
    (a) =>
      a.outcome === 'pending' &&
      (a.label.toLowerCase().includes('review') ||
        a.label.toLowerCase().includes('assess') ||
        a.label.toLowerCase().includes('create pr')),
  )
  if (hasRunningJob || hasPendingAction) {
    return 'inReview'
  }

  // If the card has been assessed successfully (has a review/assess action that succeeded)
  const hasReviewAction = cardActions.some(
    (a) =>
      a.outcome === 'success' &&
      (a.label.toLowerCase().includes('review') ||
        a.label.toLowerCase().includes('assess')),
  )
  if (hasReviewAction) {
    return 'inReview'
  }

  // Default: inbox
  return 'inbox'
}

/* ------------------------------------------------------------------ */
/*  Draggable card component                                           */
/* ------------------------------------------------------------------ */

interface KanbanCardProps {
  card: TriageCard
  isDragOverlay?: boolean
}

function KanbanCardComponent({ card, isDragOverlay }: KanbanCardProps) {
  const cardId = `${card.kind}-${card.repo}-${card.id}`
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: cardId,
    data: { card },
  })

  const normalizedRepo = normalizeRepoPath(card.repo)
  const shortRepo = normalizedRepo.includes('/')
    ? normalizedRepo.split('/')[1]
    : normalizedRepo

  return (
    <motion.div
      ref={isDragOverlay ? undefined : setNodeRef}
      layoutId={cardId}
      className={`kanban-card ${isDragging && !isDragOverlay ? 'is-dragging' : ''} ${isDragOverlay ? 'is-overlay' : ''}`.trim()}
      {...(isDragOverlay ? {} : { ...listeners, ...attributes })}
      initial={false}
      animate={{ opacity: isDragging && !isDragOverlay ? 0.4 : 1 }}
      transition={{ duration: 0.2 }}
    >
      <div className="kanban-card-header">
        <span className={`kanban-card-kind ${card.kind === 'issue' ? 'kind-issue' : 'kind-pr'}`}>
          {card.kind === 'issue' ? 'Issue' : 'PR'}
        </span>
        <span className="kanban-card-id">#{card.id}</span>
      </div>
      <p className="kanban-card-title">{truncate(card.title, 60)}</p>
      <div className="kanban-card-footer">
        <span className="kanban-card-repo" title={normalizedRepo}>{truncate(shortRepo, 20)}</span>
        <img
          className="kanban-card-avatar"
          src={card.avatarUrl}
          alt={card.author}
          width={18}
          height={18}
        />
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  Backlog card component (for locally stored items)                   */
/* ------------------------------------------------------------------ */

interface BacklogCardProps {
  item: BacklogItem
}

function BacklogCardComponent({ item }: BacklogCardProps) {
  const cardId = `backlog-${item.localId}`
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: cardId,
    data: { backlogItem: item },
  })

  const shortRepo = item.repo
    ? item.repo.includes('/')
      ? item.repo.split('/')[1]
      : item.repo
    : 'local'

  return (
    <motion.div
      ref={setNodeRef}
      layoutId={cardId}
      className={`kanban-card backlog-local-card ${isDragging ? 'is-dragging' : ''}`.trim()}
      {...listeners}
      {...attributes}
      initial={false}
      animate={{ opacity: isDragging ? 0.4 : 1 }}
      transition={{ duration: 0.2 }}
    >
      <div className="kanban-card-header">
        <span className="kanban-card-kind kind-issue">Draft</span>
      </div>
      <p className="kanban-card-title">{truncate(item.title, 60)}</p>
      <div className="kanban-card-footer">
        <span className="kanban-card-repo">{truncate(shortRepo, 20)}</span>
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  Droppable column component                                         */
/* ------------------------------------------------------------------ */

interface KanbanColumnProps {
  columnId: KanbanColumnId
  cards: TriageCard[]
  backlogItems?: BacklogItem[]
  onCreateClick?: () => void
}

function KanbanColumn({ columnId, cards, backlogItems, onCreateClick }: KanbanColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id: columnId })
  const meta = COLUMN_META[columnId]

  return (
    <div
      ref={setNodeRef}
      className={`kanban-column ${isOver ? 'is-over' : ''}`.trim()}
    >
      <div className="kanban-column-header">
        <div className="kanban-column-header-left">
          <h3 className="kanban-column-title">{meta.label}</h3>
          <span className="kanban-column-count">
            {cards.length + (backlogItems?.length ?? 0)}
          </span>
        </div>
        {meta.allowCreate && onCreateClick ? (
          <button
            type="button"
            className="kanban-column-add"
            onClick={onCreateClick}
            aria-label={`Add item to ${meta.label}`}
          >
            <Plus size={14} />
          </button>
        ) : null}
      </div>
      <div className="kanban-column-cards hide-scrollbar">
        <AnimatePresence mode="popLayout">
          {cards.map((card) => (
            <KanbanCardComponent key={`${card.kind}-${card.repo}-${card.id}`} card={card} />
          ))}
          {backlogItems?.map((item) => (
            <BacklogCardComponent key={`backlog-${item.localId}`} item={item} />
          ))}
        </AnimatePresence>
        {cards.length === 0 && (!backlogItems || backlogItems.length === 0) ? (
          <div className="kanban-column-empty">No items</div>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Create Issue Modal                                                 */
/* ------------------------------------------------------------------ */

interface CreateIssueModalProps {
  isOpen: boolean
  onClose: () => void
  availableRepos: string[]
  targetColumn: KanbanColumnId
  onCreateIssue: (repo: string, title: string, body: string, labels: string[]) => Promise<void>
  onCreateBacklogItem: (title: string, body: string, repo: string, labels: string[]) => void
}

function CreateIssueModal({
  isOpen,
  onClose,
  availableRepos,
  targetColumn,
  onCreateIssue,
  onCreateBacklogItem,
}: CreateIssueModalProps) {
  const [repo, setRepo] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [labelsInput, setLabelsInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError('Title is required.')
      return
    }

    const labels = labelsInput
      .split(',')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)

    // Backlog items without a repo are stored locally
    if (targetColumn === 'backlog' && !repo) {
      onCreateBacklogItem(trimmedTitle, body.trim(), '', labels)
      resetAndClose()
      return
    }

    if (!repo) {
      setError('Select a repository.')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      await onCreateIssue(repo, trimmedTitle, body.trim(), labels)
      resetAndClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create issue.'
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetAndClose = () => {
    setRepo('')
    setTitle('')
    setBody('')
    setLabelsInput('')
    setError(null)
    setIsSubmitting(false)
    onClose()
  }

  if (!isOpen) return null

  return (
    <motion.div
      key="kanban-create-modal-backdrop"
      className="modal-backdrop"
      onClick={resetAndClose}
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="comment-modal kanban-create-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Create new GitHub issue"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.97 }}
        transition={{ type: 'spring', damping: 28, stiffness: 340, mass: 0.85 }}
      >
        <div className="kanban-modal-header">
          <h3>New Issue</h3>
          <button
            type="button"
            className="kanban-modal-close"
            onClick={resetAndClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="kanban-modal-field">
          <label htmlFor="kanban-repo-select">Repository</label>
          <select
            id="kanban-repo-select"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          >
            <option value="">
              {targetColumn === 'backlog' ? '(none - store locally)' : 'Select a repository...'}
            </option>
            {availableRepos.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <div className="kanban-modal-field">
          <label htmlFor="kanban-title-input">Title</label>
          <input
            id="kanban-title-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Issue title..."
            autoComplete="off"
          />
        </div>

        <div className="kanban-modal-field">
          <label htmlFor="kanban-body-input">Body</label>
          <textarea
            id="kanban-body-input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Describe the issue..."
            rows={4}
            spellCheck={false}
          />
        </div>

        <div className="kanban-modal-field">
          <label htmlFor="kanban-labels-input">Labels</label>
          <input
            id="kanban-labels-input"
            type="text"
            value={labelsInput}
            onChange={(e) => setLabelsInput(e.target.value)}
            placeholder="bug, enhancement (comma-separated)"
            autoComplete="off"
          />
        </div>

        {error ? <p className="kanban-modal-error">{error}</p> : null}

        <div className="modal-actions">
          <button
            type="button"
            className="fab-button secondary"
            onClick={resetAndClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="fab-button primary"
            onClick={() => { void handleSubmit() }}
            disabled={isSubmitting}
          >
            {isSubmitting ? <span className="spinner" aria-hidden="true" /> : null}
            <span>{isSubmitting ? 'Creating...' : 'Create Issue'}</span>
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main KanbanBoard component                                         */
/* ------------------------------------------------------------------ */

interface KanbanBoardProps {
  issues: IssueCard[]
  pullRequests: PullRequestCard[]
  actionStream: ActionEntry[]
  jobs: JobEntry[]
  mergeConflictLookup: Record<string, number>
  availableRepos: string[]
  isWideLayout: boolean
  onSwipeAction: (tab: 'issues' | 'pullRequests', direction: 'left' | 'right' | 'down', card: IssueCard | PullRequestCard) => void
  onCreateIssue: (repo: string, title: string, body: string, labels: string[]) => Promise<void>
  onShowToast: (message: string) => void
}

function KanbanBoard({
  issues,
  pullRequests,
  actionStream,
  jobs,
  mergeConflictLookup,
  availableRepos,
  isWideLayout,
  onSwipeAction,
  onCreateIssue,
  onShowToast,
}: KanbanBoardProps) {
  const [activeCard, setActiveCard] = useState<TriageCard | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [createTargetColumn, setCreateTargetColumn] = useState<KanbanColumnId>('inbox')
  const [backlogItems, setBacklogItems] = useState<BacklogItem[]>(() => loadPersistedBacklog())

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  )

  // Derive column assignments for all cards
  const columnAssignments = useMemo(() => {
    const allCards: TriageCard[] = [...issues, ...pullRequests]
    const columns: Record<KanbanColumnId, TriageCard[]> = {
      inbox: [],
      inReview: [],
      blocked: [],
      backlog: [],
      done: [],
    }

    allCards.forEach((card) => {
      const col = deriveColumn(card, actionStream, jobs, mergeConflictLookup)
      columns[col].push(card)
    })

    return columns
  }, [issues, pullRequests, actionStream, jobs, mergeConflictLookup])

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event
      const card = active.data.current?.card as TriageCard | undefined
      if (card) {
        setActiveCard(card)
      }
    },
    [],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setActiveCard(null)

      if (!over) return

      const targetColumn = over.id as KanbanColumnId
      if (!COLUMN_ORDER.includes(targetColumn)) return

      const card = active.data.current?.card as TriageCard | undefined
      if (!card) return

      // Determine the card's current column
      const currentColumn = deriveColumn(card, actionStream, jobs, mergeConflictLookup)
      if (currentColumn === targetColumn) return

      // Map column transitions to swipe actions
      const tab: 'issues' | 'pullRequests' = card.kind === 'issue' ? 'issues' : 'pullRequests'
      if (targetColumn === 'done') {
        // Moving to Done = left swipe (close)
        onSwipeAction(tab, 'left', card)
        onShowToast(`Moved #${card.id} to Done`)
      } else if (targetColumn === 'inReview') {
        // Moving to In Review = right swipe (trigger review/PR)
        onSwipeAction(tab, 'right', card)
        onShowToast(`Moved #${card.id} to In Review`)
      } else if (targetColumn === 'inbox') {
        // Moving back to Inbox = skip/reset
        onSwipeAction(tab, 'down', card)
        onShowToast(`Moved #${card.id} to Inbox`)
      } else if (targetColumn === 'backlog') {
        // Moving to Backlog = skip
        onSwipeAction(tab, 'down', card)
        onShowToast(`Moved #${card.id} to Backlog`)
      }
    },
    [actionStream, jobs, mergeConflictLookup, onSwipeAction, onShowToast],
  )

  const handleCreateClick = (columnId: KanbanColumnId) => {
    setCreateTargetColumn(columnId)
    setIsCreateModalOpen(true)
  }

  const handleCreateBacklogItem = useCallback(
    (title: string, body: string, repo: string, labels: string[]) => {
      const newItem: BacklogItem = {
        localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        body,
        repo,
        labels,
        createdAt: Date.now(),
      }
      setBacklogItems((prev) => {
        const next = [newItem, ...prev]
        savePersistedBacklog(next)
        return next
      })
      onShowToast('Backlog item created locally.')
    },
    [onShowToast],
  )

  const handleCreateIssue = useCallback(
    async (repo: string, title: string, body: string, labels: string[]) => {
      await onCreateIssue(repo, title, body, labels)
      onShowToast(`Issue created in ${repo}`)
    },
    [onCreateIssue, onShowToast],
  )

  return (
    <div className={`kanban-board ${isWideLayout ? 'kanban-wide' : ''}`.trim()}>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {COLUMN_ORDER.map((colId) => (
          <KanbanColumn
            key={colId}
            columnId={colId}
            cards={columnAssignments[colId]}
            backlogItems={colId === 'backlog' ? backlogItems : undefined}
            onCreateClick={
              COLUMN_META[colId].allowCreate ? () => handleCreateClick(colId) : undefined
            }
          />
        ))}

        <DragOverlay dropAnimation={null}>
          {activeCard ? (
            <KanbanCardComponent card={activeCard} isDragOverlay />
          ) : null}
        </DragOverlay>
      </DndContext>

      <AnimatePresence>
        {isCreateModalOpen ? (
          <CreateIssueModal
            isOpen={isCreateModalOpen}
            onClose={() => setIsCreateModalOpen(false)}
            availableRepos={availableRepos}
            targetColumn={createTargetColumn}
            onCreateIssue={handleCreateIssue}
            onCreateBacklogItem={handleCreateBacklogItem}
          />
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export default KanbanBoard
export type {
  IssueCard,
  PullRequestCard,
  TriageCard,
  ActionEntry,
  JobEntry,
  KanbanColumnId,
}
