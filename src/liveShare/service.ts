// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from "vscode";
import { LiveShare, Role, SharedService, SharedServiceProxy } from "vsls";
import {
  endCurrentCodeTour,
  onDidEndTour,
  onDidStartTour,
  startCodeTour
} from "../store/actions";

interface Message {
  data?: any;
  peer?: number;
}

const TOUR_ENDED_NOTIFICATION = "tourEnded";
const TOUR_STARTED_NOTIFICATION = "tourStarted";

export default function (
  api: LiveShare,
  service: SharedService | SharedServiceProxy
) {
  const peer = api.session.peerNumber;

  onDidEndTour(() => {
    service.notify(TOUR_ENDED_NOTIFICATION, { peer });
  });

  service.onNotify(TOUR_ENDED_NOTIFICATION, (message: Message) => {
    if (message.peer === peer) return;

    endCurrentCodeTour(false);
    service.notify(TOUR_ENDED_NOTIFICATION, message);
  });

  onDidStartTour(([tour, stepNumber]) => {
    const newTour = { ...tour };

    if (api.session.role === Role.Host) {
      newTour.id = api.convertLocalUriToShared(Uri.parse(tour.id)).toString();
    } else {
      newTour.id = api.convertSharedUriToLocal(Uri.parse(tour.id)).toString();
    }

    const message = {
      peer,
      data: {
        tour: newTour,
        stepNumber
      }
    };

    service.notify(TOUR_STARTED_NOTIFICATION, message);
  });

  service.onNotify(TOUR_STARTED_NOTIFICATION, (message: Message) => {
    if (message.peer === peer) return;

    startCodeTour(message.data.tour, message.data.stepNumber);
    service.notify(TOUR_STARTED_NOTIFICATION, message);
  });
}
