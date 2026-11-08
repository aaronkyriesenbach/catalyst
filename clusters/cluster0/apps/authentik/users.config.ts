export type DeclaredUser = {
  username: string;
  name: string;
  // Public repo: leave unset and set the address in the authentik UI, which the blueprint then keeps.
  email?: string;
  // authentik superuser; app-level admin rights come from `groups` instead.
  admin?: boolean;
  groups?: readonly string[];
  apps: readonly string[] | "all";
};

// Groups that belong to no single app, for claims an app reads (e.g. shakedown's ADMIN_GROUP).
export const groups: readonly string[] = ["admin"];

// Declared users are enforced from Git; everyone else is invited and managed in authentik's UI.
export const users: readonly DeclaredUser[] = [
  {
    username: "aaron",
    name: "Aaron Ky-Riesenbach",
    admin: true,
    groups: ["admin"],
    apps: "all",
  },
];
