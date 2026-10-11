# PiMobile Context

This file captures the project language used to describe PiMobile behavior and runtime concepts. It keeps module naming and design discussions aligned across backend, frontend, and architecture reviews.

## Language

**Agent session**:
A repository-bound pi runtime conversation state, identified by session id or session file, that carries message history, runtime phase, and usage metrics.
_Avoid_: chat runtime object, prompt history

**Test provider**:
An in-process faux provider registered within the agent runtime (`PI_TEST_PROVIDER=1`) providing deterministic responses and scripted tool calls for offline test suites.
_Avoid_: mock session, fake chat, demo thread

**Repository runtime selection**:
The transition that binds watcher state and agent session state to a selected repository path.
_Avoid_: repo switch event, workspace flip
