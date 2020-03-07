import {
  Disposable,
  Event,
  EventEmitter,
  TreeDataProvider,
  TreeItem,
  window
} from "vscode";
import { store } from "../store";
import { CodeTourNode } from "./nodes";
import { reaction } from "mobx";

class CodeTourTreeProvider implements TreeDataProvider<TreeItem>, Disposable {
  private _disposables: Disposable[] = [];

  private _onDidChangeTreeData = new EventEmitter<TreeItem>();
  public readonly onDidChangeTreeData: Event<TreeItem> = this
    ._onDidChangeTreeData.event;

  constructor(private extensionPath: string) {
    reaction(
      () => [store.hasTours],
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
