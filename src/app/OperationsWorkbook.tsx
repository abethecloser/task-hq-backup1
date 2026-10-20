import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import './workbook.css';

const sheets = [
  { name: 'General', columns: ['Work item', 'Assigned', 'Status', 'Due date', 'Project / task reference'] },
  { name: 'Quotes', columns: ['Customer / project', 'Scope', 'Assigned', 'Quote amount', 'Status'] },
  { name: 'Send Proposals', columns: ['Customer / project', 'Proposal reference', 'Assigned', 'Target date', 'Status'] },
  { name: 'Send Agreement', columns: ['Customer / project', 'Agreement reference', 'Assigned', 'Target date', 'Status'] },
  { name: 'Software', columns: ['Software', 'Purpose', 'Responsible', 'Renewal date', 'Vault reference'] },
];

/** Explicit, empty preview. No backend writes or imported customer/sample records. */
export function OperationsWorkbook() {
  const [active, setActive] = useState(0);
  const [rows, setRows] = useState<string[][][]>(() => sheets.map(() => []));
  const [viewer, setViewer] = useState(false);
  const [notice, setNotice] = useState('No records loaded.');
  function change(row: number, column: number, value: string) {
    setRows(current => current.map((sheet, i) => i !== active ? sheet : sheet.map((cells, r) => r !== row ? cells : cells.map((cell, c) => c === column ? value : cell))));
    setNotice('Changed in preview memory only.');
  }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % sheets.length : event.key === 'ArrowLeft' ? (index + sheets.length - 1) % sheets.length : event.key === 'Home' ? 0 : event.key === 'End' ? sheets.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); setActive(next); document.getElementById(`workbook-tab-${next}`)?.focus();
  }
  function print(all: boolean) {
    document.body.classList.add('printing-workbook');
    document.body.classList.toggle('printing-workbook-all', all);
    const done = () => { document.body.classList.remove('printing-workbook', 'printing-workbook-all'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    try { window.print(); } catch { done(); setNotice('Printing could not open. Try your browser print command.'); }
  }
  return <article className="operations-workbook" aria-label="Operations Workbook">
    <header><p className="eyebrow">Operations · Preview</p><h1>Operations Workbook</h1>
      <p className="muted">Temporary preview — edits are not saved or shared. Leaving this page or reloading clears them. Use only non-sensitive test information. Software stores vault references, never passwords.</p>
    </header>
    <div className="workbook-toolbar">
      <button className="btn" disabled={viewer} onClick={() => { setRows(current => current.map((sheet, i) => i === active ? [...sheet, Array(5).fill('')] : sheet)); setNotice('Row added in preview memory only.'); }}>+ Add row</button>
      <button className="btn" onClick={() => print(false)}>Print worksheet</button>
      <button className="btn" onClick={() => print(true)}>Print workbook</button>
      <label className="workbook-viewer"><input type="checkbox" checked={viewer} onChange={event => setViewer(event.target.checked)} />Simulate read-only</label>
    </div>
    <p className="muted" role="status">{notice} Read-only simulation is not a permission system. Import/export and shared storage are not available.</p>
    <div className="workbook-tabs" role="tablist" aria-label="Worksheets">{sheets.map((sheet, i) => <button type="button" role="tab" id={`workbook-tab-${i}`} aria-controls={`workbook-sheet-${i}`} aria-selected={i === active} tabIndex={i === active ? 0 : -1} key={sheet.name} onClick={() => setActive(i)} onKeyDown={event => tabKey(event, i)}>{sheet.name}</button>)}</div>
    {sheets.map((sheet, i) => <section className={`workbook-sheet ${active === i ? 'is-active' : ''}`} role="tabpanel" id={`workbook-sheet-${i}`} aria-labelledby={`workbook-tab-${i}`} key={sheet.name}>
      <h2>{sheet.name}</h2><div className="workbook-scroll"><table><thead><tr><th scope="col">#</th>{sheet.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>
        {rows[i]!.map((cells, r) => <tr key={r}><th scope="row">{r + 1}</th>{cells.map((cell, c) => <td key={c} data-label={sheet.columns[c]}><textarea rows={2} aria-label={`${sheet.name}, row ${r + 1}, ${sheet.columns[c]}`} value={cell} readOnly={viewer} onChange={event => change(r, c, event.target.value)} /><span className="workbook-print-value">{cell}</span></td>)}</tr>)}
      </tbody></table></div>{!rows[i]!.length && <p className="muted workbook-empty">No rows yet. Add a row to explore this preview.</p>}
    </section>)}
  </article>;
}
