export interface ServiceSelector {
    name: string;
    capabilities?: string[];
}
export interface ServiceHandler {
    (request: MessageWithHeader): Message | void | Promise<Message | void>;
}
type MessageHeader = Record<string, unknown>;
type MessagePayload = string | ArrayBuffer | Blob | ArrayBufferView;
export interface MessageWithHeader {
    header: MessageHeader;
    payload?: MessagePayload;
}
export interface Message {
    header?: MessageHeader;
    payload?: MessagePayload;
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
    private messageToData;
    private isBinaryPayload;
    private messageToBinary;
    request(service: ServiceSelector, req: Message): Promise<Message>;
    requestTo(endpointId: string | null, service: ServiceSelector, req: Message): Promise<Message>;
    advertise(service: ServiceSelector, handler: ServiceHandler): void;
    unadvertise(serviceName: string): void;
    setServiceHandler(serviceName: string, handler: ServiceHandler): void;
    setHandler(serviceName: string, handler: ServiceHandler): void;
    publish(topic: string, text: string): void;
    subscribe(topic: string, handler: (text: string) => void): void;
    unsubscribe(topic: string): void;
    status(): Promise<any>;
    isConnected(): boolean;
    addConnectListener(listener: Function): void;
}
export {};
