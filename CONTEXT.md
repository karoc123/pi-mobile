# PiMobile Context

This file captures the project language used to describe PiMobile behavior and runtime concepts. It keeps module naming and design discussions aligned across backend, frontend, and architecture reviews.

## Language

**Agent session**:
A repository-bound pi runtime conversation state, identified by session id or session file, that carries message history, runtime phase, and usage metrics.
_Avoid_: chat runtime object, prompt history

**Mock session**:
A deterministic local simulation of an agent session used for wiring, mobile flow validation, and cost/status behavior without a live model call.
_Avoid_: fake chat, demo thread

**Repository runtime selection**:
The transition that binds watcher state and agent session state to a selected repository path.
_Avoid_: repo switch event, workspace flip
