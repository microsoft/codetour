import { registerPlayerCommands } from "./player/commands";
import { registerRecorderCommands } from "./recorder/commands";

export function registerCommands() {
  registerPlayerCommands();
  registerRecorderCommands();
}
