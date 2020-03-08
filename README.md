# Code Tour 🗺️

Code Tour is a Visual Studio Code extension, which allows you to record and playback guided walkthroughs of your codebases. It's like a virtual brownbag, that can make it easier to onboard to a new project/feature area, visualize bug reports, or understand the context of a code review/PR change. A "code tour" is simply a series of interactive steps, each of which are associated with a specific file/line, and include a description of the respective code. This allows developers to clone a repo, and then immediately start **learning it**, without needing to refer to a `CONTRIBUTING.md` file and/or rely on help from others.

<img width="800px" src="https://user-images.githubusercontent.com/116461/76151694-7b531b80-606c-11ea-96a6-0655eb6ab4e6.gif" />

## Starting a tour

In order to start a tour, simply open up a codebase that has one or more tours. If this is the first time you've ever opened this codebase, then you'll be presented with a toast notification asking if you'd like to take a tour of it. Otherwise, you can manually start a tour via any of the following methods:

1. Clicking the `> Start Code Tour` button in the [status bar](#status-bar)
1. Selecting on a tour (or specific step) in the [`Code Tours` view](#tree-view) in the `Explorer` activity tab

   <img width="250px" src="https://user-images.githubusercontent.com/116461/76164362-8610bd80-610b-11ea-9621-4ba2d47a8a52.png" />

1. Running the `Code Tour: Start Tour` [command](#contributed-commands), and selecting the tour you'd like to take

If the current workspace only has a single code tour, then any of the above actions will automatically start that tour. Otherwise, you'll be presented with a list of tours to select from.

## Navigating a tour

Once you've started a tour, the comment UI will guide you, and includes navigation actions that allow you to perform the following:

- `Previous` - Navigate back to the previous step in the current tour
- `Next` - Navigate to the next step in the current tour
- `End Tour` - End the current tour and remove the comment UI

When you're actively in a code tour, the status bar will also display the title and current step of the tour. If you navigate away from the active tour step, you can click on the status bar item and resume the tour at any time.

<img width="500px" src="https://user-images.githubusercontent.com/116461/76151723-ca00b580-606c-11ea-9bd5-81c1d9352cef.png" />

## Authoring tours

If you'd like to create a code tour for your codebase, you can simply click the `+` button in the `Code Tours` tree view and/or run the `Code Tour: Record Tour` command. This will start the "tour recorder", which allows you to begin opening files, clicking the "comment bar" for the line you want to annotate, and then adding the respective description (including markdown!). Add as many steps as you want, and then when done, click the save icon in the comment UI to write the tour to the current project.

While you're recording, the `Code Tours` [tree view](#tree-view) will display the currently recorded tour, and it's current set of steps. You can tell which tour is being recorded because it will have a microphone icon to the left of its name. 

<img width="800px" src="https://user-images.githubusercontent.com/116461/76155936-fab21080-60a7-11ea-8417-a74078459b7a.gif" />

Behind the scenes, the tour will be written as a JSON file to the `.vscode/tours` directory of the current workspace. This file is pretty simple and can be hand-edited if you'd like. Additionally, you can manually create tour files, by following the [tour schema](#tour-schema). You can then store these files to the `.vscode/tours` directory, or you can also create a tour at any of the following locations:

- `codetour.json`
- `tour.json`
- `.vscode/codetour.json`
- `.vscode/tour.json`

### Tour Schema

Within the tour file, you need to specify the following required properties:

- `title` - The display name of the tour, which will be shown in the `Code Tours` tree view, quick pick, etc.
- `description` - An optional description for the tour
- `steps` - An array of tour steps
  - `file` - The file path (relative to the workspace root) that this step is associated with
  - `uri` - An absolute URI that this step is associated with. Note that `uri` and `file` are mutually exclusive, so only set one per step
  - `line` - The 1-based line number that this step is associated with
  - `description` - The text which explains the current file/line number, and can include plain text and markdown syntax

For an example, refer to the `.vscode/tour.json` file of this repository.

## Tree View

If the currently opened workspace has any code tours, you'll see a new tree view called `Code Tours`, that's added to the `Explorer` tab. This view simply lists the set of available code tours, along with their title and number of steps. If you select a tour it will start it, and therefore, this is simply a more convenient alternative to running the `Code Tour: Start Tour` command. However, you can also expand a tour and start it at a specific step.

<img width="250px" src="https://user-images.githubusercontent.com/116461/76164362-8610bd80-610b-11ea-9621-4ba2d47a8a52.png" />

Additionally, the tree view will display the tour currently being [recorded](#authoring-tours), which makes it easy to track your status while in the process of creating a new tour.

> The tree view is automatically kept up to date, as you add/edit/delete tours within the current workspace. So feel free to [record](#authoring-tours) and/or edit tours, and then navigate them when done.

## Status Bar

In addition to the `Code Tours` tree view, this extension also contributes a new status bar item called `Start Code Tour` to your status bar. It's only visible when the current workspace has one or more tours, and when clicked, it allows you to select a tour and then begin navigating it.

While you're within a tour, the status bar will update to show the title and step of the current tour. When clicked, it will open the file/line of the current tour step, which allows you to open other files while taking a tour, and then resumse the tour when ready. Once you end the current tour, the status bar will transition back to displaying the `Start Code Tour` button.

> If you don't want this status bar item, simply right-click it and select `Hide Code Tour (Extension)`.

## Contributed Commands

In addition to the `Code Tours` tree view and the status bar item, the Code Tour extension also contributes the following commands to the command palette:

- `Code Tour: Start Tour` - Starts a tour for the currently opened workspace. This command is only visible if the current workspace actually has one or more code tours.

- `Code Tour: Record Tour` - Starts the tour recorder, which allows you to create a new tour by creating a sequence of steps.

- `Code Tour: Refresh Tours` - Refreshes the `Code Tours` view, which can be handy if you'd created/modified/deleted tour files on disk.

- `Code Tour: Resume Current Tour` - Resumse the current tour by navigating to the file/line number that's associated with the current step.
