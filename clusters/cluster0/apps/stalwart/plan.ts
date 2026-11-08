import { site } from "@catalyst/site";
import { oidcIssuer } from "@catalyst/platform/auth";
import { appHostname } from "@catalyst/platform/hostnames";
import { accounts } from "./accounts.config";
import { stalwartName, webUiClientId } from "./common";
import { disabledPermissions } from "./permissions";

type Operation = Record<string, unknown>;

const enabled = (names: readonly string[]) =>
  Object.fromEntries(names.map((name) => [name, true]));

const upsert = (
  object: string,
  matchOn: readonly string[],
  value: Record<string, Operation>,
): Operation => ({ "@type": "upsert", object, matchOn, value });

const reconcile = (
  object: string,
  matchOn: readonly string[],
  value: Record<string, Operation>,
): Operation => ({ "@type": "reconcile", object, matchOn, value });

const update = (object: string, value: Operation): Operation => ({
  "@type": "update",
  object,
  value,
});

const ADMIN_ROLE_ID = "e";
const USER_ROLE_ID = "b";

const manual = { "@type": "Manual" };

export function buildStalwartPlan(): string {
  const operations: Operation[] = [
    upsert("Domain", ["name"], {
      domain: {
        name: site.domain,
        certificateManagement: manual,
        dkimManagement: manual,
        dnsManagement: manual,
      },
    }),
    upsert("Role", ["description"], {
      calendarUser: {
        description: "Calendar user",
        roleIds: enabled([USER_ROLE_ID]),
        disabledPermissions: enabled(disabledPermissions),
      },
    }),
    upsert("Directory", ["description"], {
      authentik: {
        "@type": "Oidc",
        description: "authentik",
        issuerUrl: oidcIssuer(webUiClientId),
        claimUsername: "preferred_username",
        usernameDomain: site.domain,
        acceptedAudiences: enabled([webUiClientId]),
      },
    }),
    update("Authentication", {
      directoryId: "#authentik",
      defaultUserRoleIds: enabled(["#calendarUser"]),
    }),
    update("SystemSettings", {
      defaultHostname: appHostname(stalwartName),
      defaultDomainId: "#domain",
    }),
    update("Http", { redirectRoot: null, clientIpSource: "xForwardedFor" }),
    upsert("Application", ["description"], {
      webUi: {
        description: "Stalwart Web Interface",
        oauthClientId: webUiClientId,
      },
    }),
    upsert(
      "Account",
      ["name", "domainId"],
      Object.fromEntries(
        accounts.map((account) => [
          `account-${account.name}`,
          {
            "@type": "User",
            name: account.name,
            domainId: "#domain",
            roles: {
              "@type": "Custom",
              roleIds: enabled([
                ...(account.admin ? [ADMIN_ROLE_ID] : []),
                "#calendarUser",
              ]),
            },
          },
        ]),
      ),
    ),
    reconcile("NetworkListener", ["name"], {
      http: { name: "http", protocol: "http", bind: { "[::]:8080": true } },
    }),
    reconcile("Tracer", ["@type"], {
      stdout: {
        "@type": "Stdout",
        enable: true,
        level: "info",
        ansi: false,
        multiline: false,
      },
    }),
    upsert("EventTracingLevel", ["event"], {
      forwardedMissing: {
        event: "http.x-forwarded-missing",
        level: "disable",
      },
    }),
  ];

  return `${operations.map((operation) => JSON.stringify(operation)).join("\n")}\n`;
}
