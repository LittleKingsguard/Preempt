/**
 * Identifies the user or system process that produced an event within Preempt.
 *
 * @useCase Used to trace audit logs, user actions, or worker-driven state events.
 * @processFlow Attached to every `IPreemptEvent` emitted across the Kafka/WebSocket event bus.
 */
export interface EventSource {
    /** Unique entity ID of the user or process. */
    id: string;
    /** Category of event trigger: human user interaction or background system worker. */
    type: 'user' | 'process';
    /** Optional human-readable name of the triggering user or process. */
    name?: string;
}

/**
 * Represents the state change payload containing before and after states for event auditing or synchronization.
 *
 * @template T Type of state object being tracked.
 * @useCase Used in real-time node modification events and rollback logging.
 * @processFlow Captured during node state updates and streamed over event relays.
 */
export interface StateChange<T = any> {
    /** State before the transition. */
    before: T | null;
    /** State after the transition. */
    after: T | null;
}

/**
 * Core event interface for all real-time events in the Preempt ecosystem.
 *
 * @template T Type of state data attached to the event.
 * @useCase Transport format for real-time WebSocket state synchronization and Kafka event relaying.
 * @processFlow Created by interactive handlers or backend sources, relayed via `eventRelay`, and consumed by client WebSocket subscribers.
 */
export interface IPreemptEvent<T = any> {
    /** Unique UUID string identifying the event instance. */
    id: string;
    /** Event type string (e.g. 'NODE_MODIFIED', 'USER_LOGGED_IN'). */
    type: string;
    /** Epoch timestamp in milliseconds when the event was generated. */
    timestamp: number;
    /** Originating user or process metadata. */
    source: EventSource;
    /** List of user/process IDs authorized or targeted to receive this event payload. */
    interestedParties: string[];
    /** Optional state change tracking before/after snapshot data. */
    stateChange?: StateChange<T>;
    /** Optional correlation ID for tracing multi-event workflow transactions. */
    correlationId?: string;
    /** Schema version identifier. Defaults to '1.0'. */
    version?: string;
    /** Target messaging topic name for Kafka or WebSocket routing. */
    topic?: string;
}

/**
 * Instantiable class for building Preempt event instances with automatic UUID generation.
 *
 * @template T Type of state data attached to the event.
 * @useCase Instantiated when publishing custom state mutations or streaming DOM updates over WebSockets.
 * @processFlow Created in handlers or backend sources, passed to `eventRelay` / `websocketManager`.
 */
export class PreemptEvent<T = any> implements IPreemptEvent<T> {
    public id: string;
    public type: string;
    public timestamp: number;
    public source: EventSource;
    public interestedParties: string[];
    public stateChange?: StateChange<T>;
    public correlationId?: string;
    public version?: string;
    public topic?: string;

    /**
     * Constructs a new PreemptEvent instance.
     *
     * @param type Event type descriptor string.
     * @param source Metadata describing the initiating user or process.
     * @param interestedParties List of subscriber IDs targeted for this event payload.
     * @param stateChange Optional state snapshot before and after the modification.
     * @param correlationId Optional transaction correlation identifier.
     * @param version Schema version string (defaults to '1.0').
     * @param topic Destination messaging topic (defaults to 'preempt-events').
     * @returns Instantiated PreemptEvent object.
     */
    constructor(
        type: string,
        source: EventSource,
        interestedParties: string[] = [],
        stateChange?: StateChange<T>,
        correlationId?: string,
        version: string = "1.0",
        topic: string = "preempt-events"
    ) {
        // Fallback for environments without crypto.randomUUID (older browsers, etc.)
        this.id = typeof crypto !== 'undefined' && crypto.randomUUID 
            ? crypto.randomUUID() 
            : Date.now().toString(36) + Math.random().toString(36).substring(2);
        this.type = type;
        this.timestamp = Date.now();
        this.source = source;
        this.interestedParties = interestedParties;
        if (stateChange !== undefined) this.stateChange = stateChange;
        if (correlationId !== undefined) this.correlationId = correlationId;
        this.version = version;
        this.topic = topic;
    }
}

