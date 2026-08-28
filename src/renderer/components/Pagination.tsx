import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from './ui.js';

export function Pagination({ page, pageSize, total, onPageChange }: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const current = Math.min(Math.max(1, page), pageCount);
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  return <nav className="pagination" aria-label="Pagination"><IconButton icon={ChevronLeft} iconSize={15} className="pagination-button" label="Previous page" disabled={current === 1} onClick={() => onPageChange(current - 1)} />{pages.map(value => <button type="button" key={value} className={`pagination-button ${value === current ? 'selected' : ''}`} aria-current={value === current ? 'page' : undefined} onClick={() => onPageChange(value)}>{value}</button>)}<IconButton icon={ChevronRight} iconSize={15} className="pagination-button" label="Next page" disabled={current === pageCount} onClick={() => onPageChange(current + 1)} /></nav>;
}
