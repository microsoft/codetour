import { registerRecorderCommands } from "./commands";
import { registerCompletionProvider } from "./completionProvider";

export function registerRecorderModule() {
  registerRecorderCommands();
  registerCompletionProvider();
}
