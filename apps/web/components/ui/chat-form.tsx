'use client';

import { useState, forwardRef, ReactElement } from 'react';

interface ChatFormProps {
    className?: string;
    isPending: boolean;
    handleSubmit: (
        event?: { preventDefault?: () => void },
        options?: { experimental_attachments?: FileList }
    ) => void;
    children: (props: {
        files: File[] | null;
        setFiles: React.Dispatch<React.SetStateAction<File[] | null>>;
    }) => ReactElement;
}

export const ChatForm = forwardRef<HTMLFormElement, ChatFormProps>(
    ({ children, handleSubmit, isPending, className }, ref) => {
        const [files, setFiles] = useState<File[] | null>(null);

        const onSubmit = (event: React.FormEvent) => {
            // Always prevent default to avoid page refresh
            event.preventDefault();

            if (!files) {
                handleSubmit(event);
                return;
            }

            const fileList = createFileList(files);
            handleSubmit(event, { experimental_attachments: fileList });
            setFiles(null);

            // Return false for older browsers
            return false;
        };

        return (
            <form
                ref={ref}
                onSubmit={onSubmit}
                className={className}
            >
                {children({ files, setFiles })}
            </form>
        );
    }
);

ChatForm.displayName = "ChatForm";

function createFileList(files: File[] | FileList): FileList {
    const dataTransfer = new DataTransfer();
    for (const file of Array.from(files)) {
        dataTransfer.items.add(file);
    }
    return dataTransfer.files;
} 