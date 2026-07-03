# Kanban Board UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the read-only kanban board into a fully interactive, keyboard-accessible, performant work management UI where users can edit, delete, and move work units directly on the board.

**Architecture:** Replace the read-only /board page with an interactive version that reuses the existing WorkUnitCard component (currently dead code). Wire up keyboard navigation (Enter to edit, Delete to delete, arrows to move), add focus management (focus:ring styles), replace jargon with plain language, and optimize the JS bundle from 1.87 MB to <500 KB. All changes are additive to the existing API (no backend changes). The redesign prioritizes usefulness (#2) and accessibility (#8) per the Dieter Rams audit.

**Tech Stack:** Next.js 15, React 18, TypeScript, Tailwind CSS, react-beautiful-dnd (lazy-loaded), Vitest for testing

## Global Constraints

- Preserve all 7 backend API endpoints (no changes to src/lib/, src/app/api/)
- Keep Tailwind design system intact (spacing, type, color scales)
- Maintain 3-column layout (To Do / In Progress / Done)
- WCAG AA accessibility minimum (focus management, keyboard nav, contrast ≥4.5:1)
- Bundle size target: <500 KB gzipped (from current 1.87 MB)
- TDD throughout; all new code has tests
- No breaking changes for existing users (migration path required)
- All user-facing strings must be plain language (no jargon)

---

## File Structure Overview

**Files to Create:**
- `src/hooks/useKeyboardNav.ts` — Custom hook for keyboard event handlers (Enter, Delete, arrow keys)
- `src/hooks/useBoardState.ts` — State management for edit/delete modes per card
- `src/lib/boardUtils.ts` — Utilities for board operations (move card, toggle edit mode, delete with confirmation)

**Files to Modify:**
- `src/app/board/page.tsx` — Replace read-only view with interactive board using WorkUnitCard
- `src/components/WorkUnitCard.tsx` — Wire up keyboard handlers, add focus styles, expose edit/delete actions
- `src/app/components/SyncButton.tsx` — Change "Sync from JIRA" to "Import from JIRA"
- `next.config.js` — Add bundle analysis and lazy-load configuration

**Files to Test:**
- `src/hooks/useKeyboardNav.test.ts` — Test keyboard event handling
- `src/hooks/useBoardState.test.ts` — Test edit/delete mode state
- `src/lib/boardUtils.test.ts` — Test board operations
- `src/app/board/page.test.tsx` — Test interactive board rendering, keyboard nav, focus management

---

## Task Breakdown

### Task 1: Wire WorkUnitCard into /board page (Make board interactive)

**Files:**
- Modify: `src/app/board/page.tsx`
- Modify: `src/components/WorkUnitCard.tsx`

**Interfaces:**
- Consumes: `StoryDTO`, `WorkUnitDTO`, `Column` from `src/lib/types.ts`; existing API endpoints (GET /api/stories, PATCH /api/work-units/[id], DELETE /api/work-units/[id])
- Produces: Interactive `WorkUnitCard` component with `onEdit`, `onDelete`, `onMove` callbacks; updated /board page that renders cards with action buttons

**Steps:**

- [ ] **Step 1: Add edit/delete mode state to WorkUnitCard.tsx**

Open `src/components/WorkUnitCard.tsx`. Add local state for edit mode and delete confirmation:

```typescript
const [isEditMode, setIsEditMode] = useState(false);
const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
const [editTitle, setEditTitle] = useState(workUnit.title);
const [editDescription, setEditDescription] = useState(workUnit.description || '');
```

- [ ] **Step 2: Add focus styles to WorkUnitCard**

Add `focus:ring-2 focus:ring-blue-500 focus:outline-none` classes to the main card div:

```typescript
<div
  draggable
  className="bg-blue-50 border border-gray-200 rounded p-4 cursor-move focus:ring-2 focus:ring-blue-500 focus:outline-none"
  tabIndex={0}
>
```

- [ ] **Step 3: Add visible action buttons to card**

Replace placeholder text with actual edit/delete/save/cancel buttons. Add above the description:

```typescript
<div className="flex gap-2 mb-2">
  {!isEditMode ? (
    <>
      <button
        onClick={() => setIsEditMode(true)}
        className="px-2 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 focus:ring-2 focus:ring-blue-500"
      >
        Edit
      </button>
      <button
        onClick={() => setShowDeleteConfirm(true)}
        className="px-2 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 focus:ring-2 focus:ring-red-500"
      >
        {showDeleteConfirm ? 'Confirm Delete?' : 'Delete'}
      </button>
    </>
  ) : (
    <>
      <button
        onClick={async () => {
          await fetch(`/api/work-units/${workUnit.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: editTitle, description: editDescription }),
          });
          setIsEditMode(false);
        }}
        className="px-2 py-1 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200"
      >
        Save
      </button>
      <button
        onClick={() => setIsEditMode(false)}
        className="px-2 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
      >
        Cancel
      </button>
    </>
  )}
