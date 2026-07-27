import { useEffect, useState } from "react";

export interface Size {
  width: number;
  height: number;
}

/**
 * 监听 DOM 元素尺寸变化的 hook。
 * 基于 ResizeObserver 实现，当目标元素尺寸变化时自动更新返回值。
 *
 * @param target - React ref 指向的目标 DOM 元素，传入 null 时不进行监听
 * @returns 当前元素的 `{ width, height }`，若目标不存在则返回 `undefined`
 *
 * @example
 * ```tsx
 * const ref = useRef<HTMLDivElement>(null);
 * const size = useSize(ref);
 * // size?.width, size?.height
 * ```
 */
export function useSize(target: React.RefObject<HTMLElement | null>): Size | undefined {
  const [size, setSize] = useState<Size | undefined>(() => {
    const el = target.current;
    return el ? { width: el.clientWidth, height: el.clientHeight } : undefined;
  });

  useEffect(() => {
    const el = target.current;
    if (!el) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { clientWidth, clientHeight } = entry.target;
        setSize({ width: clientWidth, height: clientHeight });
      }
    });

    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
    };
  }, [target]);

  return size;
}
