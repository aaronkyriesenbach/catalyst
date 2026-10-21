import { appriseUrl } from "../apprise";
import {
  alertSeverities,
  alertSeverityOverrides,
  type Severity,
} from "../../notifications";

// Must be listed in `appriseNotifiers`.
export const notifierKey = "victoria-metrics";

// Alertmanager YAML-parses rendered values, so colons are rewritten and lines start with a bullet.
const NO_YAML_COLON = '| reReplaceAll `:(\\s|$)` " - "';

const TITLE = `{{ $t := printf "%s - %s" (.Status | toUpper) .CommonLabels.alertname }}{{ with .CommonLabels.namespace }}{{ $t = printf "%s (%s)" $t . }}{{ end }}{{ $t ${NO_YAML_COLON} }}`;

const BODY = `{{ $b := "" }}{{ range .Alerts }}{{ $s := .Labels.alertname }}{{ with .Annotations.summary }}{{ $s = . }}{{ end }}{{ with .Annotations.description }}{{ $s = printf "%s - %s" $s . }}{{ end }}{{ $b = printf "%s• %s\\n" $b ($s ${NO_YAML_COLON}) }}{{ end }}{{ $b }}`;

const TYPE =
  '{{ if eq .Status "resolved" }}success{{ else if or (eq .CommonLabels.severity "critical") (eq .CommonLabels.severity "emergency") }}failure{{ else }}warning{{ end }}';

const receiverName = (severity: Severity) => `apprise-${severity}`;

function appriseReceiver(severity: Severity) {
  return {
    name: receiverName(severity),
    webhook_configs: [
      {
        url: `${appriseUrl}/notify/${notifierKey}`,
        send_resolved: true,
        payload: { title: TITLE, body: BODY, type: TYPE, tag: severity },
      },
    ],
  };
}

const overrideRoutes = Object.entries(alertSeverityOverrides).map(
  ([alertname, severity]) => ({
    matchers: [`alertname="${alertname}"`],
    receiver: receiverName(severity),
  }),
);

export const alertmanagerConfig = {
  route: {
    receiver: "blackhole",
    group_by: ["alertname", "namespace"],
    group_wait: "30s",
    group_interval: "5m",
    repeat_interval: "12h",
    routes: [
      {
        matchers: ['alertname=~"Watchdog|InfoInhibitor"'],
        receiver: "blackhole",
      },
      ...overrideRoutes,
      ...alertSeverities.map((severity) => ({
        matchers: [`severity="${severity}"`],
        receiver: receiverName(severity),
      })),
    ],
  },
  receivers: [{ name: "blackhole" }, ...alertSeverities.map(appriseReceiver)],
};
