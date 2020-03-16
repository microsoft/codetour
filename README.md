# CodeTour 🗺️

CodeTour is a Visual Studio Code extension, which allows you to record and playback guided walkthroughs of your codebases. It's like a virtual brownbag, that can make it easier to onboard (or reboard!) to a new project/feature area, visualize bug reports, or understand the context of a code review/PR change. A "code tour" is simply a series of interactive steps, each of which are associated with a specific file/line, and include a description of the respective code. This allows developers to clone a repo, and then immediately start **learning it**, without needing to refer to a `CONTRIBUTING.md` file and/or rely on help from others.

<img width="800px" src="https://user-images.githubusercontent.com/116461/76165260-c6c00500-6112-11ea-9cda-0a6cb9b72e8f.gif" />

## Starting a tour

In order to start a tour, simply open up a codebase that has one or more tours. If this is the first time you've ever opened this codebase, you'll be presented with a toast notification asking if you'd like to take a tour of it.

<img width="400px" src="https://user-images.githubusercontent.com/116461/76691619-d0ada080-6609-11ea-81bf-c1f022dbff43.png" />

Otherwise, you can manually start a tour via any of the following methods:

1. Clicking the `> Start CodeTour` button in the [status bar](#status-bar)
2. Selecting a tour (or specific step) in the [`CodeTour` view](#tree-view) in the `Explorer` activity tab

   <img width="250px" src="https://user-images.githubusercontent.com/116461/76164362-8610bd80-610b-11ea-9621-4ba2d47a8a52.png" />

3. Running the `CodeTour: Start Tour` [command](#contributed-commands), and selecting the tour you'd like to take

<img width="800px" src="https://user-images.githubusercontent.com/116461/76151694-7b531b80-606c-11ea-96a6-0655eb6ab4e6.gif" />

If the current workspace only has a single code tour, then any of the above actions will automatically start that tour. Otherwise, you'll be presented with a list of tours to select from.

## Navigating a tour

Once you've started a tour, the comment UI will guide you, and includes navigation actions that allow you to perform the following:

- `Move Previous` - Navigate back to the previous step in the current tour
- `Move Next` - Navigate to the next step in the current tour
- `Edit Tour` - Begin editing the current tour (see [authoring](#authoring-tours) for details)
- `End Tour` - End the current tour and remove the comment UI

Additionally, you can use the `ctrl+right` / `ctrl+left` (Windows/Linux) and `cmd+right` / `cmd+left` (macOS) keyboard shortcuts to move forwards and backwards in the tour. When you're actively in a code tour, the status bar will also display the title and current step of the tour.

<img width="500px" src="https://user-images.githubusercontent.com/116461/76151723-ca00b580-606c-11ea-9bd5-81c1d9352cef.png" />

If you navigate away from the current step and need to resume, you can do that via any of the following actions:

- Right-clicking the active tour in the `CodeTours` tree and selecting `Resume Tour`
- Clicking the `CodeTour` status bar item
- Running the `CodeTour: Resume Tour` command in the command palette

At any time, you can end the current code tour by means of one of the following actions:

- Click the stop button (the red square) in the current step comment
- Click the stop button next to the active tour in the `CodeTour` tree
- Running the `CodeTour: End Tour` command in the command palette

## Authoring tours

If you'd like to create a code tour for your codebase, you can simply click the `+` button in the `CodeTours` tree view and/or run the `CodeTour: Record Tour` command. This will start the "tour recorder", which allows you to begin opening files, clicking the "comment bar" for the line you want to annotate, and then adding the respective description (including markdown!). Add as many steps as you want, and then when done, click the save icon in the comment UI to write the tour to the currently opened workspace.

While you're recording, the `CodeTour` [tree view](#tree-view) will display the currently recorded tour, and it's current set of steps. You can tell which tour is being recorded because it will have a microphone icon to the left of its name.

<img width="800px" src="https://user-images.githubusercontent.com/116461/76165260-c6c00500-6112-11ea-9cda-0a6cb9b72e8f.gif" />

If you need to edit or delete a step while recording, click the `...` menu next to the step's description, and select the appropriate action.

<img width="500px" src="https://user-images.githubusercontent.com/116461/76168548-1f50cb80-612e-11ea-9aca-8598b9e1c730.png" />

### Step titles

By default, the `CodeTour` tree displays each tour step using the following display name format: `#<stepNumber> - <filePath>`. However, if you'd like to give the step a more friendly name, you can edit the step's description and add a markdown heading to the top of it, using whichever heading level you prefer (e.g. `#`, `##`, etc.). For example, if you add a step whose description starts with `### Activation, the step and tree view would look like the following:

<img width="500px" src="https://user-images.githubusercontent.com/116461/76721235-91ac4780-66fc-11ea-80bf-f6de8bf4b02e.png" />

While you can any heading leve for the step title, we'd recommend using `###` or "lower" (e.g. `####`), since that provides a nice look within the step's comment UI.

> If you'd like to add step titles to a tour, but don't want to add markdown headings to their descriptions, you can manually set the `title` property for each step in the tour's underlying `JSON` file (which can be found in the `.vscode/tours` directory). See [tour schema](#tour-schema) for more detials.

### Recording text selection

By default, each step is associated with the line of code you created the comment on (i.e. the line you clicked the `+` on the comment bar for). However, if you want to call out a specific span of code as part of the step, simply highlight the code before you add the step (clicking the `Add Tour to Step` button), and the selection will be captured as part of the step.

<img width="800px" src="https://user-images.githubusercontent.com/116461/76705627-b96cc280-669e-11ea-982a-d754c4f001aa.gif" />

### Re-arranging steps

While you're recording a tour, each new step that you add will be appended to the end of the tour. However, you can move existing steps up and down in the order by performing one of the following actions:

- Hover over the step in the `CodeTour` tree and click the up/down arrow icon
- Right-click the step in the `CodeTour` tree and select the `Move Up` or `Move Down` menu items
- Click the `...` menu in the step comment UI and select `Move Up` or `Move Down`

Additionally, if you want to add a new step in the middle of a tour, simply navigate to the step that you want to insert a new step after, and then create the new step.

### Deleting steps

If you no longer need a specific step in a tour, you can delete it by means of one of the following actions:

- Right-clicking the step in the `CodeTour` tree and selecting `Delete Step`
- Navigating to the step in the replay/comment UI, selecting the `...` menu next to the comment description and selecting `Delete Step`

### Editing a tour

If you want to edit an existing tour, simply right-click the tour in the `CodeTour` tree and select `Edit Tour`. Alternatively, you can edit a tour you're actively viewing by clicking the pencil icon in the current step's comment bar, or running the `CodeTour: Edit Tour` command.

At any time, you can right-click a tour in the `CodeTour` tree and change it's title, description or git ref, by selecting the `Change Title`, `Change Description` or `Change Git Ref` menu items. Additionally, you can delete a tour by right-clicking it in the `CodeTour` tree and seelcting `Delete Tour`.

### Versioning tours

When you record a tour, you'll be asked which git "ref" to associate it with. This allows you to define how resilient you want the tour to be, as changes are made to the respective codebase.

<img width="600px" src="https://user-images.githubusercontent.com/116461/76692462-3f8ff700-6614-11ea-88a1-6fbded8e8507.png" />

You can choose to associate with the tour with the following ref types:

- `None` - The tour isn't associated with any ref, and therefore, the file/line numbers in the tour might get out of sync over time. The benefit of this option is that it enables the code to be edited as part of the tour, since the tour will walk the user through whichever branch/commit they have checked out.
- `Current Branch` - The tour is restricted to the current branch. This can have the same resiliency challenges as `None`, but, it allows you to maintain a special branch for your tours that can be versioned seperately. If the end-user has the associated branch checked out, then the tour will enable them to make edits to files as its taken. Otherwise, the tour will replay with read-only files.
- `Current Commit` - The tour is restricted to the current commit, and therefore, will never get out of sync. If the end-user's `HEAD` points at the specified commit, then the tour will enable them to make edits to files as its taken. Otherwise, the tour will replay with read-only files.
- Tags - The tour is restricted to the selected tag, and therefore, will never get out of sync. The repo's entire list of tags will be displayed, which allows you to easily select one.

At any time, you can edit the tour's ref by right-clicking it in the `CodeTour` tree and selecting `Change Git Ref`. This let's you "rebase" a tour to a tag/commit as you change/update your code and/or codebase.

### Tour Files

Behind the scenes, the tour will be written as a JSON file to the `.vscode/tours` directory of the current workspace. This file is pretty simple and can be hand-edited if you'd like. Additionally, you can manually create tour files, by following the [tour schema](#tour-schema). You can then store these files to the `.vscode/tours` directory, or you can also create a tour at any of the following locations:

- `codetour.json`
- `tour.json`
- `.vscode/codetour.json`
- `.vscode/tour.json`

### Tour Schema

Within the tour file, you need to specify the following required properties:

- `title` - The display name of the tour, which will be shown in the `CodeTour` tree view, quick pick, etc.
- `description` - An optional description for the tour, which will be shown as the tooltip for the tour in the `CodeTour` tree view
- `ref` - An optional "git ref" (branch/tag/commit) that this tour applies to. See [versioning tours](#versioning-tours) for more details.
- `steps` - An array of tour steps
  - `file` - The file path (relative to the workspace root) that this step is associated with
  - `uri` - An absolute URI that this step is associated with. Note that `uri` and `file` are mutually exclusive, so only set one per step
  - `line` - The 1-based line number that this step is associated with
  - `title` - An optional title, which will be displayed as the step name in the `CodeTour` tree view.
  - `description` - The text which explains the current file/line number, and can include plain text and markdown syntax

For an example, refer to the `.vscode/tour.json` file of this repository.

## Tree View

If the currently opened workspace has any code tours, you'll see a new tree view called `CodeTour`, that's added to the `Explorer` tab. This view simply lists the set of available code tours, along with their title and number of steps. If you select a tour it will start it, and therefore, this is simply a more convenient alternative to running the `CodeTour: Start Tour` command. However, you can also expand a tour and start it at a specific step.

<img width="250px" src="https://user-images.githubusercontent.com/116461/76164362-8610bd80-610b-11ea-9621-4ba2d47a8a52.png" />

Additionally, the tree view will display the tour currently being [recorded](#authoring-tours), which makes it easy to track your status while in the process of creating a new tour.

> The tree view is automatically kept up to date, as you add/edit/delete tours within the current workspace. So feel free to [record](#authoring-tours) and/or edit tours, and then navigate them when done.

## Status Bar

In addition to the `CodeTour` tree view, this extension also contributes a new status bar item called `Start CodeTour` to your status bar. It's only visible when the current workspace has one or more tours, and when clicked, it allows you to select a tour and then begin navigating it.

While you're within a tour, the status bar will update to show the title and step of the current tour. When clicked, it will open the file/line of the current tour step, which allows you to open other files while taking a tour, and then resumse the tour when ready. Once you end the current tour, the status bar will transition back to displaying the `Start CodeTour` button.

> If you don't want this status bar item, simply right-click it and select `Hide CodeTour (Extension)`.

## Contributed Commands

In addition to the `CodeTour` tree view and the status bar item, the Code Tour extension also contributes the following commands to the command palette:

- `CodeTour: Start Tour` - Starts a tour for the currently opened workspace. This command is only visible if the current workspace actually has one or more code tours.

- `CodeTour: Record Tour` - Starts the tour recorder, which allows you to create a new tour by creating a sequence of steps.

- `CodeTour: Refresh Tours` - Refreshes the `Code Tours` view, which can be handy if you'd created/modified/deleted tour files on disk.

- `CodeTour: Edit Tour` - Puts the currently active tour into edit more. This command is only visible while you're actively playing a tour, that you're not already editing.
-
- `CodeTour: End Tour` - Ends the currently active tour. This command is only visible while you're actively recording/playing a tour.
-
- `CodeTour: Resume Current Tour` - Resumse the current tour by navigating to the file/line number that's associated with the current step. This command is only visible while you're actively recording/playing a tour.

## Keybindings

In addition to the available commands, the Code Tour extension also contributes the following commands, which are active while you're currently taking a tour:

- `ctrl+right` (Windows/Linux), `cmd+right` (macOS) - Move to the next step in the tour
- `ctrl+left` (Windows/Linux) `cmd+left` (macOS) - Move to the previous step in the tour
