export async function headers(): Promise<Headers> {
  return new Headers({ host: location.host, "x-forwarded-proto": location.protocol.replace(":", "") });
}

export async function cookies() {
  return {
    getAll: () => [] as Array<{ name: string; value: string }>,
    get: () => undefined,
    set: () => {},
  };
}
