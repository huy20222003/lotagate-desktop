import { ChevronLeft, ChevronRight } from 'lucide-react';

export function Pagination({ page, pageSize, total, onPageChange }: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const current = Math.min(Math.max(1, page), pageCount);
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  return <nav className="pagination" aria-label="Pagination"><button type="button" className="pagination-button" disabled={current === 1} aria-label="Previous page" onClick={() => onPageChange(current - 1)}><ChevronLeft size={15} /></button>{pages.map(value => <button type="button" key={value} className={`pagination-button ${value === current ? 'selected' : ''}`} aria-current={value === current ? 'page' : undefined} onClick={() => onPageChange(value)}>{value}</button>)}<button type="button" className="pagination-button" disabled={current === pageCount} aria-label="Next page" onClick={() => onPageChange(current + 1)}><ChevronRight size={15} /></button></nav>;
}
