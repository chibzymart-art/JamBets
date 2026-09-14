import React from 'react';

export interface SmartPaginationBarProps {
  page: number;
  totalPages: number;
  totalItems: number;
  limit: number;
  onPageChange: (newPage: number) => void;
  loading?: boolean;
}

export const SmartPaginationBar: React.FC<SmartPaginationBarProps> = ({
  page,
  totalPages,
  totalItems,
  limit,
  onPageChange,
  loading = false,
}) => {
  if (totalItems <= limit && page === 1) {
    return (
      <div className="smart-pagination-single-page-note">
        <span>Showing all {totalItems} matches in this market</span>
      </div>
    );
  }

  const startIdx = (page - 1) * limit + 1;
  const endIdx = Math.min(page * limit, totalItems);

  const handlePageSelect = (p: number) => {
    if (p < 1 || p > totalPages || p === page || loading) return;
    onPageChange(p);
    // Smooth scroll back to top of terminal stream
    const target = document.getElementById('market-terminal-stream-top');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Generate page numbers window (max 5 visible)
  const pageNumbers: number[] = [];
  const maxWindow = 5;
  let startPage = Math.max(1, page - Math.floor(maxWindow / 2));
  let endPage = Math.min(totalPages, startPage + maxWindow - 1);
  if (endPage - startPage + 1 < maxWindow) {
    startPage = Math.max(1, endPage - maxWindow + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    pageNumbers.push(i);
  }

  return (
    <div className="smart-pagination-bar-wrapper">
      <div className="pagination-range-info">
        <span>
          Showing <strong>{startIdx}–{endIdx}</strong> of <strong>{totalItems}</strong> calibrated matches
        </span>
        <span className="pagination-bounded-badge">MAX 10 / VIEWPORT</span>
      </div>

      <div className="pagination-controls-row">
        {/* Previous Button */}
        <button
          type="button"
          className="pagination-arrow-btn prev-btn"
          disabled={page <= 1 || loading}
          onClick={() => handlePageSelect(page - 1)}
          aria-label="Previous Page"
        >
          <span className="arrow-symbol">←</span>
          <span className="arrow-text">Previous 10</span>
        </button>

        {/* Numeric Page Buttons */}
        <div className="pagination-numbers-list">
          {startPage > 1 && (
            <>
              <button
                type="button"
                className="page-number-pill"
                onClick={() => handlePageSelect(1)}
              >
                1
              </button>
              {startPage > 2 && <span className="page-ellipsis">…</span>}
            </>
          )}

          {pageNumbers.map((p) => (
            <button
              key={p}
              type="button"
              className={`page-number-pill ${p === page ? 'active' : ''}`}
              onClick={() => handlePageSelect(p)}
              disabled={loading}
            >
              {p}
            </button>
          ))}

          {endPage < totalPages && (
            <>
              {endPage < totalPages - 1 && <span className="page-ellipsis">…</span>}
              <button
                type="button"
                className="page-number-pill"
                onClick={() => handlePageSelect(totalPages)}
              >
                {totalPages}
              </button>
            </>
          )}
        </div>

        {/* Next Button */}
        <button
          type="button"
          className="pagination-arrow-btn next-btn"
          disabled={page >= totalPages || loading}
          onClick={() => handlePageSelect(page + 1)}
          aria-label="Next Page"
        >
          <span className="arrow-text">Next 10</span>
          <span className="arrow-symbol">→</span>
        </button>
      </div>
    </div>
  );
};