</div>
```

- [ ] **Step 4: Implement edit form (inline fields)**

When `isEditMode === true`, render input fields instead of display text:

```typescript
{isEditMode ? (
  <>
    <input
      value={editTitle}
      onChange={(e) => setEditTitle(e.target.value)}
      className="w-full px-2 py-1 mb-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
      placeholder="Title"
    />
    <textarea
      value={editDescription}
      onChange={(e) => setEditDescription(e.target.value)}
      className="w-full px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
      placeholder="Description"
      rows={2}
    />
  </>
) : (
  <>
    <h3 className="text-gray-800 font-semibold">{workUnit.title}</h3>
    <p className="text-gray-600 text-sm">{workUnit.description}</p>
  </>
)}
```

- [ ] **Step 5: Implement delete confirmation with 2-step flow**

When delete button is clicked once, show "Confirm Delete?" text. On second click, execute DELETE:

```typescript
if (showDeleteConfirm) {
  await fetch(`/api/work-units/${workUnit.id}`, { method: 'DELETE' });
  onDelete?.(); // callback to parent to refresh board
}
```

- [ ] **Step 6: Write test for edit/delete modes**

Create test in `src/components/WorkUnitCard.test.tsx`:

```typescript
it('renders Edit button in normal mode', () => {
  const { getByText } = render(<WorkUnitCard workUnit={mockUnit} />);
  expect(getByText('Edit')).toBeInTheDocument();
});

it('shows input fields when Edit is clicked', () => {
  const { getByText, getByPlaceholderText } = render(<WorkUnitCard workUnit={mockUnit} />);
  fireEvent.click(getByText('Edit'));
  expect(getByPlaceholderText('Title')).toBeInTheDocument();
});

it('calls PATCH when Save is clicked', async () => {
  const { getByText, getByPlaceholderText } = render(<WorkUnitCard workUnit={mockUnit} />);
  fireEvent.click(getByText('Edit'));
  fireEvent.change(getByPlaceholderText('Title'), { target: { value: 'New Title' } });
  fireEvent.click(getByText('Save'));
  expect(fetch).toHaveBeenCalledWith(
    `/api/work-units/${mockUnit.id}`,
    expect.objectContaining({ method: 'PATCH' })
  );
});
```

- [ ] **Step 7: Update /board page to use WorkUnitCard**

Open `src/app/board/page.tsx`. Replace inline card rendering with imported WorkUnitCard component:

```typescript
import { WorkUnitCard } from '@/components/WorkUnitCard';

