import type { ReactNode } from 'react';
import { Scrollbar } from '../Scrollbar.js';

export interface TableColumn<T> { key: string; label: string; render?: (row: T) => ReactNode }
export function Table<T extends { id: string }>({ columns, rows }: { columns: TableColumn<T>[]; rows: T[] }) {
  return <Scrollbar axis="horizontal" className="table-scroll"><div className="table-wrap"><table><thead><tr>{columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}>{columns.map(column => <td key={column.key}>{column.render ? column.render(row) : String((row as Record<string, unknown>)[column.key] ?? '')}</td>)}</tr>)}</tbody></table></div></Scrollbar>;
}
