import { reaction } from "mobx";
import {
  Disposable,
  Event,
  EventEmitter,
  TreeDataProvider,
  TreeItem,
  window
} from "vscode";
import { store } from "../store";
import { CodeTourNode, CodeTourStepNode } from "./nodes";

class CodeTourTreeProvider implements TreeDataProvider<TreeItem>, Disposable {
  private _disposables: Disposable[] = [];

  private _onDidChangeTreeData = new EventEmitter<TreeItem>();
  public readonly onDidChangeTreeData: Event<TreeItem> = this
    ._onDidChangeTreeData.event;

  constructor(private extensionPath: string) {
    reaction(
      () => [store.hasTours, store.mainTour, store.subTours],
      () => {
        this._onDidChangeTreeData.fire();
      }
    );
  }

  getTreeItem = (node: TreeItem) => node;

  async getChildren(element?: TreeItem): Promise<TreeItem[] | undefined> {
    if (!element) {
      const tours = store.subTours.map(
        tour => new CodeTourNode(tour, this.extensionPath)
      );
      if (store.mainTour) {
        tours.unshift(new CodeTourNode(store.mainTour, this.extensionPath));
      }
      return tours;
    } else if (element instanceof CodeTourNode) {
      return element.tour.steps.map(
        (_, index) => new CodeTourStepNode(element.tour, index)
      );
    }
  }

  dispose() {
    this._disposables.forEach(disposable => disposable.dispose());
  }
}

export function registerTreeProvider(extensionPath: string) {
  window.registerTreeDataProvider(
    "codetour.tours",
    new CodeTourTreeProvider(extensionPath)
  );
}
