import type { Message } from '../../types';
import type { RemediationStatus } from '../../types';
import { RemediationOption } from './RemediationOption';
import type { RemediationOptionData } from './RemediationOption';
import { remediatorConfig } from '../../config';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './chat.css';

interface Props {
  message: Message;
  remediationStatuses?: Record<string, RemediationStatus>;
  onExecuteRemediation?: (option: RemediationOptionData) => void;
}

/**
 * Extract remediation options JSON from agent response.
 * Returns the text without the JSON block and the parsed options.
 */
function extractRemediationOptions(content: string): {
  text: string;
  options: RemediationOptionData[];
} {
  const regex = /<!--REMEDIATION_OPTIONS-->([\s\S]*?)<!--\/REMEDIATION_OPTIONS-->/;
  const match = content.match(regex);

  if (!match) {
    return { text: content, options: [] };
  }

  const text = content.replace(regex, '').trim();
  try {
    const parsed = JSON.parse(match[1].trim()) as RemediationOptionData[];
    // Safety net filter: only keep options with action_types from config (fallback list)
    // The backend already filters dynamically via Remediator Gateway tools/list,
    // this is a frontend safety net in case the LLM hallucinates an action_type.
    const supportedActions = remediatorConfig.fallbackActions;
    const options = parsed.filter(opt => supportedActions.includes(opt.action_type));
    return { text, options };
  } catch {
    return { text: content, options: [] };
  }
}

/**
 * Clean agent response by removing tool invocation tags and thinking text.
 * Keeps only the final human-readable response.
 */
function cleanAgentResponse(content: string): string {
  let cleaned = content;

  // Remove <use_mcp_tool>...</use_mcp_tool> blocks
  cleaned = cleaned.replace(/<use_mcp_tool>[\s\S]*?<\/use_mcp_tool>/g, '');

  // Remove tool call patterns like: get_cost_and_usage({...})
  cleaned = cleaned.replace(/\w+\(\{[\s\S]*?\}\)\s*/g, '');

  // Fix markdown tables: ensure blank line before any table block
  // This is REQUIRED for remark-gfm to parse tables - they need a preceding blank line
  const tableLines = cleaned.split('\n');
  const fixedLines: string[] = [];
  for (let i = 0; i < tableLines.length; i++) {
    const line = tableLines[i];
    const prevLine = i > 0 ? tableLines[i - 1] : '';
    // If this line starts with | and previous line is not empty and not a | line
    if (line.trimStart().startsWith('|') && prevLine.trim() !== '' && !prevLine.trimStart().startsWith('|')) {
      fixedLines.push(''); // insert blank line
    }
    fixedLines.push(line);
  }
  cleaned = fixedLines.join('\n');
  // Fix tables that come without newlines (|| pattern means rows are concatenated)
  cleaned = cleaned.replace(/\|\|/g, '|\n|');

  // Remove "I'll retrieve..." / "Let me get..." preamble before actual data
  // Only if there's substantial content after it
  const lines = cleaned.split('\n').filter(line => line.trim());
  if (lines.length > 3) {
    const firstContentLine = lines.findIndex(line =>
      !line.startsWith("I'll ") &&
      !line.startsWith("Let me ") &&
      !line.startsWith("This will show") &&
      !line.startsWith("Once I receive")
    );
    if (firstContentLine > 0 && firstContentLine < lines.length - 1) {
      cleaned = lines.slice(firstContentLine).join('\n');
    }
  }

  // Clean up extra whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned || content; // fallback to original if cleaning removed everything
}

export function MessageBubble({ message, remediationStatuses, onExecuteRemediation }: Props) {
  const isUser = message.role === 'user';
  const rawContent = isUser ? message.content : cleanAgentResponse(message.content);
  const { text: displayContent, options } = isUser
    ? { text: rawContent, options: [] }
    : extractRemediationOptions(rawContent);

  return (
    <div className={`message-bubble ${isUser ? 'user' : 'agent'}`}>
      <div className="message-header">
        <span className="message-role">{isUser ? 'You' : 'Cost Optimizer'}</span>
        <span className="message-time">
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <div className="message-content">
        {isUser ? (
          <p>{displayContent}</p>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
        )}
      </div>
      {options.length > 0 && (
        <div className="remediation-options-list">
          <div className="remediation-options-header">Available Actions</div>
          {options.map((opt) => (
            <RemediationOption
              key={opt.id}
              option={opt}
              status={remediationStatuses?.[opt.id] || 'idle'}
              onExecute={onExecuteRemediation || (() => {})}
            />
          ))}
        </div>
      )}
    </div>
  );
}
