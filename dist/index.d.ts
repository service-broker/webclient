
interface ServiceFilter {
  name: string
  capabilities?: string[]
}

export interface ServiceAdvert {
  name: string
  capabilities?: string[]
  priority: number
}

export interface ServiceHandler {
  (msg: Message): Partial<Message>|void|Promise<Partial<Message>|void>
}

interface Message {
  header: any
  payload: any
}

export declare class ServiceBroker {
  constructor(url: string, logger: {error: Console["error"], debug: Console["debug"]});
  request(service: ServiceFilter, req: Partial<Message>): Promise<Message>;
  requestTo(endpointId: string, service: ServiceFilter, req: Partial<Message>): Promise<Message>;
  advertise(service: ServiceAdvert, handler: ServiceHandler): Promise<void>;
  unadvertise(serviceName: string): Promise<void>;
  setHandler(serviceName: string, handler: ServiceHandler): void;
  publish(topic: string, text: string): Promise<void>;
  subscribe(topic: string, handler: (text: string) => void): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
  isConnected(): boolean;
  addConnectListener(listener: () => void): void;
}
