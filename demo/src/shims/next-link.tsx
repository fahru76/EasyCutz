import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { hrefFor, navigate } from "./router";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | { pathname?: string };
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
  children?: ReactNode;
};

export default function Link({ href, prefetch: _prefetch, replace, scroll: _scroll, onClick, ...rest }: Props) {
  const target = typeof href === "string" ? href : (href.pathname ?? "/");
  const internal = target.startsWith("/");
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || !internal || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (rest.target && rest.target !== "_self") return;
    e.preventDefault();
    navigate(target, replace);
  };
  return <a href={internal ? hrefFor(target) : target} onClick={handle} {...rest} />;
}
