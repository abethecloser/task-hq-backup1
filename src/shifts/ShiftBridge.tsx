// Coordinated handoff entry point. No routing, navigation, core or dispatch changes are required here.
import { useMemo, useRef } from 'react';
import { useLive } from '../app/LiveContext.tsx';
import type { Quest } from '../ui/useQuest.ts';
import { activeProjects, canEnter, inFocus } from '../core/selectors.ts';
import { ShiftModule } from './ShiftModule.tsx';
import { demoShiftBackend, liveShiftBackend } from './backend.ts';
import type { ShiftContext } from './types.ts';
export function ShiftBridge({quest}:{quest:Quest}) {
 const live=useLive(), me=quest.state.people.find(person=>person.id===quest.actor);
 const scoped=inFocus(quest.state,quest.actor)&&!canEnter(quest.state,quest.actor,'company-work',quest.now);
 const context:ShiftContext={org:live?.org.id??quest.state.workspace.tenantId,actor:quest.actor,
  manager:live?['owner','admin','supervisor'].includes(live.role):me?.role==='manager',
  canCheckIn:!!me&&me.role!=='reviewer'&&live?.role!=='reviewer',tasks:scoped?quest.state.tasks.filter(task=>task.id===quest.state.focus?.taskId):quest.state.tasks,
  projects:activeProjects(quest.state),events:quest.state.events};
 const ref=useRef(context);ref.current=context;
 const backend=useMemo(()=>live?liveShiftBackend(live.client,context.org,context.actor):demoShiftBackend(()=>ref.current),[live?.client,context.org,context.actor]);
 return <ShiftModule backend={backend} context={context} name="Your shift"/>;
}
