# Code Tour 🗺️

Code Tour is a Visual Studio Code extension, which allows you to take guided walkthroughs of a codebase, in order to make it easier to onboard and/or learn new parts of it. A "code tour" is simply a series of inline comments, each of which are associated with a specific file/line, and include a description of the respective code. The end user can start/stop tours at any time, and navigate the current tour at their own pace.

## Starting a tour

1. Clicking the `Start Tour` button in the `Explorer` view's title bar
1. Selecting on a tour in the `Code Tours` view in the `Explorer` tab
1. Running the `Code Tour: Start Tour` command, and selecting the tour you'd like to take

If the current workspace only has a single code tour, then any of the

## Navigating a tour

Once you've started a tour, the comment UI includes navigation actions that allow you to perform the following:

- `Previous` - Navigate back to the previous step in the current tour
- `Next` - Navigate to the next step in the current tour
- `End Tour` - End the current tour and remove the comment UI

## Authoring tours

- `codetour.json`
- `tour.json`
- `.vscode/codetour.json`
- `.vscode/tour.json`

Additionally, you can create a directory called `.vscode/tours`, which includes any number of `*.json` files (whose name is irrelevant).
