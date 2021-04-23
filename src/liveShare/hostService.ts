// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from "vscode";
import * as vsls from "vsls";
import { EXTENSION_NAME } from "../constants";
import { store } from "../store";
import initializeBaseService from "./service";

export async function initializeService(vslsApi: vsls.LiveShare) {
  const service = await vslsApi.shareService(EXTENSION_NAME);
  if (!service) return;

  service.onRequest("getCurrentTourStep", () => {
    if (!store.activeTour) {
      return null;
    }

    const tour = { ...store.activeTour.tour };
    tour.id = vslsApi.convertLocalUriToShared(Uri.parse(tour.id)).toString();

    return {
      tour,
      stepNumber: store.activeTour.step
    };
  });

  initializeBaseService(vslsApi, service);
}
