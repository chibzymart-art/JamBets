import { useState, useEffect, useRef, useCallback } from 'react';

export interface UseVirtualWindowOptions {
  /**
   * Number of items to render on initial mount.
   * Default: 25 items (sufficient for initial viewport + 2 screens of buffer).
   */
  initialCount?: number;

  /**
   * Number of items to append when the user scrolls near the bottom.
   * Default: 25 items.
   */
  batchSize?: number;

  /**
   * Dependencies that should reset the visible count back to initialCount.
   * E.g. [selectedDate, activeTab, searchQuery, sortMode, filter]
   */
  resetDeps?: any[];
}

export interface UseVirtualWindowResult<T> {
  /** Sliced list of items to render in the DOM */
  visibleItems: T[];

  /** Current number of items rendered in the DOM */
  visibleCount: number;

  /** Total number of items in the source array */
  totalCount: number;

  /** Whether there are more items to reveal on scroll */
  hasMore: boolean;

  /** Ref to attach to the sentinel element at the bottom of the list */
  sentinelRef: React.RefObject<HTMLDivElement>;

  /** Manually reveal the next batch of items */
  showMore: () => void;
}

/**
 * useVirtualWindow
 *
 * Provides progressive list windowing for match feeds.
 * Prevents mobile browsers from mounting 100-300 heavy match card trees simultaneously,
 * maintaining 60 FPS scrolling and low memory footprint on mobile devices.
 */
export function useVirtualWindow<T>(
  items: T[],
  options?: UseVirtualWindowOptions
): UseVirtualWindowResult<T> {
  // If search engine crawler/bot, render full list immediately for complete indexing
  const isCrawler =
    typeof navigator !== 'undefined' &&
    /bot|crawler|spider|googlebot|bingbot|yandex|duckduckbot/i.test(navigator.userAgent || '');

  const defaultInitial = isCrawler ? 500 : 25;
  const initialCount = options?.initialCount ?? defaultInitial;
  const batchSize = options?.batchSize ?? 25;
  const resetDeps = options?.resetDeps ?? [];

  const [visibleCount, setVisibleCount] = useState<number>(initialCount);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset to initial count whenever filtering, tab, or search dependencies change
  useEffect(() => {
    setVisibleCount(initialCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetDeps);

  // IntersectionObserver to auto-reveal next batch 600px before user hits bottom
  useEffect(() => {
    if (visibleCount >= items.length) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    if (typeof IntersectionObserver === 'undefined') {
      // Fallback for older browsers without IntersectionObserver
      setVisibleCount(items.length);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + batchSize, items.length));
        }
      },
      {
        root: null,
        rootMargin: '600px', // Expand 600px ahead for instantaneous 60 FPS scroll
        threshold: 0,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, items.length, batchSize]);

  const showMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + batchSize, items.length));
  }, [batchSize, items.length]);

  const visibleItems = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;

  return {
    visibleItems,
    visibleCount,
    totalCount: items.length,
    hasMore,
    sentinelRef,
    showMore,
  };
}
