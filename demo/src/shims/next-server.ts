/** Static demo: every render is "at request time". */
export async function connection(): Promise<void> {}

export const NextResponse = {
  json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
};
