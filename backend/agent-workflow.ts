import { INSTRUCTIONS } from '../collaboration/plan-tools.cjs';
import { boardAgentInstructions } from './board-agent-instructions';

// What a connected agent is told: the plan rules for contributors, then the connection's own guidance.
export const agentWorkflow = (mode: 'read' | 'edit') => mode === 'edit'
  ? INSTRUCTIONS + '\n' + boardAgentInstructions(mode)
  : boardAgentInstructions(mode);
