"use client"

import React, { useEffect, useRef } from 'react';

interface ExternalLinkWrapperProps {
    children: React.ReactNode;
}

export function ExternalLinkWrapper({ children }: ExternalLinkWrapperProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Find all links within the container
        const links = container.querySelectorAll('a');

        // Add target="_blank" and rel="noopener noreferrer" to each link
        links.forEach(link => {
            // Skip links that already have a target attribute
            if (!link.hasAttribute('target')) {
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener noreferrer');
            }

            // Add click handler to ensure links open in new tab
            link.addEventListener('click', (e) => {
                e.preventDefault();
                window.open(link.href, '_blank', 'noopener,noreferrer');
            });
        });

        // Cleanup event listeners on unmount
        return () => {
            links.forEach(link => {
                link.removeEventListener('click', (e) => {
                    e.preventDefault();
                    window.open(link.href, '_blank', 'noopener,noreferrer');
                });
            });
        };
    }, [children]); // Re-run when children change

    return (
        <div ref={containerRef}>
            {children}
        </div>
    );
} 