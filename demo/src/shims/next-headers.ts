export async function headers(): Promise<Headers> {
  return new Headers({
    host: location.host,
    "x-forwarded-proto": location.protocol.replace(":", ""),
    "accept-language": (navigator.languages ?? [navigator.language]).join(","),
  });
}

/** Read-only view of document.cookie (the app only reads cookies on the server side). */
export async function cookies() {
  const all = () =>
    document.cookie
      .split(";")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const i = c.indexOf("=");
        return { name: c.slice(0, i), value: decodeURIComponent(c.slice(i + 1)) };
      });
  return {
    getAll: () => all(),
    get: (name: string) => all().find((c) => c.name === name),
    set: () => {},
  };
}
