'use client';

import { useState } from 'react';
import { Chat } from '@/components/ui/chat';
import type { Message } from '@/components/ui/chat-message';
import axios from 'axios';

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const handleInputChange: React.ChangeEventHandler<HTMLTextAreaElement> = (e) => {
    setInput(e.target.value);
  };

  const handleSubmit = (
    event?: { preventDefault?: () => void },
    options?: { experimental_attachments?: FileList }
  ) => {
    if (event?.preventDefault) {
      event.preventDefault();
    }

    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      createdAt: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    // Use async IIFE to handle the async API call
    (async () => {
      try {
        const payload: { prompt: string; sessionId?: string } = {
          prompt: input.trim(),
        };

        // Only include sessionId if it exists
        if (sessionId) {
          payload.sessionId = sessionId;
        }

        const response = await axios.post('http://localhost:3010/llm/chat', payload);

        const aiMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: response.data.response,
          createdAt: new Date()
        };

        setMessages(prev => [...prev, aiMessage]);

        // Update session ID if returned from backend
        if (response.data.sessionId) {
          setSessionId(response.data.sessionId);
        }
      } catch (err) {
        console.error('Error communicating with backend:', err);
        setError('Failed to get response from AI. Please try again.');
      } finally {
        setIsLoading(false);
      }
    })();
  };

  const stop = () => {
    setIsLoading(false);
  };

  return (
    <div className="flex flex-col w-full h-screen overflow-hidden p-4">

      <Chat
        className='grow'
        messages={messages}
        input={input}
        handleInputChange={handleInputChange}
        handleSubmit={handleSubmit}
        isGenerating={isLoading}
        stop={stop}
      />

      {error && (
        <div className="absolute bottom-0 left-4 text-red-500 text-sm p-2 bg-red-100 rounded mb-16 max-w-md">
          {error}
        </div>
      )}
    </div>
  );
}
