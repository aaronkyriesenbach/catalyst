export type DeclaredUser = {
  username: string;
  name: string;
  email: string;
  admin?: boolean;
  apps: readonly string[];
};

// Declared users are enforced from Git; everyone else is invited and managed in authentik's UI.
export const users: readonly DeclaredUser[] = [];
