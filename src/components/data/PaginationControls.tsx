import { normalizePageRequest } from '../../types/listQuery';

export function PaginationControls({ page, pageSize, totalCount, onPageChange }: {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}) {
  const request = normalizePageRequest(page, pageSize);
  const total = Number.isSafeInteger(totalCount) && totalCount > 0 ? totalCount : 0;
  const pageCount = Math.max(1, Math.ceil(total / request.pageSize));
  const currentPage = Math.min(request.page, pageCount);
  const start = total === 0 ? 0 : (currentPage - 1) * request.pageSize + 1;
  const end = Math.min(currentPage * request.pageSize, total);

  return <nav className="list-pagination" aria-label="List pagination">
    <p aria-live="polite">Showing {start}–{end} of {total} · Page {currentPage} of {pageCount}</p>
    <div className="list-pagination-actions">
      <button className="button secondary" type="button" aria-label="Previous page"
        disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>Previous</button>
      <button className="button secondary" type="button" aria-label="Next page"
        disabled={currentPage >= pageCount} onClick={() => onPageChange(currentPage + 1)}>Next</button>
    </div>
  </nav>;
}
