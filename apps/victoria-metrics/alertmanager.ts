import { appriseUrl } from "../apprise";

// Apprise only accepts keys listed in `appriseNotifiers`.
export const notifierKey = "victoria-metrics";

// Alertmanager parses each rendered value as YAML and turns anything that looks like a
// map or list into one, so colons are rewritten and every body line starts with a bullet.
const NO_YAML_COLON = '| reReplaceAll `:(\\s|$)` " - "';

const TITLE = `{{ $t := printf "%s - %s" (.Status | toUpper) .CommonLabels.alertname }}{{ with .CommonLabels.namespace }}{{ $t = printf "%s (%s)" $t . }}{{ end }}{{ $t ${NO_YAML_COLON} }}`;

const BODY = `{{ $b := "" }}{{ range .Alerts }}{{ $s := .Labels.alertname }}{{ with .Annotations.summary }}{{ $s = . }}{{ end }}{{ with .Annotations.description }}{{ $s = printf "%s - %s" $s . }}{{ end }}{{ $b = printf "%s• %s\\n" $b ($s ${NO_YAML_COLON}) }}{{ end }}{{ $b }}`;

// The receiver fixes Apprise's routing `tag`, so rules never name a channel.
function appriseReceiver(name: string, tag: "warn" | "critical") {
  return {
    name,
    webhook_configs: [
      {
        url: `${appriseUrl}/notify/${notifierKey}`,
        send_resolved: true,
        payload: {
          title: TITLE,
          body: BODY,
          type: '{{ if eq .Status "resolved" }}success{{ else if eq .CommonLabels.severity "critical" }}failure{{ else }}warning{{ end }}',
          tag,
        },
      },
    ],
  };
}

// Info and always-firing alerts go to blackhole: they are for dashboards, not a phone.
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
      { matchers: ['severity="critical"'], receiver: "apprise-critical" },
      { matchers: ['severity="warning"'], receiver: "apprise-warn" },
    ],
  },
  receivers: [
    { name: "blackhole" },
    appriseReceiver("apprise-critical", "critical"),
    appriseReceiver("apprise-warn", "warn"),
  ],
};
