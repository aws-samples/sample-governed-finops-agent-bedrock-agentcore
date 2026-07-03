import { useState, useRef, useEffect, FormEvent } from 'react';
import { MessageBubble } from './MessageBubble';
import type { RemediationOptionData } from './RemediationOption';
import type { Message, RemediationStatus } from '../../types';
import './chat.css';

interface Props {
  messages: Message[];
  loading: boolean;
  onSend: (prompt: string) => void;
  onExecuteRemediation?: (option: RemediationOptionData) => Promise<RemediationStatus>;
}

export function ChatView({ messages, loading, onSend, onExecuteRemediation }: Props) {
  const [input, setInput] = useState('');
  const [remediationStatuses, setRemediationStatuses] = useState<Record<string, RemediationStatus>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;
    onSend(input.trim());
    setInput('');
  }

  async function handleExecuteRemediation(option: RemediationOptionData) {
    if (!onExecuteRemediation) return;
    setRemediationStatuses(prev => ({ ...prev, [option.id]: 'loading' }));
    try {
      const result = await onExecuteRemediation(option);
      setRemediationStatuses(prev => ({ ...prev, [option.id]: result }));
    } catch {
      setRemediationStatuses(prev => ({ ...prev, [option.id]: 'error' }));
    }
  }

  return (
    <div className="chat-container">
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Pregúntame sobre tus costos en AWS.</p>
            <div className="chat-suggestions">
              {[
                '¿Cuáles son mis 5 servicios más costosos este mes?',
                'Muéstrame las tendencias de costos de los últimos 3 meses',
                '¿Hay instancias EC2 subutilizadas?',
                '¿Qué savings plans me recomiendas?',
                '¿Existen volúmenes EBS no conectados o instantáneas huérfanas?',
              ].map((q) => (
                <button
                  key={q}
                  className="chat-suggestion"
                  onClick={() => onSend(q)}
                  disabled={loading}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            message={msg}
            remediationStatuses={remediationStatuses}
            onExecuteRemediation={handleExecuteRemediation}
          />
        ))}
        {loading && (
          <div className="message-bubble agent">
            <div className="message-header">
              <span className="message-role">Cost Optimizer</span>
            </div>
            <div className="message-content thinking">
              <span className="dot" /><span className="dot" /><span className="dot" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask about your AWS costs..."
          disabled={loading}
          aria-label="Chat message input"
        />
        <button type="submit" className="chat-send" disabled={loading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
