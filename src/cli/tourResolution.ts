import * as path from "path";
import { fileURLToPath } from "node:url";
import type { CodeTour } from "../store";

// The single Tour selection resolution contract (spec #94): given the
// discovered Tours and an optional requested title, return the resolved
// Tour or the resolution error. Interactive selection stays in the CLI
// entry point; non-interactive callers (the Copilot adapter) consume
// this contract through --internal-resolve-tour.
export function resolveTourSelection(tours: CodeTour[], requested?: string): CodeTour {
  const availableTours = () => "Available Tours: " + tours.map(tour => tour.title).join(", ");
  if (tours.length === 0) {
    throw new Error("No existing Tours found in this Git worktree.");
  }
  if (requested) {
    const matches = tours.filter(tour =>
      tour.title === requested ||
      path.basename(fileURLToPath(tour.id), ".tour") === requested
    );
    if (matches.length !== 1) {
      throw new Error("Tour '" + requested + "' not found or ambiguous. " + availableTours());
    }
    return matches[0];
  }
  if (tours.length === 1) return tours[0];
  throw new Error("Tour selection is ambiguous. " + availableTours());
}
