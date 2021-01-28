// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vsls from "vsls";
import { EXTENSION_NAME } from "../constants";

export async function registerLiveShareModule() {
  const vslsApi = await vsls.getApi(`vsls-contrib.${EXTENSION_NAME}`);
  if (!vslsApi) return;

  vslsApi.onDidChangeSession(e => {
    if (e.session.id) {
      initializeService(vslsApi);
    }
  });

  if (vslsApi.session.id) {
    initializeService(vslsApi);
  }
}

async function initializeService(vslsApi: vsls.LiveShare) {
  let { initializeService } =
    vslsApi.session.role === vsls.Role.Host
      ? require("./hostService")
      : require("./guestService");

  await initializeService(vslsApi);
}
