import { useEffect, useRef, useState, type ReactNode } from 'react';

interface ChartFrameProps {
  height: number;
  className?: string;
  fallback?: ReactNode;
  children: (size: { width: number; height: number }) => ReactNode;
}

export function ChartFrame({ height, className = '', fallback = null, children }: ChartFrameProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updateSize = () => setWidth(element.clientWidth);
    updateSize();

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} style={{ height }}>
      {width > 0 ? children({ width, height }) : fallback}
    </div>
  );
}
