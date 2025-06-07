interface ServiceFilter {
    name: string;
    capabilities?: string[];
}
export interface ServiceHandler {
    (request: Message): Message | void | Promise<Message | void>;
}
interface Message {
    header?: Record<string, unknown>;
    payload?: string;
}
export declare class ServiceBroker {
    private readonly url;
    private readonly providers;
    private ws;
    private readonly connectListeners;
    private pendingSend;
    private readonly pendingResponses;
    private pendingIdGen;
    constructor(url: string);
    private connect;
    private onOpen;
    private onClose;
    private onMessage;
    private onServiceResponse;
    private onServiceRequest;
    private send;
    request(service: ServiceFilter, req: Message): Promise<Message>;
    requestTo(endpointId: string | null, service: ServiceFilter, req: Message): Promise<Message>;
    advertise(service: ServiceFilter, handler: ServiceHandler): void;
    unadvertise(serviceName: string): void;
    setServiceHandler(serviceName: string, handler: ServiceHandler): void;
    publish(topic: string, text: string): void;
    subscribe(topic: string, handler: (text: string) => void): void;
    unsubscribe(topic: string): void;
    isConnected(): boolean;
    addConnectListener(listener: Function): void;
}
export {};
