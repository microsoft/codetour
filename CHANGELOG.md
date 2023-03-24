## Upcoming

- Automatically updating a tour file as the associated code changes
- Automatically set the "pattern" record mode when you create a new tour, and select `None` for the git ref
- Added support for opening a `*.tour` file in the VS Code notebook editor (Insiders only)

## v0.0.59 (03/24/2023)

- A tour step can now run multiple commands
- Tours are now written to the `CodeTour: Custom Tour Directory` directory, when that property is set
- Fixed a performance issue with large codebases

## v0.0.58 (07/08/2021)

- The "Tours available!" prompt is now suppressed when opening a [CodeSwing](https://aka.ms/codeswing) workspace

## v0.0.57 (07/08/2021)

- Added a new `CodeTour: Custom Tour Directory` setting, that allows a project to specify a custom directory for their tours to be stored in
- Added support for storing tours in the `.github/tours` folder, in addition to the existing `.vscode/tours` and `.tours` directories
- You can now create a tour called `main.tour` at the root of your workspace, which will be considered a primary tour
- Fixed a bug with running CodeTour in Safari (which doesn't support lookbehinds in regex)

## v0.0.56 (05/29/2021)

- URI handler now allows specifying the step via 1-based numbers, as opposed to 0-based

## v0.0.55 (05/29/2021)

- The URI handler now allows specifying _just_ a step number, in order to index into a repo within only a single tour

## v0.0.54 (05/29/2021)

- Added a URI handler, with support for launching a specific tour and step

## v0.0.53 (05/12/2021)

- Exposed a new `onDidStartTour` event and `startTourByUri` method to the extension API
- Added experimental support for the CodeStatus extension

## v0.0.52 (04/26/2021)

- Updated the play/stop icons
- Fixed an issue with tour steps that were attached to the first line of a file

## v0.0.51 (04/23/2021)

- Added support for referencing workspace images in a tour step

## v0.0.50 (04/23/2021)

- Added support for referencing workspace files in a tour step
- Fixed a bug with code fences, that allow multi-line snippets

## v0.0.49 (03/27/2021)

- Fixed a bug with tours that span multi-root workspaces
- Fixed a bug with code fences, that allows the use of backticks in the code snippet

## v0.0.48 (03/27/2021)

- Added support for conditional tours via the new `when` property to tour files
- Added keybindings for starting and ending tours
- Fixed an issue with using quotes in a shell command
- Fixed a bug with code fences that used a multi-word language (e.g. `codefusion html`)

## v0.0.47 (03/10/2021)

- Introduced the new `CodeTour: Record Mode` setting, that allows you to create tours that are associated with code via regex patterns, in addition to line numbers.

## v0.0.46 (03/09/2021)

- Added the new `Add Tour Step` command to tour step nodes in the `CodeTour` tree
- When you add a new tour step, you're now transitioned into preview mode.
- Fixed a bug with the rendering of shell commands, immediately after saving a step.
- The `CodeTour: Edit Tour` command is now hidden from the command palette

## v0.0.45 (03/09/2021)

- Fixed an issue with gutter decorators being duplicated when copying/pasting code on lines associated with a tour step
- When you save a tour step, you're now automatically transitioned into "preview mode", in order to make it simpler to view the rendering of your step

## v0.0.44 (02/09/2021)

- Added the `codetour.promptForWorkspaceTours` setting to allow users to supress the notification when opening workspaces with tours
- Fixed a bug with replaying directory and content steps
- Fixed a bug where there was a "flash" after adding the first step to a new tour

## v0.0.43 (02/02/2021)

- Tour steps can now be associated with a regular expression or "comment marker" (e.g. `// CT1.1`) in addition to a line number.
- The `Insert code` gesture will now replace the selection when the current step has one.

## v0.0.42 (12/13/2020)

- Added a hover preview for tour steps in the `CodeTour` tree view, so you can see the step's content at-a-glance
- If a tour has a previous tour, then its first step will now display a `Previous Tour` link to navigate "back" to it
- Tour references are now automatically updated when you the change the title of a tour through the `CodeTour` view

## v0.0.41 (12/12/2020)

- The `CodeTour` view now indicates the progress for tours/steps you've already taken
- The `CodeTour` view now displays an icon next to the active tour step
- The `CodeTour: Hide Markers` and `CodeTour: Show Markers` commands are now hidden from the command palette

## v0.0.40 (12/11/2020)

- Tours with titles that start with `#1 -` or `1 -` are now automatically considered the primary tour, if there isn't already a tour that's explicitly marked as being the primary.
- Added support for numbering/linking tours, and the `nextTour` property in `*.tour` files

## v0.0.39 (11/08/2020)

- Updated the previous/next navigation links, so that they don't show file names when a step doesn't have a title

## v0.0.38 (11/06/2020)

- Introduced support for inserting code snippets
- Added arrow icons to the previous/next navigation links
- The `$schema` property is now explicitly added to `*.tour` files

## v0.0.37 (11/04/2020)

- Added `Previous`, `Next` and `Finish` commands to the bottom of the comment UI, in order to make it easier to navigate a tour.
- Fixed a parsing issue with step reference links

## v0.0.36 (10/29/2020)

- Removed the `Reply...` box from the tour step visualization.

## v0.0.35 (06/28/2020)

- Added new extensibility APIs to record and playback tours for external workspaces (e.g. GistPad repo editing).
- Updated the `CodeTour` tree to always show when you're taking a tour, even if you don't have a workspace open.

## v0.0.34 (06/27/2020)

- Updated the tour recorder, to allow you to edit the line associated with a step
- Updated the tour recorder, to allow you to add a tour step from an editor selection
- Added the ability to record a new tour that is saved to an arbitrary location on disk, as opposed to the `.tours` directory of the opened workspace.

## v0.0.33 (06/18/2020)

- Fixed an issue where CodeTour overrode the JSON language type

## v0.0.32 (06/01/2020)

- Added a list of well-known views to the step `view` property (e.g. `scm`, `extensions:disabled`) to simpify the authoring process for view steps.

## v0.0.31 (05/31/2020)

- Exposed the `Add Tour Step` as a context menu to tour nodes in the `CodeTour` tree.
- Update the `CodeTour` tree, so that it doesn't "steal" focus while navigating a tour, if the end-user doesn't have it visible already
- **Experimental** Added the concept of a "view step", which allows you to add a step that automatically focuses a VS Code view and describes it
- **Experimental** Added step commands, which allows a step to include one or more commands that should be executed when the step is navigated to

## v0.0.30 (05/28/2020)

- Changed the `CodeTour` tree to be always visible by default, as long as you have one or more workspaces opened.

## v0.0.29 (05/27/2020)

- Fixed an issue with URI handling on Windows

## v0.0.28 (05/22/2020)

- Introduced support for the step/tour reference syntax.
- Added the following commands to the command link completion list: `Run build task`, `Run task` and `Run test task`.
- Fixed a bug where command links didn't work, if the command included multiple "components" to the name (e.g. `workbench.action.tasks.build`).
- Fixed a bug where tours weren't being discovered for virtual file systems that include a query string in their workspace path.
- Fixed a bug where tours that included content-only steps couldn't be exported.
- Fixed the open/export tour commands to correctly look for `*.tour` files.
- Fixed a bug where the `CodeTour: Record Tour` command was being displayed without having any workspaces open.

## v0.0.27 (05/22/2020)

- Added support for "command links" in your steps, including a completion provider for using well-known commands.
- Improved extension activation perf by building it with Webpack
- Fixed an issue with playing tours for virtual file systems (e.g. `gist://`).

## v0.0.26 (05/17/2020)

- Added support for a codebase to have a "primary" tour, which provides a little more prescription to folks that are onboarding
- Added the `Change Title` command to step nodes in the `CodeTour` tree. This allows you to easily give steps a title without needing to add a markdown header to their description
- Added support for multi-select deletes in the `CodeTour` tree, for both tour and step nodes
- Added a `Preview Tour` command that allows putting the active tour into preview mode
- Updated the tour recorder to automatically place steps into edit mode when you start recording
- The `Save Step` button is now only enabled when recording a step, whose description isn't empty
- Removed the `Start CodeTour` status bar item, which just added noise to the user's statur bar

## v0.0.25 (05/03/2020)

- Introduced the `Add CodeTour Step` context menu to directories in the `Explorer` tree, which allows you to add steps that point at directories, in addition to files.
- Added the `CodeTour: Add Tour Step` command, which allows you to create a content-only step, that isn't associated with a file or directory.
- Fixed a bug where new steps weren't properly focused in the `CodeTour` tree when recording a new tour.

## v0.0.24 (05/02/2020)

- Explicitly marking the `CodeTour` extension as a "workspace extension", since it needs access to the workspace files and Git extension.
- Temporarily removed the `View Notebook` command, since this isn't officially supported in VS Code.

## v0.0.23 (04/19/2020)

- Added the `View Notebook` command to tour nodes in the `CodeTour` tree, which allows you to view a tour as a notebook

## v0.0.22 (04/18/2020)

- New tours are now written to the workspace's `.tours` folder, instead of the `.vscode/tours` folder. Both folders are still valid locations for tours, but the former sets up CodeTour to be more editor-agnostic (e.g. adding a Visual Studio client)
- New tours are now written using a `.tour` extension (instead of `.json`). Both formats are still supported, but `.tour` will be the new default.

## v0.0.21 (04/10/2020)

- Added the `CodeTour: Open Tour URL...` command, that allows opening a tour file by URL, in addition to the existing `CodeTour: Open Tour File...` command.

## v0.0.20 (04/08/2020)

- Introduced support for embedding shell commands in a tour step (e.g. `>> npm run compile`), which allows you to add more interactivity to a tour.
- Added support for including VS Code `command:` links within your tour step comments (e.g. `[Start Tour](command:codetour.startTour)`), in order to automate arbitrary workbench actions.
- Tours can now be organized within sub-directories of the `.vscode/tours` directory, and can now also be places withtin a root-level `.tours` folder.
- Added the `exportTour` to the API that is exposed by this extension

## v0.0.19 (04/06/2020)

- Added support for recording and playing tours within a multi-root workspace
- Added support for recording steps that reference files outside of the currently opened workspace. _Note: This should only be done if the file is outside of the workspace, but still within the same git repo. Otherwise, the tour wouldn't be "stable" for people who clone the repo and try to replay it._
- The `CodeTour` tree now auto-refreshes when you add/remove folders to the current workspace.
- Fixed an issue with "tour markers" being duplicated
- Fixed an issue with replaying tours that were associated with a Git tag ref

## v0.0.18 (04/02/2020)

- Updated the VS Code version dependency to `1.40.0` (instead of `1.42.0`).
- Removed the dependency on the built-in Git extension, to ensure that recording/playback is more reliable.

## v0.0.17 (03/31/2020)

- Introduced "tour markers", which display a gutter icon next to lines of code which are associated with a step in a code tour.

## v0.0.16 (03/30/2020)

- Updated the `CodeTour` tree to display the currently active tour, regardless how it was started (e.g. you open a tour file).

## v0.0.15 (03/29/2020)

- Updated the `CodeTour` tree to only display if the currently open workspace has any tours, or if the user is currently taking a tour. That way, it isn't obtrusive to users that aren't currently using it.
- Updated the `CodeTour: Refresh Tours` command to only show up when the currently opened workspace has any tours.

## v0.0.14 (03/26/2020)

- Added the `Export Tour` command to the `CodeTour` tree, which allows exporting a recorded tour that embeds the file contents needed to play it back
- Added the ability to open a code tour file, either via the `CodeTour: Open Tour File...` command or by clicking the `Open Tour File...` button in the title bar of the `CodeTour` view
- Added support for tour steps to omit a line number, which results in the step description being displayed at the bottom of the associated file

## v0.0.13 (03/23/2020)

- Exposed an experimental API for other extensions to record/playback tours. For an example, see the [GistPad](https://aka.ms/gistpad) extension, which now allows you to create tours associated with interactive web playgrounds

## v0.0.12 (03/21/2020)

- Added a new `Edit Step` command to the `CodeTour` tree, which allows you to start editing a tour at a specific step
- Updated the `CodeTour` tree to only show the move step up/down commands while you're actively recording that step

## v0.0.11 (03/16/2020)

- Updated the `CodeTour` tree to auto-select tree node that is associated with the currently viewing tour step
- Text highlights can now be edited when editing a tour code
- Added support for collapsing all nodes in the `CodeTour` tree
- Added a prompt when trying to record a tour, using a title that is already in use by an existing tour

## v0.0.10 (03/16/2020)

- Introduced support for step titles, which allow defining friendly names for a tour's steps in the `CodeTour` tree
- Exposed an extension API, so that other VS Code extensions (e.g. [GistPad](https://aka.ms/gistpad)) can start and end tours that they manage
- Added the `CodeTour: Edit Tour` command, that allows you to edit the tour you're currently playing.

## v0.0.9 (03/15/2020)

- Added the ability to record a text selection as part of a step

  ![Selection](https://user-images.githubusercontent.com/116461/76705627-b96cc280-669e-11ea-982a-d754c4f001aa.gif)

## v0.0.8 (03/14/2020)

- Added the ability to associate a tour with a specific Git tag and/or commit, in order to enable it to be resilient to code changes
- Updated the tour recorder so that tours are automatically saved upon creation, and on each step/change

## v0.0.7 (03/14/2020)

- Added the `Edit Tour` command to tour nodes in the `CodeTour` tree, in order to allow editing existing tours
- Added the `Move Up` and `Move Down` commands to tour step nodes in the `CodeTour` tree, in order to allow re-arranging steps in a tour
- Added the `Delete Step` command to tour step nodes in the `CodeTour` tree
- Added the ability to insert a step after the current step, as opposed to always at the end of the tour
- Updated the workspace tour notification to display when any tours are available, not just a "main tour"

## v0.0.6 (03/13/2020)

- Added the `'Resume Tour`, `End Tour`, `Change Title`, `Change Description` and `Delete Tour` commands to the `Code Tours` tree view to enable easily managing existing tours
- Added the `Code Tour: End Tour` command to the command palette

## v0.0.5 (03/09/2020)

- Added an icon to the `Code Tours` tree view which indicates the currently active tour
- Added support for creating/replaying tours when connected to a remote environment (thanks @alefragnani!)

## v0.0.4 (03/09/2020)

- Added the save/end tour commands to the `Code Tours` tree view
- The tour file name is now auto-generated based on the specified title

## v0.0.3 (03/08/2020)

- Fixed a bug where recorded tours didn't always save properly on Windows

## v0.0.2 (03/08/2020)

- Added keyboard shortcuts for navigating an active code tour
- Changed the `Code Tours` view to always display, even if the current workspace doesn't have any tours. That way, there's a simple entry point for recording new tours

## v0.0.1 (03/08/2020)

- Initial release 🎉
