export function boardAgentInstructions(mode: 'read' | 'edit'): string {
  const instructions = [
    'Use the connected Branch MCP tools for board work. Start with read_board to read the current project instructions and card list, then use read_card and read_context as needed.',
    'Use this connection for board reads and changes. Do not open Chrome or use screen control to operate the board when these MCP tools can perform the task.',
  ];

  if (mode === 'edit') {
    instructions.push(
      'Use create_card to add whiteboard notes, update_card for notes created by this connection, and propose_edit for changes to other notes. Read the current card version before editing.',
      'Before sending every assistant message to the user, call publish_update to update the board’s Context automatically. This includes progress messages, questions, and final replies. Publish one concise summary per message of the work, decision, question, or blocker. Link a relevant card with nodeKey when available. Do this without asking the user to request or confirm routine Context updates.',
      'Give each message update a new requestId. Reuse that requestId only when retrying the same update. Wait for the tool result before reporting delivery. If publishing fails, tell the user that Context could not be updated and explain the returned blocker.',
    );
  } else {
    instructions.push(
      'This connection is read only. It cannot change cards or publish Context updates. If the user asks for those actions, explain that a connection with contribution access is required. Do not use Chrome or screen control to work around the connection’s access.',
    );
  }

  instructions.push('Keep connection keys and other credentials out of cards and Context. Share concise public work summaries, without hidden reasoning.');
  return instructions.join('\n');
}
