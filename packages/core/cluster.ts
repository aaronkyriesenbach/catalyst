import { currentCluster, loadCluster } from "./clusters";

export const cluster = await loadCluster(currentCluster());
