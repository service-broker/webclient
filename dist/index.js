function messageFromString(text) {
    const index = text.indexOf('\n');
    if (index == -1) {
        return {
            header: JSON.parse(text)
        };
    }
    else {
        return {
            header: JSON.parse(text.slice(0, index)),
            payload: text.slice(index + 1)
        };
    }
}
function messageFromBinary(buffer) {
    const bytes = new Uint8Array(buffer);
    const index = bytes.indexOf(10);
    const headerBytes = index == -1 ? bytes : bytes.subarray(0, index);
    const header = JSON.parse(new TextDecoder().decode(headerBytes));
    if (index == -1)
        return { header };
    return { header, payload: buffer.slice(index + 1) };
}
function messageFromData(data) {
    if (typeof data == "string")
        return messageFromString(data);
    if (data instanceof ArrayBuffer)
        return messageFromBinary(data);
    if (typeof Blob != "undefined" && data instanceof Blob) {
        return data.arrayBuffer().then(messageFromBinary);
    }
    throw new Error("Unsupported message data type");
}
export class ServiceBroker {
    constructor(url) {
        this.url = url;
        this.providers = new Map();
        this.ws = null;
        this.connectListeners = [];
        this.pendingSend = [];
        this.pendingResponses = new Map();
        this.pendingIdGen = 0;
        this.connect();
    }
    connect() {
        const conn = new WebSocket(this.url);
        conn.binaryType = "arraybuffer";
        conn.onopen = () => this.onOpen(conn);
        conn.onerror = () => {
            console.info("Failed to connect to service broker, retrying in 15");
            setTimeout(() => this.connect(), 15000);
        };
    }
    onOpen(conn) {
        console.info("Connected to service broker", conn);
        this.ws = conn;
        this.ws.onerror = console.error;
        this.ws.onclose = event => this.onClose(event);
        this.ws.onmessage = event => this.onMessage(event);
        for (const listener of this.connectListeners)
            listener();
        for (const { header, payload } of this.pendingSend)
            this.send(header, payload);
        this.pendingSend = [];
    }
    onClose(event) {
        this.ws = null;
        console.info("Lost connection to service broker", event.code, event.reason);
        setTimeout(() => this.connect(), 1000);
    }
    async onMessage(event) {
        try {
            const msg = await messageFromData(event.data);
            console.debug("<<", msg.header, msg.payload);
            if (msg.header.type == "ServiceResponse")
                this.onServiceResponse(msg);
            else if (msg.header.type == "ServiceRequest")
                await this.onServiceRequest(msg);
            else if (msg.header.type == "SbStatusResponse")
                this.onServiceResponse(msg);
            else if (msg.header.error)
                this.onServiceResponse(msg);
            else
                console.error("Unhandled", msg.header);
        }
        catch (err) {
            console.error("Failed to handle message", event.data, err);
        }
    }
    onServiceResponse(message) {
        const id = message.header.id;
        const pendingResponse = this.pendingResponses.get(id);
        if (pendingResponse) {
            this.pendingResponses.delete(id);
            if (message.header.error) {
                pendingResponse.reject(new Error(message.header.error));
            }
            else {
                pendingResponse.fulfill(message);
            }
        }
        else {
            console.error("Response received but no pending request", message.header);
        }
    }
    async onServiceRequest(msg) {
        const service = msg.header.service;
        const provider = this.providers.get(service.name);
        if (provider) {
            try {
                const res = await provider.handler(msg);
                if (msg.header.id) {
                    this.send({
                        ...res?.header,
                        to: msg.header.from,
                        id: msg.header.id,
                        type: "ServiceResponse"
                    }, res?.payload);
                }
            }
            catch (err) {
                if (msg.header.id) {
                    this.send({
                        to: msg.header.from,
                        id: msg.header.id,
                        type: "ServiceResponse",
                        error: err instanceof Error ? err.message : err
                    });
                }
                else {
                    console.error("Failed to handle notification", msg.header, err);
                }
            }
        }
        else {
            console.error("No handler for service", service.name);
        }
    }
    send(header, payload) {
        if (!this.ws) {
            this.pendingSend.push({ header, payload });
            return;
        }
        console.debug(">>", header, payload);
        this.ws.send(this.messageToData(header, payload));
    }
    messageToData(header, payload) {
        if (this.isBinaryPayload(payload))
            return this.messageToBinary(header, payload);
        return JSON.stringify(header) + (payload ? "\n" + payload : "");
    }
    isBinaryPayload(payload) {
        return payload instanceof ArrayBuffer ||
            (typeof Blob != "undefined" && payload instanceof Blob) ||
            (typeof ArrayBuffer != "undefined" && ArrayBuffer.isView(payload));
    }
    messageToBinary(header, payload) {
        const headerBytes = new TextEncoder().encode(JSON.stringify(header) + "\n");
        const payloadBlob = payload instanceof Blob ? payload : new Blob([payload]);
        return new Blob([headerBytes, payloadBlob]);
    }
    request(service, req) {
        return this.requestTo(null, service, req);
    }
    requestTo(endpointId, service, req) {
        const id = ++this.pendingIdGen;
        const promise = new Promise((fulfill, reject) => {
            this.pendingResponses.set(id, { fulfill, reject });
        });
        const header = {
            id: id,
            type: "ServiceRequest",
            service
        };
        if (endpointId)
            header.to = endpointId;
        this.send({ ...req.header, ...header }, req.payload);
        return promise;
    }
    advertise(service, handler) {
        if (this.providers.has(service.name)) {
            throw new Error(service.name + " provider already exists");
        }
        this.providers.set(service.name, { advertisedService: service, handler });
        return this.send({
            type: "SbAdvertiseRequest",
            services: Array.from(this.providers.values())
                .filter(x => x.advertisedService)
                .map(x => x.advertisedService)
        });
    }
    unadvertise(serviceName) {
        if (!this.providers.delete(serviceName)) {
            throw new Error(serviceName + " provider not exists");
        }
        return this.send({
            type: "SbAdvertiseRequest",
            services: Array.from(this.providers.values())
                .filter(x => x.advertisedService)
                .map(x => x.advertisedService)
        });
    }
    setServiceHandler(serviceName, handler) {
        if (this.providers.has(serviceName)) {
            throw new Error(serviceName + " handler already exists");
        }
        this.providers.set(serviceName, { handler });
    }
    setHandler(serviceName, handler) {
        return this.setServiceHandler(serviceName, handler);
    }
    publish(topic, text) {
        return this.send({ type: "ServiceRequest", service: { name: "#" + topic } }, text);
    }
    subscribe(topic, handler) {
        return this.advertise({ name: "#" + topic }, msg => handler(msg.payload));
    }
    unsubscribe(topic) {
        return this.unadvertise("#" + topic);
    }
    async status() {
        const id = ++this.pendingIdGen;
        this.send({ id, type: "SbStatusRequest" });
        const res = await new Promise((fulfill, reject) => this.pendingResponses.set(id, { fulfill, reject }));
        return JSON.parse(res.payload);
    }
    isConnected() {
        return this.ws != null;
    }
    addConnectListener(listener) {
        this.connectListeners.push(listener);
        if (this.isConnected())
            listener();
    }
}
