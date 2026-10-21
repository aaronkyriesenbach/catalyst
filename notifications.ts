import { stringify } from "yaml";

export type Severity = "info" | "warning" | "critical" | "emergency";
type PushPriority = "normal" | "high" | "emergency";

type Delivery = {
  push?: PushPriority;
  email?: true;
};

// Edit this table to change who is told what; every sender posts a severity as its Apprise `tag`.
export const severityDelivery: Record<Severity, Delivery> = {
  info: { email: true },
  warning: { email: true },
  critical: { push: "high", email: true },
  emergency: { push: "emergency", email: true },
};

// Other alert severities (`info`, `none`) are dropped: they are for dashboards.
export const alertSeverities = ["warning", "critical", "emergency"] as const;

// Per-alert severity, e.g. `KubePodCrashLooping: "critical"` to push crash loops.
export const alertSeverityOverrides: Record<string, Severity> = {};

const severities = ["info", "warning", "critical", "emergency"] as const;
const pushPriorities = ["normal", "high", "emergency"] as const;

function pushoverUrl(priority: PushPriority): string {
  const base = `pover://{{ .pushover_user_key }}@{{ .pushover_app_token }}?priority=${priority}`;

  return priority === "emergency" ? `${base}&interval=300&expire=10800` : base;
}

const sesUrl =
  "ses://{{ .ses_from }}/{{ .ses_access_key_id }}/{{ .ses_secret_access_key | urlquery }}/{{ .ses_region }}/{{ .ses_to }}";

export function buildAppriseConfig(): string {
  const pushEntries = pushPriorities.flatMap((priority) => {
    const tags = severities.filter(
      (severity) => severityDelivery[severity].push === priority,
    );

    return tags.length === 0
      ? []
      : [{ url: pushoverUrl(priority), tags: [...tags, "push"] }];
  });

  const emailTags = severities.filter(
    (severity) => severityDelivery[severity].email,
  );
  const emailEntries =
    emailTags.length === 0
      ? []
      : [{ url: sesUrl, tags: [...emailTags, "email"] }];

  const urls = [...pushEntries, ...emailEntries].map(({ url, tags }) => ({
    [url]: [{ tag: tags.join(", ") }],
  }));

  return stringify(
    { version: 1, urls },
    { lineWidth: 0, defaultKeyType: "QUOTE_DOUBLE" },
  );
}
