/**
 * Message List Component - displays chat messages with version separator
 */
import { useEffect, useRef } from 'react';
import { useApp } from '../context';
import { Storage, EXAMPLE_QUESTIONS } from '../utils';
import { Message } from './Message';
import { FaCheese } from 'react-icons/fa6';

/**
 * Empty chat hint with gold-style starter questions.
 */
export function EmptyState() {
    const { sendMessage, isResponding } = useApp();

    return (
        <div className="empty-state">
            <div className="empty-state-icon">
                <FaCheese size={28} />
            </div>
            <div className="empty-state-text">
                <strong>Ask Swiss Cheese</strong><br/>
                Cash by bank, period spend, counterparties, or a reference lookup.
            </div>
            <div className="empty-state-examples">
                {EXAMPLE_QUESTIONS.map((question) => (
                    <button
                        key={question}
                        type="button"
                        className="empty-state-example"
                        disabled={isResponding}
                        onClick={() => sendMessage(question, 'user')}
                    >
                        {question}
                    </button>
                ))}
            </div>
        </div>
    );
}

export function TypingIndicator() {
    return (
        <div className="message assistant" style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <div className="message-avatar">🧀</div>
            <div className="typing-indicator-bubble">
                <div className="typing-dot" style={{ '--delay': '0s' }} />
                <div className="typing-dot" style={{ '--delay': '0.15s' }} />
                <div className="typing-dot" style={{ '--delay': '0.3s' }} />
            </div>
        </div>
    );
}

export function VersionSeparator({ versionId }) {
    return (
        <div className="version-separator" role="separator" aria-label={`Saved in ${versionId}`}>
            <span className="version-separator-label">Saved in {versionId}</span>
        </div>
    );
}

export function MessageList() {
    const { messages, isResponding, config, activeConversationId, currentPromptId } = useApp();
    const containerRef = useRef();

    const nonSystemMessages = messages.filter(m => m.role !== 'system');
    const isEmpty = nonSystemMessages.length === 0;

    // Get version origin info for separator
    const conversation = activeConversationId 
        ? Storage.get('conversations').find(c => c.id === activeConversationId) 
        : null;
    const versionOrigin = conversation?.origin?.type === 'version' ? conversation.origin : null;
    
    // Calculate version message count
    let versionMessageCount = versionOrigin?.versionMessageCount || 0;
    if (versionOrigin && !versionMessageCount && versionOrigin.sourceId && currentPromptId) {
        const version = Storage.get('versions').find(
            v => v.id === versionOrigin.sourceId && v.promptId === currentPromptId
        );
        if (version) {
            versionMessageCount = (version.messages || []).filter(m => m.role !== 'system').length;
        }
    }

    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [messages, isResponding]);

    // Render messages with version separator
    const renderMessages = () => {
        const result = [];
        let nonSystemCount = 0;
        let separatorInserted = false;

        nonSystemMessages.forEach((msg) => {
            nonSystemCount++;
            
            // Insert separator after version boundary
            if (!separatorInserted && versionOrigin && 
                nonSystemCount === versionMessageCount + 1 && versionMessageCount > 0) {
                result.push(
                    <VersionSeparator key="version-separator" versionId={versionOrigin.sourceId} />
                );
                separatorInserted = true;
            }
            
            result.push(
                <Message key={msg.id} message={msg} responseFormat={config.responseFormat} />
            );
        });

        return result;
    };

    return (
        <div className="messages-container" ref={containerRef}>
            {isEmpty ? (
                <EmptyState />
            ) : (
                renderMessages()
            )}
            {isResponding && <TypingIndicator />}
        </div>
    );
}
