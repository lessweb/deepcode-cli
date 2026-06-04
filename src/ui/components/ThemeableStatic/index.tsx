import React, { useMemo } from "react";
import { Static } from "ink";

type Props<T> = {
  items: T[];
  themeVersion: number;
  /** 当此值变化时强制重新挂载，用于清除终端旧内容（如 /new 切换会话） */
  resetKey?: number;
  children: (item: T, index: number) => React.ReactNode;
};

/**
 * 支持主题重新渲染的 Static 组件。
 *
 * Ink 的 <Static> 组件只渲染新增的 items，已渲染的 items 不会重新渲染。
 * 这个组件始终渲染所有 items，使用 key={themeVersion}:{resetKey} 在主题变化或内容重置时强制重新挂载。
 *
 * 使用 React.memo + 自定义比较跳过 children (render prop) 的比较，
 * 避免父组件因 nowTick 等无关状态变化导致每帧重渲染。
 */
const ThemeableStaticInner = function ThemeableStaticInner<T>({
  items,
  themeVersion: _themeVersion,
  resetKey,
  children: render,
}: Props<T>): React.ReactElement {
  // resetKey 用于 /new 等需要重新挂载的场景
  // themeVersion 不参与 key，切换主题时历史消息保持原样，新消息用新主题
  const key = `${resetKey ?? 0}`;

  const wrappedRender = useMemo(() => (item: T, index: number) => render(item, index), [render]);
  return (
    <Static key={key} items={items}>
      {wrappedRender}
    </Static>
  );
};

function propsAreEqual(prev: Props<unknown>, next: Props<unknown>): boolean {
  return prev.items === next.items && prev.themeVersion === next.themeVersion && prev.resetKey === next.resetKey;
}

export default React.memo(ThemeableStaticInner, propsAreEqual) as typeof ThemeableStaticInner;
