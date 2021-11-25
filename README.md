# CodeTour 🗺️

CodeTour is a Visual Studio Code extension, which allows you to record and play back guided walkthroughs of your codebases. It's like a table of contents, that can make it easier to onboard (or re-board!) to a new project/feature area, visualize bug reports, or understand the context of a code review/PR change. A "code tour" is simply a series of interactive steps, each of which are associated with a specific directory, or file/line, and include a description of the respective code. This allows developers to clone a repo, and then immediately start **learning it**, without needing to refer to a `CONTRIBUTING.md` file and/or rely on help from others. Tours can either be checked into a repo, to enable sharing with other contributors, or [exported](#exporting-tours) to a "tour file", which allows anyone to replay the same tour, without having to clone any code to do it!

<img width="800px" src="https://user-images.githubusercontent.com/116461/76165260-c6c00500-6112-11ea-9cda-0a6cb9b72e8f.gif" />

## Getting Started

In order to get started, install the [CodeTour extension](https://aka.ms/codetour), and then following one of the following guides, depending on whether you want to record or play back a tour:

- [Recording Tours](#recording-tours)
- [Exporting Tours](#exporting-tours)
- [Starting Tours](#starting-tours)
- [Navigating Tours](#navigating-tours)
- [Maintaining Tours](#maintaining-tours)
- [Reference](#reference)

## Recording Tours

If you'd like to record a code tour for your codebase, you can simply click the `+` button in the `CodeTour` tree view (if it's visible) and/or run the `CodeTour: Record Tour` command. This will start the tour recorder, which allows you to begin opening files, clicking the "comment bar" for the line you want to annotate, and then adding the respective description (including markdown!). Add as many steps as you want, and then when done, simply click the stop tour action (the red square button). You can also create [directory steps](#directory-steps), [selection steps](#text-selection), or [content steps](#content-steps) in order to add an introductory or intermediate explanations to a tour.

While you're recording, the `CodeTour` [tree view](#tree-view) will display the currently recorded tour, and it's current set of steps. You can tell which tour is being recorded because it will have a microphone icon to the left of its name.

<img width="800px" src="https://user-images.githubusercontent.com/116461/76165260-c6c00500-6112-11ea-9cda-0a6cb9b72e8f.gif" />

If you need to edit or delete a step while recording, click the `...` menu next to the step's description, and select the appropriate action. Alternatively, you can edit/delete steps from the CodeTour [tree view](#tree-view).

<img width="500px" src="https://user-images.githubusercontent.com/116461/76168548-1f50cb80-612e-11ea-9aca-8598b9e1c730.png" />

### Workspaces

If you record a tour within a "multi-root workspace", you'll be asked to select the folder that you'd like to save the tour to. This is necessary because tours are written as [files](#tour-files) to your workspace, and so we need to disambiguate which folder the tour should be persisted to. That said, when you're recording a tour, you can add steps that span any of the folders within the workspace, which allows you to create tours for a specific folder and/or that demonstrate concepts across multiple folders within the workspace.

### Step Titles

By default, the `CodeTour` tree displays each tour step using the following display name format: `#<stepNumber> - <filePath>`. However, if you'd like to give the step a more friendly/recognizeable name, you can do so using one of the following methods:

1. Right-click the step in the `CodeTour` tree and select `Change Title`
1. Edit the step's description and add a markdown heading to the top of it, using whichever heading level you prefer (e.g. `#`, `##`, etc.). For example, if you add a step whose description starts with `### Activation`, the step and tree view would look like the following:

  <img width="500px" src="https://user-images.githubusercontent.com/116461/76721235-91ac4780-66fc-11ea-80bf-f6de8bf4b02e.png" />

### Text Selection

By default, each step is associated with the line of code you created the comment on (i.e. the line you clicked the `+` on the comment bar for). However, if you want to call out a specific span of code as part of the step, simply highlight the code before you add the step (clicking the `Add Tour to Step` button), and the selection will be captured as part of the step.

<img width="800px" src="https://user-images.githubusercontent.com/116461/76705627-b96cc280-669e-11ea-982a-d754c4f001aa.gif" />

If you need to tweak the selection that's associated with a step, simply edit the step, reset the selection and then save it. Furthermore, if you want to create a step from a selection, simply highlight a span a code, right-click the editor and select `Add CodeTour Step`.

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

If you need to delete multiple steps, the `CodeTour` tree supports multi-select, so you can `Cmd+click` (macOS) / `Ctrl+click` (Windows/Linux) multiple step nodes, and then right-click them and select `Delete Step`.

### Editing a tour

If you want to edit an existing tour, simply right-click the tour in the `CodeTour` tree and select `Edit Tour`. Alternatively, you can edit a tour you're actively viewing by clicking the pencil icon in the current step's comment bar, or running the `CodeTour: Edit Tour` command.

At any time, you can right-click a tour in the `CodeTour` tree and change it's title, description or git ref, by selecting the `Change Title`, `Change Description` or `Change Git Ref` menu items. Additionally, you can delete a tour by right-clicking it in the `CodeTour` tree and selecting `Delete Tour`.

### Linking Tours

If you want to create a series of tours, that a user can navigate through in sequence, then simply prefix your tour title's with the number they represent in the tour order (e.g. `1: Foo`, `2 - Bar`). When your tours are titled like this, the tour player will automatically provide the following benefis to your readers:

1. If the current tour has a subsequent tour, then it's final step will display a `Next Tour` link instead of the `Finish Tour` link. This allows users to easily jump to the next tour.

1. If the current tour has a previous tour, then it's first step will display a `Previous Tour` link. This allows users to navigate back to the tour they might have just navigated from.

> _If you don't want to number your tours like this, but you'd still link to link one tour to another, you can open it's `*.tour` file and set the `nextTour` property to the title of the tour you'd like it to link to._

### Primary Tours

A codebase can include one or more tours, but it might have a primary tour, that is intended for new developers to start with. This way, when they open the codebase for the first time, they can be immediately presented with this tour, as opposed to a list of all tours.

In order to mark a specific tour as the primary tour, simply right-click it in the `CodeTour` tree, and select `Make Primary`. When you mark a tour as primary, any other tours that were marked as primary, will be updated to remove that annotation. Additionally, if you want to manually unmark a tour as being the primary tour, you can right-click it and select `Unmake Primary`.

If you'd prefer to number your tours (e.g. `1 - Status Bar`), then a tour whose title starts with either `#1 - ` or `1 - ` will be automatically considered the primary tour, and you don't need to do anything further.

### Conditional Tours

If you author a tour that isn't relevant to every developer on the team, then you can decide when to conditionally show it in the `CodeTour` tree by adding a `when` property to the respective `*.tour` file. This property expects a JavaScript expression, that will determine the visibility of the tour, based on whether it evaluates to `true` or `false`. By default, all tours are displayed, and therefore, only tours with a `when` property that evaluate to `false` will be hidden.

In order to simplify the process of defining conditional tours, the following variables are made available to your `when` clause:

- `isLinux` - The current user is running on Linux
- `isMac` - The current user is running on macoS
- `isWindows` - The current user is running on Windows

For example, if you want to define a tour that is only displayed for Linux users, you can simply set the `when` property to `"isLinux"`.

### CodeTour-Flavored Markdown

When you describe a step, you're able to use the full-breadth of markdown capabilities in order to write rich/compelling content (e.g. images, links, headings, code fences). However, CodeTour also provides some additional syntactic features that allow you to include additional interactivity to your tours:

#### File References

If you want a step to reference a file in the workspace, you can add a markdown link to it, using a workspace-relative path. For example, adding `[Open file](./file.html)` to your step content, would add a hyperlink called `Open file`, that when clicked, would open the `./file.html` file.

Additionally, you can reference local images in a step as well, using a markdown reference. For example, adding `![Image](./icon.png)` would render the `icon.png` in the step.

#### Step References

If you want to add a reference to another step within the current tour, you can use markdown's "link reference" syntax, specifying the 1-based number of the step to navigate to, prefixed by a `#` character (e.g. `[#2]`, or `[#23]`). This reference will be automatically rendered as a hyperlink, that when clicked, will navigate the end-user to that step. The text of the link will default to `#<stepNumber>`, but you can customize that by appending a title to the link reference (e.g. `[title][#2]).

> This syntax is a simplified version of using the `Navigate to tour step` [command link](#command-links) manually.

#### Tour References

If you want to reference an entirely seperate tour, then you can create a link reference, that specifies the title of the tour (e.g. `[Tree View]`). This will be rendered as a hyperlink, that when clicked, will navigate the end-user to that tour, starting on step #1. If you'd like to navigate the user to a specific step in the tour, you can append the step number after the tour title, seperated by a `#` (e.g. `[Tree View#3]`). The text of the link will be rendered as `<tourTitle>`, but you can customize that by appending a title to the link reference (e.g. `[title][Tree View]`).

> This syntax is a simplified version of using the `Start tour` [command link](#command-links) instead.

#### Code Blocks

If you add a markdown code block to a step's body content, then the CodeTour player will render an `Insert Code` link below it, which allows the viewer to automatically insert the code snippet into the current file, at the line that the step is associated with. This can make it easy to use CodeTour for creating interactive tutorials or samples.

<img width="600px" src="https://user-images.githubusercontent.com/116461/98431597-bb3f2800-206b-11eb-8f46-55f48ff014ef.gif" />

> Note: The code snippet will be formatted after inserting it into the document, and therefore, you don't need to worry about adding whitespace/etc. to the snippet itself.

#### Shell Commands

To make it simpler to embed shell commands into a step (e.g. to perform a build, run tests, start an app), CodeTour supports a special `>>` synax, followed by the shell command you want to run (e.g. `>> npm run compile`). This will be converted into a hyperlink, that when clicked, will launch a new integrated terminal (called `CodeTour`) and will run the specified command.

<img width="600px" src="https://user-images.githubusercontent.com/116461/78858896-91912600-79e2-11ea-8002-196c12273ebc.gif" />

#### Command Links

In order to add more interactivity to a tour, you can include "command links" to a step's description. Command links are simply markdown links, that use the `command:` scheme (instead of `http:` / `https:`), and specify the name of a VS Code command, along with an optional query string that includes the needed command arguments. Using this syntax, you can call any command in VS Code, including both built-in commands (e.g. `vscode.open`), as well as commands that are contributed by extensions (e.g. `codetour.startTour`). For example, the following shows how to include commands with and without arguments.

```markdown
<!-- Call a command that doesn't require arguments-->

[Start tour](command:codetour.startTour)

<!-- Call a command that requires arguments-->

[Open URL](command:vscode.open?["https://aka.ms/codetour"])
```

##### Well-Known Commands

In order to make it simpler to call common commands, CodeTour will prompt you with a list of well-known commands as soon as you type `command:` in a step comment. If you select an option, it will generates the respective markdown code, and include placeholders for any necessary arguments. The following list explains the set of currently supported well-known commands:

- `Navigate to tour step` - Allows you to specify a tour step, that when clicked, will navigate the end-user to that step in the current tour. This can be useful for giving the end-user the option to skip ahead in the tour, or quickly reference previous steps.

- `Open URL` - Allows you to specify a URL, that when clicked, will launch the end-users default browser, and navigate to it.

- `Run build task` - Allows you to run the build task, as defined by the current workspace's `task.json` file.

* `Run task` - Allows you to specify a workspace task name, that when clicked, will run the specified task as defined by the current workspace's `task.json` file.

- `Run test task` - Allows you to run the butestild task, as defined by the current workspace's `task.json` file.

- `Run terminal command...` - Allows you to specify a shell command (e.g. `npm run package`), that when clicked, will run the specified command in the integrated terminal.

- `Start tour...` - Allows you to specify the title or another tour in the workspace, that when clicked, will automatically start that tour.

### Versioning Tours

When you record a tour, you'll be asked which git "ref" to associate it with. This allows you to define how resilient you want the tour to be, as changes are made to the respective codebase.

<img width="600px" src="https://user-images.githubusercontent.com/116461/76692462-3f8ff700-6614-11ea-88a1-6fbded8e8507.png" />

You can choose to associate with the tour with the following ref types:

- `None` - The tour isn't associated with any ref. The benefit of this option is that it enables the code to be edited as part of the tour, since the tour will walk the user through whichever branch/commit they have checked out (e.g. interactive tutorials).
- `Current Branch` - The tour is restricted to the current branch. This can have the same resiliency challenges as `None`, but, it allows you to maintain a special branch for your tours that can be versioned seperately. If the end-user has the associated branch checked out, then the tour will enable them to make edits to files as its taken. Otherwise, the tour will replay with read-only files.
- `Current Commit` - The tour is restricted to the current commit, and therefore, will never get out of sync. If the end-user's `HEAD` points at the specified commit, then the tour will enable them to make edits to files as its taken. Otherwise, the tour will replay with read-only files.
- Tags - The tour is restricted to the selected tag, and therefore, will never get out of sync. The repo's entire list of tags will be displayed, which allows you to easily select one.

At any time, you can edit the tour's ref by right-clicking it in the `CodeTour` tree and selecting `Change Git Ref`. This let's you "rebase" a tour to a tag/commit as you change/update your code and/or codebase.

### Content Steps

Code tours are primarily meant to describe code, however, when you're recording a tour, it may help to provide some intro explaination about the tour itself. To do this, you can create a "content step", which is a tour step that includes a title and markdown content, but isn't associated with a directory or file. To create a content step, perform one of the following actions:

1. Click the `Add tour step...` node in the `CodeTour` tree, underneath the node that represents your currently recording tour. _Note: This option is only available when the tour doesn't have any steps._
1. Right-click a tour node in the `CodeTour` tree and select `Add Tour Step`. _Note: This option is only available while recording the tour._
1. Run the `CodeTour: Add Tour Step` command.

When you create a content step, you'll be asked for a title of the step (e.g. `Introduction`), and then a "virtual" file will be created with an associated comment that you can edit. This allows the viewer to navigate between steps in a consistent fashion, regardless if the step is associated with a file or not.

### Directory Steps

If you want to call out a directory as part of a tour, then while recording, you can right-click a directory in the `Explorer` tree and select `Add CodeTour Step`. This will create a new step that allows you to add a description for the selected directory. When the tour is played back, the directory will be focused in the `Explorer` tree, and the viewer will be presented with the description in a "virtual" CodeTour document.

### Tour Files

Behind the scenes, the tour will be written as a JSON file to the `.tours` directory of the current workspace. This file is pretty simple and can be hand-edited if you'd like. Additionally, you can manually create tour files, by following the [tour schema](#tour-schema). You can then store these files to the `.tours` (or `.vscode/tours` or `.github/tours`) directory, or you can also create a tour at any of the following well-known locations: `.tour`, `main.tour`, `.vscode/main.tour`.

Within the `.tours` (or `.vscode/tours`) directory, you can organize your tour files into arbitrarily deep sub-directories, and the CodeTour player will properly discover them.

#### Tour Schema

- `title` _(Required)_ - The display name of the tour, which will be shown in the `CodeTour` tree view, quick pick, etc.
- `description` - An optional description for the tour, which will be shown as the tooltip for the tour in the `CodeTour` tree view
- `ref` - An optional "git ref" (branch/tag/commit) that this tour applies to. See [versioning tours](#versioning-tours) for more details.
- `isPrimary` - Indicates that this tour is the primary tour within the workspace that an end-user should be guided through.
- `nextTour` - The title of the tour that this tour is [meant to precede](#linking-tours).
- `when` - Specifies the condition that must be met before this tour is shown. The value of this property is a string that is evaluated as JavaScript.
- `steps` _(Required)_ - An array of tour steps
  - `description` _(Required)_ - The text which explains the current file/line number, and can include plain text and markdown syntax
  - `file` - The file path (relative to the workspace root) that this step is associated with
  - `directory` - The path of a directory (relative to the workspace root) that this step is associated with. _Note: This property takes precedence over the `file` property, and so will "win" if both are present._
  - `uri` - An absolute URI that this step is associated with. Note that `uri` and `file` are mutually exclusive, so only set one per step
  - `line` - The 1-based line number that this step is associated with
  - `pattern` - A regular expression to associate the step with. This is only considered when the `line` property isn't set, and allows you to associate steps with line content as opposed to ordinal.
  - `title` - An optional title, which will be displayed as the step name in the `CodeTour` tree view.
  - `commands` - An array of VS Code command strings, that indicate the name of a command (e.g. `codetour.endTour`) and any optional parameters to pass to it, specified as a query string array (eg. `codetour.endTour?[2]`).
  - `view` - The ID of a VS Code view that will be automatically focused when this step is navigated to.

For an example, refer to the `.tours/tree.tour` file of this repository.

## Exporting Tours

By default, when you record a tour, it is written to the currently open workspace. This makes it easy to check-in the tour and share it with the rest of the team. However, there may be times where you want to record a tour for yourself, or a tour to help explain a one-off to someone, and in those situations, you might not want to check the tour into the repo.

To support this scenario, when you start recording a new tour, you can click the `Save tour as...` button in the upper-right side of the dialog that asks for the title of the tour. This wll allow you to select the file that the new tour will be written to, so that it isn't persisted to the workspace. Furthermore, you can record a tour as usual, and then when done, you can right-click it in the `CodeTour` tree and select `Export Tour...`. This will allow you to save the tour to a new location, and then you can delete the tour file from your repo. When you export a tour, the tour file itself will embed the contents of all files needed by the tour, which ensures that someone can play it back, regardless if the have the respective code available locally. This enables a powerful form of collaboration.

<img width="700px" src="https://user-images.githubusercontent.com/116461/77705325-9682be00-6f7c-11ea-9532-6975b19b8fcb.gif" />

### GitHub Gists

If you install the [GistPad](https://aka.ms/gistpad) extension, then you'll see an additional `Export Tour to Gist...` option added to the `CodeTour` tree. This lets you export the tour file to a new/existing gist, which allows you to easily create your own private tours and/or create tours that can be shared with others on your team.

Once a tour is exported as a gist, you can right-click the `main.tour` file in the `GistPad` tree, and select `Copy GitHub URL`. If you send that to someone, and they run the `CodeTour: Open Tour URL...` command, then they'll be able to take the exact same tour, regardless if they have the code locally available or not.

## Starting Tours

In order to start a tour, simply open up a codebase that has one or more tours. If this is the first time you've ever opened this codebase, you'll be presented with a toast notification asking if you'd like to take a tour of it.

<img width="400px" src="https://user-images.githubusercontent.com/116461/76691619-d0ada080-6609-11ea-81bf-c1f022dbff43.png" />

Otherwise, you can manually start a tour via any of the following methods:

1. Selecting a tour (or specific step) in the [`CodeTour` view](#tree-view) in the `Explorer` activity tab

   <img width="250px" src="https://user-images.githubusercontent.com/116461/76164362-8610bd80-610b-11ea-9621-4ba2d47a8a52.png" />

1. Running the `CodeTour: Start Tour` [command](#contributed-commands), and selecting the tour you'd like to take

   <img width="800px" src="https://user-images.githubusercontent.com/116461/76151694-7b531b80-606c-11ea-96a6-0655eb6ab4e6.gif" />

   If the current workspace only has a single code tour, then this command will automatically start that tour. Otherwise, you'll be presented with a list of tours to select from.

### Opening Tours

In addition to taking tours that are part of the currently open workspace, you can also open a tour file that someone else sent you and/or you created yourself. Simply run the `CodeTour: Open Tour File...` command and/or click the folder icon in the title bar of the `CodeTour` tree view.

> Note: The `CodeTour` tree view only appears if the currently opened workspace has any tours and/or you're currently taking a tour.

Additionally, if someone has [exported](#exporting-tours) a tour, and uploaded it to a publically accessible location, they can send you the URL, and you can open it by running the `CodeTour: Open Tour URL...` command.

### Tour Markers

As you explore a codebase, you might encounter a "tour marker", which displays the CodeTour icon in the file gutter. This indicates that a line of code participates in a tour for the open workspace, which makes it easier to discover tours that might be relevant to what you're currently working on. When you see a marker, simply hover over the line and click the `Start Tour` link in the hover tooltip. This will start the tour that's associated with this line of code, at the specific step.

<img width="800px" src="https://user-images.githubusercontent.com/116461/78101204-9aa74500-739b-11ea-8a1e-dea923910524.gif" />

If you want to disable tour markers, you can perform one of the following actions:

- Run the `CodeTour: Hide Tour Markers` command
- Click the "eye icon" in the title bar of the `CodeTour` tree view
- Set the `codetour.showMarkers` configuration setting to `false`. _Note that the above two actions do this for you automatically._

<!--
### Notebook View

In addition to taking a tour through a series of files, you can also view a tour as a "notebook", which displays the tour's steps within a single document. Simply right-click a tour in the `CodeTour` tree and select `View Notebook`.

<img width="700px" src="https://user-images.githubusercontent.com/116461/79699658-bd63a580-8245-11ea-81cc-6208e2784acf.gif" />

-->

## Navigating Tours

Once you've started a tour, the comment UI will guide you, and includes navigation actions that allow you to perform the following:

- `Move Previous` - Navigate to the previous step in the current tour. This command is visible for step #2 and later.
- `Move Next` - Navigate to the next step in the current tour. This command is visible for all steps but the last one in a tour.
- `Edit Tour` - Begin editing the current tour (see [authoring](#authoring-tours) for details). Note that not all tours are editable, so depending on how you started the tour, you may or may not see this action.
- `End Tour` - End the current tour and remove the comment UI.

<img width="500px" src="https://user-images.githubusercontent.com/116461/76151723-ca00b580-606c-11ea-9bd5-81c1d9352cef.png" />

Additionally, you can use the `ctrl+right` / `ctrl+left` (Windows/Linux) and `cmd+right` / `cmd+left` (macOS) keyboard shortcuts to move forwards and backwards in the tour. The `CodeTour` tree view and status bar is also kept in sync with your current tour/step, to help the developer easily understand where they're at in the context of the broader tour.

<img width="800px" src="https://user-images.githubusercontent.com/116461/76807453-a1319c00-67a1-11ea-9b88-7e448072f33d.gif" />

If you navigate away from the current step and need to resume, you can do that via any of the following actions:

- Right-clicking the active tour in the `CodeTour` tree and selecting `Resume Tour`
- Clicking the `CodeTour` status bar item
- Running the `CodeTour: Resume Tour` command in the command palette

At any time, you can end the current code tour by means of one of the following actions:

- Click the stop button (the red square) in the current step comment
- Click the stop button next to the active tour in the `CodeTour` tree
- Running the `CodeTour: End Tour` command in the command palette

## Maintaining Tours

In order to ensure that your tours stay up-to-date as your codebase evolves, you can install one of the following tasks as part of your CI pipeline, in order to detect "tour drift" in response to PRs/commits/etc.

- [CodeTour Watch](https://github.com/marketplace/actions/codetour-watch) (GitHub Actions)
- [CodeTour Watcher](https://marketplace.visualstudio.com/items?itemName=Sharma.CodeTourWatcher) (Azure Pipelines)

## Reference

The following sections describe the VS Code integrations that the CodeTour extension contributes (e.g. tree, status bar, settings):

### Tree View

If the currently opened workspace has any code tours, or you're actively taking/recording a tour, you'll see a new tree view called `CodeTour`, that's added to the `Explorer` tab. This view simply lists the set of available code tours, along with their title and number of steps. If you select a tour it will start it, and therefore, this is simply a more convenient alternative to running the `CodeTour: Start Tour` command. However, you can also expand a tour and start it at a specific step, edit/delete steps, re-order steps, and change the tour's description/title/git ref.

<img width="250px" src="https://user-images.githubusercontent.com/116461/76164362-8610bd80-610b-11ea-9621-4ba2d47a8a52.png" />

Additionally, the tree view will display the tour currently being [recorded](#authoring-tours), which makes it easy to track your status while in the process of creating a new tour.

> The tree view is automatically kept up-to-date, as you add/edit/delete tours within the current workspace. So feel free to [record](#authoring-tours) and/or edit tours, and then navigate them when done.

### Status Bar

In addition to the `CodeTour` tree view, the CodeTour extension also contributes a status bar item that indicates the title and step of the current tour you're actively taking or recording. When clicked, it will open the file/line of the current tour step, which allows you to open other files while taking a tour, and then resume the tour when ready. Once you end the current tour, the status bar will automatically hide itself.

### Contributed Commands

In addition to the `CodeTour` tree view and the status bar item, the CodeTour extension also contributes the following commands to the command palette:

- `CodeTour: Open Tour File...` - Allows you to select a tour file that was previously [exported](#exporting-tours).

- `CodeTour: Record Tour` - Starts the [tour recorder](#authoring-tours), which allows you to create a new tour by creating a sequence of steps.

* `CodeTour: Start Tour` - Starts a tour for the currently opened workspace. This command is only visible if the current workspace has one or more code tours.

* `CodeTour: Refresh Tours` - Refreshes the [`CodeTour` view](#tree-view), which can be handy if you'd created/modified/deleted tour files on disk. This command is only visible if the current workspace has one or more code tours.

* `CodeTour: Hide Tour Markers` - Hides [tour markers](#tour-markers). This command is only visible if the current workspace has one or more code tours, and tour markers are currently visible.

* `CodeTour: Show Tour Markers` - Shows [tour markers](#tour-markers). This command is only visible if the current workspace has one or more code tours, and tour markers are currently hidden.

- `CodeTour: Edit Tour` - Puts the currently active tour into edit mode. This command is only visible while you're actively playing a tour, that you're not already editing.

- `CodeTour: End Tour` - Ends the currently active tour. This command is only visible while you're actively recording/playing a tour.

- `CodeTour: Resume Current Tour` - Resume the current tour by navigating to the file/line number that's associated with the current step. This command is only visible while you're actively recording/playing a tour.

- `CodeTour: Add Tour Step` - Add a new [content-only step](#content-steps) after the current step in the active tour. This command is only visible while you're actively recording a tour.

### Configuration Settings

The `CodeTour` extension contributes the following settings:

- `Codetour > Prompt For Workspace Tours` - Specifies whether or not to display a notification when opening a workspace with tours for the first time.

- `Codetour > Record Mode` - Specifies how you want to associate tour steps to code when you're recording a new tour. Can either be `lineNumber` or `pattern`. Defaults to `lineNumber`.

- `Codetour > Show Markers` - Specifies whether or not to show [tour markers](#tour-markers). Defaults to `true`.

- `Codetour > Custom Tour Directory` - Specifies the name of a custom directory path that tours can be stored in within an opened workspace (e.g. `docs/tours`).

### Keybindings

In addition to the available commands, the Code Tour extension also contributes the following commands, which are active while you're currently taking a tour:

| Windows/Linux         | macOS               | Description                           |
| --------------------- | ------------------- | ------------------------------------- |
| `ctrl+right`          | `cmd+right`         | Move to the next step in the tour     |
| `ctrl+left`           | `cmd+left`          | Move to the previous step in the tour |
| `ctrl+down ctrl+down` | `cmd+down cmd+down` | End the current tour                  |
| `ctrl+up ctrl+up`     | `cmd+up cmd+up`     | Start new tour                        |

## Extension API

In order to enable other extensions to contribute/manage their own code tours, the CodeTour extension exposes an API with the following methods:

- `startTour(tour: CodeTour, stepNumber: number, workspaceRoot: Uri, startInEditMode: boolean = false, canEditTour: boolean): void` - Starts the specified tour, at a specific step, and using a specific workspace root to resolve relative file paths. Additionally, you can specify whether the tour should be started in edit/record mode or not, as well as whether the tour should be editable. Once the tour has been started, the end-user can use the status bar, command palette, key bindings and comment UI to navigate and edit the tour, just like a "normal" tour.

- `startTourByUri(tourUri: vscode.Uri, stepNumber?: number = 0): void` - Same as above, but allows specifying a file `Uri`, and optionally, a step number.

- `endCurrentTour(): void` - Ends the currently running tour (if there is one). Note that this is simply a programatic way to end the tour, and the end-user can also choose to end the tour using either the command palette (running the `CodeTour: End Tour` command) or comment UI (clicking the red square, stop icon) as usual.

- `exportTour(tour: CodeTour): Promise<string>` - Exports a `CodeTour` instance into a fully-embedded tour file, that can then be written to some persistent storage (e.g. a GitHub Gist).

In addition to the aforementioned functions, the extension API also allows subscribing to the following tour events:

- `onDidStartTour(([tour: CodeTour, stepNumber: number]) => void): Disposable` - Registers a callback function, that is triggered whenever a tour is started or navigated. The provided callback is passed a [`CodeTour`](https://github.com/microsoft/codetour/blob/main/src/store/index.ts#L38) instance as well as the step number that is visible.

- `onDidEndTour((tour: CodeTour) => void): Disposable` - Registers a callback function, that is triggered whenever a tour is ended. The provided callback is passed a [`CodeTour`](https://github.com/microsoft/codetour/blob/main/src/store/index.ts#L38) instance, which represents the metadata of the tour that was ended.

```javascript
// Check if the end-user has the CodeTour extension installed.
const codeTourExtension = vscode.extensions.getExtension(
  "vsls-contrib.codetour"
);
if (codeTourExtension) {
  // Grab the extension API.
  const codeTourApi = codeTour.exports;

  // Use the API object as needed
  codeTourApi.onDidStartTour(([tour, stepNumber]) => {
    console.log("Tour started: ", tour.title);
  });

  codeTourApi.onDidEndTour(tour => {
    console.log("Tour ended: ", tour.title);
  });
}
```