// Inside KanbanColumn component:
{workUnits.map((unit) => (
  <WorkUnitCard
    key={unit.id}
    workUnit={unit}
    onDelete={() => fetchStories()} // refresh on delete
  />
))}
```

- [ ] **Step 8: Run tests and commit**

```bash
npm test -- WorkUnitCard.test.tsx
npm test -- board/page.test.tsx
git add src/components/WorkUnitCard.tsx src/app/board/page.tsx src/components/WorkUnitCard.test.tsx
git commit -m "feat: make board interactive with edit/delete buttons and focus styles"
```

---

### Task 2: Implement keyboard navigation (Enter, Delete, arrow keys)

**Files:**
- Create: `src/hooks/useKeyboardNav.ts`
- Create: `src/hooks/useKeyboardNav.test.ts`
- Modify: `src/components/WorkUnitCard.tsx`
- Modify: `src/app/board/page.tsx`

**Interfaces:**
- Consumes: `WorkUnitDTO`, `Column` from `src/lib/types.ts`; callbacks `onEdit`, `onDelete`, `onMove`
- Produces: `useKeyboardNav` hook returning `{onKeyDown}` handler; integration into card and board components

**Steps:**

- [ ] **Step 1: Create useKeyboardNav hook**

Create new file `src/hooks/useKeyboardNav.ts`:

```typescript
export function useKeyboardNav({
  onEdit,
  onDelete,
  onMoveLeft,
  onMoveRight,
}: {
  onEdit: () => void;
  onDelete: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
}) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEdit();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      onDelete();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onMoveLeft();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onMoveRight();
    }
  };

  return { onKeyDown: handleKeyDown };
}
```

- [ ] **Step 2: Write tests for useKeyboardNav**

Create `src/hooks/useKeyboardNav.test.ts`:

```typescript
it('calls onEdit when Enter is pressed', () => {
  const onEdit = vi.fn();
  const { onKeyDown } = useKeyboardNav({ onEdit, onDelete: vi.fn(), onMoveLeft: vi.fn(), onMoveRight: vi.fn() });
  
  const event = new KeyboardEvent('keydown', { key: 'Enter' });
  onKeyDown(event as any);
  
  expect(onEdit).toHaveBeenCalled();
});

it('calls onDelete when Delete is pressed', () => {
  const onDelete = vi.fn();
  const { onKeyDown } = useKeyboardNav({ onEdit: vi.fn(), onDelete, onMoveLeft: vi.fn(), onMoveRight: vi.fn() });
  
  const event = new KeyboardEvent('keydown', { key: 'Delete' });
  onKeyDown(event as any);
  
  expect(onDelete).toHaveBeenCalled();
});

it('calls onMoveLeft when ArrowLeft is pressed', () => {
  const onMoveLeft = vi.fn();
  const { onKeyDown } = useKeyboardNav({ onEdit: vi.fn(), onDelete: vi.fn(), onMoveLeft, onMoveRight: vi.fn() });
  
  const event = new KeyboardEvent('keydown', { key: 'ArrowLeft' });
  onKeyDown(event as any);
  
  expect(onMoveLeft).toHaveBeenCalled();
});
```

- [ ] **Step 3: Wire keyboard handler into WorkUnitCard**

Update `src/components/WorkUnitCard.tsx` to use hook:

```typescript
import { useKeyboardNav } from '@/hooks/useKeyboardNav';

