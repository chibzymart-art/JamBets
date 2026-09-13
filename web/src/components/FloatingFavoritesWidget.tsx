import React, { useState, useRef, useEffect } from 'react';

interface FloatingFavoritesWidgetProps {
  count: number;
  isOpen?: boolean;
  onToggleDrawer: () => void;
}

export const FloatingFavoritesWidget: React.FC<FloatingFavoritesWidgetProps> = ({
  count,
  isOpen = false,
  onToggleDrawer,
}) => {
  // Draggable position state (defaults to bottom right: right: 18px, bottom: 85px)
  const [position, setPosition] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; posX: number; posY: number }>({
    startX: 0,
    startY: 0,
    posX: 0,
    posY: 0,
  });
  const touchStartTimeRef = useRef<number>(0);
  const hasMovedRef = useRef<boolean>(false);
  const isDragActiveRef = useRef<boolean>(false);
  const widgetRef = useRef<HTMLDivElement>(null);

  // Initialize position to bottom right once mounted
  useEffect(() => {
    if (typeof window !== 'undefined' && position.x === null) {
      const defaultX = window.innerWidth - 72;
      const defaultY = window.innerHeight - 100;
      setPosition({ x: Math.max(16, defaultX), y: Math.max(60, defaultY) });
    }

    const handleResize = () => {
      setPosition((prev) => {
        if (prev.x === null || prev.y === null) return prev;
        const maxX = window.innerWidth - 65;
        const maxY = window.innerHeight - 65;
        return {
          x: Math.min(Math.max(12, prev.x), maxX),
          y: Math.min(Math.max(60, prev.y), maxY),
        };
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [position.x]);

  // Touch Drag Handlers (tuned for mobile tap & drag)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const currentX = position.x ?? (window.innerWidth - 72);
    const currentY = position.y ?? (window.innerHeight - 100);

    touchStartTimeRef.current = Date.now();
    dragStartRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      posX: currentX,
      posY: currentY,
    };
    hasMovedRef.current = false;
    isDragActiveRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - dragStartRef.current.startX;
    const deltaY = touch.clientY - dragStartRef.current.startY;
    const moveDist = Math.hypot(deltaX, deltaY);

    // Only treat as drag if moved beyond finger touch slop (12px)
    if (moveDist > 12) {
      hasMovedRef.current = true;
      isDragActiveRef.current = true;
      if (!isDragging) setIsDragging(true);

      const newX = Math.min(Math.max(12, dragStartRef.current.posX + deltaX), window.innerWidth - 68);
      const newY = Math.min(Math.max(55, dragStartRef.current.posY + deltaY), window.innerHeight - 75);

      setPosition({ x: newX, y: newY });
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const touchDuration = Date.now() - touchStartTimeRef.current;
    setIsDragging(false);

    // If tap was quick (<350ms) or movement was below slop, toggle the drawer!
    if (!hasMovedRef.current || touchDuration < 300) {
      hasMovedRef.current = false;
      isDragActiveRef.current = false;
      onToggleDrawer();
      if (e.cancelable) {
        e.preventDefault();
      }
    } else {
      // Small cooldown to prevent synthetic click from immediately reopening/closing
      setTimeout(() => {
        hasMovedRef.current = false;
        isDragActiveRef.current = false;
      }, 100);
    }
  };

  // Mouse Drag Handlers (for desktop testing & interaction)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only primary mouse button
    const currentX = position.x ?? (window.innerWidth - 72);
    const currentY = position.y ?? (window.innerHeight - 100);

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: currentX,
      posY: currentY,
    };
    hasMovedRef.current = false;

    const onMouseMove = (moveEv: MouseEvent) => {
      const deltaX = moveEv.clientX - dragStartRef.current.startX;
      const deltaY = moveEv.clientY - dragStartRef.current.startY;
      if (Math.hypot(deltaX, deltaY) > 10) {
        hasMovedRef.current = true;
        setIsDragging(true);
        const nextX = Math.min(Math.max(12, dragStartRef.current.posX + deltaX), window.innerWidth - 68);
        const nextY = Math.min(Math.max(55, dragStartRef.current.posY + deltaY), window.innerHeight - 75);
        setPosition({ x: nextX, y: nextY });
      }
    };

    const onMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      // If user dragged, keep hasMovedRef true briefly so trailing handleClick is suppressed
      if (hasMovedRef.current) {
        setTimeout(() => {
          hasMovedRef.current = false;
        }, 120);
      }
      // Note: We do NOT call onToggleDrawer() here! The native click event (handleClick) handles it cleanly.
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleClick = (e: React.MouseEvent) => {
    // If it was a genuine drag, suppress click
    if (hasMovedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onToggleDrawer();
  };

  const inlineStyle: React.CSSProperties = {
    position: 'fixed',
    left: position.x !== null ? `${position.x}px` : 'auto',
    top: position.y !== null ? `${position.y}px` : 'auto',
    right: position.x === null ? '18px' : 'auto',
    bottom: position.y === null ? '85px' : 'auto',
    zIndex: 10001,
    touchAction: 'none',
    cursor: isDragging ? 'grabbing' : 'pointer',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    pointerEvents: 'auto',
  };

  return (
    <div
      ref={widgetRef}
      role="button"
      tabIndex={0}
      className={`floating-favorites-chatbot-widget ${isDragging ? 'dragging' : ''} ${isOpen ? 'is-open' : ''}`}
      style={inlineStyle}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleDrawer();
        }
      }}
      aria-label={isOpen ? 'Close Saved Predictions Custom Slip' : 'Open Saved Predictions Custom Slip'}
      title={isOpen ? 'Tap to close Custom Slip' : 'Tap to view Saved Predictions & Custom Slip (Draggable)'}
    >
      <div className="floating-widget-inner">
        {/* Glow Radar Aura */}
        <div className="floating-widget-aura" />
        {/* Main Icon */}
        <div className="floating-widget-icon">{isOpen ? '✕' : '⭐'}</div>
        {/* Badge Count */}
        {!isOpen && (
          <span className={`floating-widget-badge ${count > 0 ? 'active' : ''}`}>
            {count}
          </span>
        )}
      </div>
      <div className="floating-widget-hint">{isOpen ? 'CLOSE' : 'SLIP'}</div>
    </div>
  );
};
