export type StalwartAccount = {
  name: string;
  admin?: boolean;
};

export const accounts: readonly StalwartAccount[] = [
  { name: "aaron", admin: true },
];
