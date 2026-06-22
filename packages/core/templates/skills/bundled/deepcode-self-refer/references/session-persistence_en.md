# Session Persistence

Deep Code stores per-project session history in the local user directory. This history powers `/resume`, `/continue`, and `/undo`, and it remains available after the current terminal process exits.

## Storage Location

Each project has its own storage directory:

```text
~/.deepcode/projects/<project-code>/
```

`<project-code>` is generated from the project root path. Normal paths are converted into safe directory names. When the path would be too long, Deep Code keeps part of the project name and appends a stable hash so the storage path stays safe.

The project storage directory contains these main files and directories:

| Path                  | Description                                                                             |
| --------------------- | --------------------------------------------------------------------------------------- |
| `sessions-index.json` | Session index for the current project, including the session list and summary metadata. |
| `<session-id>.jsonl`  | Message log for one session. Each line is one JSON message.                             |
| `file-history/.git`   | Internal Git repository used for code checkpoints restored by `/undo`.                  |

## Persisted Data

### Session Index

`sessions-index.json` stores recent session entries. Each entry includes:

- Session ID, title, creation time, and update time.
- Session status, such as `pending`, `processing`, `completed`, `failed`, `interrupted`, `ask_permission`, or `waiting_for_user`.
- Latest assistant reply, thinking content, refusal reason, and failure reason.
- Latest tool-call data, token usage, and active token count.
- Metadata for subprocesses still tracked by the session.

The default session title comes from the first 100 characters of the first user prompt. Renaming a session from the session list updates the title in the index.

### Message Files

Each session has a separate JSONL message file named `<session-id>.jsonl`. Messages are appended in order. Common fields include:

| Field            | Description                                                                            |
| ---------------- | -------------------------------------------------------------------------------------- |
| `id`             | Message ID.                                                                            |
| `sessionId`      | Owning session ID.                                                                     |
| `role`           | Message role: `system`, `user`, `assistant`, or `tool`.                                |
| `content`        | Text content.                                                                          |
| `contentParams`  | Structured content, such as image input.                                               |
| `messageParams`  | Model message parameters, such as tool call IDs, tool calls, and reasoning content.    |
| `visible`        | Whether the message is shown in the UI.                                                |
| `compacted`      | Whether the message has been replaced by long-session compaction.                      |
| `checkpointHash` | Code checkpoint hash associated with `/undo`.                                          |
| `meta`           | Extra metadata for tool display, skills, permissions, summaries, and related features. |

When loading a message file, Deep Code parses JSON one line at a time. Malformed lines are ignored so the remaining usable history can still be loaded.

### Code Checkpoints

Deep Code stores code checkpoints in `file-history/.git`. This repository is only internal file history; it is not the project Git repository.

- A new session initializes an internal branch named after the session ID.
- Before each user prompt, Deep Code records the state of files it already tracks.
- Before and after tool-based file mutations, Deep Code records the relevant file state as needed.
- `checkpointHash` on user messages links a conversation position to a code state.

Checkpoints only cover files Deep Code has tracked. Unrelated files are not arbitrarily rewritten by `/undo`.

## Session Lifecycle

### Creating A Session

When creating a new session, Deep Code:

1. Generates a new session ID.
2. Initializes the code checkpoint branch for that session.
3. Adds an entry to `sessions-index.json`.
4. Writes system prompts, runtime context, project instructions, and the user message.
5. Starts the model request and keeps updating the index and message file as assistant replies and tool executions complete.

The per-project session list keeps the 50 most recent entries. When the limit is exceeded, older sessions are removed from the index, and their message files and related runtime resources are cleaned up.

### Continuing A Session

`/resume` shows the current project's session history and lets you select a session to continue.

`/continue` first continues the active session. If there is no active session to continue, it opens the session selection flow.

When continuing a session, Deep Code reads the message file, filters compacted old messages, repairs incomplete tool-call context, and converts the usable history into model request messages.

### Long-Session Compaction

When the conversation context grows too large, Deep Code can compact earlier messages:

- It summarizes an older range of non-system messages.
- It marks those old messages as `compacted: true`.
- It inserts an invisible system summary message into the message sequence.

Future requests use the remaining active messages and the summary message. The original messages stay in the JSONL file for auditability and UI history.

### Interruptions, Failures, And Permission Waits

Session status changes during execution:

- After a user interruption, status becomes `interrupted`, and Deep Code clears the current session controller and tracked subprocesses.
- After a request failure, status becomes `failed`, and the failure reason is written to the index.
- When a tool call needs confirmation, status becomes `ask_permission`.
- When a tool needs user input, status becomes `waiting_for_user`.

These states are persisted in `sessions-index.json`, so they remain visible in the session list after reopening the CLI.

## How `/undo` Uses Persistent Data

`/undo` candidates come from visible, non-compacted user messages. Each candidate is checked for an associated `checkpointHash`, and Deep Code verifies whether the checkpoint can be restored.

Depending on the selected mode, Deep Code can perform these operations:

| Operation            | Behavior                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Restore conversation | Truncates message history before the selected user message and updates the latest assistant data in the index. |
| Restore code         | Reads the selected checkpoint from `file-history/.git` and restores tracked files.                             |
| Restore both         | Restores code first, then truncates the conversation history.                                                  |

Restoring conversation rewrites the session JSONL file. Restoring code modifies workspace files tracked by the selected checkpoint.

## Delete And Rename

Deleting a session from the session list:

- Removes the entry from `sessions-index.json`.
- Deletes the matching `<session-id>.jsonl` file.
- Clears in-memory state, temporary working-directory state, controllers, and tracked process controls for that session.

Renaming a session only updates the `summary` field in the index. It does not change message files or code checkpoints.

## Notes

- Session data is stored in the local user directory and separated by project.
- If a project directory is moved, the new project root path generates a new `<project-code>`; history for the old path is not migrated automatically.
- `file-history/.git` is Deep Code's internal checkpoint repository and should not be edited manually.
- Deleting a session does not remove every historical object from the internal Git repository. It mainly removes the session index entry, message file, and runtime resources.
