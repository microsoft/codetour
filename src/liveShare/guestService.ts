// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vsls from "vsls";
import { EXTENSION_NAME } from "../constants";
import { startCodeTour } from "../store/actions";
import initializeBaseService from "./service";

export async function initializeService(vslsApi: vsls.LiveShare) {
  const service = await vslsApi.getSharedService(EXTENSION_NAME);
  if (!service) return;

  const response = await service.request("getCurrentTourStep", []);
  if (response) {
    startCodeTour(response.tour, response.stepNumber);
  }

  initializeBaseService(vslsApi, service);
}
