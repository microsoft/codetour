# Answer Step questions in a right-hand terminal panel

A Tour Step is read while the reader keeps an eye on the code it explains. The
terminal reader therefore does not append the conversation under the Step: a
Step conversation rendered in the flow pushes the code out of the viewport,
mixes two scroll positions, and makes an answer as wide as the whole terminal
for no reason. The ACP chat gets a dedicated right-hand panel instead, about
45% of the columns, with its own header, transcript and prompt. The Step keeps
its own scroller on the left; the panel keeps its own and stays pinned to the
newest exchange. This is the same split an editor takes for granted between the
code and its assistant, and it is what makes a streamed answer readable.

The panel is driven by the same responder the extension chat uses. Only an
installed agent is a candidate, in the extension order, discovered on `PATH`
without downloading anything: the first question launches it lazily in Ask
mode, and the ACP session layer still refuses every write, delete, move and
execute tool. Conversations live in process memory per Step and are the prompt
history of the next question; closing the reader disposes the session and
nothing is persisted. Reading works unchanged without an agent: the panel then
states that no ACP agent is installed and the Tour stays readable.

`CODETOUR_ACP_PROVIDER` restricts the candidates by provider name, and
`CODETOUR_ACP_COMMAND` with `CODETOUR_ACP_ARGS` runs one explicit ACP command —
the deterministic tests use it to put a fake agent at the real transport
boundary. The HTML reader is a self-contained document with no process and no
agent, so ACP remains a terminal-only surface.
