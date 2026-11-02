# 04: Render rich Tour explanations and Mermaid in TermDOM

**What to build:** A reader reaches a Tour Step containing real Markdown/HTML, tables, links, images and a Mermaid Diagram and receives an intelligible terminal presentation of the same explanation. The POC measures TermDOM's real capabilities rather than assuming browser-equivalent HTML/CSS support.

**Blocked by:** 03 — Play a Tour in an independent TermDOM terminal window.

**Status:** ready-for-agent

- [ ] A representative real Tour Step exercises Markdown, HTML/CSS, lists/tables, links, and a validated Mermaid Diagram through TermDOM, reusing the authoritative Tour content and Mermaid rules.
- [ ] Terminal rendering does not introduce duplicate Tour content or a new persisted description format.
- [ ] Unsupported content is detected when its Tour Step is reached; the entire Tour stops immediately with an actionable diagnostic naming the Tour, step and failure type.
- [ ] No automatic plain-text degradation, step skipping, switch to HTML, or fallback terminal UI framework occurs after a rendering failure.
- [ ] Automated tests cover both the supported fixture and an intentionally unsupported step, and assert a nonzero failure/terminated traversal for the latter.
- [ ] Real limitations of Mermaid/image rendering are documented as POC acceptance blockers until resolved, rather than being described as completed parity.
