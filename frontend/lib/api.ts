export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...options, cache: "no-store" });
  } catch {
    throw new Error("Couldn’t connect. Try again.");
  }
  if (response.ok) return response.json() as Promise<T>;
  const data = await response.json().catch(() => null);
  const canShowDetail = response.status < 500 || data?.code === "gemini_import";
  throw new Error(canShowDetail && typeof data?.detail === "string"
    ? data.detail
    : "Something went wrong. Try again.");
}
