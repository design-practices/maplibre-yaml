/**
 * A record of every `ml-map:load` / `ml-map:error` on the page, for the
 * browser suite (e2e/react-example.spec.ts) to assert against: which section
 * fired what, in order. Not something an app needs; it reads the same
 * bubbling events the event log shows.
 */
export interface RecordedMapEvent {
  type: string;
  section: string;
  message?: string;
}

declare global {
  interface Window {
    __mlMapEvents?: RecordedMapEvent[];
    __lateConfigEffectRuns?: number;
  }
}

export function recordMapEvents(): void {
  const events: RecordedMapEvent[] = (window.__mlMapEvents = []);
  for (const type of ["ml-map:load", "ml-map:error"] as const) {
    document.addEventListener(type, (event) => {
      const target = event.target as HTMLElement;
      const detail = (event as CustomEvent).detail ?? {};
      events.push({
        type,
        section: target.closest("section")?.id ?? "?",
        message: detail.error?.message ?? detail.errors?.[0]?.message,
      });
    });
  }
}
