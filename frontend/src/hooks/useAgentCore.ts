/**
 * Hook for interacting with the AgentCore Runtime.
 */

import { useState, useCallback } from 'react';
import { invokeAgent } from '../api/agentcore';
import type { Message, AgentCoreConfig } from '../types';

export function useAgentCore(config: AgentCoreConfig, userId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  // Use a stable sessionId per user for cross-session memory persistence
  // AgentCore requires runtimeSessionId >= 33 characters
  const [sessionId] = useState(() => {
    const base = `costopt-session-${userId || 'anonymous-user'}`;
    // Pad with repeated base to ensure minimum 33 chars
    return base.padEnd(33, '-0');
  });

  const sendMessage = useCallback(async (prompt: string) => {
    if (!prompt.trim() || !config.runtimeArn) return;

    const userMsg: Message = {
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const response = await invokeAgent({
        runtimeArn: config.runtimeArn,
        region: config.region,
        prompt,
        sessionId,
        userId,
      });

      const agentMsg: Message = {
        role: 'agent',
        content: response,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, agentMsg]);
    } catch (err) {
      const errorMsg: Message = {
        role: 'agent',
        content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }, [config, sessionId, userId]);

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, loading, sessionId, sendMessage, clearMessages };
}
