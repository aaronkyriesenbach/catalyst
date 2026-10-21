export type DeclaredUser = {
  username: string;
  name: string;
  // Public repo: leave unset and set the address in the authentik UI, which the blueprint then keeps.
  email?: string;
  admin?: boolean;
  apps: readonly string[];
};

// Declared users are enforced from Git; everyone else is invited and managed in authentik's UI.
export const users: readonly DeclaredUser[] = [
  {
    username: "aaron",
    name: "Aaron Ky-Riesenbach",
    admin: true,
    apps: ["reader"],
  },
];
