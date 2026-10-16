import { init } from "@sentry/browser";

const messages = {
  search: "Documentation search index could not load",
  markdown: "Documentation page Markdown could not load",
} as const;
const reported = new Set<keyof typeof messages>();
const environment = import.meta.env.PUBLIC_SITE_ENVIRONMENT ?? "development";
const release = import.meta.env.PUBLIC_SITE_RELEASE ?? "development";
let client: ReturnType<typeof init>;

export function reportDocsFailure(operation: keyof typeof messages) {
  if (reported.has(operation)) return;
  reported.add(operation);
  try {
    client ??= init({
      // Public browser ingestion key, not an administrative credential.
      dsn: "https://3196d9ecfd859b522024c00a958c0165@o4510313803677696.ingest.us.sentry.io/4512265106620416",
      environment,
      release,
      defaultIntegrations: false,
      dataCollection: { userInfo: false },
      attachStacktrace: false,
      sendClientReports: false,
      transportOptions: {
        bufferSize: 2,
        fetchOptions: { credentials: "omit", referrerPolicy: "no-referrer" },
      },
      // Reconstruct rather than scrub: neither SDK scope nor caught error data
      // may add URLs, input, content, headers, breadcrumbs, or user identity.
      beforeSend(event) {
        if (!event.message || !Object.values(messages).some((message) => message === event.message))
          return null;
        return {
          type: undefined,
          event_id: event.event_id,
          timestamp: event.timestamp,
          message: event.message,
          level: "error",
          environment,
          release,
          fingerprint: [event.message],
        };
      },
    });
    client?.captureEvent({ message: messages[operation], level: "error" });
  } catch {
    // Reporting is best effort. Never replace the docs fallback or its retry.
  }
}
