/**
 * Host-independent Tour discovery. Both VS Code and the standalone reader use
 * these locations, parsing rules and platform visibility filters.
 */
import * as jexl from "jexl";
import type { CodeTour } from "../store";

export const MAIN_TOUR_FILES = [".tour", ".vscode/main.tour", "main.tour"];
export const SUB_TOUR_DIRECTORIES = [".vscode/tours", ".github/tours", ".tours"];

export interface TourFilesystem<Uri> {
  join(root: Uri, relative: string): Uri;
  read(uri: Uri): Promise<string>;
  list(uri: Uri): Promise<Array<{ name: string; isDirectory: boolean }>>;
  id(uri: Uri): string;
}

export function tourDirectories(customDirectory?: string | null): string[] {
  return customDirectory
    ? [...SUB_TOUR_DIRECTORIES, customDirectory]
    : [...SUB_TOUR_DIRECTORIES];
}

export async function discoverToursFromRoot<Uri>(
  root: Uri,
  fs: TourFilesystem<Uri>,
  customDirectory?: string | null
): Promise<CodeTour[]> {
  const readTour = async (uri: Uri): Promise<CodeTour | undefined> => {
    try {
      const tour = JSON.parse(await fs.read(uri)) as CodeTour;
      tour.id = fs.id(uri);
      return tour;
    } catch {
      // Existing CodeTour discovery ignores unreadable/non-Tour files.
      return undefined;
    }
  };

  const readDirectory = async (uri: Uri): Promise<CodeTour[]> => {
    try {
      const entries = await fs.list(uri);
      const tours = await Promise.all(entries.map(async entry => {
        const child = fs.join(uri, entry.name);
        return entry.isDirectory ? readDirectory(child) : readTour(child);
      }));
      return tours.flat().filter((tour): tour is CodeTour => !!tour);
    } catch {
      return [];
    }
  };

  const directories = await Promise.all(
    tourDirectories(customDirectory).map(path => readDirectory(fs.join(root, path)))
  );
  const mains = await Promise.all(
    MAIN_TOUR_FILES.map(path => readTour(fs.join(root, path)))
  );
  // Preserve the existing provider's sub-Tours-first discovery order.
  return [...directories.flat(), ...mains.filter((tour): tour is CodeTour => !!tour)];
}

export interface TourVisibility {
  isLinux: boolean;
  isMac: boolean;
  isWindows: boolean;
  isWeb: boolean;
}

export function visibleTours(tours: CodeTour[], visibility: TourVisibility): CodeTour[] {
  return tours
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title))
    .filter(tour => !tour.when || jexl.evalSync(tour.when, visibility));
}
