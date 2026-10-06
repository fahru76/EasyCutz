import { appPath, navigate, NotFoundSignal, RedirectSignal, refresh } from "./router";

export function useRouter() {
  return {
    push: (href: string) => navigate(href),
    replace: (href: string) => navigate(href, true),
    refresh,
    back: () => history.back(),
    forward: () => history.forward(),
    prefetch: () => {},
  };
}

export function usePathname(): string {
  return appPath();
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(location.search);
}

export function redirect(href: string): never {
  throw new RedirectSignal(href);
}

export function notFound(): never {
  throw new NotFoundSignal();
}
