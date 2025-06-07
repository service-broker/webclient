
export interface ServiceSelector {
  name: string
  capabilities?: string[]
}

export interface ServiceHandler {
  (request: MessageWithHeader): Message | void | Promise<Message | void>
}

type MessageHeader = Record<string, unknown>
type MessagePayload = string

export interface MessageWithHeader {
  header: MessageHeader
  payload?: MessagePayload
}

export interface Message {
  header?: MessageHeader
  payload?: MessagePayload
}

interface PendingResponse {
  fulfill(response: Message): void
  reject(err: unknown): void
}

function messageFromString(text: string): MessageWithHeader {
  const index = text.indexOf('\n')
  if (index == -1) {
    return {
      header: JSON.parse(text)
    }
  } else {
    return {
      header: JSON.parse(text.slice(0, index)),
      payload: text.slice(index + 1)
    }
  }
}


export class ServiceBroker {

  private readonly providers = new Map<string, {
    advertisedService?: ServiceSelector
    handler: ServiceHandler
  }>()
  private ws: WebSocket | null = null
  private readonly connectListeners: Function[] = []
  private pendingSend: MessageWithHeader[] = []
  private readonly pendingResponses = new Map<number, PendingResponse>()
  private pendingIdGen = 0


  constructor(private readonly url: string) {
    this.connect()
  }

  private connect() {
    const conn = new WebSocket(this.url)
    conn.onopen = () => this.onOpen(conn)
    conn.onerror = () => {
      console.error("Failed to connect to service broker, retrying in 15")
      setTimeout(() => this.connect(), 15000)
    }
  }

  private onOpen(conn: WebSocket) {
    this.ws = conn
    this.ws.onerror = console.error
    this.ws.onclose = () => this.onClose()
    this.ws.onmessage = event => this.onMessage(event)
    for (const listener of this.connectListeners) listener()
    for (const { header, payload } of this.pendingSend) this.send(header, payload)
    this.pendingSend = []
  }

  private onClose() {
    this.ws = null
    console.error("Lost connection to service broker, reconnecting")
    setTimeout(() => this.connect(), 0)
  }

  private onMessage(e: MessageEvent) {
    const msg = messageFromString(e.data);
    console.debug("<<", msg.header, msg.payload);
    if (msg.header.type == "ServiceResponse") this.onServiceResponse(msg)
    else if (msg.header.type == "ServiceRequest") this.onServiceRequest(msg)
    else if (msg.header.type == "SbStatusResponse") this.onServiceResponse(msg)
    else if (msg.header.error) this.onServiceResponse(msg)
    else console.error("Unhandled", msg.header)
  }

  private onServiceResponse(message: MessageWithHeader) {
    const id = message.header.id as number
    const pendingResponse = this.pendingResponses.get(id)
    if (pendingResponse) {
      this.pendingResponses.delete(id)
      if (message.header.error) {
        pendingResponse.reject(new Error(message.header.error as string))
      } else {
        pendingResponse.fulfill(message)
      }
    } else {
      console.error("Response received but no pending request", message.header)
    }
  }

  private onServiceRequest(msg: MessageWithHeader) {
    const service = msg.header.service as ServiceSelector
    const provider = this.providers.get(service.name)
    if (provider) {
      Promise.resolve(provider.handler(msg))
        .then(res => {
          if (msg.header.id) {
            this.send({
              ...res?.header,
              to: msg.header.from,
              id: msg.header.id,
              type: "ServiceResponse"
            }, res?.payload)
          }
        })
        .catch(err => {
          if (msg.header.id) {
            this.send({
              to: msg.header.from,
              id: msg.header.id,
              type: "ServiceResponse",
              error: err.message || err
            })
          } else {
            console.error(err.message, msg.header)
          }
        })
    } else {
      console.error("No handler for service " + service.name)
    }
  }

  private send(header: MessageHeader, payload?: MessagePayload) {
    if (!this.ws) {
      this.pendingSend.push({ header, payload })
      return;
    }
    console.debug(">>", header, payload);
    if (payload) {
      this.ws.send(JSON.stringify(header) + "\n" + payload)
    } else {
      this.ws.send(JSON.stringify(header))
    }
  }


  request(service: ServiceSelector, req: Message) {
    return this.requestTo(null, service, req);
  }

  requestTo(endpointId: string | null, service: ServiceSelector, req: Message) {
    const id = ++this.pendingIdGen
    const promise = new Promise<Message>((fulfill, reject) => {
      this.pendingResponses.set(id, { fulfill, reject })
    })
    const header: MessageHeader = {
      id: id,
      type: "ServiceRequest",
      service
    };
    if (endpointId) header.to = endpointId;
    this.send({...req.header, ...header}, req.payload)
    return promise;
  }

  advertise(service: ServiceSelector, handler: ServiceHandler) {
    if (this.providers.has(service.name)) {
      throw new Error(service.name + " provider already exists")
    }
    this.providers.set(service.name, { advertisedService: service, handler })
    return this.send({
      type: "SbAdvertiseRequest",
      services: Array.from(this.providers.values())
        .filter(x => x.advertisedService)
        .map(x => x.advertisedService)
    })
  }

  unadvertise(serviceName: string) {
    if (!this.providers.delete(serviceName)) {
      throw new Error(serviceName + " provider not exists")
    }
    return this.send({
      type: "SbAdvertiseRequest",
      services: Array.from(this.providers.values())
        .filter(x => x.advertisedService)
        .map(x => x.advertisedService)
    })
  }

  setServiceHandler(serviceName: string, handler: ServiceHandler) {
    if (this.providers.has(serviceName)) {
      throw new Error("Handler already exists")
    }
    this.providers.set(serviceName, { handler })
  }

  publish(topic: string, text: string) {
    return this.send({ type: "ServiceRequest", service: { name: "#" + topic } }, text)
  }

  subscribe(topic: string, handler: (text: string) => void) {
    return this.advertise({ name: "#" + topic }, msg => handler(msg.payload!))
  }

  unsubscribe(topic: string) {
    return this.unadvertise("#" + topic)
  }

  isConnected() {
    return this.ws != null
  }

  addConnectListener(listener: Function) {
    this.connectListeners.push(listener)
    if (this.isConnected()) listener()
  }
}
