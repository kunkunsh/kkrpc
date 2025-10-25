---
description: Reviews recent changes and decisions, and documents them in a dated journal file.
---

# Journal Command

## Description

Reviews recent changes and decisions, and documents them in a dated journal file.

## Usage

Run this command to document recent work, decisions, and architectural tradeoffs in the project journal.

## Implementation

The command will:

1. Analyze recent git changes and conversation context
2. Synthesize a summary of decisions and rationale
3. Append the entry to the appropriate daily journal file (journal/YYYY-MM-DD.md)
4. Report completion with the file path

## Key Components

- **Core Decision/Topic**: Main subject of recent work
- **Options Considered**: Different approaches or tradeoffs discussed
- **Final Decision & Rationale**: What was decided and why
- **Key Changes Made**: Significant code or file modifications
- **Future Considerations**: Potential future work or remaining tech debt

## File Structure

- Journal entries are stored in `.journal/YYYY-MM-DD.md`
- Each entry is formatted as a Markdown section with a timestamp
- Entries are appended to existing daily files or create new ones as needed
