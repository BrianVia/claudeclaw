import { join } from "path";
import { DATA_DIR } from "./paths";

// Write state.json so the statusline script can read fresh data
export interface StateData {
  heartbeat?: { nextAt: number };
  jobs: { name: string; nextAt: number }[];
  security: string;
  telegram: boolean;
  discord: boolean;
  slack: boolean;
  startedAt: number;
  web?: { enabled: boolean; host: string; port: number };
}

export async function writeState(state: StateData) {
  await Bun.write(
    join(DATA_DIR, "state.json"),
    JSON.stringify(state) + "\n"
  );
}
