"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type CSSProperties,
} from "react";
import { SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type ResizableSheetContentProps = Omit<
  ComponentProps<typeof SheetContent>,
  "side" | "style"
> & {
  side?: "right";
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  children: ReactNode;
};

export function ResizableSheetContent({
  width,
  minWidth,
  maxWidth,
  onWidthChange,
  className,
  children,
  ...props
}: ResizableSheetContentProps) {
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ pointerX: number; width: number } | null>(
    null,
  );
  const widthRef = useRef(width);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const clampWidth = useCallback(
    (nextWidth: number) =>
      Math.min(maxWidth, Math.max(minWidth, Math.round(nextWidth))),
    [maxWidth, minWidth],
  );

  const setClampedWidth = useCallback(
    (nextWidth: number) => {
      const next = clampWidth(nextWidth);
      widthRef.current = next;
      onWidthChange(next);
    },
    [clampWidth, onWidthChange],
  );

  const stopDragging = useCallback(() => {
    dragStartRef.current = null;
    setDragging(false);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const onPointerMove = (event: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      // The handle is on the left edge, so moving left makes the panel wider.
      setClampedWidth(start.width + start.pointerX - event.clientX);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [dragging, setClampedWidth, stopDragging]);

  useEffect(() => () => stopDragging(), [stopDragging]);

  function startDragging(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragStartRef.current = { pointerX: event.clientX, width: widthRef.current };
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function onHandleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setClampedWidth(widthRef.current + 16);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setClampedWidth(widthRef.current - 16);
    } else if (event.key === "Home") {
      event.preventDefault();
      setClampedWidth(minWidth);
    } else if (event.key === "End") {
      event.preventDefault();
      setClampedWidth(maxWidth);
    }
  }

  return (
    <SheetContent
      side="right"
      className={cn(
        "relative w-screen max-w-none rounded-none sm:w-[var(--sheet-width)]",
        className,
      )}
      style={{ "--sheet-width": `${width}px` } as CSSProperties}
      {...props}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize side panel"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={startDragging}
        onKeyDown={onHandleKeyDown}
        className={cn(
          "absolute inset-y-0 left-0 z-[110] hidden w-3 -translate-x-1/2 cursor-col-resize items-center justify-center sm:flex",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          dragging && "bg-primary/10",
        )}
      >
        <span
          className={cn(
            "h-full w-px bg-border/50 transition-colors",
            "group-hover:bg-primary/60",
            dragging && "bg-primary",
          )}
        />
      </div>
      {children}
    </SheetContent>
  );
}
