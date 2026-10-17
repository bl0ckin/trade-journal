"use client";

import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from "lucide-react";

export interface ViewerImage {
  id: string;
  name: string;
  src: string;
}

/**
 * Full-page image pop-up. Stays on the current page: the X, Escape, or a click on the backdrop
 * closes it. With several images, use the arrow buttons, the left/right arrow keys, swiping, or
 * the thumbnail strip. Click the image (or the magnifier) to zoom to full size and scroll around.
 */
export function ImageViewer({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: ViewerImage[];
  /** Index of the open image, or null when closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const open = index !== null && images.length > 0;
  const current = open ? Math.min(index, images.length - 1) : 0;
  const image = images[current];
  const many = images.length > 1;
  const [zoomed, setZoomed] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const go = (step: number) => {
    setZoomed(false);
    onIndexChange((current + step + images.length) % images.length);
  };

  useEffect(() => {
    if (!open || !many) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setZoomed(false);
        onIndexChange((current - 1 + images.length) % images.length);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setZoomed(false);
        onIndexChange((current + 1) % images.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, many, current, images.length, onIndexChange]);

  // Start every opening un-zoomed.
  useEffect(() => {
    if (!open) setZoomed(false);
  }, [open]);

  // If the open image is removed while viewing, close when none are left.
  useEffect(() => {
    if (index !== null && images.length === 0) onClose();
  }, [index, images.length, onClose]);

  // Load the neighbours ahead of time so next/previous feels instant.
  useEffect(() => {
    if (!open || !many) return;
    for (const offset of [-1, 1]) {
      const neighbour = images[(current + offset + images.length) % images.length];
      if (neighbour) new window.Image().src = neighbour.src;
    }
  }, [open, many, current, images]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="journal-popup fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="journal-popup fixed inset-0 z-[60] flex flex-col outline-none"
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            {image ? `Image: ${image.name}` : "Image viewer"}
          </DialogPrimitive.Title>

          <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
            <p className="min-w-0 truncate text-sm font-medium" title={image?.name}>
              {image?.name}
              {many && (
                <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs font-normal text-white/80">
                  {current + 1} / {images.length}
                </span>
              )}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                aria-label={zoomed ? "Zoom out" : "Zoom in"}
                onClick={() => setZoomed((value) => !value)}
                className="flex size-10 items-center justify-center rounded-full bg-white/10 outline-none transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
              >
                {zoomed ? <ZoomOut className="size-5" /> : <ZoomIn className="size-5" />}
              </button>
              <DialogPrimitive.Close
                aria-label="Close image"
                className="flex size-10 items-center justify-center rounded-full bg-white/10 outline-none transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
              >
                <X className="size-5" />
              </DialogPrimitive.Close>
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            <div
              className="flex size-full overflow-auto px-4 sm:px-16"
              onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
              }}
              onTouchStart={(event) => {
                const touch = event.touches[0];
                touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
              }}
              onTouchEnd={(event) => {
                const start = touchStart.current;
                const touch = event.changedTouches[0];
                touchStart.current = null;
                if (!start || !touch || zoomed || !many) return;
                const dx = touch.clientX - start.x;
                const dy = touch.clientY - start.y;
                if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
              }}
            >
              {image && (
                <img
                  key={image.id}
                  src={image.src}
                  alt={image.name}
                  onClick={() => setZoomed((value) => !value)}
                  className={`m-auto rounded-lg shadow-2xl ${
                    zoomed
                      ? "max-h-none max-w-none cursor-zoom-out"
                      : "max-h-full max-w-full cursor-zoom-in object-contain"
                  }`}
                />
              )}
            </div>
            {many && (
              <>
                <button
                  type="button"
                  aria-label="Previous image"
                  onClick={() => go(-1)}
                  className="absolute left-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white outline-none backdrop-blur transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white sm:left-4"
                >
                  <ChevronLeft className="size-6" />
                </button>
                <button
                  type="button"
                  aria-label="Next image"
                  onClick={() => go(1)}
                  className="absolute right-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white outline-none backdrop-blur transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white sm:right-4"
                >
                  <ChevronRight className="size-6" />
                </button>
              </>
            )}
          </div>

          {many && (
            <div className="flex justify-center gap-2 overflow-x-auto px-4 py-3">
              {images.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`Show ${item.name}`}
                  aria-current={i === current}
                  onClick={() => {
                    setZoomed(false);
                    onIndexChange(i);
                  }}
                  className={`h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 bg-black/40 outline-none transition-all focus-visible:ring-2 focus-visible:ring-white ${
                    i === current ? "border-white" : "border-transparent opacity-60 hover:opacity-100"
                  }`}
                >
                  <img src={item.src} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
