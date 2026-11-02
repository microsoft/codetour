# CodeTour

CodeTour is a VS Code extension that records and plays back guided tours of a codebase, plus an MCP server through which an AI agent authors those tours.

## Language

**Tour Image**:
An image generated to illustrate one specific Tour, stored under `.tours/images/<tour-name>/` and referenced by that Tour's Markdown.
_Avoid_: Generated image, tour asset

**Project Image**:
An image that belongs to the codebase, stored outside `.tours/`; Tour generation may reference it but never create it.
_Avoid_: Workspace image, user image

**Forbidden tool**:
A tool call a Tour Step Conversation's agent is never allowed to run — one that writes, deletes, moves, or executes. When one runs anyway, the reader is told.
_Avoid_: Disallowed tool, unsafe tool

**Narration Spell Dictionary**:
The fixed code constant mapping identifier tokens to the letter-by-letter spoken spelling the voice reads in their place.
_Avoid_: Acronym map, A–Z mapping, word list
