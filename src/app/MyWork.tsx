import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Task } from '../core/contract.ts';
import { blockingDeps, firstName, myTasks } from '../core/selectors.ts';
import { localDate } from '../core/time.ts';
import { TaskRow } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import { WorkSurface } from './WorkSurface.tsx';

// Situation first: the composed work surface leads; the full list stays one scroll away.
export function MyWork({ quest, onOpen, onCreate }: { quest: Quest; onOpen: (id: string) => void; onCreate: () => void }) {
  const { state, actor, now, dispatch } = quest;
  const mine = myTasks(state, actor, now);
  const groups: { title: string; tasks: Task[] }[] = [
    { title: 'Approvals waiting on you', tasks: mine.filter(task => task.status === 'review' && task.approver === actor) },
    { title: 'Working', tasks: mine.filter(task => task.status === 'working') },
    { title: 'Blocked', tasks: mine.filter(task => task.status === 'blocked') },
    { title: 'Ready to start', tasks: mine.filter(task => task.status === 'ready' && blockingDeps(state, task).length === 0) },
    { title: 'Waiting on someone else', tasks: mine.filter(task => (task.status === 'ready' && blockingDeps(state, task).length > 0) || (task.status === 'review' && task.approver !== actor)) },
  ].filter(group => group.tasks.length);
  const [quick, setQuick] = useState('');

  async function quickAdd(event: FormEvent) {
    event.preventDefault();
    if (!quick.trim()) return;
    const result = await dispatch({ type: 'task/create', task: { title: quick, owner: actor, due: localDate(now) } });
    if (result.ok) setQuick('');
  }

  return (
    <div className="view">
      <p className="eyebrow surface-date">{firstName(state, actor)} · {new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(now)}</p>
      <WorkSurface quest={quest} onOpen={onOpen} />

      <form className="quick-add" onSubmit={quickAdd}>
        <input value={quick} onChange={event => setQuick(event.target.value)} maxLength={160} placeholder="Add a task for yourself… (press Enter)" aria-label="Quick add a task" />
        <button type="submit" className="btn btn-ghost" disabled={!quick.trim()}>Add</button>
        <button type="button" className="btn btn-ghost" onClick={onCreate}>More options</button>
      </form>

      <details className="all-work" open={mine.length <= 4}>
        <summary><span>All your tasks</span> <small>{mine.length} open</small></summary>
        {groups.map(group => (
          <section key={group.title} className="group">
            <h3 className="group-title">{group.title} <span>{group.tasks.length}</span></h3>
            <div className="rows">{group.tasks.map(task => <TaskRow key={task.id} quest={quest} task={task} onOpen={onOpen} />)}</div>
          </section>
        ))}
      </details>
    </div>
  );
}