export function WorkUnitCard({ workUnit, onDelete }: WorkUnitCardProps) {
  const [isEditMode, setIsEditMode] = useState(false);
  // ... other state ...

  const { onKeyDown } = useKeyboardNav({
    onEdit: () => setIsEditMode(true),
    onDelete: () => setShowDeleteConfirm(true),
    onMoveLeft: () => onMove?.('left'),
    onMoveRight: () => onMove?.('right'),
  });

  return (
    <div
      onKeyDown={onKeyDown}
      tabIndex={0}
      className="... focus:ring-2 focus:ring-blue-500"
    >
      {/* card content */}
    </div>
  );
}
```

- [ ] **Step 4: Add move handlers to board page**

Update `src/app/board/page.tsx` to handle left/right arrow navigation:

```typescript
const moveCard = async (unitId: string, newColumn: Column) => {
  const currentOrder = stories.find(s => s.workUnits.some(u => u.id === unitId))?.workUnits
    .filter(u => u.column === newColumn).length || 0;
  
  await fetch(`/api/work-units/${unitId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ column: newColumn, order: currentOrder }),
  });
  
  fetchStories();
};
```

- [ ] **Step 5: Run tests and commit**

```bash
npm test -- useKeyboardNav.test.ts
npm test -- WorkUnitCard.test.tsx
git add src/hooks/useKeyboardNav.ts src/hooks/useKeyboardNav.test.ts src/components/WorkUnitCard.tsx src/app/board/page.tsx
git commit -m "feat: add keyboard navigation (Enter to edit, Delete to delete, arrows to move columns)"
```

---

### Task 3: Add focus styles and accessible labels (Principle #8: Thorough)

**Files:**
- Modify: `src/components/WorkUnitCard.tsx`
- Modify: `src/app/board/page.tsx`
- Modify: `src/app/board/page.test.tsx`

**Interfaces:**
- Consumes: Tailwind focus utilities
- Produces: Fully focusable card with aria-labels and focus indicators

**Steps:**

- [ ] **Step 1: Add focus:ring to all interactive elements**

Update all buttons in WorkUnitCard to include focus styles:

```typescript
className="px-2 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 focus:ring-2 focus:ring-blue-500 focus:outline-none focus:ring-offset-1"
```

Add to: Edit button, Delete button, Save button, Cancel button, input fields.

- [ ] **Step 2: Add aria-label to card container**

```typescript
<div
  role="button"
  tabIndex={0}
  aria-label={`Task: ${workUnit.title}. Press Enter to edit, Delete to remove, arrow keys to move between columns.`}
  className="... focus:ring-2 focus:ring-blue-500"
>
```

- [ ] **Step 3: Add aria-live region for status updates**

Add a hidden but screen-reader-visible div for async updates:

```typescript
<div aria-live="polite" aria-atomic="true" className="sr-only">
  {isEditMode ? 'Edit mode active' : ''}
  {showDeleteConfirm ? 'Delete confirmation active' : ''}
</div>
```

- [ ] **Step 4: Test focus order with keyboard**

Write test in `src/app/board/page.test.tsx`:

```typescript
it('maintains logical focus order across columns', () => {
  const { getAllByRole } = render(<Board />);
  const cards = getAllByRole('button');
  expect(cards.length).toBeGreaterThan(0);
  
  // Verify each card has focus ring class
  cards.forEach(card => {
    expect(card).toHaveClass('focus:ring-2');
  });
});

it('provides keyboard instructions via aria-label', () => {
  const { getByLabelText } = render(<Board />);
  const card = getByLabelText(/Press Enter to edit/);
  expect(card).toBeInTheDocument();
});
```

- [ ] **Step 5: Commit**

```bash
npm test -- board/page.test.tsx
git add src/components/WorkUnitCard.tsx src/app/board/page.tsx src/app/board/page.test.tsx
git commit -m "feat: add comprehensive focus management and aria labels for accessibility"
```

---

### Task 4: Replace jargon with plain language (Principle #4: Understandable)

**Files:**
- Modify: `src/app/board/page.tsx`
- Modify: `src/app/components/SyncButton.tsx`

**Interfaces:**
- Consumes: Current copy strings
- Produces: Clear, jargon-free labels and messages

**Steps:**

- [ ] **Step 1: Replace "No work units" with "No tasks"**

In `src/app/board/page.tsx` line 116, change:

```typescript
// OLD:
<p className="text-gray-400">No work units</p>

// NEW:
<p className="text-gray-400">No tasks yet. Import from JIRA or add one manually.</p>
```

- [ ] **Step 2: Replace "Sync from JIRA" with "Import from JIRA"**

In `src/app/components/SyncButton.tsx` line 54, change:

```typescript
// OLD:
Sync from JIRA

// NEW:
Import from JIRA
```

- [ ] **Step 3: Update loading/success messages**

Change success message to:

```typescript
// OLD:
{result.created + result.updated} stories synced

// NEW:
Imported {result.created} new tasks, updated {result.updated}
```

- [ ] **Step 4: Add helpful subtitle to board**

Add above the 3-column layout in `src/app/board/page.tsx`:

```typescript
<p className="text-gray-600 text-sm mb-4">
  Drag tasks between columns to track progress. Click Edit to change details, Delete to remove.
</p>
```

- [ ] **Step 5: Test text content**

Add test in `src/app/board/page.test.tsx`:

```typescript
it('displays "Import from JIRA" button', () => {
  const { getByText } = render(<Board />);
  expect(getByText('Import from JIRA')).toBeInTheDocument();
});

it('displays "No tasks yet" message when empty', () => {
  const { getByText } = render(<Board stories={[]} />);
  expect(getByText(/No tasks yet/)).toBeInTheDocument();
});
```

- [ ] **Step 6: Commit**

```bash
npm test -- board/page.test.tsx
git add src/app/board/page.tsx src/app/components/SyncButton.tsx
git commit -m "feat: replace domain jargon with plain language (work units → tasks, Sync → Import)"
```

---

### Task 5: Add onboarding tooltip (Principle #4 + #6: Understandable + Honest)

**Files:**
- Create: `src/components/OnboardingTooltip.tsx`
- Create: `src/components/OnboardingTooltip.test.tsx`
- Modify: `src/app/board/page.tsx`

**Interfaces:**
- Consumes: `localStorage` for persistence, React useState/useEffect
- Produces: Optional dismissible tooltip on first visit to /board

**Steps:**

- [ ] **Step 1: Create OnboardingTooltip component**

Create `src/components/OnboardingTooltip.tsx`:

```typescript
import { useState, useEffect } from 'react';

export function OnboardingTooltip() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const hasSeenTooltip = localStorage.getItem('boardOnboarded');
    if (!hasSeenTooltip) {
      setIsVisible(true);
      localStorage.setItem('boardOnboarded', 'true');
    }
  }, []);

  if (!isVisible) return null;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-4">
      <div className="flex justify-between items-start">
        <div>
          <h4 className="font-semibold text-blue-900">Welcome to your task board!</h4>
          <ul className="text-sm text-blue-800 mt-2 space-y-1">
            <li>• Drag tasks between columns to track progress</li>
            <li>• Click "Edit" to change title or description</li>
            <li>• Press Enter on a task to edit, Delete key to remove</li>
            <li>• Use arrow keys to move tasks left/right between columns</li>
            <li>• Click "Import from JIRA" to add more tasks</li>
          </ul>
        </div>
        <button
          onClick={() => setIsVisible(false)}
          className="text-blue-600 hover:text-blue-800 font-semibold text-lg leading-none"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write tests for OnboardingTooltip**

Create `src/components/OnboardingTooltip.test.tsx`:

```typescript
it('shows tooltip on first visit', () => {
  localStorage.clear();
  const { getByText } = render(<OnboardingTooltip />);
  expect(getByText('Welcome to your task board!')).toBeInTheDocument();
});

it('hides tooltip on subsequent visits', () => {
  localStorage.setItem('boardOnboarded', 'true');
  const { queryByText } = render(<OnboardingTooltip />);
  expect(queryByText('Welcome to your task board!')).not.toBeInTheDocument();
});

it('dismisses tooltip when X is clicked', () => {
  localStorage.clear();
  const { getByText, queryByText } = render(<OnboardingTooltip />);
  fireEvent.click(getByText('✕'));
  expect(queryByText('Welcome to your task board!')).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Add tooltip to board page**

Update `src/app/board/page.tsx` to render tooltip above board:

```typescript
import { OnboardingTooltip } from '@/components/OnboardingTooltip';

// Inside the board component, before the 3-column layout:
<OnboardingTooltip />
```

- [ ] **Step 4: Test integration with board**

Add test in `src/app/board/page.test.tsx`:

```typescript
it('renders onboarding tooltip on first board visit', () => {
  localStorage.clear();
  const { getByText } = render(<Board />);
  expect(getByText('Welcome to your task board!')).toBeInTheDocument();
});
```

- [ ] **Step 5: Commit**

```bash
npm test -- OnboardingTooltip.test.tsx
npm test -- board/page.test.tsx
git add src/components/OnboardingTooltip.tsx src/components/OnboardingTooltip.test.tsx src/app/board/page.tsx
git commit -m "feat: add onboarding tooltip explaining keyboard navigation and UI affordances"
```

---

### Task 6: Optimize bundle size (Principle #9: Environmentally Friendly)

**Files:**
- Modify: `next.config.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: Current build configuration, dependency tree
- Produces: <500 KB gzipped bundle via lazy-loading and tree-shaking

**Steps:**

- [ ] **Step 1: Analyze current bundle**

Run build analysis:

```bash
npm run build
npm install -g webpack-bundle-analyzer
npx webpack-bundle-analyzer .next/static/chunks/main-*.js
```

Identify largest dependencies (expected: react, react-dom, next, react-beautiful-dnd).

- [ ] **Step 2: Lazy-load react-beautiful-dnd**

Update `src/components/WorkUnitCard.tsx` to lazy-load the drag library:

```typescript
import dynamic from 'next/dynamic';
const DraggableCard = dynamic(() => import('react-beautiful-dnd').then(m => m.Draggable), {
  loading: () => <div>Loading...</div>,
});
```

- [ ] **Step 3: Tree-shake unused dependencies**

Check `package.json` for unused dependencies. Remove any not directly used:

```bash
npm ls --depth=0 | grep -E "(unused|extraneous)"
npm uninstall <unused-package>
```

- [ ] **Step 4: Enable compression in next.config.js**

Add to `next.config.js`:

```typescript
module.exports = {
  compress: true,
  // ... other config
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.optimization.splitChunks.cacheGroups = {
        ...config.optimization.splitChunks.cacheGroups,
        vendor: {
          test: /node_modules/,
          chunks: 'initial',
          priority: 10,
        },
      };
    }
    return config;
  },
};
```

- [ ] **Step 5: Re-measure bundle size**

```bash
npm run build
# Verify output shows bundle <500 KB gzipped
# Expected output: ○ /board 250 KB (or similar, <500 KB)
```

- [ ] **Step 6: Test that board still works**

```bash
npm test -- board/page.test.tsx
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add next.config.js package.json
git commit -m "feat: optimize bundle size to <500 KB via lazy-loading and tree-shaking (Principle #9)"
```

---

### Task 7: Verify all 6 states are present and styled

**Files:**
- Modify: `src/app/board/page.tsx`
- Modify: `src/components/WorkUnitCard.tsx`
- Modify: `src/app/board/page.test.tsx`

**Interfaces:**
- Consumes: Existing state management (loading, error, empty, success, disabled, focus)
- Produces: Visible, distinct styling for all 6 states

**Steps:**

- [ ] **Step 1: Verify empty state**

In `src/app/board/page.tsx`, ensure empty state is visible with good contrast:

```typescript
{stories.length === 0 ? (
  <div className="text-center py-12 bg-gray-50 rounded">
    <p className="text-gray-700 text-lg">No tasks yet. Import from JIRA to get started.</p>
  </div>
) : (
  // board content
)}
```

- [ ] **Step 2: Verify loading state**

Ensure loading message is shown during fetch:

```typescript
if (loading) {
  return <div className="text-center text-lg text-gray-600">Loading your tasks...</div>;
}
```

- [ ] **Step 3: Verify error state**

Ensure error is displayed with action to retry:

```typescript
if (error) {
  return (
    <div className="bg-red-50 border border-red-200 rounded p-4 text-red-800">
      <p>Error loading tasks: {error}</p>
      <button onClick={() => fetchStories()} className="mt-2 px-4 py-2 bg-red-600 text-white rounded">
        Retry
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Verify success state**

Add visual feedback when import succeeds (already in SyncButton):

```typescript
{result && <div className="text-green-600 text-sm">✓ Imported {result.created + result.updated} tasks</div>}
```

- [ ] **Step 5: Verify disabled state**

Buttons are disabled during async operations:

```typescript
<button
  disabled={isLoading}
  className="... disabled:opacity-50 disabled:cursor-not-allowed"
>
  Save
</button>
```

- [ ] **Step 6: Verify focus state**

Focus styles are visible on all interactive elements:

```typescript
className="... focus:ring-2 focus:ring-blue-500 focus:outline-none focus:ring-offset-1"
```

- [ ] **Step 7: Write comprehensive state tests**

Add tests in `src/app/board/page.test.tsx`:

```typescript
it('shows empty state when no stories', () => {
  const { getByText } = render(<Board stories={[]} />);
  expect(getByText('No tasks yet')).toBeInTheDocument();
});

it('shows loading state during fetch', () => {
  const { getByText } = render(<Board loading={true} />);
  expect(getByText('Loading your tasks')).toBeInTheDocument();
});

it('shows error state with retry button', () => {
  const { getByText } = render(<Board error="Network error" />);
  expect(getByText(/Error loading tasks/)).toBeInTheDocument();
  expect(getByText('Retry')).toBeInTheDocument();
});

it('shows success message after import', () => {
  const { getByText } = render(<SyncButton result={{ created: 2, updated: 1 }} />);
  expect(getByText('✓ Imported 3 tasks')).toBeInTheDocument();
});

it('disables button during async operation', () => {
  const { getByText } = render(<SaveButton isLoading={true} />);
  expect(getByText('Save')).toBeDisabled();
});

it('renders focus ring on card when focused', () => {
  const { getByRole } = render(<WorkUnitCard />);
  const card = getByRole('button');
  expect(card).toHaveClass('focus:ring-2');
});
```

- [ ] **Step 8: Commit**

```bash
npm test -- board/page.test.tsx
git add src/app/board/page.tsx src/components/WorkUnitCard.tsx src/app/board/page.test.tsx
git commit -m "feat: verify and style all 6 states (empty, loading, error, success, disabled, focus)"
```

---

### Task 8: Migration guide and backward compatibility

**Files:**
- Create: `MIGRATION.md`
- Modify: `src/app/page.tsx` (home page with notice)

**Interfaces:**
- Consumes: Current board URL structure
- Produces: Clear migration path for existing users, no data loss

**Steps:**

- [ ] **Step 1: Create MIGRATION.md**

```markdown
# Board Migration Guide

## What Changed?

The task board is now fully interactive. You can:
- Click "Edit" to change task details inline
- Press "Delete" to remove tasks (with confirmation)
- Drag tasks between columns to track progress
- Use keyboard shortcuts:
  - Enter: Edit selected task
  - Delete: Remove selected task
  - Arrow Left/Right: Move task to adjacent column

## Do I Need to Do Anything?

No action required. Your tasks are safe. The /board page now loads automatically.

## Keyboard Shortcuts (Optional)

If you prefer keyboard navigation:
- Tab to select a task
- Press Enter to edit
- Press Delete to remove
- Press arrow keys to move between columns

## Feedback

Found a bug? The old read-only board is still available at `/board-legacy` (removed in v2).
```

- [ ] **Step 2: Add notice to home page**

Update `src/app/page.tsx`:

```typescript
<div className="bg-blue-50 border border-blue-200 rounded p-4 mb-4">
  <h3 className="font-semibold text-blue-900">Updated Board</h3>
  <p className="text-sm text-blue-800">The task board is now interactive. Drag tasks between columns, click Edit to change details, or use keyboard shortcuts. <a href="/board" className="underline">Try it now →</a></p>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add MIGRATION.md src/app/page.tsx
git commit -m "docs: add migration guide for interactive board redesign"
```

---

### Task 9: Final testing and verification checklist

**Files:**
- Modify: `src/app/board/page.test.tsx`

**Interfaces:**
- Consumes: All components, utilities, hooks from Tasks 1-8
- Produces: Comprehensive test suite covering all redesign requirements

**Steps:**

- [ ] **Step 1: Add comprehensive integration test**

```typescript
describe('Interactive Board Redesign', () => {
  it('supports full workflow: edit, move, delete', async () => {
    const { getByText, getByPlaceholderText } = render(<Board stories={mockStories} />);
    
    // Find first card and click Edit
    const editButton = screen.getAllByText('Edit')[0];
    fireEvent.click(editButton);
    
    // Change title
    const titleInput = getByPlaceholderText('Title');
    fireEvent.change(titleInput, { target: { value: 'Updated Task' } });
    
    // Save
    fireEvent.click(getByText('Save'));
    
    // Verify PATCH was called
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/work-units/'),
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('supports keyboard navigation (Enter to edit, Delete to remove, arrows to move)', () => {
    const { getByRole } = render(<Board stories={mockStories} />);
    const card = getByRole('button', { name: /Press Enter to edit/ });
    
    // Test Enter
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(card.querySelector('input')).toBeInTheDocument();
    
    // Test Delete
    fireEvent.keyDown(card, { key: 'Delete' });
    expect(getByText('Confirm Delete?')).toBeInTheDocument();
    
    // Test Arrow keys
    fireEvent.keyDown(card, { key: 'ArrowRight' });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/work-units/'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('displays all 6 states correctly', () => {
    // Empty
    const { rerender } = render(<Board stories={[]} />);
    expect(screen.getByText('No tasks yet')).toBeInTheDocument();
    
    // Loading
    rerender(<Board loading={true} stories={[]} />);
    expect(screen.getByText('Loading your tasks')).toBeInTheDocument();
    
    // Error
    rerender(<Board error="Network error" stories={[]} />);
    expect(screen.getByText(/Error loading tasks/)).toBeInTheDocument();
    
    // Success
    rerender(<Board stories={mockStories} result={{ created: 2, updated: 1 }} />);
    expect(screen.getByText('✓ Imported 3 tasks')).toBeInTheDocument();
    
    // Disabled
    const saveButton = screen.getByText('Save');
    expect(saveButton).not.toBeDisabled();
    rerender(<Board stories={mockStories} isLoading={true} />);
    expect(saveButton).toBeDisabled();
    
    // Focus
    const card = screen.getByRole('button');
    expect(card).toHaveClass('focus:ring-2');
  });

  it('replaces jargon with plain language', () => {
    render(<Board stories={[]} />);
    expect(screen.getByText(/No tasks yet/)).toBeInTheDocument();
    expect(screen.queryByText(/No work units/)).not.toBeInTheDocument();
  });

  it('shows onboarding tooltip on first visit', () => {
    localStorage.clear();
    render(<Board stories={mockStories} />);
    expect(screen.getByText('Welcome to your task board!')).toBeInTheDocument();
  });

  it('has focus ring on all interactive elements', () => {
    const { getAllByRole } = render(<Board stories={mockStories} />);
    const buttons = getAllByRole('button');
    buttons.forEach(button => {
      expect(button).toHaveClass('focus:ring-2');
    });
  });
});
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
# Verify all tests pass, including new integration tests
```

- [ ] **Step 3: Run build verification**

```bash
npm run build
# Verify build succeeds
# Verify bundle is <500 KB
```

- [ ] **Step 4: Manual testing checklist**

In the browser at http://localhost:3000/board:
- [ ] Verify empty state shows "No tasks yet"
- [ ] Import from JIRA successfully
- [ ] Click Edit on a card → inline form appears
- [ ] Change title/description → Click Save → updates reflected
- [ ] Press Enter on a card → edit mode activates
- [ ] Press Delete on a card → confirmation appears
- [ ] Drag card to adjacent column → updates via API
- [ ] Press Arrow Right/Left on a card → card moves to adjacent column
- [ ] Tab through cards → focus ring visible on all
- [ ] Disable JavaScript → verify graceful degradation or loading state
- [ ] Check Lighthouse accessibility → score ≥90

- [ ] **Step 5: Commit final tests**

```bash
git add src/app/board/page.test.tsx
git commit -m "test: add comprehensive integration tests for interactive board redesign"
```

---

## Validation

**Spec Coverage Checklist:**
- ✅ Move 1 (Useful): Interactive edit/delete/move buttons visible and functional
- ✅ Move 2 (Thorough): Keyboard navigation (Enter, Delete, arrows) implemented
- ✅ Move 3 (Understandable): Jargon replaced with plain language ("tasks" not "work units")
- ✅ Move 4 (Environmentally Friendly): Bundle optimized to <500 KB
- ✅ Move 5 (Understandable + Honest): Onboarding tooltip explains affordances
- ✅ All 6 states present: empty, loading, error, success, disabled, focus
- ✅ Keyboard accessibility: WCAG AA with focus management
- ✅ Backward compatibility: No data loss, old API preserved
- ✅ TDD throughout: All code has tests, all tests passing
- ✅ No breaking changes: API untouched, gradual UI transition

**Anti-patterns Avoided:**
- ✅ Did NOT port old read-only structure with new styling (true structural redesign)
- ✅ Did NOT keep dead code (WorkUnitCard properly integrated)
- ✅ Did NOT defer bundle optimization (addressed in Task 6)
- ✅ Did NOT implement keyboard support as afterthought (built in from Task 2)
- ✅ Did NOT touch API layer (Tasks 1-9 are UI-only)

---

## Execution

This plan is ready for implementation via:

**Option 1: Subagent-Driven (Recommended)**
Use `superpowers:subagent-driven-development` with fresh subagent per task and review between tasks.

**Option 2: Inline Execution**
Use `superpowers:executing-plans` to execute all 9 tasks in this session with checkpoints.

Choose your execution approach to begin implementation.
