import { useDropdown } from './useDropdown.tsx';
import { createContext, forwardRef, useContext, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, FocusEvent, ForwardedRef, InputHTMLAttributes, KeyboardEvent, ReactNode, TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { referenceDocument, referenceSuggestions, rebaseReferences } from '../core/references.ts';
import type { ReferenceDocument, ReferenceDrafts, ReferenceScope, ReferenceSuggestions } from '../core/references.ts';

interface Environment { scope: ReferenceScope; drafts?: ReferenceDrafts }
const Context = createContext<Environment | null>(null);
export function ReferenceProvider({ scope, drafts, children }: Environment & { children: ReactNode }) { return <Context.Provider value={{ scope, drafts }}>{children}</Context.Provider>; }
export const useReferenceEnvironment = () => useContext(Context);
interface ReferenceProps { referenceScope?: ReferenceScope; referenceDocument?: ReferenceDocument; onReferencesChange?: (document: ReferenceDocument) => void }
type Element = HTMLInputElement | HTMLTextAreaElement;
interface Events<T extends Element> extends ReferenceProps {
  value?: InputHTMLAttributes<T>['value']; disabled?: boolean; readOnly?: boolean; maxLength?: number;
  onChange?: (event: ChangeEvent<T>) => void; onKeyDown?: (event: KeyboardEvent<T>) => void;
  onFocus?: (event: FocusEvent<T>) => void; onBlur?: (event: FocusEvent<T>) => void;
}
function useReferenceEditor<T extends Element>(props: Events<T>, forwarded: ForwardedRef<T>) {
  const env = useContext(Context), scope = props.referenceScope ?? env?.scope;
  const id = useId().replace(/:/g, ''), input = useRef<T | null>(null), composing = useRef(false);
  const doc = useRef<ReferenceDocument>(props.referenceDocument ?? { text: String(props.value ?? ''), spans: [] });
  const popup = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<ReferenceSuggestions | null>(null), [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 300, maxHeight: 260 });
  useDropdown({ open: !!menu, onClose: () => setMenu(null), trigger: () => input.current, content: () => popup.current });
  const enabled = !!scope && !props.disabled && !props.readOnly;
  const value = String(props.value ?? '');
  if (doc.current.text !== value && scope) doc.current = referenceDocument(value, scope, rebaseReferences(doc.current, value));
  function remember(text: string) {
    if (!scope) return;
    doc.current = referenceDocument(text, scope, rebaseReferences(doc.current, text));
    env?.drafts?.set(id, doc.current); props.onReferencesChange?.(doc.current);
  }
  function suggestions(text: string, caret: number) {
    if (!enabled || composing.current) return;
    setMenu(referenceSuggestions(text, caret, scope!)); setActive(0);
  }
  useLayoutEffect(() => {
    if (!menu || !input.current) return;
    const place = () => {
      const r = input.current!.getBoundingClientRect(), width = Math.min(360, window.innerWidth - 24);
      const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
      const up = below < 190 && above > below;
      setPosition({ left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)), top: up ? r.top - Math.min(260, above) - 5 : r.bottom + 5, width, maxHeight: Math.max(96, Math.min(260, up ? above : below)) });
    };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [menu]);
  function pick(index: number) {
    const item = menu?.items[index], el = input.current;
    if (!item || !el || !menu || !scope) return;
    const text = el.value.slice(0, menu.start) + item.insert + el.value.slice(menu.end);
    if (props.maxLength && text.length > props.maxLength) return;
    const moved = rebaseReferences(doc.current, text);
    const span = { kind: item.kind, id: item.id, workspaceId: scope.workspaceId, start: menu.start, end: menu.start + item.insert.trimEnd().length, label: item.insert.trimEnd() };
    // A newly created tag is confirmed in the draft; engine permission-checks creation on save.
    doc.current = { text, spans: [...moved.spans.filter(s => s.end <= span.start || s.start >= span.end), span].sort((a, b) => a.start - b.start) };
    env?.drafts?.set(id, doc.current); props.onReferencesChange?.(doc.current);
    el.value = text;
    props.onChange?.({ target: el, currentTarget: el } as ChangeEvent<T>);
    setMenu(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(menu.start + item.insert.length, menu.start + item.insert.length); });
  }
  return {
    ref: (el: T | null) => { input.current = el; if (typeof forwarded === 'function') forwarded(el); else if (forwarded) forwarded.current = el; },
    handlers: {
      onChange: (event: ChangeEvent<T>) => { remember(event.currentTarget.value); suggestions(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length); props.onChange?.(event); },
      onSelect: () => { if (input.current && document.activeElement === input.current) suggestions(input.current.value, input.current.selectionStart ?? input.current.value.length); },
      onFocus: (event: FocusEvent<T>) => { props.onFocus?.(event); },
      onBlur: (event: FocusEvent<T>) => { setMenu(null); remember(event.currentTarget.value); props.onBlur?.(event); },
      onCompositionStart: () => { composing.current = true; setMenu(null); },
      onCompositionEnd: () => { composing.current = false; if (input.current) { remember(input.current.value); suggestions(input.current.value, input.current.selectionStart ?? input.current.value.length); } },
      onKeyDown: (event: KeyboardEvent<T>) => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (menu && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (event.key === 'Escape') setMenu(null);
          else if (event.key === 'Enter' || event.key === 'Tab') pick(active);
          else setActive(n => (n + (event.key === 'ArrowDown' ? 1 : -1) + menu.items.length) % menu.items.length);
          return;
        }
        props.onKeyDown?.(event);
      },
      ...(enabled ? { role: 'combobox', 'aria-autocomplete': 'list' as const, 'aria-expanded': !!menu, 'aria-controls': menu ? `${id}-list` : undefined, 'aria-activedescendant': menu ? `${id}-option-${active}` : undefined } : {}),
    },
    menu: menu && typeof document !== 'undefined' ? createPortal(<div ref={popup} className="reference-popover" style={{ position: 'fixed', ...position, zIndex: 1800 }}>
      <ul id={`${id}-list`} role="listbox" aria-label="People and tags">{menu.items.map((item, i) => <li key={`${item.kind}:${item.id}`} id={`${id}-option-${i}`} role="option" aria-selected={i === active}>
        <button type="button" tabIndex={-1} className={i === active ? 'is-active' : ''} onPointerDown={e => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(i)}><strong>{item.label}</strong><small>{item.detail}</small></button>
      </li>)}</ul><p className="sr-only" role="status">{menu.items.length} suggestions. Arrow keys to move, Enter to select, Escape to close.</p>
    </div>, document.body) : null,
  };
}
export const ReferenceInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & ReferenceProps>(function ReferenceInput(props, ref) {
  const { referenceScope: scope, referenceDocument: doc, onReferencesChange, ...native } = props;
  const enabledType = !props.type || props.type === 'text';
  const editor = useReferenceEditor<HTMLInputElement>({ ...props, readOnly: props.readOnly || !enabledType }, ref);
  return <><input {...native} ref={editor.ref} {...editor.handlers} />{editor.menu}</>;
});
export const ReferenceTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & ReferenceProps>(function ReferenceTextarea(props, ref) {
  const { referenceScope: scope, referenceDocument: doc, onReferencesChange, ...native } = props;
  const editor = useReferenceEditor<HTMLTextAreaElement>(props, ref);
  return <><textarea {...native} ref={editor.ref} {...editor.handlers} />{editor.menu}</>;
});
export function ReferencedText({ text, document: saved, scope: explicit }: { text: string; document?: ReferenceDocument; scope?: ReferenceScope }) {
  const env = useContext(Context), scope = explicit ?? env?.scope;
  if (!scope) return <>{text}</>;
  const doc = referenceDocument(text, scope, saved);
  let at = 0; const parts: ReactNode[] = [];
  for (const span of doc.spans) {
    parts.push(text.slice(at, span.start));
    const params = new URLSearchParams({ workspace: span.workspaceId, [span.kind === 'person' ? 'person' : 'tag']: span.id });
    parts.push(<a className="reference-link" key={`${span.start}:${span.id}`} href={`#/search?${params}`} onClick={e => e.stopPropagation()}>{text.slice(span.start, span.end)}</a>); at = span.end;
  }
  parts.push(text.slice(at)); return <>{parts}</>;
}
