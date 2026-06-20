// Identifies the user or process that triggered the event
export interface EventSource {
    id: string;
    type: 'user' | 'process';
    name?: string;
}

// Represents the state change payload
export interface StateChange<T = any> {
    before: T | null;
    after: T | null;
}

// The core event data structure
export interface IPreemptEvent<T = any> {
    id: string;               // Unique identifier for the event
    type: string;             // Type/name of the event (e.g., 'NODE_MODIFIED', 'USER_LOGGED_IN')
    timestamp: number;        // Epoch timestamp of when it was created
    source: EventSource;      // User/process that created the event
    interestedParties: string[]; // List of IDs (users/processes) interested in this event
    stateChange?: StateChange<T>; // Before/after data
    correlationId?: string;   // For tracing event chains
    version?: string;         // Version tracking for the event schema or state
    topic?: string;           // The Kafka topic to route this event to
}

// Helper class for easy instantiation
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
