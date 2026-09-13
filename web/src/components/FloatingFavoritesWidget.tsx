import React, { useState, useRef, useEffect } from 'react';

interface FloatingFavoritesWidgetProps {
  count: number;
  onOpenDrawer: () => void;
}

export const FloatingFavoritesWidget: React.FC<FloatingFavoritesWidgetProps> = ({
  count,
  onOpenDrawer,
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
  const hasMovedRef = useRef<boolean>(false);
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

  // Touch Drag Handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const currentX = position.x ?? (window.innerWidth - 72);
    const currentY = position.y ?? (window.innerHeight - 100);

    dragStartRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      posX: currentX,
      posY: currentY,
    };
    hasMovedRef.current = false;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - dragStartRef.current.startX;
    const deltaY = touch.clientY - dragStartRef.current.startY;

    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
      hasMovedRef.current = true;
    }

    const newX = Math.min(Math.max(12, dragStartRef.current.posX + deltaX), window.innerWidth - 68);
    const newY = Math.min(Math.max(55, dragStartRef.current.posY + deltaY), window.innerHeight - 75);

    setPosition({ x: newX, y: newY });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    if (!hasMovedRef.current) {
      onOpenDrawer();
    }
  };

  // Mouse Drag Handlers (for testing on desktop mobile view)
  const handleMouseDown = (e: React.MouseEvent) => {
    const currentX = position.x ?? (window.innerWidth - 72);
    const currentY = position.y ?? (window.innerHeight - 100);

    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: currentX,
      posY: currentY,
    };
    hasMovedRef.current = false;
    setIsDragging(true);

    const onMouseMove = (moveEv: MouseEvent) => {
      const deltaX = moveEv.clientX - dragStartRef.current.startX;
      const deltaY = moveEv.clientY - dragStartRef.current.startY;
      if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
        hasMovedRef.current = true;
      }
      const nextX = Math.min(Math.max(12, dragStartRef.current.posX + deltaX), window.innerWidth - 68);
      const nextY = Math.min(Math.max(55, dragStartRef.current.posY + deltaY), window.innerHeight - 75);
      setPosition({ x: nextX, y: nextY });
    };

    const onMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (!hasMovedRef.current) {
        onOpenDrawer();
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const inlineStyle: React.CSSProperties = {
    position: 'fixed',
    left: position.x !== null ? `${position.x}px` : 'auto',
    top: position.y !== null ? `${position.y}px` : 'auto',
    right: position.x === null ? '18px' : 'auto',
    bottom: position.y === null ? '85px' : 'auto',
    zIndex: 9999,
    touchAction: 'none',
    cursor: isDragging ? 'grabbing' : 'grab',
  };

  return (
    <div
      ref={widgetRef}
      className={`floating-favorites-chatbot-widget ${isDragging ? 'dragging' : ''}`}
      style={inlineStyle}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      aria-label="Saved Predictions Custom Slip"
      title="Tap to view Saved Predictions & Custom Slip (Draggable)"
    >
      <div className="floating-widget-inner">
        {/* Glow Radar Aura */}
        <div className="floating-widget-aura" />
        {/* Main Icon */}
        <div className="floating-widget-icon">⭐</div>
        {/* Badge Count */}
        <span className={`floating-widget-badge ${count > 0 ? 'active' : ''}`}>
          {count}
        </span>
      </div>
      <div className="floating-widget-hint">SLIP</div>
    </div>
  );
};
