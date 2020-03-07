# Code Tour 🗺️

Code Tour is a Visual Studio Code extension, which allows you to take guided walkthroughs of a codebase, in order to make it easier to onboard and/or learn new parts of it. A "code tour" is simply a series of inline comments, each of which are associated with a specific file/line, and include a description of the respective code. The end user can start/stop tours at any time, and navigate the current tour at their own pace.

## Starting a tour

In order to start a tour, simply open up a codebase that has one or more tours. If this is the first time you've ever opened this codebase, then you'll be presented with a toast notification, asking if you'd like to take a tour of it. Otherwise, you can manually start a tour via any of the following methods:

1. Clicking the `Start Code Tour` button in the status bar
1. Selecting on a tour in the `Code Tours` view in the `Explorer` tab
1. Running the `Code Tour: Start Tour` command, and selecting the tour you'd like to take

If the current workspace only has a single code tour, then any of the above actions will automatically start the tour. Otherwise, you'll be presented with a list of tours to select from.

## Navigating a tour

Once you've started a tour, the comment UI includes navigation actions that allow you to perform the following:

- `Previous` - Navigate back to the previous step in the current tour
- `Next` - Navigate to the next step in the current tour
- `End Tour` - End the current tour and remove the comment UI

When you're actively in a code tour, the status bar will also display the title and current step of the tour. If you navigate away from the active tour step, you can click on the status bar item and resume the tour at any time.

## Authoring tours

If you'd like to create a code tour for your codebase, you can simply create a file in your repo, at one of the following locations:

- `codetour.json`
- `tour.json`
- `.vscode/codetour.json`
- `.vscode/tour.json`

> Note that only one of the above will be respected, in the aforementioned order of resolution. If you'd like to have multiple tours for your codebase, then read the following section on [sub-tours](#sub-tours).

### Sub-tours

In addition to your repo's "main tour", you can also create one or more "sub-tours", by creating a directory called `.vscode/tours`, which includes any number of `*.json` files (whose actual name is irrelevant).

### Tour Schema

Within the tour file, you need to specify the following required properties:

- `title` - The display name of the tour, which will be shown in the `Code Tours` tree view, quick pick, etc.
- `steps` - An array of tour steps
  - `file` - The file path (relative to the workspace root) that this step is associated with
  - `uri` - An absolute URI that this step is associated with. Note that `uri` and `file` are mutually exclusive, so only set one per step
  - `line` - The line number that this step is associated with
  - `description` - The text which explains the current file/line number, and can include plain text and markdown syntax

For an example, refer to the `.vscode/tour.json` file of this repository.

## Status Bar

After installing the Code Tour extension, it will detect whether the currently opened workspace has any code tours, and if so, it will add a new status bar item called `Start Code Tour` to your status bar. When you click it, it will allow you to select a tour and then begin navigating it.

While you're within a tour, the status bar will update to show the title and step of the current tour. When clicked, it will open the file/line of the current tour step, which allows you to open other files while taking a tour, and then resumse the tour when ready. Once you end the current tour, the status bar will transition back to displaying the `Start Code Tour` button.

> If you don't want this status bar item, simply right-click it and select `Hide Code Tour (Extension)`.

## Contributed Commands

In addition to the `Code Tours` tree view and the status bar item, the Code Tour extension also contributes the following commands to the command palette:

- `Code Tour: Start Tour` - Starts a tour for the currently opened workspace. This command is only visible if the current workspace actually has one or more code tours.

- `Code Tour: Resume Current Tour` - Resumse the current tour by navigating to the file/line number that's associated with the current step.
