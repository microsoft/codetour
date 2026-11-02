import { joinSession } from "@github/copilot-sdk/extension";
import { runCodeTourCommand, codeTourMcpServer } from "./adapter.mjs";

const session = await joinSession({mcpServers: {codetour: codeTourMcpServer()}, commands: [{
  name: "codetour",
  description: "Read or generate a CodeTour: /codetour [tour] or /codetour generate project|changes [neutral|critical]",
  handler: async ctx => runCodeTourCommand(session, ctx.args)
}]});
