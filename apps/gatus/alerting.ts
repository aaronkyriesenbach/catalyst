import { type Severity } from "@catalyst/platform/notifications";
import { StatusGroup } from "@catalyst/platform/status";
import { appriseUrl } from "../apprise";
import { notifierKey } from "./common";

const defaultSeverity: Severity = "warning";

const groupSeverity: Partial<Record<StatusGroup, Severity>> = {
  [StatusGroup.Certificates]: "critical",
};

const TRIGGERED = "failure";
const RESOLVED = "success";

function notifyBody(severity: Severity): string {
  return JSON.stringify({
    title: "[ALERT_TRIGGERED_OR_RESOLVED]: [ENDPOINT_NAME] ([ENDPOINT_GROUP])",
    body: "[ENDPOINT_GROUP] / [ENDPOINT_NAME]: [ALERT_TRIGGERED_OR_RESOLVED]. [RESULT_ERRORS]",
    type: "[ALERT_TRIGGERED_OR_RESOLVED]",
    tag: severity,
  });
}

export const customAlert = { type: "custom" } as const;

export function buildAlerting() {
  return {
    custom: {
      url: `${appriseUrl}/notify/${notifierKey}`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: notifyBody(defaultSeverity),
      placeholders: {
        ALERT_TRIGGERED_OR_RESOLVED: { TRIGGERED, RESOLVED },
      },
      "default-alert": {
        "failure-threshold": 3,
        "success-threshold": 2,
        "send-on-resolved": true,
      },
      overrides: Object.entries(groupSeverity).map(([group, severity]) => ({
        group,
        body: notifyBody(severity),
      })),
    },
  };
}
