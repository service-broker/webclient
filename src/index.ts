
export interface ServiceSelector {
  name: string
  capabilities?: string[]
}

export interface ServiceHandler {
  (request: MessageWithHeader): Message | void | Promise<Message | void>
}

type MessageHeader = Record<string, unknown>
type MessagePayload = string | ArrayBuffer | Blob | ArrayBufferView

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

function messageFromBinary(buffer: ArrayBuffer): MessageWithHeader {
  const bytes = new Uint8Array(buffer)
  const index = bytes.indexOf(10)
  const headerBytes = index == -1 ? bytes : bytes.subarray(0, index)
  const header = JSON.parse(new TextDecoder().decode(headerBytes))
  if (index == -1) return { header }
  return { header, payload: buffer.slice(index + 1) }
}

function messageFromData(data: unknown): MessageWithHeader | Promise<MessageWithHeader> {
  if (typeof data == "string") return messageFromString(data)
  if (data instanceof ArrayBuffer) return messageFromBinary(data)
  if (typeof Blob != "undefined" && data instanceof Blob) {
    return data.arrayBuffer().then(messageFromBinary)
  }
  throw new Error("Unsupported message data type")
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
    conn.binaryType = "arraybuffer"
    conn.onopen = () => this.onOpen(conn)
    conn.onerror = () => {
      console.info("Failed to connect to service broker, retrying in 15")
      setTimeout(() => this.connect(), 15000)
    }
  }

  private onOpen(conn: WebSocket) {
    console.info("Connected to service broker", conn)
    this.ws = conn
    this.ws.onerror = console.error
    this.ws.onclose = event => this.onClose(event)
    this.ws.onmessage = event => this.onMessage(event)
    for (const listener of this.connectListeners) listener()
    for (const { header, payload } of this.pendingSend) this.send(header, payload)
    this.pendingSend = []
  }

  private onClose(event: CloseEvent) {
    this.ws = null
    console.info("Lost connection to service broker", event.code, event.reason)
    setTimeout(() => this.connect(), 1000)
  }

  private async onMessage(event: MessageEvent) {
    try {
      const msg = await messageFromData(event.data)
      console.debug("<<", msg.header, msg.payload)
      if (msg.header.type == "ServiceResponse") this.onServiceResponse(msg)
      else if (msg.header.type == "ServiceRequest") await this.onServiceRequest(msg)
      else if (msg.header.type == "SbStatusResponse") this.onServiceResponse(msg)
      else if (msg.header.error) this.onServiceResponse(msg)
      else console.error("Unhandled", msg.header)
    } catch (err) {
      console.error("Failed to handle message", event.data, err)
    }
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

  private async onServiceRequest(msg: MessageWithHeader) {
    const service = msg.header.service as ServiceSelector
    const provider = this.providers.get(service.name)
    if (provider) {
      try {
        const res = await provider.handler(msg)
        if (msg.header.id) {
          this.send({
            ...res?.header,
            to: msg.header.from,
            id: msg.header.id,
            type: "ServiceResponse"
          }, res?.payload)
        }
      } catch (err) {
        if (msg.header.id) {
          this.send({
            to: msg.header.from,
            id: msg.header.id,
            type: "ServiceResponse",
            error: err instanceof Error ? err.message : err
          })
        } else {
          console.error("Failed to handle notification", msg.header, err)
        }
      }
    } else {
      console.error("No handler for service", service.name)
    }
  }

  private send(header: MessageHeader, payload?: MessagePayload) {
    if (!this.ws) {
      this.pendingSend.push({ header, payload })
      return;
    }
    console.debug(">>", header, payload);
    this.ws.send(this.messageToData(header, payload))
  }

  private messageToData(header: MessageHeader, payload?: MessagePayload) {
    if (this.isBinaryPayload(payload)) return this.messageToBinary(header, payload)
    return JSON.stringify(header) + (payload ? "\n" + payload : "")
  }

  private isBinaryPayload(payload: MessagePayload | undefined): payload is Exclude<MessagePayload, string> {
    return payload instanceof ArrayBuffer ||
      (typeof Blob != "undefined" && payload instanceof Blob) ||
      (typeof ArrayBuffer != "undefined" && ArrayBuffer.isView(payload))
  }

  private messageToBinary(header: MessageHeader, payload: Exclude<MessagePayload, string>) {
    const headerBytes = new TextEncoder().encode(JSON.stringify(header) + "\n")
    const payloadBlob = payload instanceof Blob ? payload : new Blob([payload as BlobPart])
    return new Blob([headerBytes, payloadBlob])
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
      throw new Error(serviceName + " handler already exists")
    }
    this.providers.set(serviceName, { handler })
  }

  setHandler(serviceName: string, handler: ServiceHandler) {
    return this.setServiceHandler(serviceName, handler)
  }

  publish(topic: string, text: string) {
    return this.send({ type: "ServiceRequest", service: { name: "#" + topic } }, text)
  }

  subscribe(topic: string, handler: (text: string) => void) {
    return this.advertise({ name: "#" + topic }, msg => handler(msg.payload as string))
  }

  unsubscribe(topic: string) {
    return this.unadvertise("#" + topic)
  }

  async status() {
    const id = ++this.pendingIdGen
    this.send({ id, type: "SbStatusRequest" })
    const res = await new Promise<Message>((fulfill, reject) =>
      this.pendingResponses.set(id, { fulfill, reject })
    )
    return JSON.parse(res.payload as string)
  }

  isConnected() {
    return this.ws != null
  }

  addConnectListener(listener: Function) {
    this.connectListeners.push(listener)
    if (this.isConnected()) listener()
  }
}
