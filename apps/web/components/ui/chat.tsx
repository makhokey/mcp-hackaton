'use client';

import { Message } from '@/components/ui/chat-message';
import { MessageInput } from '@/components/ui/message-input';
import { MessageList } from '@/components/ui/message-list';
import { useCallback } from 'react';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { forwardRef } from 'react';
import { ChatForm } from './chat-form';

interface ChatPropsBase {
    handleSubmit: (
        event?: { preventDefault?: () => void },
        options?: { experimental_attachments?: FileList }
    ) => void;
    messages: Array<Message>;
    input: string;
    className?: string;
    handleInputChange: React.ChangeEventHandler<HTMLTextAreaElement>;
    isGenerating: boolean;
    stop?: () => void;
}

export function Chat({
    messages,
    handleSubmit,
    input,
    handleInputChange,
    stop,
    isGenerating,
    className,
}: ChatPropsBase) {
    const isEmpty = messages.length === 0;
    const isTyping = isGenerating;

    // Handle stop generation
    const handleStop = useCallback(() => {
        if (stop) {
            stop();
        }
    }, [stop]);

    return (
        <ChatContainer className={className}>
            {messages.length > 0 ? (
                <ChatMessages messages={messages}>
                    <MessageList
                        messages={messages}
                        isTyping={isTyping}
                    />
                </ChatMessages>
            ) : null}

            <ChatForm
                className="mt-auto"
                isPending={isGenerating || isTyping}
                handleSubmit={handleSubmit}
            >
                {({ files, setFiles }) => (
                    <MessageInput
                        value={input}
                        onChange={handleInputChange}
                        allowAttachments
                        files={files}
                        setFiles={setFiles}
                        stop={handleStop}
                        isGenerating={isGenerating}
                    />
                )}
            </ChatForm>
        </ChatContainer>
    );
}

Chat.displayName = "Chat";

export function ChatMessages({
    messages,
    children,
}: React.PropsWithChildren<{
    messages: Message[];
}>) {
    const {
        containerRef,
        scrollToBottom,
        handleScroll,
        shouldAutoScroll,
        handleTouchStart,
    } = useAutoScroll([messages]);

    return (
        <div
            className="grid grid-cols-1 overflow-y-auto pb-4"
            ref={containerRef}
            onScroll={handleScroll}
            onTouchStart={handleTouchStart}
        >
            <div className="max-w-full [grid-column:1/1] [grid-row:1/1]">
                {children}
            </div>

            {!shouldAutoScroll && (
                <div className="pointer-events-none flex flex-1 items-end justify-end [grid-column:1/1] [grid-row:1/1]">
                    <div className="sticky bottom-0 left-0 flex w-full justify-end">
                        <Button
                            onClick={scrollToBottom}
                            className="pointer-events-auto h-8 w-8 rounded-full ease-in-out animate-in fade-in-0 slide-in-from-bottom-1"
                            size="icon"
                            variant="ghost"
                        >
                            <ArrowDown className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

export const ChatContainer = forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
    return (
        <div
            ref={ref}
            className={cn("grid max-h-full w-full grid-rows-[1fr_auto]", className)}
            {...props}
        />
    );
});

ChatContainer.displayName = "ChatContainer"; 